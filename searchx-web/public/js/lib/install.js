import { INSTALL_ICONS } from '../config.js';

/** Applies the chosen home-screen name/icon; Safari reads these tags when adding to the home screen. */
export function applyInstallIcon(key) {
  const cfg = INSTALL_ICONS[key] || INSTALL_ICONS.app;
  const set = (id, attr, value) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, value); };
  set('link-manifest', 'href', cfg.manifest);
  set('link-touch-icon', 'href', cfg.icon);
  set('meta-app-title', 'content', cfg.name);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
