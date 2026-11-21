import { html, useEffect, useRef } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Toast, cx } from './common.js';
import { SearchTab } from './search-tab.js';
import { LibraryTab } from './library-tab.js';
import { HistoryTab } from './history-tab.js';
import { SettingsTab } from './settings-tab.js';
import { Viewer } from './viewer.js';
import { SheetHost } from './sheets.js';
import { LockScreen } from './lock.js';
import { state, notify, useAppState, updateSettings } from '../state.js';
import { haptic } from '../lib/haptics.js';

const TABS = [
  ['search', 'Recherche', 'search'],
  ['library', 'Favoris', 'heart'],
  ['history', 'Historique', 'history'],
  ['settings', 'Réglages', 'gear']
];

function AgeGate() {
  return html`<div class="age-gate">
    <div class="age-inner">
      <div class="age-badge">18+</div>
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

const scrollMemory = {};
function switchTab(id) {
  scrollMemory[state.tab] = window.scrollY;
  state.tab = id;
  notify();
  requestAnimationFrame(() => window.scrollTo(0, scrollMemory[id] || 0));
}

export function App() {
  const s = useAppState();
  const hiddenAt = useRef(0);

  // Lock + privacy cover when the app goes to the background.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        if (state.settings.blur) { state.hidden = true; notify(); }
        // Pause any playing media.
        document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch { /* ignore */ } });
      } else {
        const away = (Date.now() - hiddenAt.current) / 1000;
        if (state.settings.pinHash && hiddenAt.current && away >= (state.settings.lockDelay || 0)) state.locked = true;
        state.hidden = false;
        notify();
      }
    };
    const onHide = () => { if (state.settings.blur) { state.hidden = true; notify(); } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide); };
  }, []);

  // No page scrolling behind overlays.
  useEffect(() => {
    document.documentElement.classList.toggle('noscroll', Boolean(s.viewer || s.sheet || s.locked || !s.settings.ageOK));
  });

  let page;
  switch (s.tab) {
    case 'library': page = html`<${LibraryTab} />`; break;
    case 'history': page = html`<${HistoryTab} />`; break;
    case 'settings': page = html`<${SettingsTab} />`; break;
    default: page = html`<${SearchTab} />`;
  }

  return html`<div class=${cx('app', s.viewer && 'viewer-open', s.sheet && 'sheet-open')}>
    ${page}
    <${TabBar} />
    ${s.viewer && html`<${Viewer} key=${s.viewer.key} />`}
    <${SheetHost} />
    <${Toast} toast=${s.toast} />
    ${s.update && html`<button type="button" class="update-pill" onClick=${() => location.reload()}><${Icon} name="refresh" size=${15} /> Nouvelle version · toucher pour recharger</button>`}
    ${!s.settings.ageOK && html`<${AgeGate} />`}
    ${s.settings.ageOK && s.locked && s.settings.pinHash && html`<${LockScreen} />`}
    ${s.hidden && html`<div class="privacy-cover"></div>`}
  </div>`;
}
