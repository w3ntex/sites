import Foundation
import SwiftData

/// Favorites / playlists / history / progress helpers shared by views.
@MainActor
enum Library {
    // MARK: Favorites

    static func isFavorite(_ r: VideoResult, in context: ModelContext) -> Bool {
        let id = r.id
        let count = (try? context.fetchCount(FetchDescriptor<FavoriteItem>(predicate: #Predicate { $0.resultID == id }))) ?? 0
        return count > 0
    }

    /// Returns the new favorite state.
    @discardableResult
    static func toggleFavorite(_ r: VideoResult, in context: ModelContext) -> Bool {
        let id = r.id
        if let existing = try? context.fetch(FetchDescriptor<FavoriteItem>(predicate: #Predicate { $0.resultID == id })),
           !existing.isEmpty {
            for e in existing { context.delete(e) }
            try? context.save()
            Haptics.light()
            return false
        }
        context.insert(FavoriteItem(result: r))
        try? context.save()
        Haptics.success()
        return true
    }

    // MARK: Playlists

    @discardableResult
    static func createPlaylist(named name: String, in context: ModelContext) -> Playlist {
        let count = (try? context.fetchCount(FetchDescriptor<Playlist>())) ?? 0
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let p = Playlist(name: trimmed.isEmpty ? "Playlist \(count + 1)" : trimmed, sortIndex: count)
        context.insert(p)
        try? context.save()
        return p
    }

    /// Returns false if the item was already in the playlist.
    @discardableResult
    static func add(_ r: VideoResult, to playlist: Playlist, in context: ModelContext) -> Bool {
        if playlist.items.contains(where: { $0.resultID == r.id }) { return false }
        let item = PlaylistItem(result: r, sortIndex: (playlist.items.map(\.sortIndex).max() ?? -1) + 1)
        context.insert(item)
        item.playlist = playlist
        try? context.save()
        Haptics.success()
        return true
    }

    // MARK: History

    static func logOpen(_ r: VideoResult, in context: ModelContext) -> HistoryEntry {
        let entry = HistoryEntry(result: r)
        context.insert(entry)
        try? context.save()
        return entry
    }

    static func clearHistory(in context: ModelContext) {
        try? context.delete(model: HistoryEntry.self)
        try? context.save()
    }

    // MARK: Progress

    static func progress(for key: String, in context: ModelContext) -> PlaybackProgress? {
        try? context.fetch(FetchDescriptor<PlaybackProgress>(predicate: #Predicate { $0.urlKey == key })).first
    }

    static func saveProgress(key: String, position: Double, duration: Double, in context: ModelContext) {
        guard position.isFinite, duration.isFinite else { return }
        if let p = progress(for: key, in: context) {
            p.position = position
            p.duration = duration
            p.updatedAt = .now
        } else {
            context.insert(PlaybackProgress(urlKey: key, position: position, duration: duration))
        }
        try? context.save()
    }

    static func clearProgress(in context: ModelContext) {
        try? context.delete(model: PlaybackProgress.self)
        try? context.save()
    }
}
