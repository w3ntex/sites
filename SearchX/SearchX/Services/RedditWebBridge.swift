import Foundation
import WebKit
import SwiftUI

/// Runs Reddit's JSON search *inside* a hidden WKWebView on www.reddit.com, so requests carry the
/// user's own Reddit web session (cookies) like a normal browser. No API app registration needed.
/// Login happens in `RedditWebLoginView`; both share `WKWebsiteDataStore.default()`.
@MainActor
final class RedditWebBridge: NSObject, WKNavigationDelegate {
    static let shared = RedditWebBridge()

    private var webView: WKWebView?
    private var ready = false
    private var waiters: [CheckedContinuation<Void, Error>] = []

    // MARK: Session state

    static func isLoggedIn() async -> Bool {
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        return cookies.contains { $0.name == "reddit_session" && $0.domain.hasSuffix("reddit.com") && !$0.value.isEmpty }
    }

    static func logOut() async {
        let store = WKWebsiteDataStore.default()
        let records = await store.dataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes())
        let reddit = records.filter { $0.displayName.contains("reddit") || $0.displayName.contains("redd.it") }
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: reddit)
        shared.ready = false
    }

    /// Lets NSFW listings through for logged-out sessions too.
    private static func setOver18Cookie() async {
        let props: [HTTPCookiePropertyKey: Any] = [
            .domain: ".reddit.com", .path: "/", .name: "over18", .value: "1",
            .secure: "TRUE", .expires: Date().addingTimeInterval(365 * 24 * 3600)
        ]
        if let cookie = HTTPCookie(properties: props) {
            await WKWebsiteDataStore.default().httpCookieStore.setCookie(cookie)
        }
    }

    // MARK: Fetch

    /// GETs a www.reddit.com URL from within the page and returns the body.
    func get(_ url: URL) async throws -> Data {
        try await ensureReady()
        guard let webView else { throw SearchError.invalidResponse }
        let js = """
        const r = await fetch(u, { credentials: 'include', headers: { 'Accept': 'application/json' } });
        return [r.status, await r.text()];
        """
        let value: Any?
        do {
            value = try await webView.callAsyncJavaScript(js, arguments: ["u": url.absoluteString], contentWorld: .page)
        } catch {
            ready = false
            throw SearchError.network("Reddit request failed: \(error.localizedDescription)")
        }
        guard let arr = value as? [Any], arr.count == 2,
              let status = (arr[0] as? NSNumber)?.intValue, let body = arr[1] as? String else {
            throw SearchError.invalidResponse
        }
        guard (200..<300).contains(status) else { throw SearchError.http(status) }
        return Data(body.utf8)
    }

    private func ensureReady() async throws {
        if ready, webView?.url?.host?.hasSuffix("reddit.com") == true { return }
        await Self.setOver18Cookie()
        let wv = webView ?? makeWebView()
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            waiters.append(cont)
            if waiters.count == 1 {
                var req = URLRequest(url: URL(string: "https://www.reddit.com/robots.txt")!)
                req.timeoutInterval = 15
                wv.load(req)
            }
        }
        ready = true
    }

    private func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: config)
        wv.customUserAgent = HTTPClient.mobileUA
        wv.navigationDelegate = self
        wv.alpha = 0.01
        wv.isUserInteractionEnabled = false
        // Keep it in the window so iOS doesn't throttle its JavaScript.
        if let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows).first(where: \.isKeyWindow) {
            window.addSubview(wv)
        }
        webView = wv
        return wv
    }

    private func finish(_ error: Error?) {
        let pending = waiters
        waiters = []
        for w in pending {
            if let error { w.resume(throwing: error) } else { w.resume() }
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated { finish(nil) }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { finish(SearchError.network("Couldn't reach Reddit: \(error.localizedDescription)")) }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { finish(SearchError.network("Couldn't reach Reddit: \(error.localizedDescription)")) }
    }
}

// MARK: - Login sheet

/// Reddit's normal login page in a web view. Closes itself once the session cookie appears.
struct RedditWebLoginView: View {
    var onDone: (Bool) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            RedditLoginWebView {
                Haptics.success()
                onDone(true)
                dismiss()
            }
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle("Log in to Reddit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        Task {
                            onDone(await RedditWebBridge.isLoggedIn())
                            dismiss()
                        }
                    }
                }
            }
        }
    }
}

private struct RedditLoginWebView: UIViewRepresentable {
    var onLoggedIn: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onLoggedIn: onLoggedIn) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.customUserAgent = HTTPClient.mobileUA
        wv.navigationDelegate = context.coordinator
        wv.load(URLRequest(url: URL(string: "https://www.reddit.com/login/")!))
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onLoggedIn: () -> Void
        private var done = false
        init(onLoggedIn: @escaping () -> Void) { self.onLoggedIn = onLoggedIn }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in
                guard !done, await RedditWebBridge.isLoggedIn() else { return }
                done = true
                onLoggedIn()
            }
        }
    }
}
