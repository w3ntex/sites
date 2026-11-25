// Spotify remote. Spotify's own web player does not run on iPhone, so the music always plays in the
// Spotify app and SearchX is its remote control (Spotify Connect, through the Spotify Web API):
// what's playing, play / pause, previous / next, seek, shuffle and "J'aime".
//
// Sign-in uses the user's own Spotify developer app (Client ID) with Authorization Code + PKCE, all on
// the phone: the tokens never go through the SearchX server. On iPhone the Spotify sign-in page can open
// outside the installed app, so the page Spotify returns to (/api/spotify/callback) hands the one-time
// code over: directly when it shares the app's storage, otherwise through a short-lived rendezvous on the
// server that the app polls. The code alone is useless without the PKCE secret, which stays in the app.
import { useState, useEffect } from '../../vendor/preact-htm.mjs';
import { load, save, remove } from './storage.js';

const AUTHORIZE = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify'
];
export const SPOTIFY_DASHBOARD = 'https://developer.spotify.com/dashboard';

const KEY = 'spotify';             // { clientId, access, refresh, exp, scope }
const PENDING = 'spotify.pending'; // { state, verifier, clientId, redirect, ts } while signing in
const HANDOFF = 'spotify.handoff'; // { state, code | error } left by the callback page (same storage)
const PENDING_TTL = 15 * 60 * 1000;

let tokens = load(KEY, null);
if (tokens && (!tokens.access || !tokens.refresh || !tokens.clientId)) tokens = null;

/** Music state, separate from the app state so that the frequent updates only re-render the island. */
export const music = {
  connected: Boolean(tokens),
  pending: Boolean(load(PENDING, null)),
  playback: null,      // see slimPlayback()
  updatedAt: 0,        // last successful read of the player
  saved: null,         // is the current track in "Titres likés" (null: unknown)
  error: '',           // last problem, in French
  premiumNeeded: false
};
const listeners = new Set();

function setMusic(patch) {
  Object.assign(music, patch);
  for (const l of listeners) l();
}

/** Re-renders the calling component whenever the music state changes. */
export function useMusic() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(x => x + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return music;
}

export function onMusicChange(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function redirectUri(origin = location.origin) {
  return `${origin}/api/spotify/callback`;
}

export function savedClientId() {
  return tokens?.clientId || load('spotify.clientId', '') || '';
}

export function isClientId(id) {
  return /^[0-9a-f]{32}$/i.test(String(id || '').trim());
}

// ---------- PKCE ----------

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl({ clientId, redirect, state, challenge }) {
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirect,
    scope: SPOTIFY_SCOPES.join(' '),
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge
  });
  return `${AUTHORIZE}?${p}`;
}

/** Prepares the sign-in and returns the Spotify page to open. */
export async function beginConnect(clientId) {
  clientId = String(clientId || '').trim();
  if (!isClientId(clientId)) throw new Error('Ce Client ID n’a pas le bon format : 32 caractères (chiffres et lettres a à f).');
  const verifier = randomString(48);
  const state = randomString(18);
  const redirect = redirectUri();
  save(PENDING, { state, verifier, clientId, redirect, ts: Date.now() });
  save('spotify.clientId', clientId);
  remove(HANDOFF);
  setMusic({ pending: true, error: '' });
  return authorizeUrl({ clientId, redirect, state, challenge: await pkceChallenge(verifier) });
}

export function cancelConnect() {
  remove(PENDING);
  remove(HANDOFF);
  setMusic({ pending: false });
}

function pendingSignIn() {
  const p = load(PENDING, null);
  if (!p || !p.state || !p.verifier) return null;
  if (Date.now() - (p.ts || 0) > PENDING_TTL) { cancelConnect(); return null; }
  return p;
}

const CONNECT_ERRORS = {
  access_denied: 'Connexion à Spotify annulée.',
  invalid_client: 'Spotify ne reconnaît pas ce Client ID. Vérifie-le dans ton app Spotify (Settings → Client ID).',
  invalid_request: 'Spotify a refusé la demande : vérifie que la Redirect URI de ton app Spotify est exactement celle affichée dans SearchX.'
};

