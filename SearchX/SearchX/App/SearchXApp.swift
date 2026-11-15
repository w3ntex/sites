import SwiftUI
import SwiftData
import AVFoundation

@main
struct SearchXApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var settings = AppSettings.shared
    @StateObject private var lock = AppLockManager.shared
    @StateObject private var filterStore = FilterStore.shared
    @StateObject private var aggregator = SearchAggregator()

    init() {
        Theme.applyAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(settings)
                .environmentObject(lock)
                .environmentObject(filterStore)
                .environmentObject(aggregator)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
        .modelContainer(Persistence.container)
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Generous cache so thumbnails scroll smoothly.
        URLCache.shared = URLCache(memoryCapacity: 80 * 1024 * 1024, diskCapacity: 400 * 1024 * 1024)
        // Playback category enables background audio + Picture in Picture.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        DownloadManager.shared.activate()
        return true
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        if identifier == DownloadManager.sessionIdentifier {
            DownloadManager.shared.backgroundCompletionHandler = completionHandler
            DownloadManager.shared.activate()
        } else {
            completionHandler()
        }
    }
}

// MARK: - Root

struct RootView: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var lock: AppLockManager
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            if settings.ageConfirmed {
                MainTabView()
            } else {
                AgeGateView()
            }

            if lock.isLocked && settings.appLockEnabled {
                LockScreenView().transition(.opacity).zIndex(10)
            }

            // Hides content in the app switcher snapshot (taken while the scene is inactive).
            if settings.blurInSwitcher && scenePhase != .active {
                PrivacyCoverView().zIndex(20)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            lock.handle(scenePhase: phase)
        }
        .task {
            if lock.isLocked { await lock.unlock() }
        }
    }
}

struct MainTabView: View {
    enum Tab: Hashable { case search, favorites, history, downloads, settings }
    @State private var tab: Tab = .search

    var body: some View {
        TabView(selection: $tab) {
            SearchView()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(Tab.search)
            FavoritesView()
                .tabItem { Label("Favorites", systemImage: "heart.fill") }
                .tag(Tab.favorites)
            HistoryView()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                .tag(Tab.history)
            DownloadsView()
                .tabItem { Label("Downloads", systemImage: "arrow.down.circle.fill") }
                .tag(Tab.downloads)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                .tag(Tab.settings)
        }
        .onChange(of: tab) { _, _ in Haptics.selection() }
    }
}

// MARK: - 18+ gate

struct AgeGateView: View {
    @EnvironmentObject private var settings: AppSettings
    @State private var declined = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("18+")
                .font(.system(size: 64, weight: .black, design: .rounded))
                .foregroundStyle(Theme.accent)
            Text("Adults only")
                .font(.title.bold())
            Text("SearchX searches websites that host sexually explicit material. You must be at least 18 years old (or the age of majority where you live) to continue.")
                .font(.body)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            if declined {
                Text("Sorry — SearchX is only available to adults.")
                    .font(.headline)
                    .foregroundStyle(Theme.accent)
                    .padding(.top, 8)
            }
            Spacer()
            VStack(spacing: 12) {
                Button {
                    Haptics.success()
                    withAnimation { settings.ageConfirmed = true }
                } label: {
                    Text("I am 18 or older")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                        .foregroundStyle(.white)
                }
                Button("I am under 18") {
                    Haptics.warning()
                    declined = true
                }
                .foregroundStyle(Theme.secondaryText)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(Theme.background)
    }
}

// MARK: - Lock & privacy

struct LockScreenView: View {
    @EnvironmentObject private var lock: AppLockManager

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Theme.accent)
                Text("SearchX is locked").font(.title2.bold())
                if let error = lock.errorMessage {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }
                Button {
                    Task { await lock.unlock() }
                } label: {
                    Label("Unlock with \(lock.biometryName)", systemImage: lock.biometryIcon)
                        .font(.headline)
                        .padding(.horizontal, 24).padding(.vertical, 12)
                        .background(Theme.accent, in: Capsule())
                        .foregroundStyle(.white)
                }
                .disabled(lock.isAuthenticating)
            }
        }
    }
}

struct PrivacyCoverView: View {
    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            Color.black.opacity(0.92)
        }
        .ignoresSafeArea()
    }
}
