import SwiftUI
import SwiftData

/// 2-column grid of results with long-press actions (favorite / add to playlist / share).
struct ResultsGridView: View {
    let results: [VideoResult]
    var header: AnyView? = nil
    var footer: AnyView? = nil
    var onSelect: (VideoResult) -> Void
    var onAppearItem: ((VideoResult) -> Void)? = nil
    var onToast: ((String) -> Void)? = nil

    @State private var playlistTarget: VideoResult?

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        ScrollView {
            if let header { header }
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(results) { r in
                    ResultCell(result: r,
                               onAddToPlaylist: { playlistTarget = r },
                               onToast: onToast)
                        .onTapGesture {
                            Haptics.light()
                            onSelect(r)
                        }
                        .onAppear { onAppearItem?(r) }
                }
            }
            .padding(.horizontal, 10)
            if let footer { footer }
        }
        .background(Theme.background)
        .sheet(item: $playlistTarget) { r in
            AddToPlaylistSheet(result: r) { name in onToast?("Added to \(name)") }
                .presentationDetents([.medium, .large])
        }
    }
}

struct ResultCell: View {
    let result: VideoResult
    var onAddToPlaylist: () -> Void
    var onToast: ((String) -> Void)?
    @Environment(\.modelContext) private var context

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ThumbnailView(url: result.thumbnail)
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .topLeading) {
                    if let src = result.sourceID { SourceBadge(source: src, compact: true).padding(6) }
                }
                .overlay(alignment: .bottomTrailing) {
                    Text(badgeText)
                        .font(.system(size: 11, weight: .bold).monospacedDigit())
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 4))
                        .foregroundStyle(result.mediaType == .video ? .white : Theme.accent)
                        .padding(6)
                }
                .overlay(alignment: .topTrailing) {
                    if let h = result.resolutionHeight, h >= 720, result.mediaType == .video {
                        Text(h >= 2160 ? "4K" : "HD")
                            .font(.system(size: 9, weight: .heavy))
                            .padding(.horizontal, 4).padding(.vertical, 2)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 3))
                            .foregroundStyle(.white)
                            .padding(6)
                    }
                }

            Text(result.title)
                .font(.footnote.weight(.medium))
                .lineLimit(2)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 4) {
                Text(result.sourceName)
                if let v = Format.compact(result.viewCount) {
                    Text("·")
                    Image(systemName: "eye.fill").font(.system(size: 9))
                    Text(v)
                } else if let l = Format.compact(result.likes) {
                    Text("·")
                    Image(systemName: "heart.fill").font(.system(size: 9))
                    Text(l)
                }
                if let rating = result.rating {
                    Text("·")
                    Image(systemName: "hand.thumbsup.fill").font(.system(size: 9))
                    Text("\(Int(rating))%")
                }
            }
            .font(.caption2)
            .foregroundStyle(Theme.secondaryText)
            .lineLimit(1)
        }
        .contentShape(Rectangle())
        .contextMenu {
            let fav = Library.isFavorite(result, in: context)
            Button {
                let nowFav = Library.toggleFavorite(result, in: context)
                onToast?(nowFav ? "Saved to favorites" : "Removed from favorites")
            } label: {
                Label(fav ? "Remove from favorites" : "Save to favorites", systemImage: fav ? "heart.slash" : "heart")
            }
            Button {
                Haptics.light()
                onAddToPlaylist()
            } label: {
                Label("Add to playlist…", systemImage: "text.badge.plus")
            }
            ShareLink(item: result.pageURL) { Label("Share link", systemImage: "square.and.arrow.up") }
            Link(destination: result.pageURL) { Label("Open in Safari", systemImage: "safari") }
        } preview: {
            ThumbnailView(url: result.thumbnail)
                .aspectRatio(16 / 9, contentMode: .fit)
                .frame(width: 320)
        }
    }

    private var badgeText: String {
        switch result.mediaType {
        case .video: return Format.duration(result.duration) ?? "VIDEO"
        case .gif: return "GIF"
        case .image: return "IMG"
        }
    }
}

struct ThumbnailView: View {
    let url: URL?

    var body: some View {
        Color(white: 0.08)
            .overlay {
                AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        Image(systemName: "photo").foregroundStyle(Theme.secondaryText)
                    default:
                        ShimmerView()
                    }
                }
            }
            .clipped()
    }
}

// MARK: - Skeletons

struct ShimmerView: View {
    @State private var phase: CGFloat = -1

    var body: some View {
        GeometryReader { geo in
            Rectangle()
                .fill(Theme.surface)
                .overlay(
                    LinearGradient(colors: [.clear, Color.white.opacity(0.07), .clear],
                                   startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width * 0.6)
                        .offset(x: phase * geo.size.width * 1.4)
                )
                .clipped()
        }
        .onAppear {
            withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { phase = 1 }
        }
    }
}

struct SkeletonGrid: View {
    var count = 10
    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 14) {
            ForEach(0..<count, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 6) {
                    ShimmerView()
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    ShimmerView().frame(height: 10).clipShape(Capsule())
                    ShimmerView().frame(width: 70, height: 8).clipShape(Capsule())
                }
            }
        }
        .padding(.horizontal, 10)
        .redacted(reason: .placeholder)
    }
}

// MARK: - Playlist picker

struct AddToPlaylistSheet: View {
    let result: VideoResult
    var onAdded: ((String) -> Void)? = nil
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Playlist.sortIndex) private var playlists: [Playlist]
    @State private var newName = ""

    var body: some View {
        NavigationStack {
            List {
                Section("New playlist") {
                    HStack {
                        TextField("Playlist name", text: $newName)
                            .submitLabel(.done)
                            .onSubmit(createAndAdd)
                        Button("Create", action: createAndAdd)
                            .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                if !playlists.isEmpty {
                    Section("Add to") {
                        ForEach(playlists) { p in
                            Button {
                                if Library.add(result, to: p, in: context) {
                                    onAdded?(p.name)
                                } else {
                                    onAdded?("Already in \(p.name)")
                                }
                                dismiss()
                            } label: {
                                HStack {
                                    Image(systemName: "music.note.list").foregroundStyle(Theme.accent)
                                    Text(p.name).foregroundStyle(.white)
                                    Spacer()
                                    Text("\(p.items.count)").foregroundStyle(Theme.secondaryText)
                                    if p.items.contains(where: { $0.resultID == result.id }) {
                                        Image(systemName: "checkmark").foregroundStyle(Theme.accent)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Add to playlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func createAndAdd() {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        let p = Library.createPlaylist(named: name, in: context)
        Library.add(result, to: p, in: context)
        onAdded?(p.name)
        dismiss()
    }
}