function connectError(code, detail = '') {
  if (CONNECT_ERRORS[code]) return CONNECT_ERRORS[code];
  if (/redirect/i.test(detail)) return CONNECT_ERRORS.invalid_request;
  if (/user.*(not|n't).*(registered|allowed)|not.*developer/i.test(detail)) return 'Ton compte Spotify n’est pas autorisé par ton app : dans ton app Spotify → User Management, ajoute l’e-mail de ton compte Spotify.';
  return `Spotify a refusé la connexion${code ? ` (${code})` : ''}${detail ? ` : ${detail}` : '.'}`;
}

/** Text the callback page offers to copy when the automatic hand-over cannot work: "SX1.<state>.<code>". */
export function parseHandoffText(text) {
  const t = String(text || '').trim();
  const m = /^SX1\.([\w-]{8,100})\.([\w.~-]{20,1200})$/.exec(t);
  if (m) return { state: m[1], code: m[2] };
  if (/^[\w.~-]{40,1200}$/.test(t)) return { state: null, code: t };
  return null;
}

let finishing = null;

/** Finishes a sign-in in progress (code left by the callback page, or waiting on the server). */
export function resumeConnect({ poll = true, text = '' } = {}) {
  if (!finishing) finishing = finish({ poll, text }).finally(() => { finishing = null; });
  return finishing;
}

async function finish({ poll, text }) {
  const pending = pendingSignIn();
  if (!pending) { if (music.pending) setMusic({ pending: false }); return false; }
  let got = null;
  if (text) {
    got = parseHandoffText(text);
    if (!got) throw new Error('Ce n’est pas le code affiché par la page Spotify.');
    if (got.state && got.state !== pending.state) throw new Error('Ce code vient d’une autre tentative : touche à nouveau « Connecter Spotify ».');
  }
  if (!got) {
    const local = load(HANDOFF, null);
    if (local && local.state === pending.state) got = local;
  }
  if (!got && poll) got = await pollServer(pending.state);
  if (!got) return false;
  remove(HANDOFF);
  if (got.error || !got.code) {
    cancelConnect();
    setMusic({ error: connectError(got.error || 'unknown', got.detail || '') });
    return false;
  }
  try {
    await exchangeCode(pending, got.code);
  } finally {
    remove(PENDING);
    setMusic({ pending: false });
  }
  return true;
}

let pollHeaders = () => ({});
/** The app passes its server headers (access key) for the rendezvous. */
export function setServerHeaders(fn) { pollHeaders = fn; }

async function pollServer(state) {
  try {
    const res = await fetch(`api/spotify/poll?state=${encodeURIComponent(state)}`, { headers: pollHeaders(), cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.code || data?.error ? data : null;
  } catch {
    return null;
  }
}

async function tokenRequest(params) {
  let res;
  try {
    res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params)
    });
  } catch {
    throw new Error(navigator.onLine === false ? 'Pas de connexion Internet.' : 'Spotify est injoignable.');
  }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function exchangeCode(pending, code) {
  const { res, data } = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirect,
    client_id: pending.clientId,
    code_verifier: pending.verifier
  });
  if (!res.ok || !data.access_token) {
    const msg = connectError(data.error === 'invalid_grant' ? '' : data.error, data.error_description || '');
    setMusic({ error: data.error === 'invalid_grant' ? 'Ce code a expiré ou a déjà servi : touche à nouveau « Connecter Spotify ».' : msg });
    throw new Error(music.error);
  }
  keepTokens(pending.clientId, data);
  setMusic({ connected: true, error: '', premiumNeeded: false });
  refreshPlayer();
  for (const cb of connectedCallbacks) { try { cb(); } catch { /* ignore */ } }
}

const connectedCallbacks = new Set();
/** Called after each successful sign-in. */
export function onConnected(cb) {
  connectedCallbacks.add(cb);
  return () => connectedCallbacks.delete(cb);
}

function keepTokens(clientId, data, prev = null) {
  tokens = {
    clientId,
    access: data.access_token,
    refresh: data.refresh_token || prev?.refresh,
    exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60 * 1000,
    scope: data.scope || prev?.scope || ''
  };
  save(KEY, tokens);
}

export function disconnect(reason = '') {
  tokens = null;
  remove(KEY);
  stopTimer();
  setMusic({ connected: false, playback: null, saved: null, updatedAt: 0, error: reason, premiumNeeded: false });
}

let refreshing = null;

async function accessToken(force = false) {
  if (!tokens) return null;
  if (!force && tokens.exp > Date.now()) return tokens.access;
  if (!refreshing) refreshing = renew().finally(() => { refreshing = null; });
  return refreshing;
}

async function renew() {
  const prev = tokens;
  const { res, data } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: prev.refresh, client_id: prev.clientId });
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant' || data.error === 'invalid_client' || res.status === 400 || res.status === 401) {
      disconnect('La connexion Spotify a expiré : reconnecte-toi (Réglages → Musique → Spotify).');
    }
    throw new SpotifyError('auth', music.error || 'Spotify a refusé de prolonger la connexion.');
  }
  if (tokens !== prev) return tokens?.access || null; // disconnected meanwhile
  keepTokens(prev.clientId, data, prev);
  return tokens.access;
}

// ---------- Web API ----------

export class SpotifyError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

