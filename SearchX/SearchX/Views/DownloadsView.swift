import SwiftUI
import SwiftData
import AVKit

struct DownloadsView: View {
    @Query(sort: \DownloadItem.createdAt, order: .reverse) private var downloads: [DownloadItem]
    @State private var playing: LocalMedia?
    @State private var confirmDeleteAll = false

    struct LocalMedia: Identifiable {
        let id = UUID()
        let url: URL
        let title: String
        let isImage: Bool
    }

    private var totalSize: Int64 {
        downloads.filter { $0.status == .completed }.reduce(0) { $0 + $1.totalBytes }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(downloads) { item in
                    Button {
                        open(item)
                    } label: {
                        DownloadRow(item: item)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            DownloadManager.shared.delete(item)
                            Haptics.medium()
                        } label: { Label("Delete", systemImage: "trash") }
                        if item.status == .failed {
                            Button {
                                DownloadManager.shared.retry(item)
                            } label: { Label("Retry", systemImage: "arrow.clockwise") }
                            .tint(.orange)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .overlay {
                if downloads.isEmpty {
                    ContentUnavailableView("No downloads", systemImage: "arrow.down.circle",
                                           description: Text("When the player detects a direct video file, tap the download button. Files stay private inside SearchX."))
                }
            }
            .safeAreaInset(edge: .bottom) {
                if totalSize > 0 {
                    Text("\(Format.bytes(totalSize)) used")
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .padding(8)
                }
            }
            .navigationTitle("Downloads")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !downloads.isEmpty {
                    Button("Delete all", role: .destructive) { confirmDeleteAll = true }
                        .foregroundStyle(Theme.accent)
                }
            }
            .confirmationDialog("Delete all downloads?", isPresented: $confirmDeleteAll, titleVisibility: .visible) {
                Button("Delete all", role: .destructive) {
                    DownloadManager.shared.deleteAll()
                    Haptics.success()
                }
            }
            .fullScreenCover(item: $playing) { media in
                LocalPlayerView(media: media)
            }
        }
    }

    private func open(_ item: DownloadItem) {
        guard item.status == .completed, let url = item.localURL,
              FileManager.default.fileExists(atPath: url.path) else {
            Haptics.warning()
            return
        }
        Haptics.light()
        playing = LocalMedia(url: url, title: item.title, isImage: item.isImage)
    }
}

struct DownloadRow: View {
    let item: DownloadItem

    var body: some View {
        HStack(spacing: 12) {
            ThumbnailView(url: URL(string: item.thumbnailURL))
                .frame(width: 112, height: 63)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay {
                    if item.status == .completed {
                        Image(systemName: item.isImage ? "photo.fill" : "play.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.white.opacity(0.9))
                            .shadow(radius: 4)
                    }
                }
            VStack(alignment: .leading, spacing: 5) {
                Text(item.title).font(.subheadline.weight(.medium)).lineLimit(2).foregroundStyle(.white)
                switch item.status {
                case .queued:
                    Text("Queued…").font(.caption).foregroundStyle(Theme.secondaryText)
                case .downloading:
                    ProgressView(value: item.progress).tint(Theme.accent)
                    Text("\(Int(item.progress * 100))%\(item.totalBytes > 0 ? " of \(Format.bytes(item.totalBytes))" : "")")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(Theme.secondaryText)
                case .completed:
                    HStack(spacing: 6) {
                        if let src = SourceID(rawValue: item.source) { SourceBadge(source: src, compact: true) }
                        Text(Format.bytes(item.totalBytes)).font(.caption).foregroundStyle(Theme.secondaryText)
                    }
                case .failed:
                    Label(item.errorMessage ?? "Download failed", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.yellow)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

struct LocalPlayerView: View {
    let media: DownloadsView.LocalMedia
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            if media.isImage {
                if let data = try? Data(contentsOf: media.url), let ui = UIImage(data: data) {
                    Image(uiImage: ui).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else if let player {
                PlayerControllerView(player: player).ignoresSafeArea()
            }
            Button {
                player?.pause()
                dismiss()
            } label: {
                Image(systemName: "xmark").font(.body.weight(.bold)).foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(Theme.surfaceHigh, in: Circle())
            }
            .padding(12)
        }
        .onAppear {
            guard !media.isImage, player == nil else { return }
            let p = AVPlayer(url: media.url)
            player = p
            p.play()
        }
        .onDisappear { player?.pause() }
    }
}
