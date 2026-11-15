import SwiftUI
import AVKit
import SwiftData

/// AVPlayer-based viewer for direct mp4 URLs (RedGIFs serves GIFs as mp4; Reddit/Rule34 videos).
struct NativePlayerView: View {
    let result: VideoResult
    let url: URL
    let loops: Bool
    var onOpenPage: (() -> Void)? = nil

    @StateObject private var model: NativePlayerModel
    @Environment(\.dismiss) private var dismiss
    @State private var toast: String?

    init(result: VideoResult, url: URL, loops: Bool, onOpenPage: (() -> Void)? = nil) {
        self.result = result
        self.url = url
        self.loops = loops
        self.onOpenPage = onOpenPage
        _model = StateObject(wrappedValue: NativePlayerModel(result: result, url: url, loops: loops))
    }

    var body: some View {
        VStack(spacing: 0) {
            ViewerTopBar(result: result, onClose: close) {
                Button {
                    let ok = DownloadManager.shared.start(remoteURL: url, result: result, referer: result.pageURL)
                    toast = ok ? "Download started" : "Already downloaded or in progress"
                    if ok { Haptics.success() } else { Haptics.warning() }
                } label: {
                    Image(systemName: "arrow.down.circle.fill").font(.title3).foregroundStyle(Theme.accent)
                }
                Menu {
                    if let onOpenPage {
                        Button { onOpenPage() } label: { Label("Open source page", systemImage: "globe") }
                    }
                    ShareLink(item: result.pageURL) { Label("Share", systemImage: "square.and.arrow.up") }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title3)
                }
            }
            ZStack {
                PlayerControllerView(player: model.player)
                if let error = model.error {
                    VStack(spacing: 12) {
                        Text(error).multilineTextAlignment(.center)
                        if let onOpenPage {
                            Button("Open source page instead", action: onOpenPage).buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(24)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16))
                    .padding(32)
                }
            }
            if let offer = model.resumeOffer {
                HStack {
                    Image(systemName: "clock.arrow.circlepath").foregroundStyle(Theme.accent)
                    Text("Resume from \(Format.duration(offer))?").font(.subheadline)
                    Spacer()
                    Button("Resume") { model.resume() }.buttonStyle(.borderedProminent).controlSize(.small)
                    Button { model.resumeOffer = nil } label: { Image(systemName: "xmark") }
                        .foregroundStyle(Theme.secondaryText)
                }
                .padding(12)
                .background(Theme.surfaceHigh)
            }
        }
        .foregroundStyle(.white)
        .background(Color.black.ignoresSafeArea())
        .onAppear { model.player.play() }
        .onDisappear { model.stop() }
        .toast($toast)
    }

    private func close() {
        model.stop()
        dismiss()
    }
}

@MainActor
final class NativePlayerModel: ObservableObject {
    let player = AVQueuePlayer()
    @Published var error: String?
    @Published var resumeOffer: Double?

    private let key: String
    private let loops: Bool
    private var looper: AVPlayerLooper?
    private var timeObserver: Any?
    private var observations: [NSKeyValueObservation] = []

    init(result: VideoResult, url: URL, loops: Bool) {
        key = result.progressKey
        self.loops = loops
        let headers = ["User-Agent": HTTPClient.mobileUA, "Referer": result.pageURL.absoluteString]
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        let item = AVPlayerItem(asset: asset)

        if loops {
            player.isMuted = false
            let looper = AVPlayerLooper(player: player, templateItem: item)
            self.looper = looper
            observations.append(looper.observe(\.status) { [weak self] l, _ in
                guard l.status == .failed else { return }
                let msg = l.error?.localizedDescription ?? "Couldn't play this file."
                Task { @MainActor in self?.error = msg }
            })
        } else {
            player.insert(item, after: nil)
            observations.append(item.observe(\.status) { [weak self] i, _ in
                guard i.status == .failed else { return }
                let msg = i.error?.localizedDescription ?? "Couldn't play this file."
                Task { @MainActor in self?.error = msg }
            })
            if let p = Library.progress(for: key, in: Persistence.context), p.isResumable {
                resumeOffer = p.position
            }
            timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 5, preferredTimescale: 1),
                                                          queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.save() }
            }
        }
    }

    func resume() {
        guard let t = resumeOffer else { return }
        Haptics.medium()
        player.seek(to: CMTime(seconds: t, preferredTimescale: 600))
        resumeOffer = nil
    }

    private func save() {
        guard !loops, let item = player.currentItem else { return }
        let t = player.currentTime().seconds
        let d = item.duration.seconds
        guard t.isFinite, t > 3 else { return }
        Library.saveProgress(key: key, position: t, duration: d.isFinite ? d : 0, in: Persistence.context)
    }

    func stop() {
        save()
        player.pause()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
    }
}

struct PlayerControllerView: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.allowsPictureInPicturePlayback = true
        vc.canStartPictureInPictureAutomaticallyFromInline = true
        vc.entersFullScreenWhenPlaybackBegins = false
        vc.exitsFullScreenWhenPlaybackEnds = true
        vc.view.backgroundColor = .black
        return vc
    }

    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {
        if vc.player !== player { vc.player = player }
    }
}

// MARK: - Image viewer

struct ImageViewerView: View {
    let result: VideoResult
    let url: URL
    var onOpenPage: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var toast: String?

    var body: some View {
        VStack(spacing: 0) {
            ViewerTopBar(result: result, onClose: { dismiss() }) {
                Button {
                    let ok = DownloadManager.shared.start(remoteURL: url, result: result, referer: result.pageURL)
                    toast = ok ? "Saving image" : "Already saved"
                    if ok { Haptics.success() }
                } label: {
                    Image(systemName: "arrow.down.circle.fill").font(.title3).foregroundStyle(Theme.accent)
                }
                if let onOpenPage {
                    Button(action: onOpenPage) { Image(systemName: "globe").font(.title3) }
                }
            }
            GeometryReader { geo in
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFit()
                            .scaleEffect(scale)
                            .offset(offset)
                            .frame(width: geo.size.width, height: geo.size.height)
                            .gesture(
                                MagnificationGesture()
                                    .onChanged { scale = max(1, min(6, lastScale * $0)) }
                                    .onEnded { _ in lastScale = scale; if scale == 1 { offset = .zero; lastOffset = .zero } }
                                    .simultaneously(with: DragGesture()
                                        .onChanged { v in
                                            guard scale > 1 else { return }
                                            offset = CGSize(width: lastOffset.width + v.translation.width,
                                                            height: lastOffset.height + v.translation.height)
                                        }
                                        .onEnded { _ in lastOffset = offset })
                            )
                            .onTapGesture(count: 2) {
                                withAnimation(.spring) {
                                    if scale > 1 { scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero }
                                    else { scale = 2.5; lastScale = 2.5 }
                                }
                            }
                    case .failure:
                        VStack(spacing: 12) {
                            Image(systemName: "photo.badge.exclamationmark").font(.largeTitle)
                            Text("Couldn't load image.")
                            if let onOpenPage { Button("Open source page", action: onOpenPage) }
                        }
                        .frame(width: geo.size.width, height: geo.size.height)
                    default:
                        ProgressView().tint(.white).frame(width: geo.size.width, height: geo.size.height)
                    }
                }
            }
        }
        .foregroundStyle(.white)
        .background(Color.black.ignoresSafeArea())
        .toast($toast)
    }
}
