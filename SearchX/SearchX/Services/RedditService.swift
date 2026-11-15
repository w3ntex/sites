import Foundation

/// Reddit search (anonymous JSON). Only `over_18` posts with media are returned.
/// Posts from well-known NSFW subreddits are fetched separately and ranked first.
struct RedditService: SearchService {
    let source = SourceID.reddit

    static let prioritySubreddits = [
        "porn", "nsfw", "gonewild", "NSFW_GIF", "nsfw_gifs", "porn_gifs", "RealGirls", "holdthemoan",
        "NSFW_HTML5", "60fpsporn"
    ]

    /// Reddit paginates with opaque `after` tokens; remember them per query.
    private actor Cursor {
        static let shared = Cursor()
        private var tokens: [String: String] = [:]
        func get(_ key: String) -> String? { tokens[key] }
        func set(_ key: String, _ value: String?) { tokens[key] = value }
    }

    private struct Listing: Decodable { let data: ListingData? }
    private struct ListingData: Decodable { let after: String?; let children: LossyArray<Child>? }
    private struct Child: Decodable { let data: Post }
    private struct Post: Decodable {
        let id: String
        let title: String?
        let subreddit: String?
        let permalink: String?
        let url: String?
        let url_overridden_by_dest: String?
        let over_18: Bool?
        let is_self: Bool?
        let is_video: Bool?
        let ups: FlexNumber?
        let upvote_ratio: FlexNumber?
        let created_utc: FlexNumber?
        let thumbnail: String?
        let post_hint: String?
        let domain: String?
        let preview: Preview?
        let media: Media?
        let secure_media: Media?
    }
    private struct Preview: Decodable {
        let images: [PImage]?
        let reddit_video_preview: RVideo?
    }
    private struct PImage: Decodable {
        let source: PSource?
        let resolutions: [PSource]?
        let variants: Variants?
    }
    private struct Variants: Decodable { let mp4: PImage2?; let gif: PImage2? }
    private struct PImage2: Decodable { let source: PSource? }
    private struct PSource: Decodable { let url: String?; let width: Int?; let height: Int? }
    private struct Media: Decodable { let reddit_video: RVideo? }
    private struct RVideo: Decodable {
        let fallback_url: String?
        let duration: FlexNumber?
        let height: Int?
        let is_gif: Bool?
    }

    func search(_ r: SearchRequest) async throws -> [VideoResult] {
        let sort: String = {
            switch r.filters.sort {
            case .relevance: return "relevance"
            case .mostViewed, .topRated: return "top"
            case .newest: return "new"
            }
        }()
        let subs = Self.prioritySubreddits.joined(separator: "+")
        let priorityKey = "p|\(r.keyword)|\(sort)|\(r.page)"
        let globalKey = "g|\(r.keyword)|\(sort)|\(r.page)"
        let prevPriority = r.page > 1 ? await Cursor.shared.get("p|\(r.keyword)|\(sort)|\(r.page - 1)") : nil
        let prevGlobal = r.page > 1 ? await Cursor.shared.get("g|\(r.keyword)|\(sort)|\(r.page - 1)") : nil
        if r.page > 1 && prevPriority == nil && prevGlobal == nil { return [] }

        let priorityURL = URL.make("https://www.reddit.com/r/\(subs)/search.json", [
            "q": r.keyword, "restrict_sr": "on", "include_over_18": "on", "limit": "50", "sort": sort, "t": "all",
            "raw_json": "1", "after": prevPriority
        ])
        let globalURL = URL.make("https://www.reddit.com/search.json", [
            "q": r.keyword, "type": "link", "include_over_18": "on", "limit": "50", "sort": sort, "t": "all",
            "raw_json": "1", "after": prevGlobal
        ])

        async let priority = fetch(priorityURL, skip: r.page > 1 && prevPriority == nil)
        async let global = fetch(globalURL, skip: r.page > 1 && prevGlobal == nil)
        let (p, g) = await (priority, global)

        if case .failure(let e) = p, case .failure = g { throw e }
        let pList = (try? p.get()) ?? ([], nil)
        let gList = (try? g.get()) ?? ([], nil)
        await Cursor.shared.set(priorityKey, pList.1)
        await Cursor.shared.set(globalKey, gList.1)

        var seen = Set<String>()
        return (pList.0 + gList.0).filter { seen.insert($0.id).inserted }
    }