function apiError(status, data) {
  const reason = data?.error?.reason || '';
  const message = data?.error?.message || data?.error_description || '';
  if (status === 403 && reason === 'PREMIUM_REQUIRED') return new SpotifyError('premium', 'Piloter la lecture demande Spotify Premium.', status);
  if (status === 403 && /registered|developer|allowlist|not allowed/i.test(message)) {
    return new SpotifyError('user', 'Ton compte Spotify n’est pas autorisé par ton app : dans ton app Spotify → User Management, ajoute l’e-mail de ton compte.', status);
  }
  if (status === 403) return new SpotifyError('restricted', 'Spotify ne permet pas cette action maintenant.', status);
  if (status === 404 && /device/i.test(`${reason} ${message}`)) return new SpotifyError('device', 'Aucun appareil Spotify actif : ouvre Spotify et lance une musique.', status);
  if (status === 404) return new SpotifyError('missing', 'Spotify ne trouve pas cet élément.', status);
  if (status === 429) return new SpotifyError('rate', 'Spotify demande de patienter quelques secondes.', status);
  return new SpotifyError('http', `Spotify a répondu ${status}${message ? ` : ${message}` : ''}.`, status);
}

let backoffUntil = 0;

async function api(path, { method = 'GET', query = null, body = undefined, retry = true } = {}) {
  const token = await accessToken();
  if (!token) throw new SpotifyError('auth', 'Spotify n’est pas connecté.');
  const url = `${API}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new SpotifyError('network', navigator.onLine === false ? 'Pas de connexion Internet.' : 'Spotify est injoignable.');
  }
  if (res.status === 401 && retry) {
    await accessToken(true);
    return api(path, { method, query, body, retry: false });
  }
  if (res.status === 429) {
    const wait = Math.min(60, Number(res.headers.get('Retry-After')) || 5);
    backoffUntil = Date.now() + wait * 1000;
  }
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw apiError(res.status, data);
  return data;
}

function pickArt(images) {
  if (!Array.isArray(images) || !images.length) return '';
  const sorted = images.filter(i => i?.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find(i => (i.width || 0) >= 200) || sorted[sorted.length - 1] || {}).url || '';
}

/** Keeps only what the island needs from GET /me/player. */
export function slimPlayback(d, now = Date.now()) {
  if (!d) return null;
  const it = d.item;
  const episode = it?.type === 'episode';
  return {
    playing: Boolean(d.is_playing),
    progress: Number(d.progress_ms) || 0,
    at: now,
    shuffle: Boolean(d.shuffle_state),
    repeat: d.repeat_state || 'off',
    device: d.device ? { id: d.device.id || null, name: d.device.name || '', type: d.device.type || '', volume: d.device.volume_percent ?? null } : null,
    disallows: d.actions?.disallows || {},
    track: it ? {
      id: it.id || '',
      uri: it.uri || '',
      name: it.name || '',
      artist: episode ? (it.show?.name || '') : (it.artists || []).map(a => a.name).filter(Boolean).join(', '),
      art: pickArt(episode ? (it.images?.length ? it.images : it.show?.images) : it.album?.images),
      duration: Number(it.duration_ms) || 0,
      url: it.external_urls?.spotify || '',
      episode
    } : null
  };
}

/** Current position of the playing track, between two reads of the player. */
export function progressNow(p = music.playback, now = Date.now()) {
  if (!p?.track) return 0;
  const ms = p.playing ? p.progress + (now - p.at) : p.progress;
  return Math.max(0, Math.min(p.track.duration || ms, ms));
}

/**
 * Whether Spotify is playing on a phone or tablet (so a video with sound would interrupt it).
 * null when unknown: not connected, or no recent read of the player.
 */
export function musicPlayingHere(now = Date.now()) {
  if (!music.connected || !music.updatedAt || now - music.updatedAt > 90 * 1000) return null;
  const p = music.playback;
  if (!p?.playing) return false;
  const type = String(p.device?.type || '').toLowerCase();
  return !type || type === 'smartphone' || type === 'tablet';
}

let lastSavedCheck = '';

async function readPlayer() {
  if (!tokens || Date.now() < backoffUntil) return;
  try {
    const data = await api('/me/player', { query: { additional_types: 'episode' } });
    const playback = slimPlayback(data);
    const uri = playback?.track?.uri || '';
    const sameTrack = uri && uri === music.playback?.track?.uri;
    setMusic({ playback, updatedAt: Date.now(), saved: sameTrack ? music.saved : null, error: music.premiumNeeded ? music.error : '' });
    if (uri && uri !== lastSavedCheck && !playback.track.episode) { lastSavedCheck = uri; checkSaved(uri); }
  } catch (e) {
    if (e.kind === 'auth' && !tokens) return;
    setMusic({ error: e.message });
  }
}

let reading = null;
export function refreshPlayer() {
  if (!reading) reading = readPlayer().finally(() => { reading = null; });
  return reading;
}

// Library ("J'aime"). Since February 2026 Spotify uses /me/library with URIs; older apps may still
// only have /me/tracks with ids.
async function checkSaved(uri) {
  try {
    let r;
    try {
      r = await api('/me/library/contains', { query: { uris: uri } });
    } catch (e) {
      if (e.status !== 404 && e.status !== 400 && e.status !== 403) throw e;
      r = await api('/me/tracks/contains', { query: { ids: uri.split(':').pop() } });
    }
    if (music.playback?.track?.uri === uri) setMusic({ saved: Array.isArray(r) ? Boolean(r[0]) : null });
  } catch { /* keep unknown */ }
}

async function setSaved(uri, on) {
  const method = on ? 'PUT' : 'DELETE';
  try {
    await api('/me/library', { method, query: { uris: uri } });
  } catch (e) {
    if (e.status !== 404 && e.status !== 400 && e.status !== 403) throw e;
    await api('/me/tracks', { method, query: { ids: uri.split(':').pop() } });
  }
}

function settle(delays = [450, 1600]) {
  for (const d of delays) setTimeout(() => { refreshPlayer(); }, d);
}

/** Player commands. Returns an error message (French) or ''. */
export async function musicCommand(name, arg) {
  const p = music.playback;
  const before = { playback: p, saved: music.saved };
  try {
    switch (name) {
      case 'toggle': {
        const playing = !p?.playing;
        if (p) setMusic({ playback: { ...p, playing, progress: progressNow(p), at: Date.now() } });
        if (playing) await api('/me/player/play', { method: 'PUT' });
        else await api('/me/player/pause', { method: 'PUT' });
        break;
      }
      case 'next':
        await api('/me/player/next', { method: 'POST' });
        break;
      case 'previous':
        // Like the Spotify app: back to the start of the track first, previous track when already there.
        if (p?.track && progressNow(p) > 3500) {
          setMusic({ playback: { ...p, progress: 0, at: Date.now() } });
          await api('/me/player/seek', { method: 'PUT', query: { position_ms: 0 } });
        } else {
          await api('/me/player/previous', { method: 'POST' });
        }
        break;
      case 'seek': {
        const ms = Math.max(0, Math.round(arg || 0));
        if (p) setMusic({ playback: { ...p, progress: ms, at: Date.now() } });
        await api('/me/player/seek', { method: 'PUT', query: { position_ms: ms } });
        break;
      }
      case 'shuffle': {
        const on = !p?.shuffle;
        if (p) setMusic({ playback: { ...p, shuffle: on } });
        await api('/me/player/shuffle', { method: 'PUT', query: { state: on ? 'true' : 'false' } });
        break;
      }
      case 'like': {
        const uri = p?.track?.uri;
        if (!uri || p.track.episode) return '';
        const on = !music.saved;
        setMusic({ saved: on });
        await setSaved(uri, on);
        return '';
      }
      default:
        return '';
    }
    if (music.premiumNeeded) setMusic({ premiumNeeded: false, error: '' });
    settle();
    return '';
  } catch (e) {
    setMusic({ playback: before.playback, saved: before.saved });
    if (e.kind === 'premium') setMusic({ premiumNeeded: true, error: e.message });
    settle([300]);
    return e.message || 'Spotify ne répond pas.';
  }
}

// ---------- polling ----------
// Every 5 s while the music plays and the app is on screen, every 12 s otherwise; nothing in the
// background (iOS shows Spotify's own controls on the lock screen and in the Dynamic Island).

let timer = null;

function stopTimer() {
  clearTimeout(timer);
  timer = null;
}

function schedule() {
  stopTimer();
  if (!tokens || document.hidden) return;
  const wait = Math.max(music.playback?.playing ? 5000 : 12000, backoffUntil - Date.now());
  timer = setTimeout(async () => {
    await refreshPlayer();
    schedule();
  }, wait);
}

let started = false;

/** Starts reading the player (and finishes a sign-in in progress). Called once at start-up. */
export function startMusic() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const wake = async () => {
    if (document.hidden) { stopTimer(); return; }
    if (pendingSignIn()) { try { await resumeConnect(); } catch { /* shown in the sheet */ } }
    if (tokens) { await refreshPlayer(); schedule(); }
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', wake);
  // While a sign-in is in progress, check for the code every 2 s.
  setInterval(() => { if (!document.hidden && pendingSignIn() && !finishing) resumeConnect().catch(() => {}); }, 2000);
  onMusicChange(() => { if (tokens && !timer && !document.hidden) schedule(); });
  wake();
}

export function spotifyOpenUrl(track) {
  // spotify: links open the Spotify app; open.spotify.com is the fallback page.
  return track?.uri ? track.uri : 'spotify:';
}
