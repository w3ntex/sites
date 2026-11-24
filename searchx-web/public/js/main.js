import { html, render } from '../vendor/preact-htm.mjs';
import { App } from './ui/app.js';
import { state, notify } from './state.js';
import { applyInstallIcon } from './lib/install.js';
import { applyTheme } from './lib/theme.js';
import { requestPersistence } from './lib/storage.js';
import { health } from './api.js';
import { APP_VERSION } from './config.js';

applyTheme(state.settings.theme);
applyInstallIcon(state.settings.installIcon);
requestPersistence();

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}

// Tell the user when a newer version has been deployed.
health().then(h => {
  if (h?.version && h.version !== APP_VERSION) { state.update = true; notify(); }
}).catch(() => { /* server unreachable: searches will show it */ });
