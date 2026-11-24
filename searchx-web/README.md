# SearchX Web (PWA, 18+)

SearchX as a web app you install from Safari to the iPhone home screen. You don't need a computer, it never expires (unlike sideloading), and it's free.

* **App**: `public/`, built with Preact + htm and no build step. French UI. Two themes: *Hentai néon* (default) and *Sobre* (OLED black, red accent).
* **API**: `src/worker.js`, a Cloudflare Worker that searches the sites server-side. Browsers can't call those sites directly because of CORS. The Worker also serves the app.

## Features

**v2.4 (hentai):**
* **Hentai néon theme** (Réglages → Apparence → Thème):
  * Night-plum background with pink → violet neon gradients.
  * Manga screentones, speed lines on the lock and age screens, and drifting sakura petals (off with *Reduce Motion*).
  * Japanese subtitles, an 18禁 stamp, and Mochiy Pop One for titles (`public/fonts/`, SIL OFL).
  * A new heart icon. The old icon is still offered as *Sobre*.
* **Mode hentai** (on by default):
  * xVideos, xHamster, RedTube, Eporner and RedGIFs get `hentai` added to the query.
  * Reddit searches r/hentai, r/HENTAI_GIF, r/rule34, r/ecchi and r/futanari.
  * Rule34 comes first in the mixed results.
  * The home screen offers bilingual categories (無修正, 触手, エルフ…).
* **Stricter child-safety rules for drawn content.** These apply to Rule34 always, to everything in hentai mode, and to anything that looks drawn. They block school-age terms and any booru tag built on loli/shota, and add extra Rule34 exclusions. They can't be turned off.

**v2:**
* **Phone first.** RedGIFs, Eporner and Reddit (plus the PullPush Reddit archive) are called straight from the phone when the API allows it. The app remembers what works and otherwise goes through the server.
* **Diagnostics.** Every error says what the site sent back: an anti-robot page, a region block, an age gate or an HTTP code. *Tester toutes les sources* shows whether each source answered through the phone or the server, and can disable the failing ones in one tap.
* **Security.** Face ID is asked when the app opens and every time you come back, and it works without a SearchX code (iOS falls back to the iPhone passcode). The app locks as soon as you leave it. It shows a black screen while you're away, which keeps it out of the recent-apps view.
* **Search screen.**
  * A compact header that hides while scrolling down.
  * One-tap pills for Tout / Vidéos / GIFs / Images.
  * A single **Filtres** sheet with a badge counting the active filters.
  * A results bar showing the count, sort and layout.
* **Results.** Three layouts (grid, compact, list), animated GIF previews in the grid, a "Vu" badge on items already opened, and a scroll-to-top button.
* **Home.** *Reprendre* (recent history) and *Favoris* strips.
* **Viewer.** Swipe down to close. Controls fade out on GIFs and images. Embedded players can start automatically.
* **Library.** A search box and sorting for favorites, a search box for history, and history clearing by last hour, today, or all.

* Searches xVideos, xHamster, RedTube, Eporner, Rule34, RedGIFs and Reddit at once. Results appear as each source answers. Each source has a chip above the results: tap it to show only that source, or see its error ⚠️.
* Filters for type, duration, quality and sort. Changing duration, quality or sort reorders the loaded results without reloading them. Changing the type runs a new search.
* Relevance ranking: results that actually match the query move up.
* **Rule34 works like the website.** Typed words go through the site's own tag autocomplete (for example `missionary` → `missionary_position`). Suggested tags appear in the search bar with their post counts. Results come 42 per page in the site's order.
* **Creators**: after a search, list the creators found and filter by one or several of them. Long-press a result to get "Seulement <créateur>".
* **Viewer**: full screen, swipe left and right through all the results, pinch or double-tap to zoom.
  * GIFs and direct videos play natively.
  * Tube sites play in their embedded player. A sandbox blocks the ads' pop-ups and redirects; you can turn it off per video.
* Favorites, playlists (drag to reorder, swipe to delete) and history grouped by day. Everything is stored on the phone, with JSON export and import.
* Privacy:
  * 4-digit code plus Face ID / Touch ID (a local passkey), with a lock delay.
  * The app is hidden in the app switcher.
  * Discreet home-screen name and icon: Calculatrice, Notes or Horloge.
* Infinite scroll, pull to refresh, skeleton loaders, haptics (iOS 18 and later), and an offline app shell.
* An 18+ gate. A child-safety filter you can't turn off blocks minor-related queries, tags and titles (`public/js/shared/safety.js`).

## Deploy (from the phone)

1. Create a free account at **dash.cloudflare.com**.
2. Go to **Workers & Pages → Create → Import a repository**. Connect GitHub and pick this repository.
3. Configure the project:
   * Project name: **`searchx`**. It must match `name` in `wrangler.jsonc`.
   * Build command: leave empty.
   * Deploy command: `npx wrangler deploy` (the default).
   * No root directory is needed: the repository root has its own `wrangler.jsonc` pointing at `searchx-web/`. (If you set the root directory to `searchx-web`, its own `wrangler.jsonc` works too.)
4. Open **Settings → Build → Branch control** and set the production branch to the branch that contains `searchx-web/`.
5. Every push to that branch now redeploys. The app runs at `https://searchx.<your-subdomain>.workers.dev`.
6. Open that URL in Safari, tap **Share**, then **Sur l'écran d'accueil**.

### Optional variables

Set these in the Worker's **Settings → Variables and Secrets**:

| Name | Purpose |
|---|---|
| `R34_API_KEY`, `R34_USER_ID` | Rule34 credentials. Otherwise they're entered in the app's Réglages. |
| `ACCESS_KEY` | If set, the API answers only clients that send this key (Réglages → Avancé → Serveur). |
| `REDGIFS_TOKEN` | Your own RedGIFs bearer token. Otherwise a free temporary token is fetched automatically. |

### Alternative: GitHub Actions

`.github/workflows/searchx-web.yml` runs the tests on every push. If the repository secrets `CLOUDFLARE_API_TOKEN` (from the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID` exist, it also deploys.

## Develop

```bash
cd searchx-web
npm install
npm test            # parsers, safety rules, API routes (offline, with fixtures)
npm run dev:mock    # http://localhost:8787 with fake data (no network needed)
npm run dev         # same, against the real sites
```

## Notes and limits

* **Some sites may block Cloudflare's servers or the server's region.** Each source's chip shows the exact error, and Réglages → *Tester toutes les sources* runs a check of every source.
* **Reddit**: the phone queries Reddit directly first, which looks like normal browsing. It falls back to the Worker only if that fails.
* **Rule34** needs a free API key (rule34.xxx → My Account → Options → API Access Credentials).
* **Downloads**: only direct files (RedGIFs, Rule34, Reddit) can be downloaded. Tube-site videos can't be saved.
* **Separate data**: an app installed on the home screen keeps its own data, separate from Safari's. Export a backup before reinstalling or changing the icon.
