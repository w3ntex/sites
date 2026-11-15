import Foundation

/// X.com search requires a logged-in session, so results come from public Nitter mirrors
/// (configurable in Settings). Media-only; links open the original post on x.com.
struct XcomService: SearchService {
    let source = SourceID.xcom

    func search(_ r: SearchRequest) async throws -> [VideoResult] {
        let instances = Credentials.nitterInstances
        guard !instances.isEmpty else { throw SearchError.missingCredentials("at least one Nitter instance") }
        let query = "\(r.keyword) porn"
        var lastError: Error = SearchError.unavailable("No Nitter instance responded.")

        for host in instances {
            try Task.checkCancellation()
            guard let url = URL.make("https://\(host)/search", [
                "f": "tweets", "q": query, "f-media": "on"
            ]) else { continue }
            do {
                let html = try await HTTPClient.shared.string(url, userAgent: HTTPClient.desktopUA)
                guard html.contains("timeline") else { continue }   // bot wall / error page
                return Self.parse(html, instance: host)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                lastError = error
            }
        }
        throw (lastError as? SearchError) ?? SearchError.unavailable("Nitter instances unavailable: \(SearchError.message(for: lastError))")
    }

    /// Maps a Nitter "/pic/..." proxy path back to the original twimg.com URL.
    static func twimgURL(fromNitterPath path: String) -> URL? {
        var p = HTML.decodeEntities(path)
        guard let r = p.range(of: "/pic/") else { return Parse.url(p) }
        p = String(p[r.upperBound...])
        if p.hasPrefix("orig/") { p.removeFirst(5) }
        p = p.removingPercentEncoding ?? p
        if p.hasPrefix("http") { return URL(string: p) }
        return URL(string: "https://pbs.twimg.com/" + p)
    }

    static func parse(_ html: String, instance: String) -> [VideoResult] {
        let items = html.components(separatedBy: "class=\"timeline-item").dropFirst()
        var out: [VideoResult] = []
        for item in items {
            guard let link = Rx.matches(#"class="tweet-link" href="/([^/"]+)/status/(\d+)"#, in: item).first,
                  link.count >= 3,
                  let page = URL(string: "https://x.com/\(link[1])/status/\(link[2])") else { continue }
            let user = link[1], statusID = link[2]
            let text = Rx.first(#"<div class="tweet-content[^"]*"[^>]*>(.*?)</div>"#, in: item).map(HTML.stripTags) ?? ""

            var type: MediaType?
            var thumb: URL?
            if let poster = Rx.first(#"<video[^>]*poster="([^"]+)""#, in: item) {
                type = item.contains("class=\"gif\"") || item.contains("gallery-gif") ? .gif : .video
                thumb = twimgURL(fromNitterPath: poster)
            } else if let img = Rx.first(#"class="still-image"[^>]*href="([^"]+)""#, in: item)
                        ?? Rx.first(#"<div class="attachment image">\s*<a[^>]*href="([^"]+)""#, in: item) {
                type = .image
                thumb = twimgURL(fromNitterPath: img)
            }
            guard let type, let thumb else { continue }
            let likes = Rx.first(#"icon-heart[^<]*</span>\s*([\d,\.KM]+)"#, in: item)

            out.append(VideoResult(
                source: .xcom, rawID: statusID,
                title: text.isEmpty ? "@\(user)" : "@\(user): \(text)",
                duration: nil, thumbnail: thumb, viewCount: nil, rating: nil,
                pageURL: page, mediaType: type,
                directMediaURL: type == .image ? thumb : nil,
                likes: Parse.compactNumber(likes),
                creators: ["@\(user)"]))
        }
        return out
    }
}
