import SwiftUI
import UIKit

enum Theme {
    static let background = Color.black                                     // OLED #000000
    static let accent = Color(red: 0xE6 / 255, green: 0x39 / 255, blue: 0x46 / 255) // #E63946
    static let uiAccent = UIColor(red: 0xE6 / 255, green: 0x39 / 255, blue: 0x46 / 255, alpha: 1)
    static let surface = Color(white: 0.07)
    static let surfaceHigh = Color(white: 0.13)
    static let secondaryText = Color(white: 0.6)

    /// Makes UIKit chrome (tab bar / nav bar) pure black.
    static func applyAppearance() {
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = .black
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = .black
        nav.shadowColor = .clear
        nav.titleTextAttributes = [.foregroundColor: UIColor.white]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor.white]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav

        UITableView.appearance().backgroundColor = .black
        UIView.appearance(whenContainedInInstancesOf: [UIAlertController.self]).tintColor = uiAccent
    }
}

enum Haptics {
    private static var enabled: Bool {
        UserDefaults.standard.object(forKey: SettingsKeys.haptics) as? Bool ?? true
    }

    @MainActor static func light() { impact(.light) }
    @MainActor static func medium() { impact(.medium) }

    @MainActor static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
        guard enabled else { return }
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    @MainActor static func success() { notify(.success) }
    @MainActor static func error() { notify(.error) }
    @MainActor static func warning() { notify(.warning) }

    @MainActor static func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        guard enabled else { return }
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }

    @MainActor static func selection() {
        guard enabled else { return }
        UISelectionFeedbackGenerator().selectionChanged()
    }
}

enum Format {
    static func duration(_ seconds: Int?) -> String? {
        guard let s = seconds, s > 0 else { return nil }
        return duration(Double(s))
    }

    static func duration(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let s = Int(seconds)
        let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }

    static func compact(_ n: Int?) -> String? {
        guard let n else { return nil }
        let d = Double(n)
        switch d {
        case 1_000_000_000...: return String(format: "%.1fB", d / 1_000_000_000).replacingOccurrences(of: ".0", with: "")
        case 1_000_000...: return String(format: "%.1fM", d / 1_000_000).replacingOccurrences(of: ".0", with: "")
        case 1_000...: return String(format: "%.1fK", d / 1_000).replacingOccurrences(of: ".0", with: "")
        default: return "\(n)"
        }
    }

    static func bytes(_ n: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: n, countStyle: .file)
    }
}

// MARK: - Toast

struct ToastModifier: ViewModifier {
    @Binding var message: String?

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let message {
                Text(message)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Capsule().fill(Theme.surfaceHigh))
                    .overlay(Capsule().stroke(Theme.accent.opacity(0.6), lineWidth: 1))
                    .padding(.bottom, 90)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: message) {
                        try? await Task.sleep(for: .seconds(2.2))
                        withAnimation { self.message = nil }
                    }
            }
        }
        .animation(.spring(duration: 0.3), value: message)
    }
}

extension View {
    func toast(_ message: Binding<String?>) -> some View { modifier(ToastModifier(message: message)) }
}
