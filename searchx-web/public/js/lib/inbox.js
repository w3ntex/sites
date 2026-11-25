// X accounts shared from the X app (iOS Shortcut "SearchX" in the share sheet → this phone's mailbox
// on the server). Collected when the app opens or comes back to the screen. The mailbox exists once
// the user opened the setup steps; until then nothing is asked.
import { load, save } from './storage.js';

const KEY = 'inbox';

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(18));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function inboxToken(create = false) {
  let t = load(KEY, '');
  if (!/^[\w-]{20,64}$/.test(t || '')) t = '';
  if (!t && create) { t = randomToken(); save(KEY, t); }
  return t;
}

/** Address the Shortcut calls, followed by what X shared ("Entrée du raccourci"). */
export function inboxAddUrl(origin = location.origin) {
  return `${origin}/api/inbox/${inboxToken(true)}/add?u=`;
}

let headersFn = () => ({});
let onUsers = async () => {};
let pulling = null;

/** Takes the accounts waiting in the mailbox (once) and hands them to the app. */
export function pullInbox() {
  const t = inboxToken(false);
  if (!t) return Promise.resolve([]);
  if (!pulling) {
    pulling = (async () => {
      try {
        const res = await fetch(`api/inbox/${t}/take`, { headers: headersFn(), cache: 'no-store' });
        const body = await res.json().catch(() => null);
        const users = Array.isArray(body?.users) ? body.users.filter(u => /^\w{1,15}$/.test(u)) : [];
        if (users.length) await onUsers(users);
        return users;
      } catch {
        return [];
      } finally {
        pulling = null;
      }
    })();
  }
  return pulling;
}

let started = false;

export function startInbox({ headers, onAccounts }) {
  headersFn = headers;
  onUsers = onAccounts;
  if (started || typeof document === 'undefined') return;
  started = true;
  const wake = () => { if (!document.hidden) pullInbox(); };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', wake);
  wake();
}
