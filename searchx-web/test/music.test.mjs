// SearchX 2.6: Spotify sign-in hand-over (Worker), Spotify remote helpers and "music during videos".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../src/worker.js';
import { SpotifyHandoff } from '../src/spotify.js';
import {
  pkceChallenge, authorizeUrl, parseHandoffText, slimPlayback, progressNow, isClientId, randomString, SPOTIFY_SCOPES
} from '../public/js/lib/spotify.js';
import { shouldMixWithMusic } from '../public/js/lib/audio.js';

const STATE = 'Zm9vYmFyYmF6cXV4MTIzNDU2';
const CODE = `AQB${'c'.repeat(80)}`;
const call = (path, env = {}, headers = {}) => worker.fetch(new Request(`https://app.test${path}`, { headers }), env, { waitUntil() {} });

test('spotify callback stores the one-time code; poll hands it out once', async () => {
  const res = await call(`/api/spotify/callback?code=${CODE}&state=${STATE}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const csp = res.headers.get('content-security-policy');
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce, 'nonce in the CSP');
  const page = await res.text();
  assert.ok(page.includes(`<script nonce="${nonce}">`));
  assert.ok(page.includes('sx.spotify.pending') && page.includes('sx.spotify.handoff'), 'same-storage hand-over');
  assert.ok(page.includes('Copier le code'), 'manual fallback');

  const first = await (await call(`/api/spotify/poll?state=${STATE}`)).json();
  assert.deepEqual(first, { ok: true, state: STATE, code: CODE });
  const again = await (await call(`/api/spotify/poll?state=${STATE}`)).json();
  assert.deepEqual(again, { ok: true, pending: true }, 'handed out once');
});

test('spotify callback: errors, bad input, no script injection', async () => {
  const denied = await call(`/api/spotify/callback?error=access_denied&state=${STATE}`);
  assert.equal(denied.status, 200);
  assert.match(await denied.text(), /Connexion annulée/);
  assert.deepEqual(await (await call(`/api/spotify/poll?state=${STATE}`)).json(), { ok: true, state: STATE, error: 'access_denied' });

  const bad = await call(`/api/spotify/callback?code=${encodeURIComponent('</script><script>alert(1)</script>')}&state=${STATE}`);
  assert.equal(bad.status, 400);
  assert.ok(!(await bad.text()).includes('alert(1)'));
  assert.equal((await call('/api/spotify/poll?state=x')).status, 400);
});

test('spotify callback needs no access key, poll does', async () => {
  const env = { ACCESS_KEY: 'secret' };
  const state = 'c2Vjb25kU3RhdGVWYWx1ZTEy';
  assert.equal((await call(`/api/spotify/callback?code=${CODE}&state=${state}`, env)).status, 200);
  assert.equal((await call(`/api/spotify/poll?state=${state}`, env)).status, 401);
  const ok = await (await call(`/api/spotify/poll?state=${state}`, env, { 'x-sx-key': 'secret' })).json();
  assert.equal(ok.code, CODE);
});

test('spotify hand-over Durable Object: put, take once, expire', async () => {
  const data = new Map();
  const storage = {
    async put(k, v) { data.set(k, v); },
    async get(k) { return data.get(k); },
    async deleteAll() { data.clear(); },
    async setAlarm() {}
  };
  const obj = new SpotifyHandoff({ storage });
  await obj.fetch(new Request('https://handoff/', { method: 'PUT', body: JSON.stringify({ state: STATE, code: CODE }) }));
  const r1 = await obj.fetch(new Request('https://handoff/'));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).code, CODE);
  assert.equal((await obj.fetch(new Request('https://handoff/'))).status, 404);
  data.set('v', { body: '{}', t: Date.now() - 11 * 60 * 1000 });
  assert.equal((await obj.fetch(new Request('https://handoff/'))).status, 404, 'expired after 10 minutes');

  // The Worker uses the binding when it exists.
  const objects = new Map();
  const ns = {
    idFromName: n => n,
    // Like a real stub: fetch(url, init) reaches the object's fetch(request).
    get: id => {
      if (!objects.has(id)) { const d = new Map(); objects.set(id, new SpotifyHandoff({ storage: { put: async (k, v) => d.set(k, v), get: async k => d.get(k), deleteAll: async () => d.clear(), setAlarm: async () => {} } })); }
      const o = objects.get(id);
      return { fetch: (u, init) => o.fetch(new Request(u, init)) };
    }
  };
  const state = 'ZHVyYWJsZU9iamVjdFN0YXRl';
  await call(`/api/spotify/callback?code=${CODE}&state=${state}`, { SPOTIFY_HANDOFF: ns });
  assert.ok(objects.has(state));
  assert.equal((await (await call(`/api/spotify/poll?state=${state}`, { SPOTIFY_HANDOFF: ns })).json()).code, CODE);
});

test('PKCE challenge is base64url(SHA-256(verifier)); sign-in URL', async () => {
  const verifier = randomString(48);
  assert.match(verifier, /^[\w-]{64}$/);
  assert.equal(await pkceChallenge(verifier), createHash('sha256').update(verifier).digest('base64url'));
  const u = new URL(authorizeUrl({ clientId: 'a'.repeat(32), redirect: 'https://app.test/api/spotify/callback', state: STATE, challenge: 'xyz' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://app.test/api/spotify/callback');
  assert.deepEqual(u.searchParams.get('scope').split(' '), SPOTIFY_SCOPES);
  assert.ok(isClientId('0123456789abcdef0123456789ABCDEF'));
  assert.ok(!isClientId('0123456789abcdef'));
  assert.ok(!isClientId('0123456789abcdef0123456789abcdeg'));
});

test('code pasted from the Spotify page', () => {
  assert.deepEqual(parseHandoffText(`  SX1.${STATE}.${CODE} `), { state: STATE, code: CODE });
  assert.deepEqual(parseHandoffText(CODE), { state: null, code: CODE });
  assert.equal(parseHandoffText('hello'), null);
  assert.equal(parseHandoffText('SX1.short.code'), null);
});

test('player state for the island', () => {
  const p = slimPlayback({
    is_playing: true, progress_ms: 30000, shuffle_state: true, repeat_state: 'context',
    device: { id: 'd', name: 'iPhone de Sam', type: 'Smartphone', volume_percent: null },
    actions: { disallows: { seeking: true } },
    item: { type: 'track', id: 't1', uri: 'spotify:track:t1', name: 'Titre', duration_ms: 200000,
      artists: [{ name: 'A' }, { name: 'B' }],
      album: { images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 64 }] },
      external_urls: { spotify: 'https://open.spotify.com/track/t1' } }
  }, 1000);
  assert.equal(p.track.artist, 'A, B');
  assert.equal(p.track.art, 'mid', 'the 300 px cover');
  assert.equal(p.device.type, 'Smartphone');
  assert.equal(p.disallows.seeking, true);
  assert.equal(progressNow(p, 6000), 35000, 'moves on while playing');
  assert.equal(progressNow({ ...p, playing: false }, 6000), 30000, 'still when paused');
  assert.equal(progressNow(p, 1000 + 10 * 60 * 1000), 200000, 'never past the end');
  assert.equal(slimPlayback(null), null);
  const ep = slimPlayback({ is_playing: false, item: { type: 'episode', name: 'Ép.', show: { name: 'Podcast', images: [{ url: 's', width: 300 }] }, duration_ms: 1 } });
  assert.equal(ep.track.artist, 'Podcast');
  assert.equal(ep.track.episode, true);
  assert.equal(ep.track.art, 's');
});

test('music during videos: only when asked, and only while music plays', () => {
  assert.equal(shouldMixWithMusic({ settings: { musicMix: false }, playingHere: true }), false, 'setting off');
  assert.equal(shouldMixWithMusic({ settings: { musicMix: true }, playingHere: true }), true, 'Spotify plays on the phone');
  assert.equal(shouldMixWithMusic({ settings: { musicMix: true }, playingHere: false }), false, 'Spotify connected and silent: normal sound (silent switch ignored)');
  assert.equal(shouldMixWithMusic({ settings: { musicMix: true }, playingHere: null }), true, 'Spotify not connected: trust the setting');
});

test('Musique tab: tracks, playlists, albums and artists from the Web API', async () => {
  const { slimTrack, slimPlaylist, slimAlbum, slimArtist, hasScopes } = await import('../public/js/lib/spotify.js');
  const t = slimTrack({ uri: 'spotify:track:1', id: '1', name: 'A', duration_ms: 1000, explicit: true, is_playable: true,
    artists: [{ name: 'X' }, { name: 'Y' }], album: { uri: 'spotify:album:9', images: [{ url: 'big', width: 640 }, { url: 'small', width: 64 }, { url: 'mid', width: 300 }] } });
  assert.deepEqual({ artist: t.artist, art: t.art, albumUri: t.albumUri, explicit: t.explicit, playable: t.playable }, { artist: 'X, Y', art: 'mid', albumUri: 'spotify:album:9', explicit: true, playable: true });
  assert.equal(slimTrack({ uri: 'spotify:local:1', name: 'L', is_local: true }).playable, false, 'local files cannot be played remotely');
  assert.equal(slimTrack(null), null);
  assert.equal(slimTrack({ name: 'no uri' }), null);
  // February 2026: playlists count their content in "items" (older: "tracks").
  assert.equal(slimPlaylist({ uri: 'spotify:playlist:p', id: 'p', name: 'P', items: { total: 12 }, owner: { display_name: 'Moi' } }).total, 12);
  assert.equal(slimPlaylist({ uri: 'spotify:playlist:p', id: 'p', name: 'P', tracks: { total: 7 } }).total, 7);
  assert.equal(slimAlbum({ uri: 'spotify:album:a', id: 'a', name: 'Al', artists: [{ name: 'Z' }], total_tracks: 9 }).owner, 'Z');
  assert.equal(slimArtist({ uri: 'spotify:artist:r', id: 'r', name: 'R', images: [] }).kind, 'artist');
  assert.equal(hasScopes(), true, 'unknown scopes: assume granted (errors tell otherwise)');
});

test('music keeps playing during videos by default', async () => {
  const { DEFAULT_SETTINGS } = await import('../public/js/config.js');
  const { state } = await import('../public/js/state.js');
  assert.equal(DEFAULT_SETTINGS.musicMix, true);
  assert.equal(state.settings.musicMix, true, 'older settings are switched on once');
  assert.equal(state.settings.mixV, 2);
});
