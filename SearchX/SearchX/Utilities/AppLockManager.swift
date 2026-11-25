import SwiftUI
import LocalAuthentication
import UIKit

/// Face ID / Touch ID / passcode gate shown every time the app returns from the background.
@MainActor
final class AppLockManager: ObservableObject {
    static let shared = AppLockManager()

    @Published private(set) var isLocked: Bool
    @Published private(set) var isAuthenticating = false
    @Published var errorMessage: String?

    private var isEnabled: Bool { UserDefaults.standard.bool(forKey: SettingsKeys.appLock) }

    private init() {
        isLocked = UserDefaults.standard.bool(forKey: SettingsKeys.appLock)
    }

    var biometryName: String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "Passcode"
        }
    }

    var biometryIcon: String {
        switch biometryName {
        case "Face ID": return "faceid"
        case "Touch ID": return "touchid"
        case "Optic ID": return "opticid"
        default: return "lock.fill"
        }
    }

    func handle(scenePhase: ScenePhase) {
        switch scenePhase {
        case .background:
            if isEnabled { isLocked = true }
        case .active:
            if isLocked && !isAuthenticating { Task { await unlock() } }
        default:
            break
        }
    }

    func unlock() async {
        guard isLocked else { return }
        guard isEnabled else { isLocked = false; return }
        if await authenticate(reason: "Unlock SearchX") {
            withAnimation(.easeOut(duration: 0.2)) { isLocked = false }
            errorMessage = nil
        }
    }

    /// Used by Settings before turning the lock on, so users can't lock themselves out.
    func authenticateForEnabling() async -> Bool {
        await authenticate(reason: "Enable App Lock")
    }

    private func authenticate(reason: String) async -> Bool {
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Cancel"
        var error: NSError?
        // .deviceOwnerAuthentication falls back to the device passcode if biometrics fail.
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            errorMessage = "Set up a device passcode or \(biometryName) in iOS Settings to use App Lock."
            Haptics.error()
            return false
        }
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            let ok = try await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
            if ok { Haptics.success() }
            return ok
        } catch let e as LAError where e.code == .userCancel || e.code == .appCancel || e.code == .systemCancel {
            return false
        } catch {
            errorMessage = error.localizedDescription
            Haptics.error()
            return false
        }
    }
}

// MARK: - Discreet icons

enum DiscreetIcon: String, CaseIterable, Identifiable {
    case standard, calculator, notes, clock

    var id: String { rawValue }

    var title: String {
        switch self {
        case .standard: return "SearchX"
        case .calculator: return "Calculator"
        case .notes: return "Notes"
        case .clock: return "Clock"
        }
    }

    /// Name of the alternate app icon set (`nil` = primary icon).
    var iconName: String? {
        switch self {
        case .standard: return nil
        case .calculator: return "AppIcon-Calculator"
        case .notes: return "AppIcon-Notes"
        case .clock: return "AppIcon-Clock"
        }
    }

    var previewAsset: String { "Preview-" + (iconName ?? "AppIcon") }

    @MainActor
    func apply() async throws {
        guard UIApplication.shared.supportsAlternateIcons else {
            throw NSError(domain: "SearchX", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "This device doesn't support alternate icons."])
        }
        guard UIApplication.shared.alternateIconName != iconName else { return }
        try await UIApplication.shared.setAlternateIconName(iconName)
    }
}
