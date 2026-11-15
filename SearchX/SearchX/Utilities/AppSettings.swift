import SwiftUI

enum SettingsKeys {
    static let ageConfirmed = "ageConfirmed"
    static let appLock = "appLockEnabled"
    static let blurInSwitcher = "blurInSwitcher"
    static let discreetIcon = "discreetIcon"
    static let haptics = "hapticsEnabled"
    static let adBlock = "adBlockEnabled"
    static let redgifsToken = "redgifsToken"
    static let rule34APIKey = "rule34APIKey"
    static let rule34UserID = "rule34UserID"
    static let nitterInstances = "nitterInstances"
    static let currentFilters = "currentFilters"
    static let defaultFilters = "defaultFilters"
    static let recentSearches = "recentSearches"
}

/// Credentials readable from any thread (services run off the main actor).
enum Credentials {
    static var redgifsToken: String {
        UserDefaults.standard.string(forKey: SettingsKeys.redgifsToken)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
    /// Accepts either the bare values or the whole "&api_key=…&user_id=…" line copied from rule34.xxx
    /// (pasted into either field), ignoring spaces/newlines the text box may add.
    private static func rule34Field(_ name: String) -> String? {
        for key in [SettingsKeys.rule34APIKey, SettingsKeys.rule34UserID] {
            let raw = (UserDefaults.standard.string(forKey: key) ?? "").filter { !$0.isWhitespace }
            if let value = Rx.first("\(name)=([^&]+)", in: raw) { return value }
        }
        return nil
    }

    static var rule34APIKey: String {
        if let v = rule34Field("api_key") { return v }
        let raw = (UserDefaults.standard.string(forKey: SettingsKeys.rule34APIKey) ?? "").filter { !$0.isWhitespace }
        return raw.contains("=") ? "" : raw
    }
    static var rule34UserID: String {
        if let v = rule34Field("user_id") { return v }
        let raw = (UserDefaults.standard.string(forKey: SettingsKeys.rule34UserID) ?? "").filter { !$0.isWhitespace }
        return raw.contains("=") ? "" : raw
    }
    static let defaultNitter = "nitter.net, nitter.poast.org, nitter.privacydev.net"
    static var nitterInstances: [String] {
        let raw = UserDefaults.standard.string(forKey: SettingsKeys.nitterInstances) ?? defaultNitter
        return raw.split(whereSeparator: { $0 == "," || $0 == "\n" || $0 == " " })
            .map { $0.trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: "https://", with: "")
                .replacingOccurrences(of: "http://", with: "")
                .trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
            .filter { !$0.isEmpty }
    }
}

@MainActor
final class AppSettings: ObservableObject {
    static let shared = AppSettings()
    private let d = UserDefaults.standard

    @Published var ageConfirmed: Bool { didSet { d.set(ageConfirmed, forKey: SettingsKeys.ageConfirmed) } }
    @Published var appLockEnabled: Bool { didSet { d.set(appLockEnabled, forKey: SettingsKeys.appLock) } }
    @Published var blurInSwitcher: Bool { didSet { d.set(blurInSwitcher, forKey: SettingsKeys.blurInSwitcher) } }
    @Published var hapticsEnabled: Bool { didSet { d.set(hapticsEnabled, forKey: SettingsKeys.haptics) } }
    @Published var adBlockEnabled: Bool { didSet { d.set(adBlockEnabled, forKey: SettingsKeys.adBlock) } }
    @Published var discreetIcon: DiscreetIcon { didSet { d.set(discreetIcon.rawValue, forKey: SettingsKeys.discreetIcon) } }
    @Published var redgifsToken: String { didSet { d.set(redgifsToken, forKey: SettingsKeys.redgifsToken) } }
    @Published var rule34APIKey: String { didSet { d.set(rule34APIKey, forKey: SettingsKeys.rule34APIKey) } }
    @Published var rule34UserID: String { didSet { d.set(rule34UserID, forKey: SettingsKeys.rule34UserID) } }
    @Published var nitterInstances: String { didSet { d.set(nitterInstances, forKey: SettingsKeys.nitterInstances) } }

