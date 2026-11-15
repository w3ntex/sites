import Foundation

enum MediaType: String, Codable, CaseIterable, Hashable, Sendable {
    case video, gif, image

    var badge: String {
        switch self {
        case .video: return "VIDEO"
        case .gif: return "GIF"
        case .image: return "IMG"
        }
    }
}

/// Unified, source-agnostic search result.
struct VideoResult: Identifiable, Hashable, Sendable {
    /// Globally unique id: "<source>:<source-specific id>".
    var id: String
    var title: String
    /// Seconds. `nil` for GIFs/images or when unknown.
    var duration: Int?
    var thumbnail: URL
    /// `SourceID.rawValue`.
    var source: String
    var viewCount: Int?
    /// Normalized to 0...100.
    var rating: Double?
    var pageURL: URL
    var mediaType: MediaType

    // MARK: Extras used for filtering / playback

    /// Direct media file (mp4 / jpg …) when the source exposes one.
    var directMediaURL: URL? = nil
    var publishedAt: Date? = nil
    /// Vertical resolution in pixels when known (used by the quality filter).
    var resolutionHeight: Int? = nil
    /// Upvotes / likes for sources without view counts (Reddit, RedGIFs, Rule34).
    var likes: Int? = nil
    /// Source tags, used by the content safety filter.
    var tags: [String] = []
    /// Uploader / channel / performers / account, depending on the source.
    var creators: [String] = []

    init(source: SourceID,
         rawID: String,
         title: String,
         duration: Int?,
         thumbnail: URL,
         viewCount: Int?,
         rating: Double?,
         pageURL: URL,
         mediaType: MediaType,
         directMediaURL: URL? = nil,
         publishedAt: Date? = nil,
         resolutionHeight: Int? = nil,
         likes: Int? = nil,
         tags: [String] = [],
         creators: [String] = []) {
        self.id = "\(source.rawValue):\(rawID)"
        self.title = title
        self.duration = duration
        self.thumbnail = thumbnail
        self.source = source.rawValue
        self.viewCount = viewCount
        self.rating = rating
        self.pageURL = pageURL
        self.mediaType = mediaType
        self.directMediaURL = directMediaURL
        self.publishedAt = publishedAt
        self.resolutionHeight = resolutionHeight
        self.likes = likes
        self.tags = tags
        self.creators = creators
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && $0 != "[deleted]" }
    }

    var sourceID: SourceID? { SourceID(rawValue: source) }
    var sourceName: String { sourceID?.displayName ?? source.capitalized }

    /// Key used to remember playback progress.
    var progressKey: String { pageURL.absoluteString }

    /// Direct URL that AVPlayer can play natively (mp4/mov/m3u8).
    var nativePlayableURL: URL? {
        guard mediaType != .image, let url = directMediaURL else { return nil }
        let ext = url.pathExtension.lowercased()
        return ["mp4", "m4v", "mov", "m3u8"].contains(ext) ? url : nil
    }

    /// Direct image URL that can be shown natively.
    var nativeImageURL: URL? {
        guard mediaType == .image, let url = directMediaURL else { return nil }
        let ext = url.pathExtension.lowercased()
        return ["jpg", "jpeg", "png", "webp", "heic"].contains(ext) ? url : nil
    }
}
