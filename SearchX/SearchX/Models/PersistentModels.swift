import Foundation
import SwiftData

// MARK: - Shared snapshot of a VideoResult

/// Fields every stored item keeps so it can be re-opened without searching again.
protocol MediaSnapshot: AnyObject {
    var resultID: String { get set }
    var title: String { get set }
    var thumbnailURL: String { get set }
    var source: String { get set }
    var pageURL: String { get set }
    var mediaTypeRaw: String { get set }
    var duration: Int? { get set }
    var directMediaURL: String? { get set }
    var viewCount: Int? { get set }
}

extension MediaSnapshot {
    func fill(from r: VideoResult) {
        resultID = r.id
        title = r.title
        thumbnailURL = r.thumbnail.absoluteString
        source = r.source
        pageURL = r.pageURL.absoluteString
        mediaTypeRaw = r.mediaType.rawValue
        duration = r.duration
        directMediaURL = r.directMediaURL?.absoluteString
        viewCount = r.viewCount
    }

    var mediaType: MediaType { MediaType(rawValue: mediaTypeRaw) ?? .video }
    var sourceID: SourceID? { SourceID(rawValue: source) }

    var asResult: VideoResult? {
        guard let page = URL(string: pageURL) else { return nil }
        let thumb = URL(string: thumbnailURL) ?? page
        let rawID = resultID.split(separator: ":", maxSplits: 1).last.map(String.init) ?? resultID
        var r = VideoResult(source: sourceID ?? .pornhub, rawID: rawID, title: title, duration: duration,
                            thumbnail: thumb, viewCount: viewCount, rating: nil, pageURL: page,
                            mediaType: mediaType, directMediaURL: directMediaURL.flatMap(URL.init(string:)))
        r.id = resultID
        r.source = source
        return r
    }
}

// MARK: - Favorites

@Model
final class FavoriteItem: MediaSnapshot {
    @Attribute(.unique) var resultID: String
    var title: String
    var thumbnailURL: String
    var source: String
    var pageURL: String
    var mediaTypeRaw: String
    var duration: Int?
    var directMediaURL: String?
    var viewCount: Int?
    var createdAt: Date

    init(result: VideoResult) {
        resultID = result.id
        title = result.title
        thumbnailURL = result.thumbnail.absoluteString
        source = result.source
        pageURL = result.pageURL.absoluteString
        mediaTypeRaw = result.mediaType.rawValue
        duration = result.duration
        directMediaURL = result.directMediaURL?.absoluteString
        viewCount = result.viewCount
        createdAt = .now
    }
}

// MARK: - Playlists

@Model
final class Playlist {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date
    var sortIndex: Int
    @Relationship(deleteRule: .cascade, inverse: \PlaylistItem.playlist)
    var items: [PlaylistItem] = []

    init(name: String, sortIndex: Int) {
        id = UUID()
        self.name = name
        self.sortIndex = sortIndex
        createdAt = .now
    }

    var orderedItems: [PlaylistItem] { items.sorted { $0.sortIndex < $1.sortIndex } }
    var coverThumbnail: URL? { orderedItems.first.flatMap { URL(string: $0.thumbnailURL) } }
}

@Model
final class PlaylistItem: MediaSnapshot {
    @Attribute(.unique) var id: UUID
    var resultID: String
    var title: String
    var thumbnailURL: String
    var source: String
    var pageURL: String
    var mediaTypeRaw: String
    var duration: Int?
    var directMediaURL: String?
    var viewCount: Int?
    var sortIndex: Int
    var addedAt: Date
    var playlist: Playlist?

    init(result: VideoResult, sortIndex: Int) {
        id = UUID()
        resultID = result.id
        title = result.title
        thumbnailURL = result.thumbnail.absoluteString
        source = result.source
        pageURL = result.pageURL.absoluteString
        mediaTypeRaw = result.mediaType.rawValue
        duration = result.duration
        directMediaURL = result.directMediaURL?.absoluteString
        viewCount = result.viewCount
        self.sortIndex = sortIndex
        addedAt = .now
    }
}

