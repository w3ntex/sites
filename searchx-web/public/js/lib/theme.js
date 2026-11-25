// Each mode has its own look: "porn" (black, crimson → amber) and "hentai" (night plum, neon pink).
const STATUS_BAR = { porn: '#050505', hentai: '#07040b' };

export function themeName(mode) {
  return mode === 'hentai' ? 'hentai' : 'porn';
}

/** Applies the mode's theme to <html> (the CSS keys off data-theme) and the status-bar color. */
export function applyTheme(mode) {
  const t = themeName(mode);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', STATUS_BAR[t]);
}
