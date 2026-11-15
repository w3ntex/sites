import SwiftUI
import SwiftData

struct FavoritesView: View {
    enum Segment: String, CaseIterable { case favorites = "Favorites", playlists = "Playlists" }
    @State private var segment: Segment = .favorites

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $segment) {
                    ForEach(Segment.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

                switch segment {
                case .favorites: FavoritesGrid()
                case .playlists: PlaylistsListView()
                }
            }
            .background(Theme.background)
            .navigationTitle(segment.rawValue)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct FavoritesGrid: View {
    @Query(sort: \FavoriteItem.createdAt, order: .reverse) private var favorites: [FavoriteItem]
    @State private var viewer: ViewerRequest?
    @State private var toast: String?

    var body: some View {
        Group {
            if favorites.isEmpty {
                ContentUnavailableView("No favorites yet", systemImage: "heart",
                                       description: Text("Long-press any result and choose “Save to favorites”."))
            } else {
                let results = favorites.compactMap { $0.asResult }
                ResultsGridView(results: results,
                                onSelect: { viewer = .make($0, in: results) },
                                onToast: { toast = $0 })
                    .padding(.top, 4)
            }
        }
        .fullScreenCover(item: $viewer) { ViewerHost(request: $0) }
        .toast($toast)
    }
}

// MARK: - Playlists

struct PlaylistsListView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Playlist.sortIndex) private var playlists: [Playlist]
    @State private var showCreate = false
    @State private var newName = ""
    @State private var renaming: Playlist?
    @State private var renameText = ""

    var body: some View {
        List {
            Section {
                Button {
                    newName = ""
                    showCreate = true
                } label: {
                    Label("New playlist", systemImage: "plus.circle.fill").foregroundStyle(Theme.accent)
                }
            }
            Section {
                ForEach(playlists) { p in
                    NavigationLink(value: p.id) {
                        PlaylistRow(playlist: p)
                    }
                    .swipeActions(edge: .leading) {
                        Button {
                            renameText = p.name
                            renaming = p
                        } label: { Label("Rename", systemImage: "pencil") }
                        .tint(.blue)
                    }
                    .contextMenu {
                        Button {
                            renameText = p.name
                            renaming = p
                        } label: { Label("Rename", systemImage: "pencil") }
                        Button(role: .destructive) { delete(p) } label: { Label("Delete", systemImage: "trash") }
                    }
                }
                .onMove(perform: move)
                .onDelete { idx in idx.map { playlists[$0] }.forEach(delete) }
            } footer: {
                if !playlists.isEmpty { Text("Drag to reorder, swipe to rename or delete.") }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .overlay {
            if playlists.isEmpty {
                ContentUnavailableView("No playlists", systemImage: "music.note.list",
                                       description: Text("Create one here or long-press a result → “Add to playlist”."))
                    .allowsHitTesting(false)
                    .padding(.top, 80)
            }
        }
        .toolbar { if !playlists.isEmpty { EditButton() } }
        .navigationDestination(for: UUID.self) { id in
            if let p = playlists.first(where: { $0.id == id }) { PlaylistDetailView(playlist: p) }
        }
        .alert("New playlist", isPresented: $showCreate) {
            TextField("Name", text: $newName)
            Button("Create") {
                Library.createPlaylist(named: newName, in: context)
                Haptics.success()
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Rename playlist", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameText)
            Button("Save") {
                let t = renameText.trimmingCharacters(in: .whitespaces)
                if let renaming, !t.isEmpty { renaming.name = t; try? context.save(); Haptics.success() }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func move(from source: IndexSet, to destination: Int) {
        var ordered = playlists
        ordered.move(fromOffsets: source, toOffset: destination)
        for (i, p) in ordered.enumerated() { p.sortIndex = i }
        try? context.save()
        Haptics.selection()
    }

    private func delete(_ p: Playlist) {
        context.delete(p)
        try? context.save()
        Haptics.medium()
    }
}

struct PlaylistRow: View {
    let playlist: Playlist

    var body: some View {
        HStack(spacing: 12) {
            ThumbnailView(url: playlist.coverThumbnail)
                .frame(width: 72, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(playlist.name).font(.body.weight(.semibold))
                Text("\(playlist.items.count) item\(playlist.items.count == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .padding(.vertical, 2)
    }
}

struct PlaylistDetailView: View {
    let playlist: Playlist
    @Environment(\.modelContext) private var context
    @State private var viewer: ViewerRequest?
    @State private var renaming = false
    @State private var renameText = ""

    var body: some View {
        let items = playlist.orderedItems
        List {
            ForEach(items) { item in
                Button {
                    if let r = item.asResult { Haptics.light(); viewer = .make(r, in: items.compactMap { $0.asResult }) }
                } label: {
                    MediaRow(snapshot: item, subtitle: item.sourceID?.displayName ?? item.source)
                }
            }
            .onMove { src, dst in
                var ordered = items
                ordered.move(fromOffsets: src, toOffset: dst)
                for (i, it) in ordered.enumerated() { it.sortIndex = i }
                try? context.save()
                Haptics.selection()
            }
            .onDelete { idx in
                for i in idx { context.delete(items[i]) }
                try? context.save()
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .overlay {
            if items.isEmpty {
                ContentUnavailableView("Empty playlist", systemImage: "music.note.list",
                                       description: Text("Long-press a search result → “Add to playlist”."))
            }
        }
        .navigationTitle(playlist.name)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { renameText = playlist.name; renaming = true } label: { Image(systemName: "pencil") }
                EditButton()
            }
        }
        .alert("Rename playlist", isPresented: $renaming) {
            TextField("Name", text: $renameText)
            Button("Save") {
                let t = renameText.trimmingCharacters(in: .whitespaces)
                if !t.isEmpty { playlist.name = t; try? context.save() }
            }
            Button("Cancel", role: .cancel) {}
        }
        .fullScreenCover(item: $viewer) { ViewerHost(request: $0) }
    }
}

/// List row used by playlists and history.
struct MediaRow: View {
    let snapshot: any MediaSnapshot
    var subtitle: String

    var body: some View {
        HStack(spacing: 12) {
            ThumbnailView(url: URL(string: snapshot.thumbnailURL))
                .frame(width: 112, height: 63)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(alignment: .bottomTrailing) {
                    let text: String? = snapshot.mediaType == .video ? Format.duration(snapshot.duration) : snapshot.mediaType.badge
                    if let text {
                        Text(text)
                            .font(.system(size: 10, weight: .bold).monospacedDigit())
                            .padding(.horizontal, 4).padding(.vertical, 1)
                            .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 3))
                            .foregroundStyle(.white)
                            .padding(4)
                    }
                }
            VStack(alignment: .leading, spacing: 4) {
                Text(snapshot.title).font(.subheadline.weight(.medium)).lineLimit(2).foregroundStyle(.white)
                HStack(spacing: 6) {
                    if let src = snapshot.sourceID { SourceBadge(source: src, compact: true) }
                    Text(subtitle).font(.caption).foregroundStyle(Theme.secondaryText).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}
