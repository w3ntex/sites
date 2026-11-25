import SwiftUI
import SwiftData

/// What a tap on a result opens: a swipeable gallery when the result can be shown natively
/// (images, GIFs, direct mp4s from Rule34 / RedGIFs / Reddit / X), otherwise the single viewer.
struct ViewerRequest: Identifiable {
    let id = UUID()
    let items: [VideoResult]
    let startID: String

    static func make(_ r: VideoResult, in list: [VideoResult]) -> ViewerRequest {
        guard r.isNativeViewable else { return ViewerRequest(items: [r], startID: r.id) }
        var seen = Set<String>()
        let items = list.filter { $0.isNativeViewable && seen.insert($0.id).inserted }
        return ViewerRequest(items: items.isEmpty ? [r] : items, startID: r.id)
    }
}

extension VideoResult {
    var isNativeViewable: Bool { nativePlayableURL != nil || nativeImageURL != nil }
}

struct ViewerHost: View {
    let request: ViewerRequest

    var body: some View {
        if request.items.count > 1 {
            GalleryView(items: request.items, startID: request.startID)
        } else if let r = request.items.first {
            MediaViewer(result: r)
        }
    }
}

// MARK: - Gallery

struct GalleryView: View {
    let items: [VideoResult]
    @State private var currentID: String
    @State private var webTarget: VideoResult?
    @State private var toast: String?
    @State private var entry: HistoryEntry?
    @State private var openedAt = Date()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context

    init(items: [VideoResult], startID: String) {
        self.items = items
        _currentID = State(initialValue: startID)
    }

    private var index: Int { items.firstIndex { $0.id == currentID } ?? 0 }
    private var current: VideoResult { items[index] }

    var body: some View {
        VStack(spacing: 0) {
            ViewerTopBar(result: current,
                         subtitle: "\(index + 1) / \(items.count) · \(current.sourceName)",
                         onClose: { dismiss() }) {
                Button(action: download) {
                    Image(systemName: "arrow.down.circle.fill").font(.title3).foregroundStyle(Theme.accent)
                }
                Menu {
                    Button { webTarget = current } label: { Label("Open source page", systemImage: "globe") }
                    ShareLink(item: current.pageURL) { Label("Share", systemImage: "square.and.arrow.up") }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title3)
                }
            }
            .id(current.id)   // refreshes the favorite heart for each item

            TabView(selection: $currentID) {
                ForEach(items) { r in
                    GalleryPage(result: r, isActive: r.id == currentID) { webTarget = r }
                        .tag(r.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .overlay(alignment: .bottom) { swipeHint }
        }
        .foregroundStyle(.white)
        .background(Color.black.ignoresSafeArea())
        .onAppear { logCurrent() }
        .onChange(of: currentID) { _, _ in
            Haptics.selection()
            finishCurrent()
            logCurrent()
        }
        .onDisappear { finishCurrent() }
        .fullScreenCover(item: $webTarget) { WebPlayerView(result: $0) }
        .toast($toast)
    }

    @ViewBuilder
    private var swipeHint: some View {
        HStack {
            Image(systemName: "chevron.left").opacity(index > 0 ? 0.6 : 0)
            Spacer()
            Image(systemName: "chevron.right").opacity(index < items.count - 1 ? 0.6 : 0)
        }
        .font(.caption.weight(.bold))
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
        .allowsHitTesting(false)
    }

    private func download() {
        guard let url = current.nativePlayableURL ?? current.nativeImageURL else { return }
        let ok = DownloadManager.shared.start(remoteURL: url, result: current, referer: current.pageURL)
        toast = ok ? "Download started" : "Already downloaded or in progress"
        if ok { Haptics.success() } else { Haptics.warning() }
    }

    // History: each item viewed in the gallery gets its own entry and watch time.
    private func logCurrent() {
        openedAt = .now
        entry = Library.logOpen(current, in: context)
    }

    private func finishCurrent() {
        guard let entry else { return }
        entry.watchDuration += Date().timeIntervalSince(openedAt)
        try? context.save()
        self.entry = nil
    }
}

struct GalleryPage: View {
    let result: VideoResult
    let isActive: Bool
    var onOpenPage: () -> Void

    var body: some View {
        if let url = result.nativeImageURL {
            ZoomableImage(url: url, onOpenPage: onOpenPage)
        } else if let url = result.nativePlayableURL {
            if isActive {
                // Only the visible page owns an AVPlayer; it's torn down when swiped away.
                InlinePlayer(result: result, url: url, loops: result.mediaType == .gif, onOpenPage: onOpenPage)
            } else {
                AsyncImage(url: result.thumbnail) { img in
                    img.resizable().scaledToFit()
                } placeholder: {
                    ProgressView().tint(.white)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay { Image(systemName: "play.circle.fill").font(.system(size: 54)).opacity(0.8) }
            }
        }
    }
}

struct InlinePlayer: View {
    let onOpenPage: () -> Void
    @StateObject private var model: NativePlayerModel

    init(result: VideoResult, url: URL, loops: Bool, onOpenPage: @escaping () -> Void) {
        self.onOpenPage = onOpenPage
        _model = StateObject(wrappedValue: NativePlayerModel(result: result, url: url, loops: loops))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            PlayerControllerView(player: model.player)
            if let error = model.error {
                VStack(spacing: 12) {
                    Text(error).multilineTextAlignment(.center)
                    Button("Open source page instead", action: onOpenPage).buttonStyle(.borderedProminent)
                }
                .padding(24)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .padding(32)
                .frame(maxHeight: .infinity)
            } else if let offer = model.resumeOffer {
                HStack {
                    Text("Resume from \(Format.duration(offer))?").font(.subheadline)
                    Spacer()
                    Button("Resume") { model.resume() }.buttonStyle(.borderedProminent).controlSize(.small)
                    Button { model.resumeOffer = nil } label: { Image(systemName: "xmark") }
                }
                .padding(10)
                .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 12)
                .padding(.bottom, 70)
            }
        }
        .onAppear { model.player.play() }
        .onDisappear { model.stop() }
    }
}
