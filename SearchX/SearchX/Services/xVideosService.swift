import Foundation

/// Scrapes xVideos' public search results page.
struct XVideosService: SearchService {
    let source = SourceID.xvideos

    func search(_ r: SearchRequest) async throws -> [VideoResult] {
        let sort: String? = {
            switch r.filters.sort {
            case .relevance: return nil
            case .mostViewed: return "views"
            case .newest: return "uploaddate"
            case .topRated: return "rating"
            }
        }()
        let durf: String? = {
            switch r.filters.duration {
            case .any: return nil
            case .short: return "3-10min"
            case .medium: return "10-20min"
            case .long: return "20min_more"
            }
        }()
        let quality: String? = {
            switch r.filters.quality {
            case .any: return nil
            case .hd: return "hd"
            case .uhd: return "1080P"
            }
        }()
        guard let url = URL.make("https://www.xvideos.com/", [
            "k": r.keyword, "p": r.page > 1 ? String(r.page - 1) : nil,
            "sort": sort, "durf": durf, "quality": quality
        ]) else { throw SearchError.invalidResponse }

        let html = try await HTTPClient.shared.string(url, userAgent: HTTPClient.desktopUA)
        return Self.parse(html)
    }

    static func parse(_ html: String) -> [VideoResult] {
        let base = URL(string: "https://www.xvideos.com")!
        let chunks = html.components(separatedBy: "<div id=\"video_").dropFirst()
        var out: [VideoResult] = []
        for raw in chunks {
            // Limit to this block (stop at the next thumb block marker if concatenated).
            let chunk = String(raw.prefix(6000))
            guard let id = Rx.first(#"^([0-9a-z_]+)""#, in: chunk),
                  let href = Rx.first(#"href="(/video[^"]+)""#, in: chunk),
                  let page = URL(string: href, relativeTo: base)?.absoluteURL,
                  let thumbStr = Rx.first(#"data-src="([^"]+)""#, in: chunk) ?? Rx.first(#"<img[^>]+src="(https?://[^"]+\.jpg)""#, in: chunk),
                  let thumb = Parse.url(thumbStr) else { continue }

            let title = Rx.first(#"<p class="title">\s*<a[^>]*title="([^"]+)""#, in: chunk)
                ?? Rx.first(#"<p class="title">\s*<a[^>]*>(.*?)</a>"#, in: chunk).map(HTML.stripTags)
                ?? "Untitled"
            let durationText = Rx.first(#"<span class="duration">([^<]+)</span>"#, in: chunk)
            let hdMark = Rx.first(#"video-hd-mark">([^<]+)<"#, in: chunk)
            let viewsText = Rx.first(#"([\d.,]+\s*[kKmMbB]?)\s*<span class="sprfluous">\s*Views"#, in: chunk)
                ?? Rx.first(#"<span class="views?">\s*([\d.,]+\s*[kKmMbB]?)"#, in: chunk)

            out.append(VideoResult(
                source: .xvideos, rawID: id,
                title: HTML.decodeEntities(title).trimmingCharacters(in: .whitespacesAndNewlines),
                duration: Parse.wordDuration(durationText),
                thumbnail: thumb,
                viewCount: Parse.compactNumber(viewsText?.replacingOccurrences(of: " ", with: "")),
                rating: nil, pageURL: page, mediaType: .video,
                resolutionHeight: Parse.resolution(hdMark)))
        }
        return out
    }
}
