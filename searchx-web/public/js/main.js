import { html, render } from '../vendor/preact-htm.mjs';
import { App } from './ui/app.js';
import { state, notify, updateSettings, toast } from './state.js';
import { applyInstallIcon } from './lib/install.js';
import { applyTheme } from './lib/theme.js';
import { requestPersistence } from './lib/storage.js';
import { health } from './api.js';
import { APP_VERSION } from './config.js';
import { startMusic, setServerHeaders, onConnected } from './lib/spotify.js';
import { startInbox } from './lib/inbox.js';
import { followShared } from './search.js';
import { searchXUsers } from './api.js';
import { xUserFromShared } from './shared/xshare.js';
import { AUDIO_SESSION } from './lib/audio.js';

applyTheme(state.settings.mode);
applyInstallIcon(state.settings.installIcon);
requestPersistence();

render(html`<${App} />`, document.getElementById('app'));

// Spotify remote: reads what plays (and finishes a sign-in coming back from Spotify).
setServerHeaders(() => (state.settings.accessKey ? { 'x-sx-key': state.settings.accessKey } : {}));
onConnected(() => {
  // With Spotify connected SearchX knows when music plays: keep it going during videos.
  if (AUDIO_SESSION && !state.settings.musicMix) updateSettings({ musicMix: true });
  toast(AUDIO_SESSION ? 'Spotify connecté · ta musique continue pendant les vidéos' : 'Spotify connecté');
});
startMusic();

// X accounts shared from the X app: iOS Shortcut "SearchX" → this phone's mailbox → followed here.
const serverHeaders = () => (state.settings.accessKey ? { 'x-sx-key': state.settings.accessKey } : {});
const welcomeShared = async users => {
  const added = await followShared(users, u => searchXUsers(u));
  if (added.length === 1) toast(`@${added[0]} ajouté depuis X`);
  else if (added.length > 1) toast(`${added.length} comptes ajoutés depuis X`);
  else if (users.length) toast(`@${users[0]} est déjà dans tes comptes X`);
};
startInbox({ headers: serverHeaders, onAccounts: welcomeShared });

// Android (Web Share Target): "Partager → SearchX" opens the app with ?title=&text=&url=.
{
  const p = new URLSearchParams(location.search);
  if (p.has('url') || p.has('text')) {
    const user = xUserFromShared([p.get('url'), p.get('text'), p.get('title')].filter(Boolean).join(' '));
    history.replaceState(null, '', location.pathname);
    if (user) welcomeShared([user]);
    else toast('Aucun compte X dans ce partage.');
  }
}

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
