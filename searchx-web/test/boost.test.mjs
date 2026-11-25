// SearchX 2.7.8: "Vidéo au-dessus de la musique". Spotify on another device is lowered during videos
// (lib/duck.js); on the phone, where iOS lets no web app lower another app, the video is raised (lib/boost.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slimPlayback } from '../public/js/lib/spotify.js';
import { duckVolume, duckDevice, shouldRestore, DUCK_FACTORS } from '../public/js/lib/duck.js';
import {
  BOOST_LEVELS, LIMITER, boostLevel, wantsBoost, mediaHost, boostableUrl, corsFor
} from '../public/js/lib/boost.js';

test('the player keeps whether Spotify may set the device volume', () => {
  const phone = slimPlayback({ is_playing: true, device: { id: 'p', name: 'iPhone', type: 'Smartphone', volume_percent: 100, supports_volume: false } });
  const mac = slimPlayback({ is_playing: true, device: { id: 'm', name: 'MacBook', type: 'Computer', volume_percent: 70, supports_volume: true } });
  assert.equal(phone.device.canVolume, false);
  assert.equal(mac.device.canVolume, true);
  assert.equal(mac.device.volume, 70);
});

test('Spotify on another device: lowered during the video, never a phone', () => {
  const play = device => ({ playing: true, device });
  const mac = { id: 'm', type: 'Computer', volume: 70, canVolume: true };
  assert.equal(duckDevice(play(mac)), mac);
  assert.equal(duckDevice(play({ ...mac, type: 'Speaker' }))?.id, 'm');
  assert.equal(duckDevice(play({ ...mac, type: 'Smartphone' })), null, 'the music on this phone: the video is raised instead');
  assert.equal(duckDevice(play({ ...mac, type: 'Tablet' })), null);
  assert.equal(duckDevice(play({ ...mac, canVolume: false })), null, 'supports_volume false');
  assert.equal(duckDevice({ playing: false, device: mac }), null, 'paused: nothing to lower');
  assert.equal(duckDevice(play({ ...mac, volume: null })), null, 'volume unknown');
  assert.equal(duckDevice(play(mac), new Set(['m'])), null, 'Spotify refused it once');
  assert.equal(duckDevice(null), null);

  assert.equal(duckVolume(70, 'medium'), 28);
  assert.equal(duckVolume(70, 'light'), 42);
  assert.equal(duckVolume(70, 'strong'), 18);
  assert.equal(duckVolume(70, 'off'), null);
  assert.equal(duckVolume(3, 'strong'), null, 'already almost silent');
  assert.equal(duckVolume(5, 'light'), null, 'would change nothing');
  assert.ok(Object.values(DUCK_FACTORS).every(f => f > 0 && f < 1));
});

test('the volume is put back unless it was changed by hand meanwhile', () => {
  const ducked = { device: 'm', before: 70, lowered: 28 };
  const at = volume => ({ playing: true, device: { id: 'm', type: 'Computer', volume, canVolume: true } });
  assert.equal(shouldRestore(ducked, at(28)), true, 'still lowered');
  assert.equal(shouldRestore(ducked, at(70)), true, 'a read made before the change');
  assert.equal(shouldRestore(ducked, at(50)), false, 'set by hand: kept');
  assert.equal(shouldRestore(ducked, { playing: true, device: { id: 'other', volume: 50 } }), true, 'another device now: put the first one back');
  assert.equal(shouldRestore(ducked, null), true);
  assert.equal(shouldRestore(null, at(28)), false);
});

// WebKit's DynamicsCompressorKernel (same code as Chromium's): static curve and automatic make-up gain.
const db2lin = d => Math.pow(10, d / 20);
const lin2db = x => 20 * Math.log10(x);
function compressor({ threshold, knee, ratio }) {
  const linT = db2lin(threshold);
  const kneeCurve = (x, k) => (x < linT ? x : linT + (1 - Math.exp(-k * (x - linT))) / k);
  const slopeAt = (x, k) => {
    if (x < linT) return 1;
    const x2 = x * 1.001;
    return (lin2db(kneeCurve(x2, k)) - lin2db(kneeCurve(x, k))) / (lin2db(x2) - lin2db(x));
  };
  const xk = db2lin(threshold + knee);
  let minK = 0.1, maxK = 10000, k = 5;
  for (let i = 0; i < 15; i++) { if (slopeAt(xk, k) < 1 / ratio) maxK = k; else minK = k; k = Math.sqrt(minK * maxK); }
  const kneeTdb = threshold + knee, kneeT = db2lin(kneeTdb), yKneeTdb = lin2db(kneeCurve(kneeT, k));
  const saturate = x => (x < kneeT ? kneeCurve(x, k) : db2lin(yKneeTdb + (lin2db(x) - kneeTdb) / ratio));
  const makeup = Math.pow(1 / saturate(1), 0.6);
  return x => saturate(x) * makeup;
}

