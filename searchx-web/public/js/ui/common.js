import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { SOURCES } from '../config.js';
import { haptic } from '../lib/haptics.js';

export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function SourceBadge({ src, small = false }) {
  const s = SOURCES[src];
  if (!s) return null;
  return html`<span class=${cx('badge-src', small && 'small')} style=${`--c:${s.color}`}>${s.badge}</span>`;
}

/** <img> that tries a second URL, then shows a neutral placeholder. Fades in via CSS on mount. */
export function Thumb({ src, alt = '', fallback = null, class: cls = '' }) {
  const [broken, setBroken] = useState({});
  const url = src && !broken[src] ? src : (fallback && !broken[fallback] ? fallback : null);
  if (!url) {
    return html`<div class=${cx('thumb-ph', cls)}><${Icon} name="image" size=${26} stroke=${1.6} /></div>`;
  }
  return html`<img key=${url} class=${cx('thumb-img', cls)} src=${url} alt=${alt} loading="lazy" decoding="async"
    referrerpolicy="no-referrer" draggable="false"
    onError=${() => setBroken(b => ({ ...b, [url]: true }))} />`;
}

export function Spinner({ size = 18 }) {
  return html`<span class="spinner" style=${`width:${size}px;height:${size}px`}></span>`;
}

export function Switch({ checked, onChange, disabled = false, label = '' }) {
  return html`<button type="button" role="switch" aria-checked=${checked ? 'true' : 'false'} aria-label=${label}
    class=${cx('switch', checked && 'on')} disabled=${disabled}
    onClick=${e => { e.stopPropagation(); haptic(); onChange(!checked); }}><span></span></button>`;
}

export function Segmented({ value, options, onChange }) {
  return html`<div class="segmented" role="tablist">
    ${options.map(([v, label]) => html`<button type="button" role="tab" key=${v} aria-selected=${v === value ? 'true' : 'false'}
      class=${cx(v === value && 'on')} onClick=${() => { if (v !== value) { haptic(); onChange(v); } }}>${label}</button>`)}
  </div>`;
}

export function Group({ title, footer, children }) {
  return html`<section class="group">
    ${title && html`<h3 class="group-title">${title}</h3>`}
    <div class="group-body">${children}</div>
    ${footer && html`<p class="group-footer">${footer}</p>`}
  </section>`;
}

export function Row({ icon, iconColor, lead, title, subtitle, right, onClick, danger = false, chevron = false, children }) {
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} type=${onClick ? 'button' : undefined} class=${cx('row', onClick && 'tappable', danger && 'danger')}
    onClick=${onClick ? (e => { haptic(); onClick(e); }) : undefined}>
    ${icon && html`<span class="row-icon" style=${iconColor ? `background:${iconColor}` : ''}><${Icon} name=${icon} size=${17} /></span>`}
    ${lead}
    <span class="row-text">
      <span class="row-title">${title}</span>
      ${subtitle && html`<span class="row-sub">${subtitle}</span>`}
    </span>
    ${children}
    ${right != null && html`<span class="row-right">${right}</span>`}
    ${chevron && html`<${Icon} name="chevronRight" size=${18} class="row-chevron" />`}
  <//>`;
}

