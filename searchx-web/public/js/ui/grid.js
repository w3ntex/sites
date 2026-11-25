import { html, useEffect, useRef, useMemo, useState } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { SourceBadge, Thumb, useLongPress, cx } from './common.js';
import { SOURCES } from '../config.js';
import { duration, compact, ago } from '../lib/format.js';
import { state } from '../state.js';

function badgeText(it) {
  if (it.type === 'gif') return 'GIF';
  if (it.type === 'image') return 'IMG';
  return duration(it.dur) || 'VIDÉO';
}

// One shared observer for every animated preview in the grid.
let previewObserver = null;
const previewTargets = new WeakMap();
function observePreview(el, cb) {
  if (!('IntersectionObserver' in window)) return () => {};
  if (!previewObserver) {
    previewObserver = new IntersectionObserver(entries => {
      for (const e of entries) previewTargets.get(e.target)?.(e.isIntersecting && e.intersectionRatio > 0.6);
    }, { threshold: [0, 0.6, 1] });
  }
  previewTargets.set(el, cb);
  previewObserver.observe(el);
  return () => { previewObserver.unobserve(el); previewTargets.delete(el); };
}

/** Muted looping preview that only plays while most of the card is on screen. */
function Preview({ item }) {
  const box = useRef(null);
  const vid = useRef(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => observePreview(box.current, setVisible), []);
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (visible) { v.muted = true; v.play().catch(() => {}); } else v.pause();
  }, [visible]);
  return html`<div class="preview" ref=${box}>
    ${visible || ready ? html`<video ref=${vid} class=${cx('preview-video', ready && 'ready')} src=${item.preview} muted=${true} loop=${true}
      playsInline=${true} preload="none" disablePictureInPicture=${true} onPlaying=${() => setReady(true)}></video>` : null}
  </div>`;
}

export function Card({ item, onOpen, onLongPress, layout = 'grid2', watched = false }) {
  const press = useLongPress(() => onLongPress(item), () => onOpen(item));
  const src = SOURCES[item.src];
  const fav = state.favorites.some(f => f.id === item.id);
  const preview = state.settings.previews && item.preview && layout !== 'list';
  const meta = item.views != null
    ? html`<${Icon} name="eye" size=${11} />${compact(item.views)}`
    : item.likes != null ? html`<${Icon} name="heart" size=${11} />${compact(item.likes)}`
      : item.src === 'x' && item.date ? html`<${Icon} name="clock" size=${11} />${ago(item.date)}` : null;
  return html`<article class=${cx('card', `c-${layout}`, watched && 'watched')} ...${press}>
    <div class="card-thumb">
      <${Thumb} src=${item.thumb} fallback=${item.thumb2} alt="" />
      ${preview && html`<${Preview} item=${item} />`}
      <${SourceBadge} src=${item.src} small />
      ${item.type === 'video' && item.h >= 720 && html`<span class="badge-q">${item.h >= 2160 ? '4K' : 'HD'}</span>`}
      <span class="badge-left">
        ${fav && html`<span class="badge-fav"><${Icon} name="heartFill" size=${12} /></span>`}
        ${watched && html`<span class="badge-seen">Vu</span>`}
      </span>
      <span class=${cx('badge-dur', item.type !== 'video' && 'accent')}>${badgeText(item)}</span>
    </div>
    ${layout !== 'grid3' && html`<div class="card-body">
      <h4 class="card-title">${item.title}</h4>
      ${item.by?.length ? html`<div class="card-by"><${Icon} name="user" size=${10} stroke=${2.4} /><span>${item.by[0]}</span>${item.by.length > 1 && html`<em>+${item.by.length - 1}</em>`}</div>` : null}
      <div class="card-meta">
        <span>${src?.name || item.src}</span>
        ${meta && html`<span class="dot">·</span><span class="m">${meta}</span>`}
        ${item.rating != null && html`<span class="dot">·</span><span class="m"><${Icon} name="thumb" size=${11} />${item.rating}%</span>`}
      </div>
    </div>`}
  </article>`;
}

export function useWatchedSet() {
  const h = state.history;
  return useMemo(() => new Set(h.map(e => e.item.id)), [h.length, h[0]?.hid]);
}

export function Grid({ items, onOpen, onLongPress, footer = null, onEndReached = null, layout }) {
  const sentinel = useRef(null);
  const lay = layout || state.settings.layout || 'grid2';
  const watched = useWatchedSet();
  useEffect(() => {
    if (!onEndReached || !sentinel.current || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) onEndReached();
    }, { rootMargin: '900px 0px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [onEndReached, items.length]);
  return html`<div>
    <div class=${cx('grid', `l-${lay}`)}>
      ${items.map(it => html`<${Card} key=${it.id} item=${it} layout=${lay} watched=${watched.has(it.id)}
        onOpen=${onOpen} onLongPress=${onLongPress} />`)}
    </div>
    <div ref=${sentinel} class="sentinel"></div>
    ${footer}
  </div>`;
}

export function SkeletonGrid({ count = 8 }) {
  const lay = state.settings.layout || 'grid2';
  return html`<div class=${cx('grid', `l-${lay}`)} aria-busy="true" aria-label="Chargement">
    ${Array.from({ length: lay === 'grid3' ? count + 4 : count }, (_, i) => html`<div class=${cx('card skeleton', `c-${lay}`)} key=${i}>
      <div class="card-thumb shimmer"></div>
      ${lay !== 'grid3' && html`<div class="card-body"><div class="sk-line shimmer"></div><div class="sk-line short shimmer"></div></div>`}
    </div>`)}
  </div>`;
}

/** Horizontal strip of small cards (home screen). */
export function Strip({ title, jp = null, items, onOpen, action = null }) {
  if (!items.length) return null;
  return html`<section class="strip">
    <header><h3 data-jp=${jp}>${title}</h3>${action}</header>
    <div class="strip-row">
      ${items.map(it => html`<button type="button" class="strip-card" key=${it.id} onClick=${() => onOpen(it)}>
        <span class="strip-thumb"><${Thumb} src=${it.thumb} fallback=${it.thumb2} />
          <span class=${cx('badge-dur', it.type !== 'video' && 'accent')}>${badgeText(it)}</span>
          <${SourceBadge} src=${it.src} small /></span>
        <span class="strip-title">${it.title}</span>
      </button>`)}
    </div>
  </section>`;
}
