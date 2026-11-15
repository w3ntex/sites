import SwiftUI
import SwiftData
import WebKit
import AuthenticationServices

struct SettingsView: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var lock: AppLockManager
    @EnvironmentObject private var filterStore: FilterStore
    @Environment(\.modelContext) private var context

    @State private var confirm: ConfirmAction?
    @State private var toast: String?
    @State private var iconError: String?

    enum ConfirmAction: String, Identifiable {
        case history, cache, websiteData, progress, searches
        var id: String { rawValue }
        var title: String {
            switch self {
            case .history: return "Clear all history?"
            case .cache: return "Clear cache?"
            case .websiteData: return "Clear cookies & website data?"
            case .progress: return "Forget resume positions?"
            case .searches: return "Clear recent searches?"
            }
        }
        var message: String {
            switch self {
            case .history: return "Removes every item from History."
            case .cache: return "Removes cached thumbnails and web page caches."
            case .websiteData: return "Signs you out of sites and removes age-verification cookies. You may need to verify again."
            case .progress: return "Videos will start from the beginning."
            case .searches: return "Removes autocomplete suggestions from past searches."
            }
        }
    }

    private var version: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }

    var body: some View {
        NavigationStack {
            Form {
                securitySection
                iconSection
                Section("Search") {
                    NavigationLink {
                        DefaultFiltersView()
                    } label: {
                        Label("Default filters", systemImage: "line.3.horizontal.decrease.circle")
                    }
                    NavigationLink {
                        SourcesSettingsView()
                    } label: {
                        Label("Sources", systemImage: "square.stack.3d.up")
                    }
                    Toggle(isOn: $settings.adBlockEnabled) {
                        Label("Block ads & popups", systemImage: "hand.raised.fill")
                    }
                    Toggle(isOn: $settings.hapticsEnabled) {
                        Label("Haptic feedback", systemImage: "iphone.radiowaves.left.and.right")
                    }
                }
                Section("Data") {
                    destructiveRow("Clear history", icon: "clock.arrow.circlepath", .history)
                    destructiveRow("Clear recent searches", icon: "magnifyingglass", .searches)
                    destructiveRow("Clear resume positions", icon: "play.circle", .progress)
                    destructiveRow("Clear cache", icon: "internaldrive", .cache)
                    destructiveRow("Clear cookies & website data", icon: "trash", .websiteData)
                }
                Section {
                    LabeledContent("Version", value: version)
                    Text("SearchX is a search tool for adults (18+). It doesn't host any content; results and media come from third-party sites, whose terms and local laws apply. Content involving minors is blocked.")
                        .font(.footnote)
                        .foregroundStyle(Theme.secondaryText)
                } header: {
                    Text("About")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .confirmationDialog(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
                                titleVisibility: .visible, presenting: confirm) { action in
                Button("Clear", role: .destructive) { perform(action) }
            } message: { action in
                Text(action.message)
            }
            .alert("Couldn't change icon", isPresented: Binding(get: { iconError != nil }, set: { if !$0 { iconError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(iconError ?? "") }
            .toast($toast)
        }
    }

    // MARK: Sections

    private var securitySection: some View {
        Section {
            Toggle(isOn: Binding(get: { settings.appLockEnabled }, set: setAppLock)) {
                Label("Require \(lock.biometryName)", systemImage: lock.biometryIcon)
            }
            Toggle(isOn: $settings.blurInSwitcher) {
                Label("Hide in app switcher", systemImage: "eye.slash.fill")
            }
            if let err = lock.errorMessage, !settings.appLockEnabled {
                Text(err).font(.footnote).foregroundStyle(.yellow)
            }
        } header: {
            Text("Privacy & Security")
        } footer: {
            Text("App Lock asks for \(lock.biometryName) (or your passcode) every time SearchX opens.")
        }
    }

    private var iconSection: some View {
        Section {
            HStack(spacing: 0) {
                ForEach(DiscreetIcon.allCases) { icon in
                    Button {
                        Task { await setIcon(icon) }
                    } label: {
                        VStack(spacing: 6) {
                            Image(icon.previewAsset)
                                .resizable()
                                .frame(width: 56, height: 56)
                                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous)
                                    .stroke(settings.discreetIcon == icon ? Theme.accent : .clear, lineWidth: 3))
                            Text(icon.title).font(.caption2)
                                .foregroundStyle(settings.discreetIcon == icon ? Theme.accent : Theme.secondaryText)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 6)
        } header: {
            Text("Discreet icon")
        } footer: {
            Text("Changes the Home Screen icon. iOS shows a confirmation alert; the name under the icon stays “SearchX”.")
        }
    }

    private func destructiveRow(_ title: String, icon: String, _ action: ConfirmAction) -> some View {
        Button(role: .destructive) { confirm = action } label: {
            Label(title, systemImage: icon).foregroundStyle(Theme.accent)
        }
    }

    // MARK: Actions

    private func setAppLock(_ on: Bool) {
        if on {
            Task {
                if await lock.authenticateForEnabling() {
                    settings.appLockEnabled = true
                    toast = "App Lock enabled"
                }
            }
        } else {
            settings.appLockEnabled = false
            Haptics.light()
        }
    }

    private func setIcon(_ icon: DiscreetIcon) async {
        do {
            try await icon.apply()
            settings.discreetIcon = icon
            Haptics.success()
        } catch {
            iconError = error.localizedDescription
            Haptics.error()
        }
    }

    private func perform(_ action: ConfirmAction) {
        switch action {
        case .history:
            Library.clearHistory(in: context)
            toast = "History cleared"
        case .searches:
            SuggestionProvider.clearRecent()
            toast = "Recent searches cleared"
        case .progress:
            Library.clearProgress(in: context)
            toast = "Resume positions cleared"
        case .cache:
            URLCache.shared.removeAllCachedResponses()
            let types: Set<String> = [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache,
                                      WKWebsiteDataTypeFetchCache, WKWebsiteDataTypeOfflineWebApplicationCache]
            WKWebsiteDataStore.default().removeData(ofTypes: types, modifiedSince: .distantPast) {}
            toast = "Cache cleared"
        case .websiteData:
            WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
                                                    modifiedSince: .distantPast) {}
            HTTPCookieStorage.shared.cookies?.forEach(HTTPCookieStorage.shared.deleteCookie)
            toast = "Website data cleared"
        }
        Haptics.success()
    }
}

// MARK: - Default filters

struct DefaultFiltersView: View {
    @EnvironmentObject private var filterStore: FilterStore

    var body: some View {
        Form {
            Section {
                Picker("Media type", selection: $filterStore.defaults.media) {
                    ForEach(SearchFilters.MediaFilter.allCases) { Text($0.title).tag($0) }
                }
                Picker("Duration", selection: $filterStore.defaults.duration) {
                    ForEach(SearchFilters.DurationFilter.allCases) { Text($0.title).tag($0) }
                }
                .disabled(!filterStore.defaults.durationApplies)
                Picker("Quality", selection: $filterStore.defaults.quality) {
                    ForEach(SearchFilters.QualityFilter.allCases) { Text($0.title).tag($0) }
                }
                Picker("Sort", selection: $filterStore.defaults.sort) {
                    ForEach(SearchFilters.SortOrder.allCases) { Text($0.title).tag($0) }
                }
            } footer: {
                Text("Used when you tap reset in the filter bar.")
            }
            Section("Sources searched by default") {
                ForEach(SourceID.allCases) { src in
                    Toggle(isOn: Binding(
                        get: { filterStore.defaults.enabledSources.contains(src) },
                        set: { on in
                            if on { filterStore.defaults.enabledSources.insert(src) }
                            else { filterStore.defaults.enabledSources.remove(src) }
                        })) {
                        HStack { SourceBadge(source: src); Text(src.displayName) }
                    }
                }
            }
            Section {
                Button("Apply defaults to search now") {
                    filterStore.resetToDefaults()
                    Haptics.success()
                }
                Button("Restore factory defaults", role: .destructive) {
                    filterStore.defaults = SearchFilters()
                    Haptics.light()
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Default filters")
    }
}

// MARK: - Sources

struct SourcesSettingsView: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var filterStore: FilterStore

    var body: some View {
        Form {
            Section {
                ForEach(SourceID.allCases) { src in
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle(isOn: Binding(
                            get: { filterStore.current.enabledSources.contains(src) },
                            set: { on in
                                if on { filterStore.current.enabledSources.insert(src) }
                                else { filterStore.current.enabledSources.remove(src) }
                            })) {
                            HStack { SourceBadge(source: src); Text(src.displayName) }
                        }
                        if let notes = src.notes {
                            Text(notes).font(.caption).foregroundStyle(Theme.secondaryText)
                        }
                    }
                }
            } header: {
                Text("Enabled sources")
            }

            Section {
                SecureField("API key (or paste the whole line)", text: $settings.rule34APIKey)
                TextField("User ID", text: $settings.rule34UserID)
                    .keyboardType(.numbersAndPunctuation)
                if !Credentials.rule34APIKey.isEmpty && !Credentials.rule34UserID.isEmpty {
                    Label("Credentials detected (user \(Credentials.rule34UserID))", systemImage: "checkmark.seal.fill")
                        .font(.footnote)
                        .foregroundStyle(.green)
                }
            } header: {
                Text("Rule34")
            } footer: {
                Text("rule34.xxx → My Account → Options → API Access Credentials. You can paste the whole “&api_key=…&user_id=…” line into the API key field. Results are always limited to rating:explicit.")
            }

            Section {
                SecureField("Bearer token (optional)", text: $settings.redgifsToken)
            } header: {
                Text("RedGIFs")
            } footer: {
                Text("Leave empty to use a free temporary token fetched automatically.")
            }

            RedditAccountSection()

            Section {
                TextField("Instances", text: $settings.nitterInstances, axis: .vertical)
                    .lineLimit(1...4)
                Button("Reset to default instances") { settings.nitterInstances = Credentials.defaultNitter }
            } header: {
                Text("X (via Nitter)")
            } footer: {
                Text("Comma-separated Nitter hosts, tried in order. Public instances come and go — replace them if X results fail.")
            }
        }
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Sources")
    }
}

// MARK: - Reddit account

struct RedditAccountSection: View {
    @EnvironmentObject private var settings: AppSettings
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Section {
            if let user = settings.redditUsername, RedditTokenStore.isSignedIn {
                Label("Connected as u/\(user)", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)
                Button("Disconnect", role: .destructive) {
                    Task {
                        await RedditTokenStore.shared.signOut()
                        settings.redditUsername = nil
                        Haptics.light()
                    }
                }
            } else {
                TextField("Client ID", text: $settings.redditClientID)
                Button {
                    Task { await connect() }
                } label: {
                    HStack {
                        Label("Connect Reddit account", systemImage: "person.crop.circle.badge.checkmark")
                        if busy { Spacer(); ProgressView() }
                    }
                }
                .disabled(busy || settings.redditClientID.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.yellow)
            }
        } header: {
            Text("Reddit")
        } footer: {
            Text("""
            1. On reddit.com (logged in), open reddit.com/prefs/apps → “create another app…”.
            2. Name: SearchX · type: **installed app** · redirect uri: **searchx://reddit-auth** → create.
            3. Copy the ID shown under the app name, paste it above, tap Connect.
            Turn on “Show mature content” in your Reddit settings to get NSFW results.
            """)
        }
    }

    private func connect() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            settings.redditUsername = try await RedditLogin.shared.signIn()
            Haptics.success()
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
            // user closed the sheet
        } catch {
            self.error = SearchError.message(for: error)
            Haptics.error()
        }
    }
}