test('boost levels: quiet videos well above the music, nothing past full scale', () => {
  const limiter = compressor(LIMITER);
  const out = (level, inDb) => {
    const lv = BOOST_LEVELS[level];
    return lin2db(limiter(compressor(lv)(db2lin(inDb + lv.pre))));
  };
  const lift = (level, inDb) => out(level, inDb) - inDb;
  // Quiet passages (peaks around -30 dBFS, common in videos): the more, the louder.
  assert.ok(lift('light', -30) > 7 && lift('light', -30) < 10, `light ${lift('light', -30)}`);
  assert.ok(lift('medium', -30) > 13 && lift('medium', -30) < 17, `medium ${lift('medium', -30)}`);
  assert.ok(lift('strong', -30) > 19 && lift('strong', -30) < 24, `strong ${lift('strong', -30)}`);
  assert.ok(lift('light', -30) < lift('medium', -30) && lift('medium', -30) < lift('strong', -30));
  // Loud passages stay below full scale (no clipping), even a file already at 0 dBFS.
  for (const level of Object.keys(BOOST_LEVELS)) {
    for (let inDb = -60; inDb <= 0; inDb += 1) assert.ok(out(level, inDb) < -0.5, `${level} at ${inDb} dB → ${out(level, inDb)}`);
  }
});

test('boost: only with the level on and the music mixed in', () => {
  const on = { videoBoost: 'medium', musicMix: true };
  assert.equal(wantsBoost({ settings: on, playingHere: true, available: true }), true, 'Spotify plays on this phone');
  assert.equal(wantsBoost({ settings: on, playingHere: null, available: true }), true, 'Spotify not connected: music may play');
  assert.equal(wantsBoost({ settings: on, playingHere: false, available: true }), false, 'no music here: the video keeps its own sound');
  assert.equal(wantsBoost({ settings: { ...on, videoBoost: 'off' }, playingHere: true, available: true }), false);
  assert.equal(wantsBoost({ settings: { ...on, musicMix: false }, playingHere: true, available: true }), false, 'the music is cut by videos');
  assert.equal(wantsBoost({ settings: on, playingHere: true, available: false }), false, 'no Web Audio');
  assert.equal(boostLevel({}), 'medium');
  assert.equal(boostLevel({ videoBoost: 'strong' }), 'strong');
  assert.equal(boostLevel({ videoBoost: 'bogus' }), 'medium');
});

test('boost: which files Web Audio may hear', () => {
  const page = new URL('https://searchx.example.workers.dev/');
  assert.equal(mediaHost('https://media.redgifs.com/Sample1.mp4', page), 'media.redgifs.com');
  assert.equal(mediaHost('/api/dl?url=x', page), 'self');
  assert.equal(mediaHost('http://cdn.example/a.mp4', page), '', 'no plain http from an https page');
  assert.equal(mediaHost('blob:https://x/1', page), '');
  assert.equal(boostableUrl('https://video.twimg.com/amplify_video/1/vid/avc1/720x1280/a.mp4?tag=29', page), true);
  assert.equal(boostableUrl('https://v.redd.it/x/HLSPlaylist.m3u8?a=1', page), false, 'HLS: iOS keeps its sound from Web Audio');
  assert.equal(boostableUrl('https://v.redd.it/x/HLSPlaylist.m3u8', page), false);

  const now = 1_000_000_000_000;
  const cache = {
    'video.twimg.com': { ok: true, t: now - 3600e3 },
    'media.redgifs.com': { ok: false, t: now - 3600e3 },
    'old.example': { ok: true, t: now - 8 * 24 * 3600e3 },
    'old-no.example': { ok: false, t: now - 7 * 3600e3 }
  };
  const ask = (url, failed = new Set()) => corsFor(url, { now, cache, page, failed });
  assert.equal(ask('https://video.twimg.com/a.mp4'), true);
  assert.equal(ask('https://media.redgifs.com/a.mp4'), false);
  assert.equal(ask('https://new.example/a.mp4'), null, 'never asked');
  assert.equal(ask('https://old.example/a.mp4'), null, 'asked more than a week ago');
  assert.equal(ask('https://old-no.example/a.mp4'), null, 'a refusal is asked again after 6 hours');
  assert.equal(ask('/same/origin.mp4'), true, 'same origin');
  assert.equal(ask('https://video.twimg.com/a.mp4', new Set(['video.twimg.com'])), false, 'failed in this session');
});

test('the video above the music is on by default', async () => {
  const { DEFAULT_SETTINGS } = await import('../public/js/config.js');
  assert.equal(DEFAULT_SETTINGS.videoBoost, 'medium');
});
