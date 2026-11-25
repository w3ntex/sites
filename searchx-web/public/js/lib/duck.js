// Spotify playing on another device (computer, speaker, TV…): while a SearchX video plays with sound,
// that device's volume goes down, then back to where it was. Real "ducking", through the Web API.
//
// Not for this phone: Spotify cannot set an iPhone's volume (the device has supports_volume: false and
// the Web API answers VOLUME_CONTROL_DISALLOW), and the music playing here shares the phone's volume
// with the video anyway. There the video comes above the music instead (boost.js).
//
// A device is put back only if its volume is still the lowered one: a volume changed by hand meanwhile
// is kept. The lowered device is saved, so it is put back even if the app was closed during a video.
import { state } from '../state.js';
import { music, onMusicChange, setVolume } from './spotify.js';
import { load, save, remove } from './storage.js';

const KEY = 'spotify.duck';      // { device, before, lowered, t } while a device is lowered
const GRACE = 1500;              // a short pause (next video, seeking) keeps the music down
const STALE = 12 * 60 * 60 * 1000;

// Share of the device's volume kept during a video, per "Vidéo au-dessus de la musique" level.
export const DUCK_FACTORS = { light: 0.6, medium: 0.4, strong: 0.25 };

/** Volume (0–100) to lower to, or null when lowering would change nothing. */
export function duckVolume(volume, level) {
  const f = DUCK_FACTORS[level];
  if (!f || !Number.isFinite(volume) || volume <= 3) return null;
  const v = Math.max(1, Math.round(volume * f));
  return v < volume - 2 ? v : null;
}

/** The device to lower in this playback: playing, not a phone or tablet, volume settable. Else null. */
export function duckDevice(p, refused = new Set()) {
  const d = p?.device;
  if (!p?.playing || !d?.id || !d.canVolume || refused.has(d.id) || !Number.isFinite(d.volume)) return null;
  const type = String(d.type || '').toLowerCase();
  if (!type || type === 'smartphone' || type === 'tablet') return null;
  return d;
}

/**
 * Whether a lowered device should be put back. Not when its volume was changed by hand meanwhile.
 * A reading still at the old volume is a read made before the change: put back too.
 */
export function shouldRestore(ducked, p) {
  if (!ducked) return false;
  const d = p?.device;
  if (!d || d.id !== ducked.device || !Number.isFinite(d.volume)) return true;
  return Math.abs(d.volume - ducked.lowered) <= 2 || Math.abs(d.volume - ducked.before) <= 2;
}

const audible = new Set();       // what plays with sound right now: the SearchX player, embedded players
const refused = new Set();       // devices whose volume Spotify does not let us set
let ducked = load(KEY, null);
if (ducked && (!ducked.device || !(Date.now() - (ducked.t || 0) < STALE))) { ducked = null; remove(KEY); }
let timer = null;
let chain = Promise.resolve();   // one volume change at a time

function level() {
  return state.settings.videoBoost || 'medium';
}

async function lower() {
  if (ducked || !audible.size) return;
  const d = duckDevice(music.playback, refused);
  const target = d && duckVolume(d.volume, level());
  if (target == null) return;
  ducked = { device: d.id, before: d.volume, lowered: target, t: Date.now() };
  save(KEY, ducked);
  try {
    await setVolume(target, d.id);
  } catch (e) {
    if (e?.kind === 'volume' || e?.status === 403) refused.add(d.id);
    ducked = null;
    remove(KEY);
  }
}

async function restore({ keepalive = false, force = false } = {}) {
  const entry = ducked;
  if (!entry) return;
  if (!force && !music.updatedAt) return; // after a restart: wait for a first read of the player
  ducked = null;
  remove(KEY);
  if (!shouldRestore(entry, music.playback)) return;
  try { await setVolume(entry.before, entry.device, { keepalive }); } catch { /* device gone: nothing to put back */ }
}

function update() {
  const want = audible.size > 0 && level() !== 'off' && music.connected;
  if (want) {
    clearTimeout(timer);
    timer = null;
    if (!ducked) chain = chain.then(lower).catch(() => {});
    return;
  }
  if (ducked && !timer) {
    timer = setTimeout(() => {
      timer = null;
      chain = chain.then(() => restore()).catch(() => {});
    }, GRACE);
  }
}

/** A video starts (true) or stops (false) playing with sound. `source` tells the players apart. */
export function setVideoAudible(source, on) {
  if (on === audible.has(source)) return;
  if (on) audible.add(source);
  else audible.delete(source);
  update();
}

let started = false;

/** From the app's start: follows the music, puts the volume back when the app leaves the screen. */
export function startDuck() {
  if (started || typeof document === 'undefined') return;
  started = true;
  onMusicChange(update);
  const leave = () => {
    clearTimeout(timer);
    timer = null;
    if (ducked) restore({ keepalive: true, force: true });
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); else update(); });
  window.addEventListener('pagehide', leave);
  update();
}
