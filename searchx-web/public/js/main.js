import { html, render } from '../vendor/preact-htm.mjs';
import { App } from './ui/app.js';
import { state, notify } from './state.js';
import { applyInstallIcon } from './lib/install.js';
import { applyTheme } from './lib/theme.js';
import { requestPersistence } from './lib/storage.js';
import { health } from './api.js';
import { APP_VERSION } from './config.js';

applyTheme(state.settings.mode);
applyInstallIcon(state.settings.installIcon);
requestPersistence();

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}

// A newer version has been deployed: load it right away (once per version), else offer it.
health().then(h => {
  if (!h?.version || h.version === APP_VERSION) return;
  let done = null;
  try { done = sessionStorage.getItem('sx.updatedTo'); } catch { /* ignore */ }
  if (done !== h.version && !state.search.query) {
    try { sessionStorage.setItem('sx.updatedTo', h.version); } catch { /* ignore */ }
    location.reload();
    return;
  }
  state.update = true;
  notify();
}).catch(() => { /* server unreachable: searches will show it */ });
