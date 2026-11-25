# SearchX Web (PWA, 18+)

SearchX as a web app you install from Safari to the iPhone home screen. You don't need a computer, it never expires (unlike sideloading), and it's free.

* **App**: `public/`, built with Preact + htm and no build step. French UI. Two modes, each with its own sites and theme: *Porno* (black, crimson to amber, Bebas Neue) and *Hentai* (neon pink and violet, Mochiy Pop One).
* **API**: `src/worker.js`, a Cloudflare Worker that searches the sites server-side. Browsers can't call those sites directly because of CORS. The Worker also serves the app.

## RedGIFs relay (Vercel)

RedGIFs rate-limits Cloudflare's servers (429), and its CORS policy only lets its own website call the search API from a browser. `api/redgifs.js` at the repository root is a small Vercel function that runs the RedGIFs search from Vercel and answers the app with open CORS. Without it, RedGIFs shows "429" almost all the time.

Setting it up from the phone:
1. Import the repository on vercel.com/new and tap Deploy. `.vercelignore` limits the deployment to `api/` and `vercel.json`.
2. Copy the project's domain (`*.vercel.app`) into Réglages → Relais RedGIFs.

The app then calls the relay straight from the phone, and the Worker is only a fallback.

## Features

**v2.7.2:** X accounts (and X searches) are no longer cut at the first 20 posts.
* Nitter's RSS feeds are read page after page with the cursor Nitter sends in its `Min-Id` header (`…/rss?cursor=…`).
* If a mirror drops that header, the cursor comes from the "Load more" link of the HTML timeline.
* Three pages load at once, then the rest as you scroll.

**v2.7.1 (fixes):**
* **Hstream and Rule34Video work again.** Both sites changed their markup: attributes on their own lines, double spaces, lazy images. The parsers now accept any spacing and attribute order, and Rule34Video results also get views and rating.
* **Danbooru no longer loads forever.**
  * With a strict filter (e.g. Vidéos on an image site), every page added one or two results and infinite scroll fetched the next one again and again.
  * Infinite scroll now pauses after two pages that add almost nothing, and the "Charger plus" button takes over.
  * Danbooru pages are 60 posts. Tags are resolved once and remembered.
  * When Danbooru's autocomplete is blocked (anti-bot page), multi-word searches use each word instead of a made-up tag.
  * Danbooru .gif files open in the viewer as images.
* **Face ID** starts by itself when the app opens or comes back. A refused automatic attempt is silent, and the screen stays a tap target.
  * The passkey request is limited to this device (`transports: ['internal']`, `hints: ['client-device']`), so there is no "other device" option.
  * Réglages → Sécurité → *Recréer la clé Face ID* saves a new key, e.g. in Apple's Passwords instead of Chrome, whose extra step showed up at each unlock.
  * iOS 18's "Require Face ID" doesn't apply to Home Screen web apps, so iOS's own "Se connecter" confirmation stays: one tap, then Face ID.

**v2.7 (Musique tab, home, transitions):**
* **Five tabs**: Accueil, Musique, Favoris, Historique, Réglages.
  * The tab bar floats, glass-like, with a highlight that slides to the active tab.
  * Pages slide in from the side of the previous tab.
* **Home**: the first tab is Accueil. Tapping it again, or the house button next to the search field, goes back to the welcome page.
* **Musique tab** (Spotify Web API, the sound still comes from the Spotify app):
  * Now playing: large cover on a blurred backdrop, seek, shuffle, previous/play/next, repeat, "J'aime", device picker (transfer), queue ("À suivre"), open in Spotify.
  * Playlists, including "Titres likés" when readable. Playlist and album pages with Lecture / Aléatoire.
  * Récents: plays a track in its playlist or album when it came from one.
  * Spotify search: tracks, artists, albums, playlists, and add to queue.
  * If nothing is active, a play request starts on the phone's Spotify.
  * Playlists use `/playlists/{id}/items` (February 2026) and fall back to `/tracks`.
  * The tab shows the sign-in steps when Spotify isn't connected, with "Coller" buttons.
  * New scopes (`playlist-read-*`, `user-read-recently-played`): older sign-ins get an "Autoriser" banner.
* **Theme change**: the new theme spreads in a circle from the finger (View Transitions, Safari 18+; a coloured wipe on older versions).
  * Sakura petals and 変態, or sparks and PORNO, for a moment.
* **Polish**: results cards come up one after the other, the background glow drifts slowly, and the viewer opens with a short zoom. Everything respects "Réduire les animations".

