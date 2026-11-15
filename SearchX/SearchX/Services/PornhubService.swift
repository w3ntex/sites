import Foundation

/// Shared shape of the Pornhub-network webmaster APIs (Pornhub, RedTube).
struct PHNetworkVideo: Decodable {
    let duration: String?
    let views: FlexNumber?
    let videoID: FlexString?
    let rating: FlexNumber?
    let title: String?
    let url: String?
    let defaultThumb: String?
    let thumb: String?
    let publishDate: String?
    let tags: [String]

    private enum K: String, CodingKey {
        case duration, views, video_id, rating, title, url, default_thumb, thumb, publish_date, tags
    }
    private struct Tag: Decodable { let tag_name: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        duration = try? c.decodeIfPresent(String.self, forKey: .duration)
        views = try? c.decodeIfPresent(FlexNumber.self, forKey: .views)
        videoID = try? c.decodeIfPresent(FlexString.self, forKey: .video_id)
        rating = try? c.decodeIfPresent(FlexNumber.self, forKey: .rating)
        title = try? c.decodeIfPresent(String.self, forKey: .title)
        url = try? c.decodeIfPresent(String.self, forKey: .url)
        defaultThumb = try? c.decodeIfPresent(String.self, forKey: .default_thumb)
        thumb = try? c.decodeIfPresent(String.self, forKey: .thumb)
        publishDate = try? c.decodeIfPresent(String.self, forKey: .publish_date)
        if let t = try? c.decodeIfPresent(LossyArray<Tag>.self, forKey: .tags) {
            tags = t.items.compactMap(\.tag_name)
        } else if let t = try? c.decodeIfPresent([String].self, forKey: .tags) {
            tags = t
        } else {
            tags = []
        }
    }

    /// `ratingScale`: multiply raw rating to reach 0–100 (Pornhub is already a %, RedTube is 0–5).
    func toResult(source: SourceID, ratingScale: Double) -> VideoResult? {
        guard let page = Parse.url(url),
              let thumbURL = Parse.url(defaultThumb) ?? Parse.url(thumb) else { return nil }
        let rawID = videoID?.value ?? page.lastPathComponent
        return VideoResult(
            source: source, rawID: rawID,
            title: HTML.decodeEntities(title ?? "Untitled"),
            duration: Parse.clockDuration(duration),
            thumbnail: thumbURL,
            viewCount: views?.int,
            rating: rating?.value.map { min(100, $0 * ratingScale) },
            pageURL: page, mediaType: .video,
            publishedAt: Parse.sqlDate(publishDate),
            tags: tags)
    }
}

struct PornhubService: SearchService {
    let source = SourceID.pornhub

    private struct Response: Decodable {
        let videos: LossyArray<PHNetworkVideo>?
    }

    func search(_ r: SearchRequest) async throws -> [VideoResult] {
        let ordering: String? = {
            switch r.filters.sort {
            case .relevance: return nil
            case .mostViewed: return "mostviewed"
            case .newest: return "newest"
            case .topRated: return "rating"
            }
        }()
        guard let url = URL.make("https://www.pornhub.com/webmasters/search", [
            "search": r.keyword, "page": String(r.page), "thumbsize": "large_hd", "ordering": ordering
        ]) else { throw SearchError.invalidResponse }

        let data = try await HTTPClient.shared.get(url, headers: ["Accept": "application/json"])
        // "No videos found" comes back as {"code":"2001","message":...} — treat as empty.
        guard let resp = try? JSONDecoder().decode(Response.self, from: data) else {
            if String(decoding: data.prefix(400), as: UTF8.self).contains("\"code\"") { return [] }
            throw SearchError.decoding
        }
        return (resp.videos?.items ?? []).compactMap { $0.toResult(source: .pornhub, ratingScale: 1) }
    }
}

/// RedTube is part of the Pornhub network and exposes the same webmaster API format.
struct RedTubeService: SearchService {
    let source = SourceID.redtube

    private struct Wrap: Decodable { let video: PHNetworkVideo }
    private struct Response: Decodable { let videos: LossyArray<Wrap>? }

    func search(_ r: SearchRequest) async throws -> [VideoResult] {
        let ordering: String? = {
            switch r.filters.sort {
            case .relevance: return nil
            case .mostViewed: return "mostviewed"
            case .newest: return "newest"
            case .topRated: return "rating"
            }
        }()
        guard let url = URL.make("https://api.redtube.com/", [
            "data": "redtube.Videos.searchVideos", "output": "json", "search": r.keyword,
            "page": String(r.page), "thumbsize": "big", "ordering": ordering
        ]) else { throw SearchError.invalidResponse }

        let data = try await HTTPClient.shared.get(url, headers: ["Accept": "application/json"])
        guard let resp = try? JSONDecoder().decode(Response.self, from: data) else {
            if String(decoding: data.prefix(400), as: UTF8.self).contains("\"code\"") { return [] }
            throw SearchError.decoding
        }
        return (resp.videos?.items ?? []).compactMap { $0.video.toResult(source: .redtube, ratingScale: 20) }
    }
}
