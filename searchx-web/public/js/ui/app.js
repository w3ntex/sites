import { html, useEffect } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Toast, cx } from './common.js';
import { SearchTab } from './search-tab.js';
import { LibraryTab } from './library-tab.js';
import { HistoryTab } from './history-tab.js';
import { SettingsTab } from './settings-tab.js';
import { Viewer } from './viewer.js';
import { MusicIsland } from './music.js';
import { SheetHost } from './sheets.js';
import { LockScreen } from './lock.js';
import { state, notify, useAppState, updateSettings, lockEnabled, switchTab } from '../state.js';
import { haptic } from '../lib/haptics.js';
import { authBusy } from '../lib/lock.js';
import { Petals, isNeon } from './theme.js';

const TABS = [
  ['search', 'Recherche', 'search'],
  ['library', 'Favoris', 'heart'],
  ['history', 'Historique', 'history'],
  ['settings', 'Réglages', 'gear']
];

function AgeGate() {
  const neon = isNeon();
  return html`<div class="age-gate">
    ${neon && html`<${Petals} count=${9} />`}
    <div class="age-inner">
      ${neon
        ? html`<div class="age-stamp" lang="ja"><b>18</b><span>禁</span></div><p class="age-kicker" lang="ja">成人向け</p>`
        : html`<div class="age-stamp porn"><b>18</b><span>+</span></div><p class="age-kicker">Adultes uniquement</p>`}
      <h1>Réservé aux adultes</h1>
      <p>SearchX recherche sur des sites qui hébergent du contenu sexuellement explicite. Tu dois avoir au moins 18 ans
        (ou l'âge de la majorité dans ton pays) pour continuer.</p>
      <button type="button" class="btn big" onClick=${() => { haptic(); updateSettings({ ageOK: true }); }}>J'ai 18 ans ou plus</button>
      <button type="button" class="btn ghost" onClick=${() => { location.href = 'about:blank'; }}>J'ai moins de 18 ans</button>
    </div>
  </div>`;
}

function TabBar() {
  return html`<nav class="tabbar" aria-label="Navigation">
    ${TABS.map(([id, label, icon]) => html`<button type="button" key=${id} class=${cx('tab-btn', state.tab === id && 'on')}
      aria-current=${state.tab === id ? 'page' : undefined}
      onClick=${() => {
        haptic();
        if (state.tab === id) {
          if (id === 'library' && state.playlistId) { state.playlistId = null; notify(); }
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        switchTab(id);
      }}>
      <${Icon} name=${state.tab === id && icon === 'heart' ? 'heartFill' : icon} size=${24} stroke=${state.tab === id ? 2.3 : 1.9} />
      <span>${label}</span>
    </button>`)}
  </nav>`;
}


// ---- privacy: cover + lock when leaving the app -----------------------------------------------------

function mediaHasFocus() {
  const a = document.activeElement;
  if (a && a.tagName === 'IFRAME') return true; // tapping into an embedded player blurs the page
  if (document.fullscreenElement || document.webkitFullscreenElement) return true;
  return [...document.querySelectorAll('video')].some(v => v.webkitDisplayingFullscreen);
}

function setCover(on) {
  // Applied straight to the page (no re-render needed) so it is in place as early as possible.
  document.documentElement.classList.toggle('sx-cover', on);
  if (state.hidden !== on) { state.hidden = on; notify(); }
  if (on) watchCover();
}

// Safety net: the cover only exists for the app-switcher snapshot. If the app is actually on
// screen for a moment while covered (iOS didn't send the "back" events), remove it.
let coverWatch = null;
function watchCover() {
  clearInterval(coverWatch);
  let visibleFor = 0;
  coverWatch = setInterval(() => {
    if (!document.documentElement.classList.contains('sx-cover')) { clearInterval(coverWatch); return; }
    visibleFor = document.visibilityState === 'visible' && !touchingEdge ? visibleFor + 300 : 0;
    if (visibleFor >= 1500) { edgeCover = false; setCover(false); clearInterval(coverWatch); }
  }, 300);
}

let hiddenAt = 0;

function onLeave() {
  if (authBusy) return;
  if (state.settings.blur) setCover(true);
  hiddenAt = Date.now();
  document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch { /* ignore */ } });
  if (lockEnabled() && !(state.settings.lockDelay > 0)) { state.locked = true; notify(); }
}