**v2.6 (vertical viewer, music):**
* **Viewer**: one item per screen, like TikTok or Reddit. Swipe up for the next item, down for the previous one. Swipe right (or tap ✕) to close. ▲/▼ buttons and the keyboard arrows also work. Zoom on an image locks the paging.
* **Video controls**: a time bar you can drag, a sound button and full screen replace the native controls (iOS put those under the app's own bar). Tap a video to pause or play.
  * All slides share one `<video>` element. iOS remembers per element that a tap allowed sound, and that element is unlocked by the tap that opens the viewer, so videos keep their sound while swiping.
  * If iOS still refuses sound, the video plays muted and the sound button says "Activer le son".
* **Music during videos** (Réglages → Musique): uses the Audio Session API (`navigator.audioSession.type = 'ambient'`, Safari 17+). The music of other apps keeps playing, mixed with the video's sound, instead of being paused.
  * iOS doesn't let web apps lower ("duck") another app's music.
  * Ambient sound follows the silent switch.
  * So with Spotify connected, SearchX asks for it only while Spotify is playing on the phone.
* **Spotify remote + music island**: Spotify's Web Playback SDK doesn't run on iPhone. The music plays in the Spotify app and SearchX controls it through the Spotify Web API.
  * Controls: title, cover, time, play/pause, previous/next, seek, shuffle, "J'aime". The library endpoints try `/me/library`, the February 2026 replacement for `/me/tracks`, and fall back to the old ones.
  * The island: only native apps can draw in the Dynamic Island, where iOS shows Spotify's own controls. In the installed app on an iPhone with a Dynamic Island (top safe area ≥ 51 px), SearchX draws a black pill around it that opens into a square of controls, like a Live Activity. Elsewhere it's a mini player above the tab bar.
  * Sign-in: the user's own Spotify developer app (Client ID), using Authorization Code + PKCE. Tokens stay on the phone.
  * Sign-in hand-off: on iPhone the Spotify page can end in Safari, whose storage is separate from the installed app's. `/api/spotify/callback` hands the one-time code back:
    * directly, when it shares the app's storage;
    * otherwise through a Durable Object (`SPOTIFY_HANDOFF`, 10 minutes, read once) that the app polls (`/api/spotify/poll`);
    * or by copy/paste as a last resort.
    The code is useless without the PKCE secret, which never leaves the app.
  * Since February 2026, Spotify developer apps need a **Premium** owner. Up to 5 users can be added in the app's User Management.

**v2.5.4:** Without a relay, the RedGIFs tab shows RedGIFs' own search page (`/search/gifs?query=`, the route its website uses) inside the app. The phone loads it itself, so the server's 429 limit doesn't apply. The relay is optional: it brings RedGIFs results into the SearchX grid (favorites, history, filters, viewer).

**v2.5.2:** RedGIFs relay (see above). The "Ouvrir sur RedGIFs" link now uses the site's real search URL (`/search/gifs?query=`).

**v2.5.1 (strict separation, exact keywords):**
* Porn mode never shows drawn content:
  * RedGIFs and X results tagged or described as hentai, anime, 3D, animation… are dropped.
  * Typing "hentai", "anime", "rule34"… offers to search in hentai mode instead.
* Hentai mode never shows real photos (booru `photo_(medium)`, `real_life`, `cosplay_photo`).
* Favorites, playlists, history and recent searches belong to the mode they were made in. Each mode only shows its own, plus a link to the other mode.
* Exact keywords:
  * RedGIFs and X only keep results that contain every word searched. The number of hidden results is shown.
  * Common French words are searched in English, since the sites tag in English ("gros seins" → big tits), and the translation is shown.
* A newly deployed version is loaded on the next launch.

**v2.5 (two modes, one tab per site):**
* **Mode switch** (home screen, and Réglages → Mode). Each mode has its own sites and look. Results are shown one site at a time in tabs, in the site's own order, and are never mixed.
* **Porno mode: RedGIFs and X.**
  * **RedGIFs.** Searches now send the words as `query`. The API ignores the old `search_text`, which is why results used to be the trending feed whatever was typed. Default order is `score`.
  * RedGIFs search only works through the server, because its CORS only allows redgifs.com. RedGIFs temporary tokens are bound to the IP address and User-Agent that requested them. The Worker therefore fetches the token and searches within the same request, with the same User-Agent, and fetches a new token on `WrongSender`.
  * **X** goes through Nitter mirrors. `@name` shows that account's photos and videos. Video files are read from the post page via `/api/xvideo`, and pictures and videos load straight from X's CDN (pbs.twimg.com, video.twimg.com). Keyword search works but X hides most adult posts from logged-out readers. Followed accounts appear on the home screen.
  * Eporner, xHamster, RedTube, xVideos and Reddit are still available but off by default.
* **Hentai mode** uses dedicated hentai sites, one tab each:
  * Hstream: HD and 4K episodes. Genres are searched as genres, and `school-girl` is always excluded. Episodes open on hstream.moe, which can't be embedded.
  * Rule34Video: 3D and 2D animations, with an embedded player and preview clips.
  * Rule34.
  * Danbooru: called from the phone. Words go through Danbooru's autocomplete, and its 2-tag anonymous limit is respected.
  * Yande.re.
  * RedGIFs, limited to its Hentai tag.
* **Strict minor-safety rules** for drawn content and for X: school-age terms, teen, daughter, classmate…

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

The Durable Object `SpotifyHandoff` (binding `SPOTIFY_HANDOFF`, SQLite storage, available on the free plan) is created by the first deploy from `wrangler.jsonc`. Nothing needs to be set up.

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
* **Spotify**: the remote needs Spotify Premium plus a developer app with the redirect URI `https://<your app>/api/spotify/callback`. Réglages → Musique → Spotify walks through it. Volume can't be changed remotely on an iPhone.
* **Separate data**: an app installed on the home screen keeps its own data, separate from Safari's. Export a backup before reinstalling or changing the icon.
