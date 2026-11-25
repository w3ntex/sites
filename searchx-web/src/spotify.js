// Spotify sign-in hand-over (the remote itself runs on the phone, see public/js/lib/spotify.js).
//
//   GET /api/spotify/callback?code=&state=   page Spotify returns to after the sign-in (no access key:
//                                            Spotify opens it, often in Safari rather than in the app)
//   GET /api/spotify/poll?state=             the app picks the one-time code up (once)
//
// On iPhone the sign-in can end in Safari, whose storage is separate from the installed app's. The page
// then leaves the code here and the app collects it. The code is useless without the PKCE secret that
// never leaves the app, it is kept 10 minutes at most and handed out once. Storage: a Durable Object
// (binding SPOTIFY_HANDOFF) so every Cloudflare location sees it; memory of this isolate otherwise.

const TTL = 10 * 60 * 1000;
export const STATE_RE = /^[\w-]{16,100}$/;
const CODE_RE = /^[\w.~-]{20,1200}$/;
const ERROR_RE = /^[a-z_]{1,40}$/;
const memory = new Map();

export class SpotifyHandoff {
  constructor(ctx) {
    this.storage = ctx.storage;
  }

  async fetch(request) {
    if (request.method === 'PUT') {
      await this.storage.put('v', { body: await request.text(), t: Date.now() });
      try { await this.storage.setAlarm(Date.now() + TTL); } catch { /* removed at the next read */ }
      return new Response('ok');
    }
    const saved = await this.storage.get('v');
    if (saved) await this.storage.deleteAll();
    if (!saved || Date.now() - saved.t > TTL) return new Response('', { status: 404 });
    return new Response(saved.body, { headers: { 'Content-Type': 'application/json' } });
  }

  async alarm() {
    await this.storage.deleteAll();
  }
}

function objectFor(env, state) {
  const ns = env?.SPOTIFY_HANDOFF;
  if (!ns?.idFromName) return null;
  return ns.get(ns.idFromName(state));
}

export async function putHandoff(env, state, value) {
  const body = JSON.stringify(value);
  const obj = objectFor(env, state);
  if (obj) return (await obj.fetch('https://handoff/', { method: 'PUT', body })).ok;
  const now = Date.now();
  for (const [k, v] of memory) if (now - v.t > TTL) memory.delete(k);
  memory.set(state, { body, t: now });
  return true;
}

export async function takeHandoff(env, state) {
  const obj = objectFor(env, state);
  if (obj) {
    const res = await obj.fetch('https://handoff/', { method: 'GET' });
    return res.ok ? res.json() : null;
  }
  const saved = memory.get(state);
  memory.delete(state);
  if (!saved || Date.now() - saved.t > TTL) return null;
  return JSON.parse(saved.body);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

export async function handleSpotifyPoll(url, env) {
  const state = url.searchParams.get('state') || '';
  if (!STATE_RE.test(state)) return json({ ok: false, error: 'Paramètre state invalide.' }, 400);
  let value = null;
  try { value = await takeHandoff(env, state); } catch { value = null; }
  return json(value ? { ok: true, ...value } : { ok: true, pending: true });
}

export async function handleSpotifyCallback(url, env) {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const error = url.searchParams.get('error') || '';
  if (!STATE_RE.test(state) || (!CODE_RE.test(code) && !ERROR_RE.test(error))) {
    return page({
      title: 'Lien incomplet',
      text: 'Cette page termine la connexion à Spotify lancée depuis SearchX. Recommence depuis l’app : Réglages → Musique → Spotify.'
    }, 400);
  }
  const value = CODE_RE.test(code) ? { state, code } : { state, error };
  let stored = false;
  try { stored = await putHandoff(env, state, value); } catch { stored = false; }
  return page({ value, stored });
}

function nonce() {
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(16))) s += String.fromCharCode(b);
  return btoa(s);
}

function page({ value = null, stored = false, title = '', text = '' }, status = 200) {
  const n = nonce();
  const ok = Boolean(value?.code);
  const heading = title || (ok ? 'C’est presque fini' : 'Connexion annulée');
  const lead = text || (ok
    ? 'Retourne dans l’app SearchX : la connexion à Spotify se termine toute seule.'
    : 'Spotify n’a pas été connecté. Retourne dans l’app SearchX pour réessayer.');
  const data = value ? JSON.stringify(value).replace(/</g, '\\u003c') : 'null';
  const body = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<title>SearchX · Spotify</title>
<style nonce="${n}">
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0a0f; color: #f4f1f6;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px 16px; box-sizing: border-box; }
  main { width: 100%; max-width: 380px; text-align: center; }
  .mark { width: 72px; height: 72px; margin: 0 auto 18px; border-radius: 22px; display: grid; place-items: center;
    background: ${ok ? '#1db954' : '#3a3442'}; color: #000; font-size: 34px; font-weight: 800; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  p { margin: 0 0 12px; color: #c9c2cf; }
  .small { font-size: 14px; color: #9a92a1; }
  .box { margin-top: 22px; padding: 16px; border-radius: 18px; background: #17141c; border: 1px solid #2a2530; }
  .box.main { border-color: #1db954; }
  button { width: 100%; min-height: 48px; border: 0; border-radius: 14px; background: #1db954; color: #000; font: inherit; font-weight: 700; }
  button:active { opacity: .8; }
  .after { margin: 10px 0 0; }
</style>
</head>
<body>
<main>
  <div class="mark">${ok ? '♪' : '×'}</div>
  <h1>${heading}</h1>
  <p>${lead}</p>
  ${ok ? `<p class="small">Sur iPhone : ferme cette page, puis rouvre SearchX depuis ton écran d’accueil.</p>
  <div class="box${stored ? '' : ' main'}">
    <p class="small">${stored ? 'Toujours rien dans SearchX après 10 secondes ?' : 'Pour terminer, copie ce code :'}</p>
    <button type="button" id="copy">Copier le code de connexion</button>
    <p class="small after">puis colle-le dans SearchX : Réglages → Musique → Spotify.</p>
  </div>` : ''}
</main>
<script nonce="${n}">
(function () {
  var data = ${data};
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (!data) return;
  try {
    var pending = JSON.parse(localStorage.getItem('sx.spotify.pending') || 'null');
    if (pending && pending.state === data.state) {
      // Same storage as the app (sign-in opened inside it): hand the code over and go back.
      localStorage.setItem('sx.spotify.handoff', JSON.stringify(data));
      location.replace('/');
      return;
    }
  } catch (e) {}
  var btn = document.getElementById('copy');
  if (!btn || !data.code) return;
  btn.addEventListener('click', function () {
    var text = 'SX1.' + data.state + '.' + data.code;
    var done = function () { btn.textContent = 'Code copié ✓'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copie ce code :', text); });
    else window.prompt('Copie ce code :', text);
  });
})();
</script>
</body>
</html>`;
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${n}'; style-src 'nonce-${n}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
    }
  });
}