    private func fetch(_ url: URL?, skip: Bool) async -> Result<([VideoResult], String?), Error> {
        guard !skip else { return .success(([], nil)) }
        guard let url else { return .failure(SearchError.invalidResponse) }
        do {
            let listing = try await HTTPClient.shared.json(
                Listing.self, from: url,
                userAgent: "ios:com.searchx.app:v1.0 (by /u/searchx_app)")
            let posts = listing.data?.children?.items.map(\.data) ?? []
            return .success((posts.compactMap(Self.convert), listing.data?.after))
        } catch {
            return .failure(error)
        }
    }

    private static func convert(_ p: Post) -> VideoResult? {
        guard p.over_18 == true, p.is_self != true,
              let permalink = p.permalink,
              let page = URL(string: "https://www.reddit.com" + permalink) else { return nil }

        let image = p.preview?.images?.first
        let previewURL = Parse.url(image?.source?.url)
            ?? Parse.url(image?.resolutions?.last?.url)
            ?? (p.thumbnail?.hasPrefix("http") == true ? Parse.url(p.thumbnail) : nil)
        guard let thumb = previewURL else { return nil }

        let link = p.url_overridden_by_dest ?? p.url ?? ""
        let linkURL = Parse.url(link)
        let lowerLink = link.lowercased()
        let domain = (p.domain ?? "").lowercased()
        let video = p.secure_media?.reddit_video ?? p.media?.reddit_video
        let previewVideo = p.preview?.reddit_video_preview

        var type: MediaType
        var direct: URL?
        var duration: Int?
        var height: Int? = image?.source?.height

        if p.is_video == true, let v = video, let fb = Parse.url(v.fallback_url) {
            type = v.is_gif == true ? .gif : .video
            direct = fb
            duration = v.duration?.int
            height = v.height ?? height
        } else if domain.contains("redgifs") || lowerLink.hasSuffix(".gif") || lowerLink.hasSuffix(".gifv")
                    || image?.variants?.mp4 != nil || previewVideo != nil {
            type = .gif
            direct = Parse.url(previewVideo?.fallback_url) ?? Parse.url(image?.variants?.mp4?.source?.url)
            if lowerLink.hasSuffix(".gifv"), let u = Parse.url(String(link.dropLast(5)) + ".mp4") { direct = direct ?? u }
            duration = previewVideo?.duration?.int
        } else if p.post_hint == "image" || ["jpg", "jpeg", "png", "webp"].contains(linkURL?.pathExtension.lowercased() ?? "") {
            type = .image
            direct = linkURL
        } else if p.post_hint == "rich:video" || p.post_hint == "hosted:video" {
            type = .video
        } else if domain.contains("pornhub") || domain.contains("xvideos") || domain.contains("xhamster") {
            type = .video
        } else {
            return nil   // text / external non-media link
        }

        // Link posts to other video sites should open the linked page, not the Reddit thread.
        let pageURL: URL = (type == .video && direct == nil && linkURL != nil && !domain.contains("reddit")) ? linkURL! : page

        return VideoResult(
            source: .reddit, rawID: p.id,
            title: "r/\(p.subreddit ?? "nsfw") · \(HTML.decodeEntities(p.title ?? "Untitled"))",
            duration: type == .video ? duration : nil,
            thumbnail: thumb, viewCount: nil,
            rating: p.upvote_ratio?.value.map { $0 * 100 },
            pageURL: pageURL, mediaType: type,
            directMediaURL: direct,
            publishedAt: p.created_utc?.value.map { Date(timeIntervalSince1970: $0) },
            resolutionHeight: height, likes: p.ups?.int)
    }
}
