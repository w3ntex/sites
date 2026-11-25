import SwiftUI
import SwiftData
import WebKit

// MARK: - Router

/// Opens a result in the best viewer: AVPlayer for direct mp4s (RedGIFs etc.), a native image viewer
/// for direct images, otherwise the full-screen WKWebView player. Logs history while open.
struct MediaViewer: View {
    let result: VideoResult
    @Environment(\.modelContext) private var context
    @State private var entry: HistoryEntry?
    @State private var openedAt = Date()
    @State private var forceWeb = false

    var body: some View {
        Group {
            if !forceWeb, let url = result.nativePlayableURL {
                NativePlayerView(result: result, url: url, loops: result.mediaType == .gif) { forceWeb = true }
            } else if !forceWeb, let url = result.nativeImageURL {
                ImageViewerView(result: result, url: url) { forceWeb = true }
            } else {
                WebPlayerView(result: result)
            }
        }
        .onAppear {
            guard entry == nil else { return }
            openedAt = .now
            entry = Library.logOpen(result, in: context)
        }
        .onDisappear {
            guard let entry else { return }
            entry.watchDuration += Date().timeIntervalSince(openedAt)
            try? context.save()
        }
    }
}

// MARK: - Shared chrome

struct ViewerTopBar<Trailing: View>: View {
    let result: VideoResult
    var subtitle: String? = nil
    var onClose: () -> Void
    @ViewBuilder var trailing: () -> Trailing
    @Environment(\.modelContext) private var context
    @State private var isFavorite = false

