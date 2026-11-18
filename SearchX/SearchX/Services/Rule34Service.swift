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
        let owner: String?
    }

    /// "big tits, blonde" → ["big_tits", "blonde"]; "blonde" → ["blonde"]
    static func tags(from keyword: String) -> [String] {
        let parts = keyword.contains(",") ? keyword.split(separator: ",").map(String.init) : [keyword]
        return parts.map { $0.trimmingCharacters(in: .whitespaces).lowercased()
            .replacingOccurrences(of: " ", with: "_") }
            .filter { !$0.isEmpty }
    }

    func search(_ r: SearchRequest) async throws -> [VideoResult] {
        // Like the site: turn what was typed into real tags first ("missionary" → "missionary_position").
        let tags = await Self.resolveTags(for: r.keyword)
        guard !tags.isEmpty else { return [] }
        return try await query(r, baseTags: tags)
    }

    // MARK: Tag resolution (same autocomplete service the website's search box uses)

    struct TagSuggestion: Hashable, Sendable {
        let tag: String
        let count: Int
    }

    private struct ACItem: Decodable {
        let label: String?
        let value: String?
    }

    private actor Cache {
        static let shared = Cache()
        private var suggestions: [String: [TagSuggestion]] = [:]
        private var resolved: [String: [String]] = [:]
        func suggestions(_ k: String) -> [TagSuggestion]? { suggestions[k] }
        func setSuggestions(_ k: String, _ v: [TagSuggestion]) { suggestions[k] = v }
        func resolved(_ k: String) -> [String]? { resolved[k] }
        func setResolved(_ k: String, _ v: [String]) { resolved[k] = v }
    }

    /// Rule34's tag autocomplete, sorted by post count. Never throws (empty on failure).
    static func suggest(_ term: String) async -> [TagSuggestion] {
        let q = term.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: " ", with: "_")
        guard q.count >= 2 else { return [] }
        if let cached = await Cache.shared.suggestions(q) { return cached }

        let key = Credentials.rule34APIKey, user = Credentials.rule34UserID
        let endpoints = [
            URL.make("https://ac.rule34.xxx/autocomplete.php", ["q": q]),
            URL.make("https://api.rule34.xxx/autocomplete.php", [
                "q": q, "api_key": key.isEmpty ? nil : key, "user_id": user.isEmpty ? nil : user
            ])
        ].compactMap { $0 }

        for url in endpoints {
            guard let data = try? await HTTPClient.shared.get(url, headers: [
                "Accept": "application/json", "Referer": "https://rule34.xxx/"
            ]), let items = try? JSONDecoder().decode(LossyArray<ACItem>.self, from: data).items else { continue }
            let list = items.compactMap { item -> TagSuggestion? in
                guard let tag = item.value?.lowercased(), !tag.isEmpty else { return nil }
                let count = item.label.flatMap { Rx.first(#"\((\d+)\)\s*$"#, in: $0) }.flatMap { Int($0) } ?? 0
                return TagSuggestion(tag: tag, count: count)
            }
            .filter { !ContentSafety.isBlocked(text: $0.tag) && !ContentSafety.booruNegativeTags.contains($0.tag) }
            .sorted { $0.count > $1.count }
            await Cache.shared.setSuggestions(q, list)
            return list
        }
        return []
    }

    /// Exact tag if it exists, else the most-used tag starting with the term (what the site's
    /// autocomplete puts first), else the term itself.
    private static func bestTag(for term: String) async -> String {
        let t = term.lowercased().replacingOccurrences(of: " ", with: "_")
        let list = await suggest(t)
        if list.contains(where: { $0.tag == t }) { return t }
        if let top = list.first(where: { $0.tag.hasPrefix(t) }) { return top.tag }
        return t
    }

    /// "big tits, blonde" → explicit tag list (commas = the user is typing tags, kept as-is).
    /// "anime missionary" → one tag if "anime_missionary" exists, otherwise each word resolved.
    static func resolveTags(for keyword: String) async -> [String] {
        let raw = keyword.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !raw.isEmpty else { return [] }
        if let cached = await Cache.shared.resolved(raw) { return cached }

        var result: [String]
        if raw.contains(",") {
            result = tags(from: raw)
        } else {
            let words = raw.split(whereSeparator: { $0.isWhitespace }).map(String.init)
            if words.count == 1 || words.contains(where: { $0.contains("_") || $0.contains(":") }) {
                // Single word, or the user already typed real tags ("big_breasts solo").
                result = words.count == 1 ? [await bestTag(for: words[0])] : words
            } else {
                let joined = words.joined(separator: "_")
                let list = await suggest(joined)
                if list.contains(where: { $0.tag == joined }) {
                    result = [joined]
                } else if let top = list.first(where: { $0.tag.hasPrefix(joined) }) {
                    result = [top.tag]
                } else {
                    var each: [String] = []
                    for w in words { each.append(await bestTag(for: w)) }
                    result = each
                }
            }
        }
        await Cache.shared.setResolved(raw, result)
        return result
    }

    private func query(_ r: SearchRequest, baseTags: [String]) async throws -> [VideoResult] {
        var tags = baseTags
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
            "page": "dapi", "s": "post", "q": "index", "json": "1", "limit": "42",
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
                resolutionHeight: p.height?.int, likes: p.score?.int, tags: tagList,
                creators: p.owner.map { [$0] } ?? [])
        }
    }
}