function onReturn() {
  if (lockEnabled() && hiddenAt && (Date.now() - hiddenAt) / 1000 >= (state.settings.lockDelay || 0)) state.locked = true;
  hiddenAt = 0;
  edgeCover = false;
  setCover(false);
  notify();
}

function installPrivacyHandlers() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onLeave(); else onReturn();
  });
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('pageshow', e => { if (e.persisted) onReturn(); });
  // App switcher / Control Center: the page loses focus before it is hidden. Cover early.
  window.addEventListener('blur', () => {
    setTimeout(() => {
      if (authBusy || mediaHasFocus() || document.hasFocus()) return;
      if (state.settings.blur) setCover(true);
    }, 0);
  });
  window.addEventListener('focus', () => { if (document.visibilityState === 'visible' && !edgeCover) setCover(false); });

  // iOS takes the app-switcher snapshot *before* the page hears that it is leaving, so covering on
  // visibilitychange is too late. Leaving always starts with a swipe from the home-indicator strip at
  // the bottom edge: cover the screen the instant a touch starts there, so the black screen is
  // already drawn when the snapshot is taken. A tap that stays in the app uncovers on release.
  window.addEventListener('touchstart', e => {
    const t = e.touches[0];
    const atEdge = t && t.clientY >= window.innerHeight - homeIndicatorZone();
    if (!atEdge) {
      // The user is touching the app: it is on screen, never keep it covered.
      touchingEdge = false;
      if (document.documentElement.classList.contains('sx-cover') && document.visibilityState === 'visible') {
        edgeCover = false;
        setCover(false);
      }
      return;
    }
    if (!state.settings.blur || authBusy) return;
    touchingEdge = true;
    edgeCover = true;
    setCover(true);
  }, { capture: true, passive: true });
  window.addEventListener('touchend', () => {
    touchingEdge = false;
    if (!edgeCover) return;
    edgeCover = false;
    if (document.visibilityState === 'visible') setCover(false);
  }, { capture: true, passive: true });
  window.addEventListener('touchcancel', () => {
    touchingEdge = false;
    // The system took the gesture (home / app switcher). If the user stays after all, uncover.
    if (!edgeCover) return;
    setTimeout(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) { edgeCover = false; setCover(false); }
    }, 1200);
  }, { capture: true, passive: true });
}

let edgeCover = false;
let touchingEdge = false;
let zoneCache = 0;

/** Height of the home-indicator strip (bottom safe area), at least 20 px. */
function homeIndicatorZone() {
  if (zoneCache) return zoneCache;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  zoneCache = Math.max(20, probe.offsetHeight || 0);
  probe.remove();
  return zoneCache;
}

let installed = false;

export function App() {
  const s = useAppState();

  useEffect(() => {
    if (!installed) { installed = true; installPrivacyHandlers(); }
  }, []);

  // No page scrolling behind overlays.
  useEffect(() => {
    document.documentElement.classList.toggle('noscroll', Boolean(s.viewer || s.sheet || (s.locked && lockEnabled()) || !s.settings.ageOK));
  });

  let page;
  switch (s.tab) {
    case 'library': page = html`<${LibraryTab} />`; break;
    case 'history': page = html`<${HistoryTab} />`; break;
    case 'settings': page = html`<${SettingsTab} />`; break;
    default: page = html`<${SearchTab} />`;
  }

  const locked = s.settings.ageOK && s.locked && lockEnabled();
  return html`<div class=${cx('app', s.viewer && 'viewer-open', s.sheet && 'sheet-open')}>
    ${page}
    <${TabBar} />
    ${s.viewer && html`<${Viewer} key=${s.viewer.key} />`}
    ${s.settings.ageOK && !locked && !s.hidden && s.settings.musicIsland && html`<${MusicIsland} />`}
    <${SheetHost} />
    ${!locked && html`<${Toast} toast=${s.toast} />`}
    ${s.update && html`<button type="button" class="update-pill" onClick=${() => location.reload()}><${Icon} name="refresh" size=${15} /> Nouvelle version · toucher pour recharger</button>`}
    ${!s.settings.ageOK && html`<${AgeGate} />`}
    ${locked && html`<${LockScreen} key="lock" />`}
    ${s.hidden && !locked && html`<div class="privacy-cover"><img src="icons/${s.settings.installIcon || 'app'}-180.png" alt="" /></div>`}
  </div>`;
}
