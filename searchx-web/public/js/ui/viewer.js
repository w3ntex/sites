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
import { load, save } from '../lib/storage.js';
import { prepareVideoSound, resetVideoSound } from '../lib/audio.js';

// ---------- shared video player ----------
// One <video> element serves every slide. iOS only lets a page play sound after a tap and remembers
// it per element: this element is unlocked by the tap that opens the viewer, then moves from slide to
// slide, so videos keep their sound while swiping (and only one video decodes at a time).

let player = null;

function getPlayer() {
  if (player) return player;
  const v = document.createElement('video');
  v.className = 'vvideo';
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.preload = 'auto';
  const listeners = new Set();
  player = {
    el: v,
    owner: null,         // id of the item it shows
    gif: false,
    sound: null,         // the user's sound choice in this viewer (null: settings)
    soundBlocked: false, // iOS refused sound: the video plays muted until a tap
    on(l) { listeners.add(l); return () => listeners.delete(l); },
    emit(type) { for (const l of listeners) l(type); }
  };
  for (const ev of ['timeupdate', 'durationchange', 'progress', 'play', 'pause', 'playing', 'waiting', 'canplay', 'loadeddata', 'ended', 'volumechange', 'error', 'seeked']) {
    v.addEventListener(ev, () => player.emit(ev));
  }
  return player;
}

/** Called during the tap that opens the viewer: lifts iOS's "tap needed for sound" for the player. */
function unlockPlayer(p) {
  const v = p.el;
  if (p.owner) return;
  try {
    v.muted = true;
    const r = v.play(); // no source yet, nothing plays
    if (r?.catch) r.catch(() => {});
    v.pause();
  } catch { /* ignore */ }
}

function wantsSound(p) {
  if (p.sound !== null) return p.sound;
  return p.gif ? !state.settings.muteGifs : true;
}

async function playMedia(p) {
  const v = p.el;
  const sound = wantsSound(p);
  if (sound) prepareVideoSound();
  v.muted = !sound;
  p.soundBlocked = false;
  try {
    await v.play();
  } catch (e) {
    if (e?.name !== 'NotAllowedError' || v.muted) return;
    // iOS refused the sound without a tap: play muted, the sound button turns it on.
    v.muted = true;
    p.soundBlocked = true;
    p.emit('volumechange');
    try { await v.play(); } catch { /* needs a tap */ }
  }
}

function togglePlay(p) {
  const v = p.el;
  if (v.paused || v.ended) playMedia(p);
  else v.pause();
}

function setSound(p, on) {
  p.sound = on;
  p.soundBlocked = false;
  if (on) prepareVideoSound();
  p.el.muted = !on;
  if (on && p.owner && p.el.paused && !p.el.ended) p.el.play().catch(() => {});
  p.emit('volumechange');
}

function mountMedia(p, box, item, { autoplay, gif }) {
  const v = p.el;
  if (p.owner !== item.id) {
    p.owner = item.id;
    p.gif = gif;
    v.loop = gif;
    v.poster = item.thumb || '';
    v.src = item.media;
  }
  if (v.parentNode !== box) box.appendChild(v);
  p.emit('owner');
  if (autoplay) playMedia(p);
  else v.pause();
}

function releaseMedia(p, id) {
  if (!p || p.owner !== id) return;
  const v = p.el;
  p.owner = null;
  v.pause();
  v.remove();
  v.removeAttribute('src');
  try { v.load(); } catch { /* ignore */ }
  p.emit('owner');
}

function clock(sec) {
  return duration(sec) || '0:00';
}

