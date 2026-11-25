import { html, useState, useEffect, useRef, useLayoutEffect } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { cx, Spinner } from './common.js';
import { state, notify, openSheet, toast } from '../state.js';
import { SOURCES } from '../config.js';
import { toggleFavorite, isFavorite, logHistory, addWatched } from '../library.js';
import { showOnlyCreator } from '../search.js';
import { downloadUrl, xVideoUrl } from '../api.js';
import { haptic } from '../lib/haptics.js';
import { duration, compact } from '../lib/format.js';

export function openViewer(items, id) {
  const list = items.slice();
  const index = Math.max(0, list.findIndex(i => i.id === id));
  state.viewer = { items: list, index, key: Date.now() };
  notify();
}

export function closeViewer() {
  state.viewer = null;
  notify();
}

const PLAYABLE = /\.(mp4|m4v|mov|webm|m3u8)(\?|$)/i;

function Poster({ item, children }) {
  return html`<div class="vposter">
    <img src=${item.thumb} alt="" referrerpolicy="no-referrer" draggable="false" />
    ${children}
  </div>`;
}

function OpenOnSite({ item, text }) {
  text = text || "Ce contenu se lit sur le site d'origine.";
  return html`<${Poster} item=${item}>
    <div class="vposter-msg">
      <p>${text}</p>
      <a class="btn" href=${item.url} target="_blank" rel="noopener noreferrer" onClick=${() => haptic()}>
        <${Icon} name="external" size=${17} /> Ouvrir sur ${SOURCES[item.src]?.name || 'le site'}
      </a>
    </div>
  <//>`;
}

function NativeVideo({ item, active, onTap }) {
  const ref = useRef(null);
  const isGif = item.type === 'gif';
  const [failed, setFailed] = useState(false);
  const [muted, setMuted] = useState(isGif ? state.settings.muteGifs : false);
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    if (active && (!isGif || state.settings.autoplayGifs)) v.play().catch(() => { /* needs a tap */ });
    else v.pause();
  }, [active, failed]);
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);

  if (failed) {
    if (item.embed) return html`<${EmbedPlayer} item=${item} active=${active} autostart />`;
    return html`<${OpenOnSite} item=${item} text="Le fichier ne peut pas être lu ici." />`;
  }
  return html`<div class="vmedia" onClick=${isGif ? (e => { e.stopPropagation(); onTap?.(); }) : undefined}>
    <video ref=${ref} src=${item.media} poster=${item.thumb} playsInline=${true} loop=${isGif} muted=${muted}
      autoPlay=${active && isGif && state.settings.autoplayGifs} controls=${!isGif} preload=${active ? 'auto' : 'metadata'}
      onError=${() => setFailed(true)} onPlaying=${() => setWaiting(false)} onCanPlay=${() => setWaiting(false)}></video>
    ${waiting && active && html`<span class="vloading"><${Spinner} size=${28} /></span>`}
    ${isGif && html`<button type="button" class="vmute" aria-label=${muted ? 'Activer le son' : 'Couper le son'}
      onClick=${e => { e.stopPropagation(); haptic(); setMuted(!muted); }}><${Icon} name=${muted ? 'mute' : 'volume'} size=${18} /></button>`}
  </div>`;
}

function EmbedPlayer({ item, active, autostart = false }) {
  const auto = autostart || state.settings.autoplayVideos;
  const [playing, setPlaying] = useState(auto && active);
  const [sandbox, setSandbox] = useState(state.settings.sandbox);
  useEffect(() => { if (!active) setPlaying(false); else if (auto) setPlaying(true); }, [active]);
  if (!playing) {
    return html`<${Poster} item=${item}>
      <button type="button" class="vplay" aria-label="Lire" onClick=${e => { e.stopPropagation(); haptic(); setPlaying(true); }}>
        <${Icon} name="play" size=${34} />
      </button>
      ${item.dur ? html`<span class="vdur">${duration(item.dur)}</span>` : null}
    <//>`;
  }
  return html`<div class="vembed">
    <iframe key=${sandbox ? 'sbx' : 'open'} src=${item.embed} title=${item.title}
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen=${true}
      referrerpolicy="no-referrer"
      sandbox=${sandbox ? 'allow-scripts allow-same-origin allow-presentation allow-forms' : undefined}></iframe>
    <div class="vembed-help">
      ${sandbox
        ? html`<span>La vidéo ne démarre pas ?</span><button type="button" onClick=${() => { haptic(); setSandbox(false); }}>Désactiver la protection anti-pubs</button>`
        : html`<span>Protection anti-pubs désactivée pour cette vidéo.</span>`}
      <a href=${item.url} target="_blank" rel="noopener noreferrer">Ouvrir sur le site</a>
    </div>
  </div>`;
}