    var body: some View {
        HStack(spacing: 14) {
            Button {
                Haptics.light()
                onClose()
            } label: {
                Image(systemName: "xmark").font(.body.weight(.bold))
                    .frame(width: 34, height: 34)
                    .background(Theme.surfaceHigh, in: Circle())
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(result.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(subtitle ?? result.sourceName).font(.caption2).foregroundStyle(Theme.secondaryText).lineLimit(1)
            }
            Spacer(minLength: 4)
            trailing()
            Button {
                isFavorite = Library.toggleFavorite(result, in: context)
            } label: {
                Image(systemName: isFavorite ? "heart.fill" : "heart")
                    .foregroundStyle(isFavorite ? Theme.accent : .white)
                    .font(.title3)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.black)
        .onAppear { isFavorite = Library.isFavorite(result, in: context) }
    }
}

// MARK: - Web player

struct WebPlayerView: View {
    let result: VideoResult
    @StateObject private var model: WebPlayerModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var showControls = true
    @State private var scrubbing = false
    @State private var scrubValue: Double = 0
    @State private var safariURL: URL?
    @State private var awaitingExternalVerification = false
    @State private var toast: String?
    @State private var playlistTarget: VideoResult?

    init(result: VideoResult) {
        self.result = result
        _model = StateObject(wrappedValue: WebPlayerModel(result: result))
    }

    var body: some View {
        VStack(spacing: 0) {
            ViewerTopBar(result: result, subtitle: model.host, onClose: close) {
                if model.canGoBack {
                    Button { model.webView.goBack() } label: { Image(systemName: "chevron.backward").font(.title3) }
                }
                downloadButton
                moreMenu
            }
            ProgressView(value: model.progress)
                .progressViewStyle(.linear)
                .tint(Theme.accent)
                .frame(height: 2)
                .opacity(model.isLoading ? 1 : 0)

            ZStack {
                WebViewContainer(webView: model.webView)
                if let error = model.loadError {
                    VStack(spacing: 12) {
                        Image(systemName: "wifi.exclamationmark").font(.largeTitle).foregroundStyle(Theme.accent)
                        Text(error).multilineTextAlignment(.center).foregroundStyle(.white)
                        Button("Retry") { model.reloadOriginal() }.buttonStyle(.borderedProminent)
                    }
                    .padding(24)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                    .padding(32)
                }
            }

            controls
        }
        .background(Color.black.ignoresSafeArea())
        .task { await model.start() }
        .onDisappear { model.teardown() }
        .onChange(of: model.currentTime) { _, t in if !scrubbing { scrubValue = t } }
        .onChange(of: scenePhase) { _, phase in
            // Returning from the Yoti app: reload so the site picks up the verification.
            if phase == .active && awaitingExternalVerification {
                awaitingExternalVerification = false
                model.reloadOriginal()
            }
        }
        .sheet(item: $model.ageGate) { gate in
            AgeVerificationSheet(gate: gate,
                                 onYoti: { awaitingExternalVerification = true },
                                 onBrowser: { safariURL = gate.verificationURL ?? gate.originalURL },
                                 onInApp: { model.load(gate.verificationURL ?? gate.originalURL) })
                .presentationDetents([.medium])
        }
        .fullScreenCover(item: $safariURL) { url in
            SafariView(url: url) {
                safariURL = nil
                model.reloadOriginal()
            }
            .ignoresSafeArea()
        }
        .sheet(item: $playlistTarget) { r in
            AddToPlaylistSheet(result: r) { toast = "Added to \($0)" }.presentationDetents([.medium, .large])
        }
        .toast($toast)
        .statusBarHidden(false)
    }

    private func close() {
        model.teardown()
        dismiss()
    }

    @ViewBuilder
    private var downloadButton: some View {
        if !model.mediaURLs.isEmpty {
            Menu {
                Section("Detected video files") {
                    ForEach(model.mediaURLs, id: \.self) { url in
                        Button {
                            Task {
                                let ok = await model.download(url)
                                toast = ok ? "Download started" : "Already downloaded or in progress"
                                if ok { Haptics.success() } else { Haptics.warning() }
                            }
                        } label: {
                            Label(model.label(for: url), systemImage: "arrow.down.circle")
                        }
                    }
                }
            } label: {
                Image(systemName: "arrow.down.circle.fill").font(.title3).foregroundStyle(Theme.accent)
            }
        }
    }

    private var moreMenu: some View {
        Menu {
            Button { model.reloadOriginal() } label: { Label("Reload", systemImage: "arrow.clockwise") }
            Button { playlistTarget = result } label: { Label("Add to playlist…", systemImage: "text.badge.plus") }
            ShareLink(item: model.webView.url ?? result.pageURL) { Label("Share", systemImage: "square.and.arrow.up") }
            Button { safariURL = model.webView.url ?? result.pageURL } label: { Label("Open in Safari view", systemImage: "safari") }
            Button { withAnimation { showControls.toggle() } } label: {
                Label(showControls ? "Hide controls" : "Show controls", systemImage: "slider.horizontal.below.rectangle")
            }
        } label: {
            Image(systemName: "ellipsis.circle").font(.title3)
        }
    }

    @ViewBuilder
    private var controls: some View {
        VStack(spacing: 10) {
            if let offer = model.resumeOffer {
                HStack {
                    Image(systemName: "clock.arrow.circlepath").foregroundStyle(Theme.accent)
                    Text("Resume from \(Format.duration(offer))?").font(.subheadline)
                    Spacer()
                    Button("Resume") {
                        Haptics.medium()
                        model.seek(to: offer)
                        model.resumeOffer = nil
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    Button { model.resumeOffer = nil } label: { Image(systemName: "xmark") }
                        .foregroundStyle(Theme.secondaryText)
                }
                .padding(10)
                .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 12))
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if showControls {
                if model.hasVideo {
                    HStack(spacing: 8) {
                        Text(Format.duration(scrubbing ? scrubValue : model.currentTime))
                            .font(.caption.monospacedDigit())
                        Slider(value: $scrubValue, in: 0...max(model.duration, 1), onEditingChanged: { editing in
                            scrubbing = editing
                            if !editing { model.seek(to: scrubValue) }
                        })
                        Text(Format.duration(model.duration)).font(.caption.monospacedDigit())
                    }
                    HStack(spacing: 30) {
                        Button { model.skip(-10) } label: { Image(systemName: "gobackward.10") }
                        Button {
                            Haptics.light()
                            model.togglePlay()
                        } label: {
                            Image(systemName: model.isPaused ? "play.fill" : "pause.fill").font(.title)
                        }
                        Button { model.skip(10) } label: { Image(systemName: "goforward.10") }
                        Spacer()
                        Button { model.togglePiP() } label: { Image(systemName: "pip.enter") }
                        Button { model.enterFullscreen() } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }
                    }
                    .font(.title3)
                } else {
                    HStack(spacing: 8) {
                        if model.isLoading { ProgressView().controlSize(.small).tint(.white) }
                        Text(model.isLoading ? "Loading page…" : "Start the video on the page to enable controls.")
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                        Spacer()
                    }
                }
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, showControls || model.resumeOffer != nil ? 10 : 0)
        .background(Color.black)
        .animation(.easeOut(duration: 0.2), value: model.resumeOffer)
        .animation(.easeOut(duration: 0.2), value: model.hasVideo)
    }
}

extension URL: Identifiable {
    public var id: String { absoluteString }
}

struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Breaks the retain cycle between WKUserContentController and the model.
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(ucc, didReceive: message)
    }
}