/** Bottom sheet with backdrop, slide-in animation and drag-to-close on the handle. */
export function Sheet({ title, onClose, children, actions, tall = false }) {
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const close = () => { setShown(false); setTimeout(onClose, 220); };
  const onDown = e => { start.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = e => { if (start.current != null) setDrag(Math.max(0, e.clientY - start.current)); };
  const onUp = () => {
    if (start.current == null) return;
    start.current = null;
    if (drag > 90) close(); else setDrag(0);
  };
  return html`<div class=${cx('sheet-wrap', shown && 'shown')} onClick=${e => e.target === e.currentTarget && close()}>
    <div class=${cx('sheet', tall && 'tall')} style=${drag ? `transform:translateY(${drag}px);transition:none` : ''} role="dialog" aria-modal="true">
      <div class="sheet-grab" onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}><span></span></div>
      ${(title || actions) && html`<header class="sheet-head">
        <h2>${title}</h2>
        ${actions || html`<button type="button" class="icon-btn subtle" aria-label="Fermer" onClick=${close}><${Icon} name="x" size=${18} /></button>`}
      </header>`}
      <div class="sheet-body">${typeof children === 'function' ? children(close) : children}</div>
    </div>
  </div>`;
}

/** Long-press (with haptic) + click without firing both. */
export function useLongPress(onLong, onClick, ms = 430) {
  const timer = useRef(null);
  const fired = useRef(false);
  const origin = useRef([0, 0]);
  const cancel = () => { clearTimeout(timer.current); timer.current = null; };
  return {
    onPointerDown: e => {
      if (e.button > 0) return;
      fired.current = false;
      origin.current = [e.clientX, e.clientY];
      cancel();
      timer.current = setTimeout(() => { fired.current = true; haptic(); onLong(); }, ms);
    },
    onPointerMove: e => {
      if (timer.current && Math.hypot(e.clientX - origin.current[0], e.clientY - origin.current[1]) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: e => e.preventDefault(),
    onClick: e => {
      if (fired.current) { e.preventDefault(); fired.current = false; return; }
      onClick?.(e);
    }
  };
}

/** Row that reveals a delete button when swiped left. */
export function SwipeRow({ onDelete, children, label = 'Supprimer' }) {
  const [x, setX] = useState(0);
  const [open, setOpen] = useState(false);
  const s = useRef(null);
  const width = 88;
  const onStart = e => {
    const t = e.touches[0];
    s.current = { x: t.clientX, y: t.clientY, base: open ? -width : 0, dir: null };
  };
  const onMove = e => {
    if (!s.current) return;
    const t = e.touches[0];
    const dx = t.clientX - s.current.x, dy = t.clientY - s.current.y;
    if (!s.current.dir) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      s.current.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (s.current.dir !== 'h') return;
    setX(Math.min(0, Math.max(-width * 1.6, s.current.base + dx)));
  };
  const onEnd = () => {
    if (!s.current) return;
    const wasH = s.current.dir === 'h';
    s.current = null;
    if (!wasH) return;
    if (x < -width * 1.4) { haptic(); onDelete(); setX(0); setOpen(false); return; }
    const o = x < -width / 2;
    setOpen(o);
    setX(o ? -width : 0);
  };
  return html`<div class="swipe-row">
    <button type="button" class="swipe-del" style=${`width:${Math.max(width, -x)}px`} onClick=${() => { haptic(); onDelete(); }}>
      <${Icon} name="trash" size=${18} /><span>${label}</span>
    </button>
    <div class="swipe-content" style=${`transform:translateX(${x}px)`}
      onTouchStart=${onStart} onTouchMove=${onMove} onTouchEnd=${onEnd} onTouchCancel=${onEnd}
      onClickCapture=${e => { if (open) { e.stopPropagation(); e.preventDefault(); setOpen(false); setX(0); } }}>
      ${children}
    </div>
  </div>`;
}

export function EmptyState({ icon, title, text, kaomoji = null, children }) {
  return html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} size=${30} stroke=${1.7} /></div>
    ${kaomoji && html`<div class="kaomoji" aria-hidden="true">${kaomoji}</div>`}
    <h3>${title}</h3>
    ${text && html`<p>${text}</p>`}
    ${children}
  </div>`;
}

export function Toast({ toast }) {
  if (!toast) return null;
  return html`<div class="toast" key=${toast.id} role="status">${toast.msg}</div>`;
}

/** Drag-to-reorder list (handles on the right). renderItem(item, index, handleProps). */
export function SortableList({ items, keyOf, onMove, renderItem }) {
  const [drag, setDrag] = useState(null); // { from, over, dy }
  const listRef = useRef(null);
  const startY = useRef(0);
  const rowH = useRef(64);
  const handleProps = index => ({
    onPointerDown: e => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const row = e.currentTarget.closest('.sortable-item');
      rowH.current = row ? row.getBoundingClientRect().height : 64;
      startY.current = e.clientY;
      haptic();
      setDrag({ from: index, over: index, dy: 0 });
    },
    onPointerMove: e => {
      if (!drag) return;
      const dy = e.clientY - startY.current;
      const over = Math.max(0, Math.min(items.length - 1, drag.from + Math.round(dy / rowH.current)));
      if (over !== drag.over) haptic();
      setDrag({ ...drag, dy, over });
    },
    onPointerUp: () => {
      if (!drag) return;
      const { from, over } = drag;
      setDrag(null);
      if (from !== over) onMove(from, over);
    },
    onPointerCancel: () => setDrag(null),
    style: 'touch-action:none'
  });
  return html`<div class="sortable" ref=${listRef}>
    ${items.map((it, i) => {
      let shift = 0;
      if (drag) {
        if (i === drag.from) shift = drag.dy;
        else if (drag.from < drag.over && i > drag.from && i <= drag.over) shift = -rowH.current;
        else if (drag.from > drag.over && i < drag.from && i >= drag.over) shift = rowH.current;
      }
      return html`<div key=${keyOf(it)} class=${cx('sortable-item', drag && i === drag.from && 'dragging')}
        style=${shift ? `transform:translateY(${shift}px)` : ''}>${renderItem(it, i, handleProps(i))}</div>`;
    })}
  </div>`;
}