export function openViewer(items, id) {
  const list = items.slice();
  const index = Math.max(0, list.findIndex(i => i.id === id));
  const p = getPlayer();
  p.sound = null;
  unlockPlayer(p);
  // The search field keeps the focus otherwise (keyboard open, keys typed into it).
  try { document.activeElement?.blur?.(); } catch { /* ignore */ }
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

/** Video or GIF file, played by the shared player while its slide is shown. */
function NativeVideo({ item, active, onTap }) {
  const box = useRef(null);
  const isGif = item.type === 'gif';
  const [failed, setFailed] = useState(false);
  const [st, setSt] = useState({ loading: false, paused: true });

  useLayoutEffect(() => {
    if (!active || failed || !box.current) return;
    const p = getPlayer();
    const sync = type => {
      if (p.owner !== item.id) return;
      if (type === 'error') { setFailed(true); return; }
      const v = p.el;
      const paused = v.paused || v.ended;
      const loading = !paused && v.readyState < 3;
      setSt(s => (s.paused === paused && s.loading === loading ? s : { paused, loading }));
    };
    const off = p.on(sync);
    mountMedia(p, box.current, item, { autoplay: !isGif || state.settings.autoplayGifs, gif: isGif });
    sync('mount');
    return () => { off(); releaseMedia(p, item.id); };
  }, [active, failed]);

  if (failed) {
    if (item.embed) return html`<${EmbedPlayer} item=${item} active=${active} autostart />`;
    return html`<${OpenOnSite} item=${item} text="Le fichier ne peut pas être lu ici." />`;
  }
  const onClick = e => {
    e.stopPropagation();
    if (!active) return;
    const p = getPlayer();
    if (p.owner !== item.id) return;
    // GIFs hide the controls after a moment: the first tap brings them back, the next one pauses.
    if (isGif && !p.el.paused && onTap?.()) return;
    haptic();
    togglePlay(p);
  };
  return html`<div class="vmedia" onClick=${onClick}>
    <img class="vposter-img" src=${item.thumb} alt="" referrerpolicy="no-referrer" draggable="false" />
    <div class="vplayer-slot" ref=${box}></div>
    ${active && st.loading && html`<span class="vloading"><${Spinner} size=${28} /></span>`}
    ${active && st.paused && !st.loading && html`<span class="vstate" aria-hidden="true"><${Icon} name="play" size=${34} /></span>`}
  </div>`;
}

/** Time bar, sound and full screen for the video or GIF on screen. */
function VideoBar({ item }) {
  const p = getPlayer();
  const [, force] = useState(0);
  const [dragging, setDragging] = useState(false);
  const seek = useRef(null);
  const cur = useRef(null);
  const tot = useRef(null);
  const dragAt = useRef(null);
  const owned = p.owner === item.id;
  const v = p.el;
  const total = Number.isFinite(v.duration) ? v.duration : 0;

  const paint = (f = null) => {
    const el = seek.current;
    if (!el) return;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    const t = f != null ? f * d : v.currentTime;
    el.style.setProperty('--p', d ? String(Math.min(1, t / d)) : '0');
    let b = 0;
    try { if (d && v.buffered.length) b = v.buffered.end(v.buffered.length - 1) / d; } catch { /* ignore */ }
    el.style.setProperty('--b', String(Math.min(1, b)));
    if (cur.current) cur.current.textContent = clock(t);
    if (tot.current) tot.current.textContent = clock(d);
  };

  useEffect(() => {
    const off = p.on(type => {
      if (type === 'timeupdate' || type === 'progress' || type === 'seeked') { if (dragAt.current == null) paint(); return; }
      force(x => x + 1);
    });
    force(x => x + 1); // the slide may have taken the player before this bar subscribed
    return off;
  }, []);
  useLayoutEffect(() => { if (dragAt.current == null) paint(); });

  if (!owned) return null;
  const muted = v.muted;
  const showSeek = total >= 5;
  const fraction = e => {
    const r = seek.current.getBoundingClientRect();
    return r.width ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0;
  };
  const down = e => {
    e.stopPropagation();
    try { seek.current.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragAt.current = fraction(e);
    setDragging(true);
    paint(dragAt.current);
  };
  const move = e => {
    if (dragAt.current == null) return;
    dragAt.current = fraction(e);
    paint(dragAt.current);
  };
  const up = () => {
    const f = dragAt.current;
    if (f == null) return;
    dragAt.current = null;
    setDragging(false);
    if (Number.isFinite(v.duration)) v.currentTime = f * v.duration;
    haptic();
  };
  const cancel = () => { dragAt.current = null; setDragging(false); paint(); };
  const fullscreen = () => {
    haptic();
    try {
      if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      else v.requestFullscreen?.();
    } catch { /* ignore */ }
  };
  return html`<div class="vbar">
    ${showSeek ? html`
      <span class="vtime" ref=${cur}>0:00</span>
      <div class=${cx('vseek', dragging && 'dragging')} ref=${seek} role="slider" aria-label="Position dans la vidéo"
        aria-valuemin="0" aria-valuemax=${Math.round(total)} aria-valuenow=${Math.round(v.currentTime || 0)}
        onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${cancel}>
        <span class="vseek-track"><span class="vseek-buf"></span><span class="vseek-fill"></span></span>
        <span class="vseek-knob"></span>
      </div>
      <span class="vtime" ref=${tot}>0:00</span>` : html`<span class="vbar-gap"></span>`}
    <button type="button" class=${cx('vbar-btn', muted && p.soundBlocked && 'wide')} aria-label=${muted ? 'Activer le son' : 'Couper le son'}
      onClick=${e => { e.stopPropagation(); haptic(); setSound(p, muted); }}>
      <${Icon} name=${muted ? 'mute' : 'volume'} size=${18} />${muted && p.soundBlocked ? html`<span>Activer le son</span>` : null}
    </button>
    ${item.type === 'video' && html`<button type="button" class="vbar-btn" aria-label="Plein écran" onClick=${e => { e.stopPropagation(); fullscreen(); }}>
      <${Icon} name="expand" size=${17} /></button>`}
  </div>`;
}

function EmbedPlayer({ item, active, autostart = false }) {
  const auto = autostart || state.settings.autoplayVideos;
  const [playing, setPlaying] = useState(auto && active);
  const [sandbox, setSandbox] = useState(state.settings.sandbox);
  useEffect(() => { if (!active) setPlaying(false); else if (auto) setPlaying(true); }, [active]);
  if (!playing) {
    return html`<${Poster} item=${item}>
      <button type="button" class="vplay" aria-label="Lire" onClick=${e => { e.stopPropagation(); haptic(); prepareVideoSound(); setPlaying(true); }}>
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

function Slide({ item, active, onZoom, onTap, onReveal }) {
  // Animated .gif files (Danbooru, Rule34…) are pictures: shown like images, not "open on the site".
  const gifFile = item.type === 'gif' && /\.gif(\?|$)/i.test(item.media || '');
  if (item.type === 'image' || gifFile) return html`<${ZoomImage} item=${item} active=${active} onZoom=${onZoom} onTap=${onTap} />`;
  if (item.src === 'x' && !item.media && item.type !== 'image') return html`<${XVideo} item=${item} active=${active} onTap=${onReveal} />`;
  if (item.media && PLAYABLE.test(item.media)) return html`<${NativeVideo} item=${item} active=${active} onTap=${onReveal} />`;
  if (item.embed) return html`<${EmbedPlayer} item=${item} active=${active} autostart=${item.type === 'gif'} />`;
  return html`<${OpenOnSite} item=${item} text=${OPEN_TEXT[item.src]} />`;
}

/**
 * Full-screen viewer, one item per screen: swipe up for the next one, down for the previous one
 * (like TikTok / Reddit). Swipe right, or the ✕ button, closes it.
 */
export function Viewer() {
  const V = state.viewer;
  const items = V.items;
  const [idx, setIdx] = useState(V.index);
  const [zoomed, setZoomed] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [dragX, setDragX] = useState(0);
  const [hint, setHint] = useState(() => items.length > 1 && !load('hint.vswipe', false));
  const track = useRef(null);
  const idxRef = useRef(V.index);
  const drag = useRef(null);
  const dragXRef = useRef(0);
  dragXRef.current = dragX;

  useLayoutEffect(() => {
    const el = track.current;
    if (el) el.scrollTop = V.index * el.clientHeight;
  }, [V.key]);

  const go = d => {
    const el = track.current;
    const i = idxRef.current + d;
    if (!el || i < 0 || i >= items.length) return;
    haptic();
    el.scrollTo({ top: i * el.clientHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    const onResize = () => { const el = track.current; if (el) el.scrollTop = idxRef.current * el.clientHeight; };
    const onKey = e => {
      if (state.sheet || e.target?.closest?.('.sheet')) return; // a sheet over the viewer keeps its keys
      if (e.key === 'Escape') closeViewer();
      else if (['ArrowDown', 'PageDown', 'ArrowRight'].includes(e.key)) { e.preventDefault(); go(1); }
      else if (['ArrowUp', 'PageUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === ' ' && player?.owner) { e.preventDefault(); togglePlay(player); }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      resetVideoSound();
    };
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

  // First time: show how to go to the next item.
  useEffect(() => {
    if (!hint) return;
    save('hint.vswipe', true);
    const t = setTimeout(() => setHint(false), 3600);
    return () => clearTimeout(t);
  }, [hint]);

  const onScroll = () => {
    const el = track.current;
    if (!el || !el.clientHeight) return;
    const i = Math.round(el.scrollTop / el.clientHeight);
    if (i !== idxRef.current && i >= 0 && i < items.length) {
      idxRef.current = i;
      setIdx(i);
      setZoomed(false);
      setChrome(true);
      setHint(false);
    }
  };

  // Controls fade away after a moment on images / GIFs; a tap brings them back.
  useEffect(() => {
    const it = items[idx];
    if (!chrome || !it || it.type === 'video') return;
    const t = setTimeout(() => setChrome(false), 3500);
    return () => clearTimeout(t);
  }, [idx, chrome]);

  // Swipe right to close (not while zoomed, not on the time bar; embedded players keep their touches).
  const onTouchStart = e => {
    if (zoomed || e.touches.length !== 1 || e.target?.closest?.('.vseek')) { drag.current = null; return; }
    drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dir: null };
  };
  const onTouchMove = e => {
    const d = drag.current;
    if (!d) return;
    const dx = e.touches[0].clientX - d.x, dy = e.touches[0].clientY - d.y;
    if (!d.dir) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      d.dir = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.3 ? 'right' : 'other';
    }
    if (d.dir === 'right') setDragX(Math.max(0, dx));
  };
  const onTouchEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.dir !== 'right') return;
    if (dragXRef.current > 90) { haptic(); closeViewer(); }
    else setDragX(0);
  };

  // Videos: a tap brings hidden controls back (returns true) instead of pausing.
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const reveal = () => {
    if (chromeRef.current) return false;
    setChrome(true);
    return true;
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

  return html`<div class=${cx('viewer', !chrome && 'bare', dragX > 0 && 'dragging')} role="dialog" aria-label="Lecteur"
    style=${dragX ? `transform:translateX(${dragX}px);background:rgba(0,0,0,${Math.max(0.25, 1 - dragX / 500)})` : ''}
    onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd} onTouchCancel=${onTouchEnd}>
    <div class=${cx('vtrack', (zoomed || dragX > 0) && 'locked')} ref=${track} onScroll=${onScroll}>
      ${items.map((it, i) => html`<div class="vslide" key=${it.id}>
        ${Math.abs(i - idx) <= 1 ? html`<${Slide} item=${it} active=${i === idx} onZoom=${setZoomed} onTap=${() => setChrome(c => !c)} onReveal=${reveal} />` : null}
      </div>`)}
    </div>

    ${hint && html`<div class="vhint" aria-hidden="true"><${Icon} name="chevronUp" size=${30} /><span>Glisse vers le haut pour la suite</span></div>`}

    <header class="vtop">
      <button type="button" class="icon-btn glass" aria-label="Fermer" onClick=${() => { haptic(); closeViewer(); }}><${Icon} name="x" size=${20} /></button>
      <div class="vtop-right">
        <div class="vcount"><b>${idx + 1}</b> / ${items.length}</div>
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
      <${VideoBar} item=${item} key=${item.id} />
      <div class="vactions">
        <button type="button" class="vbtn" disabled=${idx === 0} aria-label="Précédent" onClick=${() => go(-1)}><${Icon} name="chevronUp" size=${22} /></button>
        <button type="button" class="vbtn" onClick=${() => { haptic(); openSheet('playlist', { item }); }}><${Icon} name="listPlus" size=${20} /><span>Playlist</span></button>
        <button type="button" class="vbtn" onClick=${share}><${Icon} name="share" size=${20} /><span>Partager</span></button>
        ${dl ? html`<a class="vbtn" href=${dl} download onClick=${() => { haptic(); toast('Téléchargement…'); }}><${Icon} name="download" size=${20} /><span>Enregistrer</span></a>`
          : html`<a class="vbtn" href=${item.url} target="_blank" rel="noopener noreferrer" onClick=${() => haptic()}><${Icon} name="external" size=${20} /><span>Site</span></a>`}
        <button type="button" class="vbtn" disabled=${idx >= items.length - 1} aria-label="Suivant" onClick=${() => go(1)}><${Icon} name="chevronDown" size=${22} /></button>
      </div>
    </footer>
  </div>`;
}
