// Visual theme: "hentai" (neon pink/violet, Japanese touches) or "classic" (black and red).
const STATUS_BAR = { hentai: '#07040b', classic: '#000000' };

export function themeName(theme) {
  return theme === 'classic' ? 'classic' : 'hentai';
}

/** Applies the theme to <html> (the CSS keys off data-theme) and the status-bar color. */
export function applyTheme(theme) {
  const t = themeName(theme);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', STATUS_BAR[t]);
}
