import SwiftUI

enum SourceID: String, CaseIterable, Codable, Identifiable, Hashable, Sendable {
    case xvideos, xhamster, redtube, rule34, redgifs, xcom, reddit

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .xvideos: return "xVideos"
        case .xhamster: return "xHamster"
        case .redtube: return "RedTube"
        case .rule34: return "Rule34"
        case .redgifs: return "RedGIFs"
        case .xcom: return "X"
        case .reddit: return "Reddit"
        }
    }

    /// Two-letter badge shown on thumbnails.
    var badge: String {
        switch self {
        case .xvideos: return "XV"
        case .xhamster: return "XH"
        case .redtube: return "RT"
        case .rule34: return "R34"
        case .redgifs: return "RG"
        case .xcom: return "X"
        case .reddit: return "RD"
        }
    }

    var color: Color {
        switch self {
        case .xvideos: return Color(red: 0.8, green: 0.1, blue: 0.1)
        case .xhamster: return Color(red: 0.95, green: 0.3, blue: 0.2)
        case .redtube: return Color(red: 0.75, green: 0.05, blue: 0.1)
        case .rule34: return Color(red: 0.4, green: 0.75, blue: 0.4)
        case .redgifs: return Color(red: 0.9, green: 0.2, blue: 0.4)
        case .xcom: return Color(white: 0.85)
        case .reddit: return Color(red: 1.0, green: 0.27, blue: 0.0)
        }
    }

    var icon: String {
        switch self {
        case .xvideos, .xhamster, .redtube: return "play.rectangle.fill"
        case .rule34: return "paintpalette.fill"
        case .redgifs: return "infinity"
        case .xcom: return "xmark"
        case .reddit: return "bubble.left.and.bubble.right.fill"
        }
    }

    /// Media types this source can return.
    var mediaTypes: Set<MediaType> {
        switch self {
        case .xvideos, .xhamster, .redtube: return [.video]
        case .rule34: return [.video, .gif, .image]
        case .redgifs: return [.gif, .image]
        case .xcom: return [.video, .gif, .image]
        case .reddit: return [.video, .gif, .image]
        }
    }

    var notes: String? {
        switch self {
        case .rule34: return "Requires a free API key + user ID (rule34.xxx → My Account → Options)."
        case .redgifs: return "Uses a free temporary token automatically; you can paste your own."
        case .xcom: return "X requires login for search, so results come from public Nitter instances (best effort — many are down or behind anti-bot checks)."
        case .reddit: return "Connect your Reddit account below — Reddit blocks most anonymous apps. Only NSFW posts are shown."
        case .xhamster: return "Uses the JSON API, falling back to scraping."
        case .xvideos: return "Scrapes the public search page."
        default: return nil
        }
    }
}
