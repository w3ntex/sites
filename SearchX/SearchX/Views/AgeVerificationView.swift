import SwiftUI
import SafariServices

/// Native prompt shown when a page redirects to (or embeds) a third-party age verification provider.
struct AgeVerificationSheet: View {
    let gate: AgeGateInfo
    var onYoti: () -> Void
    var onBrowser: () -> Void
    var onInApp: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private static let yotiScheme = URL(string: "yoti://")!

    private var yotiInstalled: Bool { UIApplication.shared.canOpenURL(Self.yotiScheme) }

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.badge.shield.checkmark.fill")
                .font(.system(size: 44))
                .foregroundStyle(Theme.accent)
                .padding(.top, 24)
            Text("Age verification required").font(.title3.bold())
            Text("This site requires age verification\(gate.provider == .generic ? "" : " via \(gate.provider.rawValue)"). Tap to verify — the page reloads automatically when you're done.")
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            VStack(spacing: 10) {
                if gate.provider == .yoti && yotiInstalled {
                    actionButton("Verify with the Yoti app", icon: "person.text.rectangle", prominent: true) {
                        onYoti()
                        openURL(Self.yotiScheme)
                    }
                }
                actionButton("Verify here", icon: "checkmark.shield", prominent: !(gate.provider == .yoti && yotiInstalled)) {
                    onInApp()
                }
                actionButton("Verify in Safari view", icon: "safari", prominent: false) {
                    onBrowser()
                }
                Button("Not now") { dismiss() }
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.top, 2)
            }
            .padding(.horizontal, 20)
            Spacer(minLength: 0)
        }
        .background(Theme.background)
    }

    private func actionButton(_ title: String, icon: String, prominent: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.medium()
            dismiss()
            action()
        } label: {
            Label(title, systemImage: icon)
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(prominent ? Theme.accent : Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 12))
                .foregroundStyle(.white)
        }
    }
}

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    var onFinish: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        let vc = SFSafariViewController(url: url, configuration: config)
        vc.preferredControlTintColor = Theme.uiAccent
        vc.preferredBarTintColor = .black
        vc.dismissButtonStyle = .done
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}

    final class Coordinator: NSObject, SFSafariViewControllerDelegate {
        let onFinish: () -> Void
        init(onFinish: @escaping () -> Void) { self.onFinish = onFinish }
        func safariViewControllerDidFinish(_ controller: SFSafariViewController) { onFinish() }
    }
}
