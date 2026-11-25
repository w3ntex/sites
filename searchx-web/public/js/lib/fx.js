// Visual effects. Theme change: the new theme spreads in a circle from the finger (View Transitions,
// Safari 18+), with sakura petals (hentai) or sparks (porn) and the mode's name. Older browsers get a
// coloured wipe instead. Nothing moves when the system asks for reduced motion.

export function reducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function originOf(e) {
  const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  if (!e) return center;
  if (typeof e.clientX === 'number' && (e.clientX || e.clientY)) return { x: e.clientX, y: e.clientY };
  const r = e.currentTarget?.getBoundingClientRect?.();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : center;
}

function radius(o) {
  return Math.hypot(Math.max(o.x, window.innerWidth - o.x), Math.max(o.y, window.innerHeight - o.y));
}

const WIPE = { porn: 'radial-gradient(circle at 50% 30%, #2a0a0e, #050505)', hentai: 'radial-gradient(circle at 50% 30%, #3a0f3a, #07040b)' };
const TITLE = { porn: 'Porno', hentai: '変態' };

/** Burst of petals / sparks from the finger, and the mode's name in the middle. */
export function burst(mode, o = originOf()) {
  if (reducedMotion() || typeof document === 'undefined') return;
  const layer = document.createElement('div');
  layer.className = `fx-burst fx-${mode}`;
  layer.setAttribute('aria-hidden', 'true');
  const spray = document.createElement('div');
  spray.className = 'fx-spray';
  spray.style.left = `${o.x}px`;
  spray.style.top = `${o.y}px`;
  const n = mode === 'hentai' ? 16 : 26;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const d = 70 + Math.random() * 130;
    const lift = mode === 'hentai' ? 60 + Math.random() * 80 : -(50 + Math.random() * 70); // petals fall, sparks rise
    p.style.setProperty('--dx', `${Math.round(Math.cos(a) * d)}px`);
    p.style.setProperty('--dy', `${Math.round(Math.sin(a) * d * 0.8 + lift)}px`);
    p.style.setProperty('--rot', `${Math.round(Math.random() * 600 - 300)}deg`);
    p.style.setProperty('--s', (0.55 + Math.random() * 0.9).toFixed(2));
    p.style.animationDelay = `${Math.round(Math.random() * 90)}ms`;
    spray.appendChild(p);
  }
  const title = document.createElement('b');
  title.className = 'fx-title';
  title.textContent = TITLE[mode] || '';
  if (mode === 'hentai') title.lang = 'ja';
  layer.append(spray, title);
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1500);
}

/**
 * Applies a theme change with a transition. `apply` changes the state (it may re-render later in a
 * microtask); `event` is the tap that asked for it.
 */
export function themeTransition(mode, event, apply) {
  const o = originOf(event);
  if (reducedMotion() || typeof document === 'undefined') { apply(); return; }
  const root = document.documentElement;
  if (typeof document.startViewTransition === 'function') {
    let vt = null;
    root.classList.add('vt-theme');
    try {
      // The new page is captured once the re-render (microtasks) is done.
      vt = document.startViewTransition(() => new Promise(resolve => { apply(); setTimeout(resolve, 0); }));
    } catch {
      root.classList.remove('vt-theme');
      apply();
      burst(mode, o);
      return;
    }
    vt.ready.then(() => {
      const r = radius(o);
      try {
        root.animate(
          { clipPath: [`circle(0px at ${o.x}px ${o.y}px)`, `circle(${r}px at ${o.x}px ${o.y}px)`] },
          { duration: 720, easing: 'cubic-bezier(.7, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' }
        );
      } catch { /* the cross-fade then */ }
      burst(mode, o);
    }).catch(() => {});
    vt.finished.finally(() => root.classList.remove('vt-theme'));
    return;
  }
  // Older Safari: a coloured disc grows from the finger, the theme changes under it, then it fades.
  const wipe = document.createElement('div');
  wipe.className = 'fx-wipe';
  wipe.style.background = WIPE[mode] || WIPE.porn;
  document.body.appendChild(wipe);
  const r = radius(o);
  const grow = wipe.animate(
    { clipPath: [`circle(0px at ${o.x}px ${o.y}px)`, `circle(${r}px at ${o.x}px ${o.y}px)`] },
    { duration: 420, easing: 'cubic-bezier(.7, 0, .2, 1)', fill: 'forwards' }
  );
  grow.finished.then(() => {
    apply();
    burst(mode, o);
    const fade = wipe.animate({ opacity: [1, 0] }, { duration: 380, easing: 'ease-out', fill: 'forwards' });
    fade.finished.finally(() => wipe.remove());
  }).catch(() => { apply(); wipe.remove(); });
}