/** Image with pinch / double-tap zoom and pan. Reports zoom so the gallery stops swiping. */
function ZoomImage({ item, active, onZoom, onTap }) {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [src, setSrc] = useState(item.media || item.thumb);
  const g = useRef(null);
  const lastTap = useRef(0);
  const tapTimer = useRef(null);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => { if (!active && t.s !== 1) { setT({ s: 1, x: 0, y: 0 }); onZoom(false); } }, [active]);

  const apply = n => { setT(n); onZoom(n.s > 1.01); };
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const onStart = e => {
    const cur = tRef.current;
    if (e.touches.length === 2) {
      g.current = { mode: 'pinch', d0: dist(e.touches[0], e.touches[1]), s0: cur.s, x0: cur.x, y0: cur.y };
    } else if (e.touches.length === 1 && cur.s > 1.01) {
      g.current = { mode: 'pan', px: e.touches[0].clientX, py: e.touches[0].clientY, x0: cur.x, y0: cur.y };
    } else g.current = null;
  };
  const onMove = e => {
    const st = g.current;
    if (!st) return;
    if (st.mode === 'pinch' && e.touches.length === 2) {
      const s = Math.max(1, Math.min(5, st.s0 * dist(e.touches[0], e.touches[1]) / st.d0));
      apply({ s, x: st.x0 * (s / st.s0), y: st.y0 * (s / st.s0) });
    } else if (st.mode === 'pan' && e.touches.length === 1) {
      apply({ ...tRef.current, x: st.x0 + e.touches[0].clientX - st.px, y: st.y0 + e.touches[0].clientY - st.py });
    }
  };
  const onEnd = () => {
    if (g.current?.mode === 'pinch' && tRef.current.s < 1.05) apply({ s: 1, x: 0, y: 0 });
    g.current = null;
  };
  const onClick = e => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      haptic();
      if (tRef.current.s > 1.01) apply({ s: 1, x: 0, y: 0 });
      else {
        const r = e.currentTarget.getBoundingClientRect();
        const s = 2.5;
        apply({ s, x: (r.width / 2 - (e.clientX - r.left)) * (s - 1), y: (r.height / 2 - (e.clientY - r.top)) * (s - 1) });
      }
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => onTap?.(), 280);
  };
  const zoomed = t.s > 1.01;
  return html`<div class=${cx('vmedia zoomable', zoomed && 'zoomed')}
    onTouchStart=${onStart} onTouchMove=${onMove} onTouchEnd=${onEnd} onTouchCancel=${onEnd} onClick=${onClick}>
    ${!loaded && html`<img class="vimg-blur" src=${item.thumb} alt="" referrerpolicy="no-referrer" />`}
    <img class=${cx('vimg', loaded && 'loaded')} src=${src} alt="" referrerpolicy="no-referrer" draggable="false"
      style=${`transform:translate(${t.x}px,${t.y}px) scale(${t.s})`}
      onLoad=${() => setLoaded(true)} onError=${() => { if (src !== item.thumb) setSrc(item.thumb); }} />
    ${!loaded && active && html`<span class="vloading"><${Spinner} size=${28} /></span>`}
  </div>`;
}

