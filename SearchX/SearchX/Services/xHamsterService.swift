import Foundation

/// Tries xHamster's front-end JSON API, then falls back to the `window.initials` JSON embedded in the search page.
struct XHamsterService: SearchService {
    let source = SourceID.xhamster

    func search(_ r: SearchRequest) async throws -> [VideoResult] {
        var apiError: Error?
        do {
            if let url = URL.make("https://xhamster.com/api/front/search", [
                "search": r.keyword, "page": String(r.page)
            ]) {
                let data = try await HTTPClient.shared.get(url, headers: ["Accept": "application/json",
                                                                          "X-Requested-With": "XMLHttpRequest"])
                if let obj = try? JSONSerialization.jsonObject(with: data) {
                    let results = Self.extract(from: obj)
                    if !results.isEmpty { return results }
                }
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            apiError = error
        }

        // Fallback: scrape the HTML search page.
        let path = r.keyword.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))) ?? r.keyword
        let sort: String? = {
            switch r.filters.sort {
            case .relevance: return nil
            case .mostViewed: return "views"
            case .newest: return "newest"
            case .topRated: return "rating"
            }
        }()
        guard let url = URL.make("https://xhamster.com/search/\(path)", [
            "page": r.page > 1 ? String(r.page) : nil, "sort": sort
        ]) else { throw apiError ?? SearchError.invalidResponse }

        let html = try await HTTPClient.shared.string(url, userAgent: HTTPClient.desktopUA)
        guard let json = Self.initialsJSON(in: html),
              let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) else {
            if html.contains("thumb-list") || html.contains("video-thumb") { return [] }
            throw apiError ?? SearchError.decoding
        }
        return Self.extract(from: obj)
    }

    /// Pulls the JSON assigned to `window.initials` out of the page.
    static func initialsJSON(in html: String) -> String? {
        guard let start = html.range(of: "window.initials=") ?? html.range(of: "window.initials ="),
              let end = html.range(of: "</script>", range: start.upperBound..<html.endIndex) else { return nil }
        var s = String(html[start.upperBound..<end.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasSuffix(";") { s.removeLast() }
        return s
    }

    /// Walks arbitrary JSON looking for video thumb objects (have pageURL + thumbURL/imageURL).
    static func extract(from obj: Any) -> [VideoResult] {
        var seen = Set<String>()
        var out: [VideoResult] = []

        func visit(_ node: Any, depth: Int) {
            guard depth < 14 else { return }
            if let dict = node as? [String: Any] {
                if let page = dict["pageURL"] as? String, page.contains("/videos/"),
                   let thumb = (dict["thumbURL"] as? String) ?? (dict["imageURL"] as? String),
                   let pageURL = Parse.url(page), let thumbURL = Parse.url(thumb),
                   !seen.contains(pageURL.absoluteString) {
                    seen.insert(pageURL.absoluteString)
                    let id = (dict["id"] as? Int).map(String.init) ?? (dict["id"] as? String) ?? pageURL.lastPathComponent
                    let views = (dict["views"] as? Int) ?? Parse.compactNumber(dict["views"] as? String)
                    let isUHD = (dict["isUHD"] as? Bool) ?? false
                    let isHD = (dict["isHD"] as? Bool) ?? false
                    let created = (dict["created"] as? Double).map { Date(timeIntervalSince1970: $0) }
                    var rating: Double?
                    if let r = dict["rating"] as? [String: Any], let v = r["value"] as? Double { rating = v <= 1 ? v * 100 : v }
                    var creator: String?
                    for key in ["landing", "uploader", "author", "user", "channel"] {
                        if let d = dict[key] as? [String: Any], let n = d["name"] as? String, !n.isEmpty { creator = n; break }
                    }
                    creator = creator ?? (dict["uploaderName"] as? String) ?? (dict["channelName"] as? String)
                    out.append(VideoResult(
                        source: .xhamster, rawID: id,
                        title: HTML.decodeEntities((dict["title"] as? String) ?? "Untitled"),
                        duration: (dict["duration"] as? Int) ?? Parse.clockDuration(dict["duration"] as? String),
                        thumbnail: thumbURL, viewCount: views, rating: rating,
                        pageURL: pageURL, mediaType: .video, publishedAt: created,
                        resolutionHeight: isUHD ? 2160 : (isHD ? 720 : nil),
                        creators: creator.map { [HTML.decodeEntities($0)] } ?? []))
                    return
                }
                for v in dict.values { visit(v, depth: depth + 1) }
            } else if let arr = node as? [Any] {
                for v in arr { visit(v, depth: depth + 1) }
            }
        }
        visit(obj, depth: 0)
        return out
    }
}
