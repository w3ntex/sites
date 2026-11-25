import { html } from '../../vendor/preact-htm.mjs';
import { state } from '../state.js';

export function isNeon() {
  return state.settings.mode === 'hentai';
}

// Stable pseudo-random numbers (the layout must not change on every re-render).
function rnd(i, n) {
  const x = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Sakura petals drifting behind the content (neon theme only, hidden with reduced motion). */
export function Petals({ count = 7 }) {
  return html`<div class="petals" aria-hidden="true">
    ${Array.from({ length: count }, (_, i) => html`<i key=${i} class="petal" style=${
      `--x:${(4 + rnd(i, 1) * 92).toFixed(1)}%;--d:${(11 + rnd(i, 2) * 10).toFixed(1)}s;` +
      `--delay:${(-rnd(i, 3) * 20).toFixed(1)}s;--s:${(0.6 + rnd(i, 4) * 0.7).toFixed(2)};--sway:${(18 + rnd(i, 5) * 46).toFixed(0)}px`}></i>`)}
  </div>`;
}
