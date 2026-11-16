import Foundation

protocol SearchService: Sendable {
    var source: SourceID { get }
    func search(_ request: SearchRequest) async throws -> [VideoResult]
}

enum SearchError: LocalizedError, Equatable {
    case offline
    case network(String)
    case http(Int)
    case invalidResponse
    case decoding
    case missingCredentials(String)
    case ageVerificationRequired
    case blocked(String)
    case unavailable(String)

    var errorDescription: String? {
        switch self {
        case .offline: return "You're offline."
        case .network(let m): return m
        case .http(let code):
            switch code {
            case 401: return "Not authorized (401)."
            case 403: return "Access denied (403) — the site may be blocking apps or your region."
            case 404: return "Not found (404)."
            case 429: return "Rate limited (429). Try again in a minute."
            case 451: return "Unavailable in your region (451)."
            case 500...599: return "Site is having problems (\(code))."
            default: return "Unexpected response (\(code))."
            }
        case .invalidResponse: return "Invalid response."
        case .decoding: return "The site changed its format — results couldn't be read."
        case .missingCredentials(let what): return "Needs \(what). Add it in Settings → Sources."
        case .ageVerificationRequired: return "Requires age verification in your region. Open a result from this source to verify."
        case .blocked(let m): return m
        case .unavailable(let m): return m
        }
    }

    static func message(for error: Error) -> String {
        if let e = error as? SearchError { return e.errorDescription ?? "Unknown error." }
        if let e = error as? URLError {
            switch e.code {
            case .notConnectedToInternet, .networkConnectionLost: return SearchError.offline.errorDescription!
            case .timedOut: return "Timed out."
            case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed: return "Couldn't reach the site (it may be blocked on your network)."
            case .secureConnectionFailed, .serverCertificateUntrusted: return "Secure connection failed."
            default: return e.localizedDescription
            }
        }
        if error is DecodingError { return SearchError.decoding.errorDescription! }
        return error.localizedDescription
    }
}

struct HTTPClient: Sendable {
    static let shared = HTTPClient()

    static let mobileUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
    static let desktopUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"

    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 15
        c.timeoutIntervalForResource = 30
        c.httpCookieStorage = .shared
        c.httpAdditionalHeaders = ["Accept-Language": "en-US,en;q=0.9"]
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    func data(_ url: URL, headers: [String: String] = [:], userAgent: String = HTTPClient.mobileUA) async throws -> (Data, HTTPURLResponse) {
        do {
            return try await rawData(url, headers: headers, userAgent: userAgent)
        } catch SearchError.http(429) {
            // Rate limited: wait briefly once, then retry.
            try await Task.sleep(for: .seconds(2.5))
            return try await rawData(url, headers: headers, userAgent: userAgent)
        }
    }

    private func rawData(_ url: URL, headers: [String: String], userAgent: String) async throws -> (Data, HTTPURLResponse) {
        var req = URLRequest(url: url)
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch let e as URLError where e.code == .cancelled {
            throw CancellationError()
        } catch let e as URLError where e.code == .notConnectedToInternet {
            throw SearchError.offline
        }
        guard let http = response as? HTTPURLResponse else { throw SearchError.invalidResponse }
        if AgeGateDetector.isAgeGate(url: http.url) { throw SearchError.ageVerificationRequired }
        guard (200..<300).contains(http.statusCode) else { throw SearchError.http(http.statusCode) }
        return (data, http)
    }

    /// application/x-www-form-urlencoded POST (used for OAuth token requests).
    func postForm(_ url: URL, form: [String: String], headers: [String: String] = [:],
                  userAgent: String = HTTPClient.mobileUA) async throws -> Data {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        req.httpBody = form.map { k, v in
            "\(k)=\(v.addingPercentEncoding(withAllowedCharacters: allowed) ?? v)"
        }.joined(separator: "&").data(using: .utf8)
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw SearchError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw SearchError.http(http.statusCode) }
        return data
    }

    /// GET with a short in-memory cache, so re-running the same search (e.g. toggling a filter
    /// back) doesn't hit the sites again and trigger their rate limits.
    func get(_ url: URL, headers: [String: String] = [:], userAgent: String = HTTPClient.mobileUA) async throws -> Data {
        let key = url.absoluteString + "|" + headers.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ";")
        if let cached = await ResponseCache.shared.value(for: key) { return cached }
        let d = try await data(url, headers: headers, userAgent: userAgent).0
        await ResponseCache.shared.store(d, for: key)
        return d
    }

    static func clearCache() async { await ResponseCache.shared.clear() }

    func string(_ url: URL, headers: [String: String] = [:], userAgent: String = HTTPClient.mobileUA) async throws -> String {
        let d = try await get(url, headers: headers, userAgent: userAgent)
        return String(decoding: d, as: UTF8.self)
    }

    func json<T: Decodable>(_ type: T.Type, from url: URL, headers: [String: String] = [:],
                            userAgent: String = HTTPClient.mobileUA) async throws -> T {
        let d = try await get(url, headers: ["Accept": "application/json"].merging(headers) { $1 }, userAgent: userAgent)
        do {
            return try JSONDecoder().decode(T.self, from: d)
        } catch {
            throw SearchError.decoding
        }
    }
}

extension URL {
    /// Builds a URL from a base string and query items; never crashes on odd input.
    static func make(_ base: String, _ items: [String: String?]) -> URL? {
        guard var c = URLComponents(string: base) else { return nil }
        let q = items.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }.sorted { $0.name < $1.name }
        if !q.isEmpty { c.queryItems = (c.queryItems ?? []) + q }
        // `+` must be escaped explicitly; URLComponents leaves it as-is.
        c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return c.url
    }
}

actor ResponseCache {
    static let shared = ResponseCache()
    private let ttl: TimeInterval = 180
    private var entries: [String: (date: Date, data: Data)] = [:]

    func value(for key: String) -> Data? {
        guard let e = entries[key] else { return nil }
        if Date().timeIntervalSince(e.date) > ttl { entries[key] = nil; return nil }
        return e.data
    }

    func store(_ data: Data, for key: String) {
        if entries.count > 300 {
            let cutoff = Date().addingTimeInterval(-ttl)
            entries = entries.filter { $0.value.date > cutoff }
            if entries.count > 300 { entries.removeAll() }
        }
        entries[key] = (Date(), data)
    }

    func clear() { entries.removeAll() }
}
