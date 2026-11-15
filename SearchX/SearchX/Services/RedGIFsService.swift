import Foundation

/// Caches RedGIFs' free temporary bearer token (or uses the user's own token from Settings).
actor RedGIFsAuth {
    static let shared = RedGIFsAuth()
    private var token: String?
    private var expiry = Date.distantPast

    func bearer() async throws -> String {
        let custom = Credentials.redgifsToken
        if !custom.isEmpty { return custom }
        if let token, expiry > Date() { return token }
        struct Resp: Decodable { let token: String }
        let resp = try await HTTPClient.shared.json(Resp.self, from: URL(string: "https://api.redgifs.com/v2/auth/temporary")!)
        token = resp.token
        expiry = Date().addingTimeInterval(20 * 3600)
        return resp.token
    }

    func invalidate() {
        token = nil
        expiry = .distantPast
    }
}

struct RedGIFsService: SearchService {
    let source = SourceID.redgifs

    private struct Response: Decodable { let gifs: LossyArray<Gif>? }
    private struct Gif: Decodable {
        let id: String
        let createDate: FlexNumber?
        let duration: FlexNumber?
        let views: FlexNumber?
        let likes: FlexNumber?
        let height: FlexNumber?
        let type: FlexNumber?
        let tags: [String]?
        let userName: String?
        let description: String?
        let urls: Urls
    }
    private struct Urls: Decodable {
        let sd: String?
        let hd: String?
        let poster: String?
        let thumbnail: String?
    }

    func search(_ r: SearchRequest) async throws -> [VideoResult] {
        do {
            return try await perform(r)
        } catch SearchError.http(401) {
            // Token expired — fetch a new one once.
            await RedGIFsAuth.shared.invalidate()
            return try await perform(r)
        }
    }

    private func perform(_ r: SearchRequest) async throws -> [VideoResult] {
        let order: String = {
            switch r.filters.sort {
            case .relevance: return "trending"
            case .mostViewed: return "top"
            case .newest: return "latest"
            case .topRated: return "best"
            }
        }()
        let type: String? = r.filters.media == .images ? "i" : (r.filters.media == .gifs ? "g" : nil)
        guard let url = URL.make("https://api.redgifs.com/v2/gifs/search", [
            "search_text": r.keyword, "order": order, "count": "40", "page": String(r.page), "type": type
        ]) else { throw SearchError.invalidResponse }

        let token = try await RedGIFsAuth.shared.bearer()
        let resp = try await HTTPClient.shared.json(Response.self, from: url, headers: ["Authorization": "Bearer \(token)"])

        return (resp.gifs?.items ?? []).compactMap { g -> VideoResult? in
            guard let thumb = Parse.url(g.urls.poster) ?? Parse.url(g.urls.thumbnail),
                  let page = URL(string: "https://www.redgifs.com/watch/\(g.id)") else { return nil }
            let isImage = g.type?.int == 2
            let tags = g.tags ?? []
            let title = (g.description?.isEmpty == false ? g.description! : tags.prefix(4).joined(separator: ", "))
            return VideoResult(
                source: .redgifs, rawID: g.id,
                title: title.isEmpty ? "@\(g.userName ?? "redgifs")" : title,
                duration: nil, thumbnail: thumb,
                viewCount: g.views?.int, rating: nil,
                pageURL: page, mediaType: isImage ? .image : .gif,
                directMediaURL: Parse.url(g.urls.hd) ?? Parse.url(g.urls.sd),
                publishedAt: g.createDate?.value.map { Date(timeIntervalSince1970: $0) },
                resolutionHeight: g.height?.int, likes: g.likes?.int, tags: tags,
                creators: g.userName.map { [$0] } ?? [])
        }
    }
}
