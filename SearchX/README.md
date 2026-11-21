# SearchX (iOS, 18+)

SearchX searches several adult sites at once and puts the results in one grid. It is meant to be **sideloaded**; it is not built for the App Store.

> **Adults only.** On first launch the app asks you to confirm you are 18+. A built-in safety filter blocks searches and results that point to minors (for example the Rule34 tags `loli`, `shota`, `young`, and phrases like "underage" or "15yo"). You cannot turn this filter off.

## Features

| # | Feature | Where |
|---|---------|-------|
| 1 | Unified search across xVideos, xHamster, RedTube, Rule34, RedGIFs and Reddit. Results stream in per source, autocomplete comes from recent and popular searches, and results show in a 2-column grid with badges | `Services/*`, `Views/SearchView.swift`, `Views/ResultsGridView.swift` |
| 2 | Filter bar that persists between launches: media type, duration, quality, sort, and per-source checkboxes | `Views/FilterBar.swift`, `Models/SearchFilters.swift` |
| 3 | Full-screen WKWebView player with native controls (play/pause, seek, ±10s, fullscreen, PiP), ad and popup blocking, and resume from the last position. Direct mp4s (RedGIFs, Reddit, Rule34) play in AVPlayer | `Views/VideoPlayerView.swift`, `Views/NativePlayerView.swift`, `Utilities/AdBlocker.swift` |
| 4 | Detects age-verification pages (Yoti, AgeID, AgeVerif, VerifyMyAge, Go.cam) and shows a native prompt. You can verify in the Yoti app, in the app itself, or in an `SFSafariViewController`; the page reloads afterward | `Utilities/AgeGateDetector.swift`, `Views/AgeVerificationView.swift` |
| 5 | Favorites and playlists (create, rename, delete, drag to reorder), stored with SwiftData | `Views/FavoritesView.swift`, `Models/PersistentModels.swift` |
| 6 | History grouped by day, with swipe to delete and "Clear all" | `Views/HistoryView.swift` |
| 7 | Discreet mode: alternate icons (Calculator, Notes, Clock), Face ID / Touch ID lock, and a cover in the app switcher | `Utilities/AppLockManager.swift`, `App/SearchXApp.swift` |
| 8 | Best-effort downloads: JavaScript finds direct `.mp4` URLs, and a background `URLSession` saves them to `Documents/Downloads` (excluded from backup) | `Services/DownloadManager.swift`, `Views/DownloadsView.swift` |

## Building

Requirements: macOS, Xcode 15.3 or later (iOS 17 SDK), and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
brew install xcodegen
cd SearchX
xcodegen generate          # creates SearchX.xcodeproj
open SearchX.xcodeproj     # run on a device/simulator, or:
./scripts/build_ipa.sh     # → build/SearchX.ipa (unsigned)
```

**No PC at all?** See [`../searchx-web`](../searchx-web/README.md): the same app as a web app installed from Safari (no sideloading, no 7-day expiry).

**Without a Mac:** every push that touches `SearchX/` runs the GitHub Actions workflow `.github/workflows/searchx-ios.yml`. It builds the unsigned IPA and uploads it as the build artifact **SearchX-unsigned-ipa**.

### Sideloading
Install the unsigned `SearchX.ipa` with AltStore, SideStore, Sideloadly or TrollStore. These tools re-sign the app with your Apple ID. A free Apple ID has to re-sign every 7 days.

## Source notes

| Source | Method | Notes |
|---|---|---|
| RedTube | Pornhub-network webmaster API (`api.redtube.com`) | |
| xVideos | Scrapes the search page | Breaks if the page markup changes |
| xHamster | `/api/front/search`, then falls back to the `window.initials` JSON in the search page | |
| Rule34 | DAPI with `json=1` | **Requires a free API key and user ID** (Settings → Sources). Typed words are turned into real tags through the site's own autocomplete (e.g. `missionary` → `missionary_position`), and the search bar suggests tags with post counts like the site. Always adds `rating:explicit` plus negative tags for minors |
| RedGIFs | v2 API | Fetches a free temporary token automatically; you can paste your own instead |
| Reddit | OAuth API once you connect your account (Settings → Sources → Reddit); anonymous `search.json` otherwise | Reddit usually blocks anonymous apps (403), so connecting is recommended. Only `over_18` posts with media |

Tap a source chip above the results to show only that source (tap several to combine). A chip with ⚠️ shows why that source failed.

## Known limitations
* **Safari verification and cookies:** `SFSafariViewController` keeps its own cookies, separate from the in-app web view. If a site still asks for verification after you verify in Safari, use **Verify here**, which runs the check inside the app's own web view so the cookie is kept.
* **Download coverage:** downloads only work when the page exposes a plain `.mp4`. HLS/blob streams can't be saved.
* **App name:** alternate icons change only the icon. iOS doesn't let an app rename itself at runtime.
* **Credential storage:** API credentials are stored in `UserDefaults`.
