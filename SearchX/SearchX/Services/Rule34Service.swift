import Foundation

/// Rule34.xxx DAPI. Always restricted to `rating:explicit` and excludes tags that denote minors.
struct Rule34Service: SearchService {
    let source = SourceID.rule34

    private struct Post: Decodable {
        let id: FlexString?
        let file_url: String?
        let preview_url: String?
        let sample_url: String?
        let tags: String?
        let score: FlexNumber?
        let rating: String?
        let width: FlexNumber?
        let height: FlexNumber?
        let change: FlexNumber?
    }

    /// "big tits, blonde" → ["big_tits", "blonde"]; "blonde" → ["blonde"]
    static func tags(from keyword: String) -> [String] {
        let parts = keyword.contains(",") ? keyword.split(separator: ",").map(String.init) : [keyword]
        return parts.map { $0.trimmingCharacters(in: .whitespaces).lowercased()
            .replacingOccurrences(of: " ", with: "_") }
            .filter { !$0.isEmpty }
    }

    func search(_ r: SearchRequest) async throws -> [VideoResult] {
        var tags = Self.tags(from: r.keyword)
        tags.append("rating:explicit")
        tags += ContentSafety.booruNegativeTags.map { "-" + $0 }
        switch r.filters.media {
        case .gifs: tags.append("animated"); tags.append("-video")
        case .videos: tags.append("video")
        case .images: tags.append("-animated"); tags.append("-video")
        case .all: break
        }
        switch r.filters.sort {
        case .relevance: break
        case .mostViewed, .topRated: tags.append("sort:score:desc")
        case .newest: tags.append("sort:id:desc")
        }

        let key = Credentials.rule34APIKey, user = Credentials.rule34UserID
        guard let url = URL.make("https://api.rule34.xxx/index.php", [
            "page": "dapi", "s": "post", "q": "index", "json": "1", "limit": "40",
            "pid": String(max(0, r.page - 1)), "tags": tags.joined(separator: " "),
            "api_key": key.isEmpty ? nil : key, "user_id": user.isEmpty ? nil : user
        ]) else { throw SearchError.invalidResponse }

        let data = try await HTTPClient.shared.get(url, headers: ["Accept": "application/json"])
        let text = String(decoding: data.prefix(300), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return [] }
        guard let posts = try? JSONDecoder().decode(LossyArray<Post>.self, from: data) else {
            let lower = text.lowercased()
            if lower.contains("auth") || lower.contains("api key") || lower.contains("api_key") {
                throw SearchError.missingCredentials("a Rule34 API key and user ID")
            }
            if lower.hasPrefix("<?xml") || lower.contains("<posts") { return [] }
            throw SearchError.decoding
        }

        return posts.items.compactMap { p -> VideoResult? in
            guard (p.rating ?? "explicit").lowercased().hasPrefix("e"),
                  let id = p.id?.value,
                  let file = Parse.url(p.file_url),
                  let thumb = Parse.url(p.preview_url) ?? Parse.url(p.sample_url),
                  let page = URL(string: "https://rule34.xxx/index.php?page=post&s=view&id=\(id)") else { return nil }
            let ext = file.pathExtension.lowercased()
            let tagList = (p.tags ?? "").split(separator: " ").map(String.init)
            let type: MediaType = ["mp4", "webm", "m4v", "mov"].contains(ext) ? .video : (ext == "gif" ? .gif : .image)
            let title = tagList.prefix(6).map { $0.replacingOccurrences(of: "_", with: " ") }.joined(separator: ", ")
            return VideoResult(
                source: .rule34, rawID: id,
                title: title.isEmpty ? "Rule34 #\(id)" : title,
                duration: nil, thumbnail: thumb, viewCount: nil, rating: nil,
                pageURL: page, mediaType: type,
                directMediaURL: type == .image ? (Parse.url(p.sample_url) ?? file) : file,
                publishedAt: p.change?.value.map { Date(timeIntervalSince1970: $0) },
                resolutionHeight: p.height?.int, likes: p.score?.int, tags: tagList)
        }
    }
}