// MARK: - History

@Model
final class HistoryEntry: MediaSnapshot {
    @Attribute(.unique) var id: UUID
    var resultID: String
    var title: String
    var thumbnailURL: String
    var source: String
    var pageURL: String
    var mediaTypeRaw: String
    var duration: Int?
    var directMediaURL: String?
    var viewCount: Int?
    var openedAt: Date
    /// Seconds the viewer was open.
    var watchDuration: Double

    init(result: VideoResult) {
        id = UUID()
        resultID = result.id
        title = result.title
        thumbnailURL = result.thumbnail.absoluteString
        source = result.source
        pageURL = result.pageURL.absoluteString
        mediaTypeRaw = result.mediaType.rawValue
        duration = result.duration
        directMediaURL = result.directMediaURL?.absoluteString
        viewCount = result.viewCount
        openedAt = .now
        watchDuration = 0
    }
}

// MARK: - Playback progress ("resume")

@Model
final class PlaybackProgress {
    @Attribute(.unique) var urlKey: String
    var position: Double
    var duration: Double
    var updatedAt: Date

    init(urlKey: String, position: Double, duration: Double) {
        self.urlKey = urlKey
        self.position = position
        self.duration = duration
        updatedAt = .now
    }

    /// Only offer resume when meaningfully into the video and not at the end.
    var isResumable: Bool { position > 10 && (duration <= 0 || position < duration - 15) }
}

// MARK: - Downloads

enum DownloadStatus: String, Codable {
    case queued, downloading, completed, failed
}

@Model
final class DownloadItem {
    @Attribute(.unique) var id: UUID
    var title: String
    var source: String
    var pageURL: String
    var remoteURL: String
    var thumbnailURL: String
    var mediaTypeRaw: String
    /// File name inside `DownloadManager.downloadsDirectory` (container path changes between installs).
    var localFilename: String?
    var statusRaw: String
    var progress: Double
    var totalBytes: Int64
    var errorMessage: String?
    var createdAt: Date

    init(result: VideoResult, remoteURL: URL) {
        id = UUID()
        title = result.title
        source = result.source
        pageURL = result.pageURL.absoluteString
        self.remoteURL = remoteURL.absoluteString
        thumbnailURL = result.thumbnail.absoluteString
        mediaTypeRaw = result.mediaType.rawValue
        statusRaw = DownloadStatus.queued.rawValue
        progress = 0
        totalBytes = 0
        createdAt = .now
    }

    var status: DownloadStatus {
        get { DownloadStatus(rawValue: statusRaw) ?? .failed }
        set { statusRaw = newValue.rawValue }
    }

    var localURL: URL? {
        localFilename.map { DownloadManager.downloadsDirectory.appendingPathComponent($0) }
    }

    var isImage: Bool {
        guard let ext = localFilename.map({ ($0 as NSString).pathExtension.lowercased() }) else {
            return mediaTypeRaw == MediaType.image.rawValue
        }
        return ["jpg", "jpeg", "png", "webp", "heic", "gif"].contains(ext)
    }
}

// MARK: - Container

@MainActor
enum Persistence {
    static let schema = Schema([FavoriteItem.self, Playlist.self, PlaylistItem.self,
                                HistoryEntry.self, PlaybackProgress.self, DownloadItem.self])

    static let container: ModelContainer = {
        do {
            return try ModelContainer(for: schema, configurations: ModelConfiguration(schema: schema))
        } catch {
            // Never crash on a corrupt store: fall back to an in-memory store so the app stays usable.
            print("SwiftData store failed to load: \(error). Using in-memory store.")
            let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
            return try! ModelContainer(for: schema, configurations: config)
        }
    }()

    static var context: ModelContext { container.mainContext }
}
