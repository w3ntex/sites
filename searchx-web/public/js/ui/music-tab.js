import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { cx, Spinner, Segmented, Sheet } from './common.js';
import { openSheet, closeSheet, toast } from '../state.js';
import { haptic } from '../lib/haptics.js';
import { load, save } from '../lib/storage.js';
import {
  useMusic, musicCommand, refreshPlayer, spotifyOpenUrl, hasScopes, reconnectUrl, setShuffle,
  myPlaylists, likedTracks, recentTracks, collectionTracks, searchSpotify, getQueue, getDevices, playItems, addToQueue, transferTo
} from '../lib/spotify.js';
import { ConnectSteps, SpotifySheet, ProgressBar, Art, Eq } from './music.js';

// Réglages are one tap away; everything else about the music lives here. The sound itself comes from
// the Spotify app (Spotify's web player does not run on iPhone): SearchX is its remote.

const cache = { playlists: null, liked: undefined, recent: null, at: {} };
const FRESH = 2 * 60 * 1000;

function useLoad(key, fn, deps = []) {
  const [st, setSt] = useState(() => ({ data: cache[key] ?? null, loading: cache[key] == null, error: '' }));
  const run = async (force = false) => {
    if (!force && cache[key] != null && Date.now() - (cache.at[key] || 0) < FRESH) { setSt({ data: cache[key], loading: false, error: '' }); return; }
    setSt(s => ({ ...s, loading: s.data == null, error: '' }));
    try {
      const data = await fn();
      cache[key] = data;
      cache.at[key] = Date.now();
      setSt({ data, loading: false, error: '' });
    } catch (e) {
      setSt(s => ({ ...s, loading: false, error: e.message || 'Spotify ne répond pas.' }));
    }
  };
  useEffect(() => { run(); }, deps);
  return { ...st, reload: () => run(true) };
}

async function play(opts, label = '') {
  haptic();
  try {
    await playItems(opts);
    if (label) toast(label);
  } catch (e) {
    toast(e.message || 'Lecture impossible.');
  }
}

/** Playlist / album: from this track, in its context. Other contexts (artist…) do not take an offset. */
function playTrack(t, list = null) {
  const ctx = t.contextUri || '';
  if (/^spotify:(playlist|album):/.test(ctx)) return play({ contextUri: ctx, offsetUri: t.uri });
  if (list?.length) return play({ uris: list.map(x => x.uri), offsetUri: t.uri });
  return play({ uris: [t.uri] });
}

async function queue(t) {
  haptic();
  try {
    await addToQueue(t.uri);
    toast(`« ${t.name} » ajouté à la file d’attente`);
  } catch (e) {
    toast(e.message || 'Impossible d’ajouter ce titre.');
  }
}

function TrackRow({ t, onPlay, showQueue = true, index = null }) {
  const m = useMusic();
  const current = m.playback?.track?.uri === t.uri;
  return html`<div class=${cx('trk', current && 'on', !t.playable && 'off')}>
    <button type="button" class="trk-main" onClick=${onPlay} disabled=${!t.playable}>
      ${index != null ? html`<span class="trk-n">${current && m.playback?.playing ? html`<${Eq} />` : index + 1}</span>`
        : html`<${Art} src=${t.art} cls="trk-art" />`}
      <span class="trk-text"><b>${t.name}</b><small>${t.explicit ? html`<i class="trk-e">E</i>` : null}${t.artist}</small></span>
      ${index == null && current && m.playback?.playing ? html`<${Eq} />` : null}
    </button>
    ${showQueue && t.playable && html`<button type="button" class="trk-add" aria-label="Ajouter à la file d’attente" onClick=${() => queue(t)}><${Icon} name="queue" size=${19} /></button>`}
  </div>`;
}

function Loading() {
  return html`<div class="music-loading"><${Spinner} size=${22} /></div>`;
}

function ErrorLine({ error, reload }) {
  return html`<div class="music-error"><p>${error}</p><button type="button" class="btn small ghost" onClick=${() => { haptic(); reload(); }}>Réessayer</button></div>`;
}

// ---------- now playing ----------

