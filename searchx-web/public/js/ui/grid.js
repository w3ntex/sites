import { html, useEffect, useRef } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { SourceBadge, Thumb, useLongPress, cx } from './common.js';
import { SOURCES } from '../config.js';
import { duration, compact } from '../lib/format.js';
import { state } from '../state.js';

function badgeText(it) {
  if (it.type === 'gif') return 'GIF';
  if (it.type === 'image') return 'IMG';
  return duration(it.dur) || 'VIDÉO';
}

export function Card({ item, onOpen, onLongPress }) {
  const press = useLongPress(() => onLongPress(item), () => onOpen(item));
  const src = SOURCES[item.src];
  const fav = state.favorites.some(f => f.id === item.id);
  const meta = item.views != null
    ? html`<${Icon} name="eye" size=${11} />${compact(item.views)}`
    : item.likes != null ? html`<${Icon} name="heart" size=${11} />${compact(item.likes)}` : null;
  return html`<article class="card" ...${press}>
    <div class="card-thumb">
      <${Thumb} src=${item.thumb} fallback=${item.thumb2} alt="" />
      <${SourceBadge} src=${item.src} small />
      ${item.type === 'video' && item.h >= 720 && html`<span class="badge-q">${item.h >= 2160 ? '4K' : 'HD'}</span>`}
      ${fav && html`<span class="badge-fav"><${Icon} name="heartFill" size=${12} /></span>`}
      <span class=${cx('badge-dur', item.type !== 'video' && 'accent')}>${badgeText(item)}</span>
    </div>
    <h4 class="card-title">${item.title}</h4>
    ${item.by?.length ? html`<div class="card-by"><${Icon} name="user" size=${10} stroke=${2.4} /><span>${item.by[0]}</span>${item.by.length > 1 && html`<em>+${item.by.length - 1}</em>`}</div>` : null}
    <div class="card-meta">
      <span>${src?.name || item.src}</span>
      ${meta && html`<span class="dot">·</span><span class="m">${meta}</span>`}
      ${item.rating != null && html`<span class="dot">·</span><span class="m"><${Icon} name="thumb" size=${11} />${item.rating}%</span>`}
    </div>
  </article>`;
}

export function Grid({ items, onOpen, onLongPress, footer = null, onEndReached = null }) {
  const sentinel = useRef(null);
  useEffect(() => {
    if (!onEndReached || !sentinel.current || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) onEndReached();
    }, { rootMargin: '900px 0px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [onEndReached, items.length]);
  return html`<div>
    <div class="grid">
      ${items.map(it => html`<${Card} key=${it.id} item=${it} onOpen=${onOpen} onLongPress=${onLongPress} />`)}
    </div>
    <div ref=${sentinel} class="sentinel"></div>
    ${footer}
  </div>`;
}

export function SkeletonGrid({ count = 8 }) {
  return html`<div class="grid" aria-busy="true" aria-label="Chargement">
    ${Array.from({ length: count }, (_, i) => html`<div class="card skeleton" key=${i}>
      <div class="card-thumb shimmer"></div>
      <div class="sk-line shimmer"></div>
      <div class="sk-line short shimmer"></div>
    </div>`)}
  </div>`;
}