    private init() {
        ageConfirmed = d.bool(forKey: SettingsKeys.ageConfirmed)
        appLockEnabled = d.bool(forKey: SettingsKeys.appLock)
        blurInSwitcher = d.object(forKey: SettingsKeys.blurInSwitcher) as? Bool ?? true
        hapticsEnabled = d.object(forKey: SettingsKeys.haptics) as? Bool ?? true
        adBlockEnabled = d.object(forKey: SettingsKeys.adBlock) as? Bool ?? true
        discreetIcon = DiscreetIcon(rawValue: d.string(forKey: SettingsKeys.discreetIcon) ?? "") ?? .standard
        redgifsToken = d.string(forKey: SettingsKeys.redgifsToken) ?? ""
        rule34APIKey = d.string(forKey: SettingsKeys.rule34APIKey) ?? ""
        rule34UserID = d.string(forKey: SettingsKeys.rule34UserID) ?? ""
        nitterInstances = d.string(forKey: SettingsKeys.nitterInstances) ?? Credentials.defaultNitter
    }
}

/// Holds the filter bar state (persisted) and the user's default filters.
@MainActor
final class FilterStore: ObservableObject {
    static let shared = FilterStore()

    @Published var current: SearchFilters { didSet { save(current, SettingsKeys.currentFilters) } }
    @Published var defaults: SearchFilters { didSet { save(defaults, SettingsKeys.defaultFilters) } }

    private init() {
        let defs = Self.load(SettingsKeys.defaultFilters) ?? SearchFilters()
        defaults = defs
        current = Self.load(SettingsKeys.currentFilters) ?? defs
    }

    func resetToDefaults() { current = defaults }

    private func save(_ f: SearchFilters, _ key: String) {
        if let data = try? JSONEncoder().encode(f) { UserDefaults.standard.set(data, forKey: key) }
    }

    private static func load(_ key: String) -> SearchFilters? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(SearchFilters.self, from: data)
    }
}

/// Recent searches + bundled suggestions for autocomplete.
enum SuggestionProvider {
    static let popular = [
        "amateur", "anal", "asian", "bbw", "big ass", "big tits", "blonde", "blowjob", "brunette", "compilation",
        "cosplay", "couple", "creampie", "cumshot", "ebony", "solo", "hentai", "homemade", "latina", "lesbian",
        "massage", "milf", "orgasm", "pov", "public", "redhead", "squirt", "threesome", "toys", "webcam"
    ]

    static var recent: [String] {
        UserDefaults.standard.stringArray(forKey: SettingsKeys.recentSearches) ?? []
    }

    static func remember(_ q: String) {
        let t = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        var list = recent.filter { $0.caseInsensitiveCompare(t) != .orderedSame }
        list.insert(t, at: 0)
        UserDefaults.standard.set(Array(list.prefix(30)), forKey: SettingsKeys.recentSearches)
    }

    static func clearRecent() { UserDefaults.standard.removeObject(forKey: SettingsKeys.recentSearches) }

    struct Suggestion: Hashable {
        var text: String
        var isRecent: Bool
    }

    static func suggestions(for text: String) -> [Suggestion] {
        let q = text.trimmingCharacters(in: .whitespaces).lowercased()
        let rec = recent.filter { q.isEmpty || $0.lowercased().hasPrefix(q) || $0.lowercased().contains(q) }
            .prefix(q.isEmpty ? 8 : 5)
            .map { Suggestion(text: $0, isRecent: true) }
        guard !q.isEmpty else { return Array(rec) }
        let recSet = Set(rec.map { $0.text.lowercased() })
        let pop = popular.filter { $0.hasPrefix(q) || ($0.contains(q) && q.count > 2) }
            .filter { !recSet.contains($0) && $0 != q }
            .prefix(6)
            .map { Suggestion(text: $0, isRecent: false) }
        return Array(rec) + pop
    }
}