/** X video: its file address is read from the post page (through the server) when it is shown. */
function XVideo({ item, active, onTap }) {
  const [video, setVideo] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active || video || error) return;
    const ctrl = new AbortController();
    xVideoUrl(item, ctrl.signal).then(setVideo).catch(e => { if (!ctrl.signal.aborted) setError(e?.message || 'Vidéo indisponible.'); });
    return () => ctrl.abort();
  }, [active]);
  if (error) return html`<${OpenOnSite} item=${item} text=${`${error} Tu peux l'ouvrir sur X.`} />`;
  if (!video) return html`<${Poster} item=${item}><span class="vloading"><${Spinner} size=${28} /></span><//>`;
  return html`<${NativeVideo} item=${{ ...item, media: video.url }} active=${active} onTap=${onTap} />`;
}

const OPEN_TEXT = {
  hstream: "Les épisodes se regardent sur hstream.moe (le site refuse d'être affiché dans une autre app). Le lien s'ouvre dans Safari."
};

function Slide({ item, active, onZoom, onTap }) {
  if (item.type === 'image') return html`<${ZoomImage} item=${item} active=${active} onZoom=${onZoom} onTap=${onTap} />`;
  if (item.src === 'x' && !item.media && item.type !== 'image') return html`<${XVideo} item=${item} active=${active} onTap=${onTap} />`;
  if (item.media && PLAYABLE.test(item.media)) return html`<${NativeVideo} item=${item} active=${active} onTap=${onTap} />`;
  if (item.embed) return html`<${EmbedPlayer} item=${item} active=${active} autostart=${item.type === 'gif'} />`;
  return html`<${OpenOnSite} item=${item} text=${OPEN_TEXT[item.src]} />`;
}

