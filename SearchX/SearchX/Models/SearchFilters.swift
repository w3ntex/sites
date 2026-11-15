import Foundation

struct SearchFilters: Codable, Equatable, Hashable, Sendable {
    enum MediaFilter: String, Codable, CaseIterable, Identifiable, Sendable {
        case all, videos, gifs, images
        var id: String { rawValue }
        var title: String {
            switch self {
            case .all: return "All"
            case .videos: return "Videos"
            case .gifs: return "GIFs"
            case .images: return "Images"
            }
        }
        var mediaType: MediaType? {
            switch self {
            case .all: return nil
            case .videos: return .video
            case .gifs: return .gif
            case .images: return .image
            }
        }
    }

    enum DurationFilter: String, Codable, CaseIterable, Identifiable, Sendable {
        case any, short, medium, long
        var id: String { rawValue }
        var title: String {
            switch self {
            case .any: return "Any length"
            case .short: return "< 10 min"
            case .medium: return "10–30 min"
            case .long: return "30 min +"
            }
        }
        func matches(_ seconds: Int?) -> Bool {
            if self == .any { return true }
            guard let s = seconds else { return false }
            switch self {
            case .any: return true
            case .short: return s < 600
            case .medium: return s >= 600 && s <= 1800
            case .long: return s > 1800
            }
        }
    }

    enum QualityFilter: String, Codable, CaseIterable, Identifiable, Sendable {
        case any, hd, uhd
        var id: String { rawValue }
        var title: String {
            switch self {
            case .any: return "Any quality"
            case .hd: return "HD"
            case .uhd: return "4K"
            }
        }
        func matches(_ height: Int?) -> Bool {
            switch self {
            case .any: return true
            case .hd: return (height ?? 0) >= 720
            case .uhd: return (height ?? 0) >= 2160
            }
        }
    }

    enum SortOrder: String, Codable, CaseIterable, Identifiable, Sendable {
        case relevance, mostViewed, newest, topRated
        var id: String { rawValue }
        var title: String {
            switch self {
            case .relevance: return "Relevance"
            case .mostViewed: return "Most viewed"
            case .newest: return "Newest"
            case .topRated: return "Top rated"
            }
        }
    }

    var media: MediaFilter = .all
    var duration: DurationFilter = .any
    var quality: QualityFilter = .any
    var sort: SortOrder = .relevance
    var enabledSources: Set<SourceID> = Set(SourceID.allCases)

    /// Duration only makes sense for videos.
    var durationApplies: Bool { media == .all || media == .videos }

    var isDefault: Bool { self == SearchFilters() }

    /// Sources that are enabled and can return the selected media type.
    var activeSources: [SourceID] {
        SourceID.allCases.filter { src in
            guard enabledSources.contains(src) else { return false }
            if let type = media.mediaType { return src.mediaTypes.contains(type) }
            return true
        }
    }

    func matches(_ r: VideoResult) -> Bool {
        if let type = media.mediaType, r.mediaType != type { return false }
        if durationApplies, duration != .any {
            // Duration filter applies to videos only; GIFs/images are hidden when it's set.
            guard r.mediaType == .video, duration.matches(r.duration) else { return false }
        }
        if !quality.matches(r.resolutionHeight) { return false }
        return true
    }
}

/// What every `SearchService` receives.
struct SearchRequest: Sendable {
    var keyword: String
    var page: Int          // 1-based
    var filters: SearchFilters
}