struct AgeGateInfo: Identifiable, Equatable {
    let id = UUID()
    let provider: AgeGateDetector.Provider
    let verificationURL: URL?
    let originalURL: URL
}

// MARK: - Web player model

@MainActor
final class WebPlayerModel: NSObject, ObservableObject {
    let result: VideoResult
    let webView: WKWebView

    @Published var isLoading = true
    @Published var progress: Double = 0
    @Published var canGoBack = false
    @Published var loadError: String?
    @Published var hasVideo = false
    @Published var isPaused = true
    @Published var currentTime: Double = 0
    @Published var duration: Double = 0
    @Published var mediaURLs: [URL] = []
    @Published var ageGate: AgeGateInfo?
    @Published var resumeOffer: Double?

    private var videoFrame: WKFrameInfo?
    private var lastSave = Date.distantPast
    private var resumeChecked = false
    private var promptedHosts = Set<String>()
    private var observations: [NSKeyValueObservation] = []
    private var started = false
    private var tornDown = false

    var host: String { webView.url?.host ?? result.pageURL.host ?? result.sourceName }

    init(result: VideoResult) {
        self.result = result
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()            // shares cookies (age verification tokens) across sessions
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.allowsAirPlayForMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        let ucc = config.userContentController
        ucc.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentEnd,
                                       forMainFrameOnly: false, in: .defaultClient))
        if AppSettings.shared.adBlockEnabled { ucc.addUserScript(AdBlocker.pageScript) }
        ucc.add(WeakScriptHandler(self), contentWorld: .defaultClient, name: "sxPlayer")

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = HTTPClient.mobileUA
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        observations = [
            webView.observe(\.estimatedProgress) { [weak self] wv, _ in
                let p = wv.estimatedProgress
                Task { @MainActor in self?.progress = p }
            },
            webView.observe(\.isLoading) { [weak self] wv, _ in
                let l = wv.isLoading
                Task { @MainActor in self?.isLoading = l }
            },
            webView.observe(\.canGoBack) { [weak self] wv, _ in
                let b = wv.canGoBack
                Task { @MainActor in self?.canGoBack = b }
            }
        ]
    }

    func start() async {
        guard !started else { return }
        started = true
        if AppSettings.shared.adBlockEnabled, let rules = await AdBlocker.ruleList() {
            webView.configuration.userContentController.add(rules)
        }
        load(result.pageURL)
    }

    func load(_ url: URL) {
        loadError = nil
        webView.load(URLRequest(url: url))
    }

    func reloadOriginal() {
        hasVideo = false
        mediaURLs = []
        resumeChecked = false
        load(result.pageURL)
    }

    func teardown() {
        guard !tornDown else { return }
        tornDown = true
        saveProgress(force: true)
        command("pause")
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "sxPlayer", contentWorld: .defaultClient)
        observations.removeAll()
    }

    // MARK: Player commands (executed in the frame that owns the <video>)

    private func command(_ name: String, _ arg: Double? = nil) {
        let js = "window.__sxCmd && window.__sxCmd('\(name)', \(arg.map { String($0) } ?? "null"))"
        webView.evaluateJavaScript(js, in: videoFrame, in: .defaultClient) { _ in }
    }

    func togglePlay() { isPaused.toggle(); command("toggle") }
    func seek(to t: Double) { currentTime = t; command("seek", t) }
    func skip(_ delta: Double) { seek(to: max(0, min(duration, currentTime + delta))) }
    func enterFullscreen() { command("fs") }
    func togglePiP() { command("pip") }

    // MARK: Downloads

    func label(for url: URL) -> String {
        let s = url.absoluteString
        for q in ["2160", "1080", "720", "480", "360", "240"] where s.contains(q) { return "\(q)p · \(url.lastPathComponent)" }
        return url.lastPathComponent.isEmpty ? (url.host ?? "video") : url.lastPathComponent
    }

    func download(_ url: URL) async -> Bool {
        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        return DownloadManager.shared.start(remoteURL: url, result: result,
                                            referer: webView.url ?? result.pageURL, cookies: cookies)
    }

    // MARK: Progress

    private func saveProgress(force: Bool = false) {
        guard currentTime > 3, duration > 0 else { return }
        guard force || Date().timeIntervalSince(lastSave) > 5 else { return }
        lastSave = Date()
        Library.saveProgress(key: result.progressKey, position: currentTime, duration: duration, in: Persistence.context)
    }

    private func checkResume() {
        guard !resumeChecked, duration > 0 else { return }
        resumeChecked = true
        if let p = Library.progress(for: result.progressKey, in: Persistence.context),
           p.isResumable, p.position < duration - 15, currentTime < p.position - 5 {
            resumeOffer = p.position
        }
    }

    fileprivate func handleMessage(_ body: Any, frame: WKFrameInfo) {
        guard let dict = body as? [String: Any], let type = dict["type"] as? String else { return }
        switch type {
        case "state":
            let d = (dict["d"] as? Double) ?? 0
            // Ignore tiny preview/ad clips once a real video has been seen.
            if hasVideo && d > 0 && d < 20 && duration > 60 { return }
            videoFrame = frame
            hasVideo = true
            duration = d
            currentTime = (dict["t"] as? Double) ?? 0
            isPaused = (dict["paused"] as? Bool) ?? true
            checkResume()
            saveProgress()
        case "mp4":
            guard let s = dict["url"] as? String, let url = URL(string: s),
                  url.scheme?.hasPrefix("http") == true, !AdBlocker.isAdHost(url),
                  !mediaURLs.contains(url), mediaURLs.count < 12 else { return }
            mediaURLs.append(url)
            mediaURLs.sort { qualityRank($0) > qualityRank($1) }
        default:
            break
        }
    }

    private func qualityRank(_ url: URL) -> Int {
        let s = url.absoluteString
        if s.contains("2160") { return 6 }
        if s.contains("1080") { return 5 }
        if s.contains("720") { return 4 }
        if s.contains("480") { return 3 }
        if s.contains("360") { return 2 }
        return 1
    }

    fileprivate func presentAgeGate(_ provider: AgeGateDetector.Provider, link: URL?) {
        let host = webView.url?.host ?? result.pageURL.host ?? ""
        guard !promptedHosts.contains(host), ageGate == nil else { return }
        promptedHosts.insert(host)
        Haptics.warning()
        ageGate = AgeGateInfo(provider: provider, verificationURL: link, originalURL: result.pageURL)
    }

    /// Injected into every frame (isolated content world): reports <video> state, finds direct mp4 URLs,
    /// and exposes `__sxCmd` for the native controls.
    static let bridgeScript = #"""
    (function () {
      if (window.__sxBridge) return; window.__sxBridge = true;
      function post(m) { try { window.webkit.messageHandlers.sxPlayer.postMessage(m); } catch (e) {} }
      function video() {
        var vs = Array.prototype.slice.call(document.querySelectorAll('video'));
        vs.sort(function (a, b) { return (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight); });
        return vs[0] || null;
      }
      var seen = {};
      function report(u) {
        if (!u || seen[u] || !/^https?:/i.test(u)) return;
        seen[u] = 1; post({ type: 'mp4', url: u });
      }
      function scan() {
        document.querySelectorAll('video, video source').forEach(function (el) {
          var s = el.currentSrc || el.src;
          if (s && /\.mp4(\?|$)/i.test(s)) report(s);
        });
        try {
          performance.getEntriesByType('resource').forEach(function (e) {
            if (/\.mp4(\?|$)/i.test(e.name)) report(e.name);
          });
        } catch (e) {}
        var html = document.documentElement.innerHTML;
        var re = /https?:\\?\/\\?\/[^"'\s<>]+?\.mp4[^"'\s<>]*/gi, m, n = 0;
        while ((m = re.exec(html)) && n < 25) { report(m[0].replace(/\\\//g, '/').replace(/&amp;/g, '&')); n++; }
      }
      setInterval(function () {
        var v = video();
        if (v) {
          v.setAttribute('playsinline', '');
          post({ type: 'state', t: v.currentTime || 0, d: isFinite(v.duration) ? v.duration : 0, paused: v.paused });
        }
      }, 1000);
      setInterval(scan, 2500);
      setTimeout(scan, 600);
      window.__sxCmd = function (c, a) {
        var v = video(); if (!v) return false;
        switch (c) {
          case 'toggle': if (v.paused) { v.play(); } else { v.pause(); } break;
          case 'pause': v.pause(); break;
          case 'seek': v.currentTime = a; break;
          case 'fs':
            if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
            else if (v.requestFullscreen) v.requestFullscreen();
            break;
          case 'pip':
            if (v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode('picture-in-picture')) {
              v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
            } else if (document.pictureInPictureEnabled) {
              if (document.pictureInPictureElement) document.exitPictureInPicture(); else v.requestPictureInPicture();
            }
            break;
        }
        return true;
      };
    })();
    """#
}

extension WebPlayerModel: WKScriptMessageHandler {
    nonisolated func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated {
            self.handleMessage(message.body, frame: message.frameInfo)
        }
    }
}

extension WebPlayerModel: WKNavigationDelegate, WKUIDelegate {
    nonisolated func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                             decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        MainActor.assumeIsolated {
            guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
            let scheme = url.scheme?.lowercased() ?? ""
            // Block app-store / custom-scheme redirects that ads use to hijack the session.
            guard ["http", "https", "about", "blob", "data"].contains(scheme) else { decisionHandler(.cancel); return }
            let isMain = navigationAction.targetFrame?.isMainFrame ?? true
            if isMain && AdBlocker.isAdHost(url) && AppSettings.shared.adBlockEnabled {
                decisionHandler(.cancel); return
            }
            if isMain, let provider = AgeGateDetector.provider(for: url) {
                presentAgeGate(provider, link: url)
            }
            decisionHandler(.allow)
        }
    }

    nonisolated func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        MainActor.assumeIsolated { loadError = nil }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated {
            webView.evaluateJavaScript(AgeGateDetector.detectionScript) { [weak self] value, _ in
                guard let self, let json = value as? String, let data = json.data(using: .utf8),
                      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return }
                let link = obj["link"].flatMap { $0.isEmpty ? nil : URL(string: $0) }
                if let provider = AgeGateDetector.provider(inHTML: obj["html"] ?? "") ?? AgeGateDetector.provider(for: link) {
                    self.presentAgeGate(provider, link: link)
                }
            }
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { handleLoadError(error) }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { handleLoadError(error) }
    }

    private func handleLoadError(_ error: Error) {
        let ns = error as NSError
        // -999 = cancelled (we or the page navigated away); 102 = frame load interrupted (downloads / blocked redirects).
        if ns.code == NSURLErrorCancelled || (ns.domain == "WebKitErrorDomain" && ns.code == 102) { return }
        if ns.domain == "WebKitErrorDomain" && ns.code == 104 { return } // blocked by content rules
        loadError = SearchError.message(for: error)
    }

    /// Popups: open same-site links in place, drop everything else (popunders).
    nonisolated func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                             for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        MainActor.assumeIsolated {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url,
               !AdBlocker.isAdHost(url), Self.sameSite(url, webView.url) {
                webView.load(navigationAction.request)
            }
        }
        return nil
    }

    nonisolated static func sameSite(_ a: URL?, _ b: URL?) -> Bool {
        func base(_ u: URL?) -> String? {
            guard let parts = u?.host?.lowercased().split(separator: "."), parts.count >= 2 else { return nil }
            return parts.suffix(2).joined(separator: ".")
        }
        guard let x = base(a), let y = base(b) else { return false }
        return x == y
    }
}