export function Viewer() {
  const V = state.viewer;
  const items = V.items;
  const [idx, setIdx] = useState(V.index);
  const [zoomed, setZoomed] = useState(false);
  const [chrome, setChrome] = useState(true);
  const track = useRef(null);
  const idxRef = useRef(V.index);
  const [dragY, setDragY] = useState(0);
  const drag = useRef(null);

  useLayoutEffect(() => {
    const el = track.current;
    if (el) el.scrollLeft = V.index * el.clientWidth;
  }, [V.key]);

  useEffect(() => {
    const onResize = () => { const el = track.current; if (el) el.scrollLeft = idxRef.current * el.clientWidth; };
    const onKey = e => {
      if (e.key === 'Escape') closeViewer();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey); };
  }, []);

  // History: an item counts as opened after a short look; watch time is added when leaving it.
  useEffect(() => {
    const item = items[idx];
    if (!item) return;
    const t0 = Date.now();
    let hid = null;
    const timer = setTimeout(() => { hid = logHistory(item); }, 700);
    return () => { clearTimeout(timer); if (hid) addWatched(hid, (Date.now() - t0) / 1000); };
  }, [idx]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== idxRef.current && i >= 0 && i < items.length) {
      idxRef.current = i;
      setIdx(i);
      setZoomed(false);
    }
  };
  const go = d => {
    const el = track.current;
    const i = idxRef.current + d;
    if (!el || i < 0 || i >= items.length) return;
    haptic();
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  // Controls fade away after a moment on images / GIFs; a tap brings them back.
  useEffect(() => {
    const it = items[idx];
    if (!chrome || !it || it.type === 'video') return;
    const t = setTimeout(() => setChrome(false), 3500);
    return () => clearTimeout(t);
  }, [idx, chrome]);

  // Swipe down to close (not while zoomed; embedded players keep their own touches).
  const onTouchStart = e => {
    if (zoomed || e.touches.length !== 1) { drag.current = null; return; }
    drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dir: null };
  };
  const onTouchMove = e => {
    const d = drag.current;
    if (!d) return;
    const dx = e.touches[0].clientX - d.x, dy = e.touches[0].clientY - d.y;
    if (!d.dir) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      d.dir = Math.abs(dy) > Math.abs(dx) * 1.3 && dy > 0 ? 'down' : 'other';
    }
    if (d.dir === 'down') setDragY(Math.max(0, dy));
  };
  const onTouchEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.dir !== 'down') return;
    if (dragY > 110) { haptic(); closeViewer(); }
    else setDragY(0);
  };

  const item = items[idx] || items[0];
  const fav = isFavorite(item.id);
  const src = SOURCES[item.src];
  const dl = downloadUrl(item);
  const meta = [
    src?.name,
    item.type === 'video' ? duration(item.dur) : item.type === 'gif' ? 'GIF' : 'Image',
    item.views != null ? `${compact(item.views)} vues` : item.likes != null ? `${compact(item.likes)} ♥` : '',
    item.rating != null ? `${item.rating} %` : ''
  ].filter(Boolean).join(' · ');

  const share = async () => {
    haptic();
    try {
      if (navigator.share) await navigator.share({ url: item.url });
      else { await navigator.clipboard.writeText(item.url); toast('Lien copié'); }
    } catch { /* cancelled */ }
  };

  return html`<div class=${cx('viewer', !chrome && 'bare', dragY > 0 && 'dragging')} role="dialog" aria-label="Lecteur"
    style=${dragY ? `transform:translateY(${dragY}px);background:rgba(0,0,0,${Math.max(0.25, 1 - dragY / 500)})` : ''}
    onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd} onTouchCancel=${onTouchEnd}>
    <div class=${cx('vtrack', (zoomed || dragY > 0) && 'locked')} ref=${track} onScroll=${onScroll}>
      ${items.map((it, i) => html`<div class="vslide" key=${it.id}>
        ${Math.abs(i - idx) <= 1 ? html`<${Slide} item=${it} active=${i === idx} onZoom=${setZoomed} onTap=${() => setChrome(c => !c)} />` : null}
      </div>`)}
    </div>

    <header class="vtop">
      <button type="button" class="icon-btn glass" aria-label="Fermer" onClick=${() => { haptic(); closeViewer(); }}><${Icon} name="x" size=${20} /></button>
      <div class="vcount"><b>${idx + 1}</b> / ${items.length}</div>
      <div class="vtop-right">
        <button type="button" class=${cx('icon-btn glass', fav && 'fav')} aria-label="Favori" onClick=${() => { haptic(); toggleFavorite(item); }}>
          <${Icon} name=${fav ? 'heartFill' : 'heart'} size=${20} />
        </button>
        <button type="button" class="icon-btn glass" aria-label="Plus" onClick=${() => { haptic(); openSheet('item', { item }); }}><${Icon} name="more" size=${20} /></button>
      </div>
    </header>

    <footer class="vbottom">
      <div class="vinfo">
        <h3>${item.title}</h3>
        <p>${meta}</p>
        ${item.by?.length ? html`<div class="vcreators">${item.by.slice(0, 3).map(n => html`<button type="button" key=${n} class="chip small ghost"
          onClick=${() => { haptic(); showOnlyCreator(n); state.tab = 'search'; closeViewer(); }}><${Icon} name="user" size=${12} /><span>${n}</span></button>`)}</div>` : null}
      </div>
      <div class="vactions">
        <button type="button" class="vbtn" disabled=${idx === 0} aria-label="Précédent" onClick=${() => go(-1)}><${Icon} name="chevronLeft" size=${22} /></button>
        <button type="button" class="vbtn" onClick=${() => { haptic(); openSheet('playlist', { item }); }}><${Icon} name="listPlus" size=${20} /><span>Playlist</span></button>
        <button type="button" class="vbtn" onClick=${share}><${Icon} name="share" size=${20} /><span>Partager</span></button>
        ${dl ? html`<a class="vbtn" href=${dl} download onClick=${() => { haptic(); toast('Téléchargement…'); }}><${Icon} name="download" size=${20} /><span>Enregistrer</span></a>`
          : html`<a class="vbtn" href=${item.url} target="_blank" rel="noopener noreferrer" onClick=${() => haptic()}><${Icon} name="external" size=${20} /><span>Site</span></a>`}
        <button type="button" class="vbtn" disabled=${idx >= items.length - 1} aria-label="Suivant" onClick=${() => go(1)}><${Icon} name="chevronRight" size=${22} /></button>
      </div>
    </footer>
  </div>`;
}