function NowPlaying() {
  const m = useMusic();
  const [, tick] = useState(0);
  const p = m.playback;
  useEffect(() => { refreshPlayer(); }, []);
  useEffect(() => {
    if (!p?.playing) return;
    const t = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [p?.playing]);
  const run = async name => {
    haptic();
    const err = await musicCommand(name);
    if (err) toast(err);
  };
  const deviceIcon = /speaker|avr|tv|cast/i.test(p?.device?.type || '') ? 'speaker' : 'phone';

  if (!p?.track) {
    return html`<section class="np empty">
      <div class="np-disc" aria-hidden="true"><span></span></div>
      <b>Rien en lecture</b>
      <p>Choisis une playlist ou un titre ci-dessous. Si rien ne démarre, ouvre d’abord Spotify une seconde.</p>
      <div class="np-empty-actions">
        <a class="btn spotify small" href="spotify:" onClick=${() => haptic()}><${Icon} name="spotify" size=${16} /> Ouvrir Spotify</a>
        <button type="button" class="btn ghost small" onClick=${() => { haptic(); openSheet('custom', { render: () => html`<${DevicesSheet} />` }); }}>
          <${Icon} name="phone" size=${16} /> Appareils</button>
      </div>
    </section>`;
  }
  const t = p.track;
  return html`<section class="np">
    <div class="np-bg" aria-hidden="true">${t.art ? html`<img src=${t.art} alt="" referrerpolicy="no-referrer" />` : null}</div>
    <div class="np-in">
      <div class=${cx('np-art-wrap', p.playing && 'playing')}><${Art} src=${t.art} cls="np-art" /></div>
      <div class="np-meta">
        <div class="np-titles"><b>${t.name}</b><span>${t.artist}</span></div>
        ${!t.episode && html`<button type="button" class=${cx('np-like', m.saved && 'on')} aria-label=${m.saved ? 'Retirer des titres likés' : 'Ajouter aux titres likés'}
          onClick=${() => run('like')}><${Icon} name=${m.saved ? 'checkCircle' : 'plusCircle'} size=${26} /></button>`}
      </div>
      <${ProgressBar} p=${p} />
      <div class="np-ctrls">
        <button type="button" class=${cx('np-btn', p.shuffle ? 'on' : 'dim')} aria-label="Lecture aléatoire" onClick=${() => run('shuffle')}><${Icon} name="shuffle" size=${21} /></button>
        <button type="button" class="np-btn" aria-label="Précédent" onClick=${() => run('previous')}><${Icon} name="skipBack" size=${30} /></button>
        <button type="button" class="np-btn main" aria-label=${p.playing ? 'Pause' : 'Lecture'} onClick=${() => run('toggle')}>
          <${Icon} name=${p.playing ? 'pause' : 'play'} size=${34} /></button>
        <button type="button" class="np-btn" aria-label="Suivant" onClick=${() => run('next')}><${Icon} name="skipForward" size=${30} /></button>
        <button type="button" class=${cx('np-btn', p.repeat !== 'off' ? 'on' : 'dim')} aria-label=${`Répéter : ${{ off: 'non', context: 'tout', track: 'ce titre' }[p.repeat] || 'non'}`}
          onClick=${() => run('repeat')}><${Icon} name=${p.repeat === 'track' ? 'repeatOne' : 'repeat'} size=${21} /></button>
      </div>
      <div class="np-foot">
        <button type="button" class="np-chip" onClick=${() => { haptic(); openSheet('custom', { render: () => html`<${DevicesSheet} />` }); }}>
          <${Icon} name=${deviceIcon} size=${15} /><span>${p.device?.name || 'Appareil'}</span><${Icon} name="chevronDown" size=${14} /></button>
        <button type="button" class="np-chip" onClick=${() => { haptic(); openSheet('custom', { render: () => html`<${QueueSheet} />` }); }}>
          <${Icon} name="queue" size=${15} /><span>À suivre</span></button>
        <a class="np-chip icon" href=${spotifyOpenUrl(t)} aria-label="Ouvrir dans Spotify" onClick=${() => haptic()}><${Icon} name="spotify" size=${17} /></a>
      </div>
      ${m.error ? html`<p class="np-error">${m.error}</p>` : null}
    </div>
  </section>`;
}

function DevicesSheet() {
  const [st, setSt] = useState({ list: null, error: '' });
  const load = () => getDevices().then(list => setSt({ list, error: '' })).catch(e => setSt({ list: [], error: e.message }));
  useEffect(() => { load(); }, []);
  return html`<${Sheet} title="Écouter sur" onClose=${closeSheet}>${close => html`
    ${st.list == null ? html`<${Loading} />` : null}
    ${st.error ? html`<p class="bad relay-msg">${st.error}</p>` : null}
    ${st.list && !st.list.length && !st.error ? html`<p class="sheet-text">Aucun appareil Spotify ouvert. Ouvre Spotify sur ton iPhone, puis reviens : il apparaîtra ici.</p>` : null}
    ${st.list?.length ? html`<div class="group-body">${st.list.map(d => html`<button type="button" key=${d.id} class=${cx('row tappable dev', d.active && 'on')}
      disabled=${d.restricted} onClick=${async () => {
        haptic();
        if (d.active) { close(); return; }
        try { await transferTo(d.id); toast(`Lecture sur ${d.name}`); close(); } catch (e) { toast(e.message); }
      }}>
      <span class="row-icon" style="background:#1db954"><${Icon} name=${/speaker|avr|tv|cast/i.test(d.type) ? 'speaker' : 'phone'} size=${17} /></span>
      <span class="row-text"><span class="row-title">${d.name}</span><span class="row-sub">${d.active ? 'En cours' : d.type}</span></span>
      ${d.active ? html`<${Eq} />` : null}
    </button>`)}</div>` : null}
    <div class="sheet-buttons col">
      <a class="btn spotify" href="spotify:" onClick=${() => haptic()}><${Icon} name="spotify" size=${18} /> Ouvrir Spotify</a>
      <button type="button" class="btn ghost" onClick=${() => { haptic(); setSt({ list: null, error: '' }); load(); }}>Actualiser</button>
    </div>
  `}<//>`;
}

function QueueSheet() {
  const [st, setSt] = useState({ q: null, error: '' });
  useEffect(() => { getQueue().then(q => setSt({ q, error: '' })).catch(e => setSt({ q: { current: null, next: [] }, error: e.message })); }, []);
  return html`<${Sheet} title="À suivre" onClose=${closeSheet} tall>
    ${st.q == null ? html`<${Loading} />` : null}
    ${st.error ? html`<p class="bad relay-msg">${st.error}</p>` : null}
    ${st.q?.current ? html`<p class="music-sub">En cours</p><div class="trk-list"><${TrackRow} t=${st.q.current} showQueue=${false} onPlay=${() => {}} /></div>` : null}
    ${st.q?.next?.length ? html`<p class="music-sub">Ensuite</p><div class="trk-list">${st.q.next.map((t, i) => html`<${TrackRow} key=${`${t.uri}-${i}`} t=${t} showQueue=${false}
      onPlay=${() => playTrack(t)} />`)}</div>` : null}
    ${st.q && !st.q.next.length && !st.error ? html`<p class="sheet-text">La file d’attente est vide. Ajoute des titres avec le bouton <${Icon} name="queue" size=${15} /> à côté d’un titre.</p>` : null}
  <//>`;
}

// ---------- library ----------

function Playlists({ onOpen }) {
  const pl = useLoad('playlists', myPlaylists);
  const liked = useLoad('liked', likedTracks);
  if (pl.loading) return html`<${Loading} />`;
  if (pl.error) return html`<${ErrorLine} error=${pl.error} reload=${pl.reload} />`;
  const cards = [
    ...(liked.data?.length ? [{ kind: 'liked', id: 'liked', name: 'Titres likés', owner: `${liked.data.length} titres`, tracks: liked.data }] : []),
    ...(pl.data || [])
  ];
  if (!cards.length) return html`<p class="music-empty">Aucune playlist. Crée-en dans Spotify : elles apparaîtront ici.</p>`;
  return html`<div class="pl-grid">${cards.map((c, i) => html`<button type="button" key=${c.id} class="pl-card" style=${`--n:${Math.min(i, 12)}`}
    onClick=${() => { haptic(); onOpen(c); }}>
    ${c.kind === 'liked' ? html`<span class="pl-art liked"><${Icon} name="heartFill" size=${34} /></span>` : html`<${Art} src=${c.art} cls="pl-art" />`}
    <b>${c.name}</b><small>${c.owner}${c.total != null ? ` · ${c.total} titres` : ''}</small>
  </button>`)}</div>`;
}

function Recent() {
  const r = useLoad('recent', recentTracks);
  if (r.loading) return html`<${Loading} />`;
  if (r.error) return html`<${ErrorLine} error=${r.error} reload=${r.reload} />`;
  if (!r.data?.length) return html`<p class="music-empty">Rien écouté récemment.</p>`;
  return html`<div class="trk-list">${r.data.map(t => html`<${TrackRow} key=${t.uri} t=${t} onPlay=${() => playTrack(t)} />`)}</div>`;
}

function SpotifySearch({ onOpen }) {
  const [q, setQ] = useState(() => load('music.q', ''));
  const [st, setSt] = useState({ res: null, loading: false, error: '' });
  useEffect(() => {
    const text = q.trim();
    save('music.q', q);
    if (text.length < 2) { setSt({ res: null, loading: false, error: '' }); return; }
    const ctrl = new AbortController();
    setSt(s => ({ ...s, loading: true, error: '' }));
    const t = setTimeout(() => {
      searchSpotify(text, ctrl.signal)
        .then(res => setSt({ res, loading: false, error: '' }))
        .catch(e => { if (!ctrl.signal.aborted) setSt({ res: null, loading: false, error: e.message }); });
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);
  const res = st.res;
  return html`<div class="msearch">
    <div class="search-field msearch-field">
      <${Icon} name="search" size=${18} />
      <input type="search" value=${q} placeholder="Titres, artistes, albums, playlists" enterkeyhint="search"
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" onInput=${e => setQ(e.currentTarget.value)} />
      ${q && html`<button type="button" class="clear" aria-label="Effacer" onClick=${() => setQ('')}><${Icon} name="x" size=${14} stroke=${3} /></button>`}
    </div>
    ${st.loading && !res ? html`<${Loading} />` : null}
    ${st.error ? html`<p class="music-empty">${st.error}</p>` : null}
    ${res ? html`
      ${res.artists.length ? html`<div class="m-row">${res.artists.slice(0, 8).map(a => html`<button type="button" key=${a.id} class="m-artist"
        onClick=${() => play({ contextUri: a.uri }, `Lecture : ${a.name}`)}><${Art} src=${a.art} cls="m-artist-art" /><span>${a.name}</span></button>`)}</div>` : null}
      ${res.tracks.length ? html`<p class="music-sub">Titres</p><div class="trk-list">${res.tracks.map(t => html`<${TrackRow} key=${t.uri} t=${t}
        onPlay=${() => (t.albumUri ? play({ contextUri: t.albumUri, offsetUri: t.uri }) : playTrack(t))} />`)}</div>` : null}
      ${[...res.albums, ...res.playlists].length ? html`<p class="music-sub">Albums et playlists</p><div class="m-row">${[...res.albums, ...res.playlists].map(c => html`<button type="button" key=${c.uri}
        class="m-coll" onClick=${() => { haptic(); onOpen(c); }}><${Art} src=${c.art} cls="m-coll-art" /><b>${c.name}</b><small>${c.kind === 'album' ? 'Album' : 'Playlist'} · ${c.owner}</small></button>`)}</div>` : null}
      ${!res.tracks.length && !res.artists.length && !res.albums.length && !res.playlists.length ? html`<p class="music-empty">Aucun résultat.</p>` : null}
    ` : null}
  </div>`;
}

function CollectionView({ c, onBack }) {
  const [st, setSt] = useState({ tracks: c.tracks || null, error: '' });
  useEffect(() => {
    if (c.tracks) return;
    collectionTracks(c).then(tracks => setSt({ tracks, error: '' })).catch(e => setSt({ tracks: [], error: e.message }));
  }, [c.id]);
  const tracks = st.tracks;
  const playAll = async shuffle => {
    if (c.kind === 'liked') await play({ uris: (tracks || []).map(t => t.uri) });
    else await play({ contextUri: c.uri });
    if (shuffle) setShuffle(true).catch(() => {});
  };
  const playOne = t => (c.kind === 'liked' ? play({ uris: tracks.map(x => x.uri), offsetUri: t.uri }) : play({ contextUri: c.uri, offsetUri: t.uri }));
  return html`<div class="tab tab-music">
    <header class="topbar plain coll-top">
      <button type="button" class="icon-btn subtle" aria-label="Retour" onClick=${() => { haptic(); onBack(); }}><${Icon} name="back" size=${22} /></button>
    </header>
    <main class="content">
      <div class="coll-head">
        ${c.kind === 'liked' ? html`<span class="coll-art liked"><${Icon} name="heartFill" size=${64} /></span>` : html`<${Art} src=${c.art} cls="coll-art" />`}
        <h2>${c.name}</h2>
        <p>${[c.kind === 'album' ? 'Album' : c.kind === 'liked' ? '' : 'Playlist', c.owner].filter(Boolean).join(' · ')}</p>
        <div class="coll-actions">
          <button type="button" class="btn spotify" onClick=${() => playAll(false)}><${Icon} name="play" size=${18} /> Lecture</button>
          <button type="button" class="btn ghost" onClick=${() => playAll(true)}><${Icon} name="shuffle" size=${18} /> Aléatoire</button>
        </div>
      </div>
      ${tracks == null ? html`<${Loading} />` : null}
      ${st.error ? html`<p class="music-empty">${st.error} Le bouton Lecture fonctionne quand même.</p>` : null}
      ${tracks?.length ? html`<div class="trk-list">${tracks.map((t, i) => html`<${TrackRow} key=${`${t.uri}-${i}`} t=${t} index=${c.kind === 'album' ? i : null} onPlay=${() => playOne(t)} />`)}</div>` : null}
    </main>
  </div>`;
}

function Onboarding() {
  return html`<div class="mo">
    <div class="mo-hero">
      <div class="mo-disc" aria-hidden="true"><span class="mo-vinyl"></span><span class="mo-logo"><${Icon} name="spotify" size=${34} /></span></div>
      <h2>Ta musique, dans SearchX</h2>
      <p>Lecture, playlists, recherche, file d’attente : tout se pilote d’ici, et la musique continue pendant les vidéos.
        Le son vient de l’app Spotify (sur iPhone, Spotify ne laisse aucune autre app jouer sa musique).</p>
    </div>
    <${ConnectSteps} page />
  </div>`;
}

function ReconnectBanner() {
  return html`<div class="music-banner">
    <${Icon} name="info" size=${18} />
    <p>Pour afficher tes playlists et tes titres récents, Spotify doit te redemander l’accord (une fois).</p>
    <button type="button" class="btn small spotify" onClick=${async () => { haptic(); try { location.href = await reconnectUrl(); } catch (e) { toast(e.message); } }}>Autoriser</button>
  </div>`;
}

export function MusicTab() {
  const m = useMusic();
  const [open, setOpen] = useState(null); // playlist / album opened
  const [seg, setSeg] = useState(() => load('music.seg', 'playlists'));
  const top = useRef(0);
  const openCollection = c => { top.current = window.scrollY; setOpen(c); window.scrollTo(0, 0); };
  const closeCollection = () => { setOpen(null); requestAnimationFrame(() => window.scrollTo(0, top.current)); };

  if (!m.connected) {
    return html`<div class="tab tab-music">
      <header class="topbar plain"><h1 class="page-title" data-jp="音楽">Musique</h1></header>
      <main class="content"><${Onboarding} /></main>
    </div>`;
  }
  if (open) return html`<${CollectionView} c=${open} onBack=${closeCollection} />`;
  return html`<div class="tab tab-music">
    <header class="topbar plain music-top">
      <h1 class="page-title" data-jp="音楽">Musique</h1>
      <button type="button" class="icon-btn subtle" aria-label="Réglages Spotify" onClick=${() => { haptic(); openSheet('custom', { render: () => html`<${SpotifySheet} />` }); }}>
        <${Icon} name="gear" size=${21} /></button>
    </header>
    <main class="content">
      ${!hasScopes() && html`<${ReconnectBanner} />`}
      <${NowPlaying} />
      <div class="music-seg"><${Segmented} value=${seg} options=${[['playlists', 'Playlists'], ['recent', 'Récents'], ['search', 'Rechercher']]}
        onChange=${v => { setSeg(v); save('music.seg', v); }} /></div>
      ${seg === 'playlists' ? html`<${Playlists} onOpen=${openCollection} />` : seg === 'recent' ? html`<${Recent} />` : html`<${SpotifySearch} onOpen=${openCollection} />`}
    </main>
  </div>`;
}

