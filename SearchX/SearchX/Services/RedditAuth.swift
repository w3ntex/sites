import Foundation
import AuthenticationServices
import UIKit

/// Reddit OAuth ("installed app" flow). Reddit blocks most anonymous API traffic, so signing in
/// with the user's own account is the reliable way to search (NSFW visibility follows the account's
/// "Show mature content" preference, same as the official app).
actor RedditTokenStore {
    static let shared = RedditTokenStore()
    static let redirectURI = "searchx://reddit-auth"
    static let userAgent = "ios:com.searchx.app:v1.0 (personal use)"

    private var d: UserDefaults { .standard }

    nonisolated static var clientID: String {
        (UserDefaults.standard.string(forKey: SettingsKeys.redditClientID) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated static var isSignedIn: Bool {
        !clientID.isEmpty && UserDefaults.standard.string(forKey: SettingsKeys.redditRefreshToken) != nil
    }

    private struct TokenResponse: Decodable {
        let access_token: String?
        let refresh_token: String?
        let expires_in: Double?
        let error: String?
    }

    /// A valid access token, refreshing it if needed. `nil` when not signed in.
    func validToken() async throws -> String? {
        guard Self.isSignedIn, let refresh = d.string(forKey: SettingsKeys.redditRefreshToken) else { return nil }
        if let token = d.string(forKey: SettingsKeys.redditAccessToken),
           d.double(forKey: SettingsKeys.redditTokenExpiry) > Date().timeIntervalSince1970 + 60 {
            return token
        }
        try await requestToken(["grant_type": "refresh_token", "refresh_token": refresh])
        return d.string(forKey: SettingsKeys.redditAccessToken)
    }

    func exchange(code: String) async throws {
        try await requestToken(["grant_type": "authorization_code", "code": code, "redirect_uri": Self.redirectURI])
    }

    func invalidateAccessToken() {
        d.removeObject(forKey: SettingsKeys.redditAccessToken)
        d.removeObject(forKey: SettingsKeys.redditTokenExpiry)
    }

    func signOut() {
        for k in [SettingsKeys.redditAccessToken, SettingsKeys.redditRefreshToken,
                  SettingsKeys.redditTokenExpiry, SettingsKeys.redditUsername] {
            d.removeObject(forKey: k)
        }
    }

    func fetchUsername() async throws -> String {
        guard let token = try await validToken() else { throw SearchError.missingCredentials("a Reddit login") }
        struct Me: Decodable { let name: String }
        let me = try await HTTPClient.shared.json(Me.self, from: URL(string: "https://oauth.reddit.com/api/v1/me")!,
                                                  headers: ["Authorization": "Bearer \(token)"],
                                                  userAgent: Self.userAgent)
        return me.name
    }

    private func requestToken(_ form: [String: String]) async throws {
        let basic = Data("\(Self.clientID):".utf8).base64EncodedString()
        let data: Data
        do {
            data = try await HTTPClient.shared.postForm(
                URL(string: "https://www.reddit.com/api/v1/access_token")!, form: form,
                headers: ["Authorization": "Basic \(basic)"], userAgent: Self.userAgent)
        } catch SearchError.http(let code) where code == 400 || code == 401 {
            signOut()
            throw SearchError.unavailable("Reddit login expired. Reconnect in Settings → Sources → Reddit.")
        }
        guard let resp = try? JSONDecoder().decode(TokenResponse.self, from: data),
              let access = resp.access_token else {
            let err = (try? JSONDecoder().decode(TokenResponse.self, from: data))?.error ?? "unknown error"
            if err == "invalid_grant" { signOut() }
            throw SearchError.unavailable("Reddit login failed (\(err)).")
        }
        d.set(access, forKey: SettingsKeys.redditAccessToken)
        d.set(Date().timeIntervalSince1970 + (resp.expires_in ?? 3600), forKey: SettingsKeys.redditTokenExpiry)
        if let refresh = resp.refresh_token { d.set(refresh, forKey: SettingsKeys.redditRefreshToken) }
    }
}

/// Presents Reddit's login/consent page and completes the OAuth exchange.
@MainActor
final class RedditLogin: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = RedditLogin()
    private var session: ASWebAuthenticationSession?

    /// Returns the Reddit username on success.
    func signIn() async throws -> String {
        let clientID = RedditTokenStore.clientID
        guard !clientID.isEmpty else { throw SearchError.missingCredentials("a Reddit client ID") }
        let state = UUID().uuidString
        var c = URLComponents(string: "https://www.reddit.com/api/v1/authorize.compact")!
        c.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "redirect_uri", value: RedditTokenStore.redirectURI),
            URLQueryItem(name: "duration", value: "permanent"),
            URLQueryItem(name: "scope", value: "identity read")
        ]
        guard let authURL = c.url else { throw SearchError.invalidResponse }

        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: authURL, callbackURLScheme: "searchx") { url, error in
                if let url { cont.resume(returning: url) }
                else { cont.resume(throwing: error ?? URLError(.cancelled)) }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false   // reuse an existing Safari login
            session = s
            if !s.start() {
                cont.resume(throwing: SearchError.unavailable("Couldn't open the Reddit login page."))
            }
        }
        session = nil

        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        if let error = value("error") {
            throw SearchError.unavailable(error == "access_denied" ? "Reddit login was cancelled." : "Reddit login failed (\(error)).")
        }
        guard value("state") == state, var code = value("code") else {
            throw SearchError.unavailable("Reddit login failed (invalid response).")
        }
        if code.hasSuffix("#_") { code.removeLast(2) }
        try await RedditTokenStore.shared.exchange(code: code)
        return try await RedditTokenStore.shared.fetchUsername()
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}
