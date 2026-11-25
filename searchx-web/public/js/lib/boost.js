// "Vidéo au-dessus de la musique" on this phone.
//
// iOS does not let a web app lower ("duck") the music of another app: WebKit's audio session never asks
// for AVAudioSession's duckOthers option ("ambient" and "transient" both mix at full volume), and the
// Spotify Web API refuses to set an iPhone's volume. So SearchX does the reverse: while music may be
// playing, its own player sends the video's sound through Web Audio (gain, compressor, limiter), which
// lifts it well above the music without clipping. When the music stops, the video gets back its own
// sound. (Spotify playing on another device is really lowered: duck.js.)
//
// Web Audio only hears a video whose server allows it (CORS), otherwise the sound would be silent. So
// the boosted <video> is a separate element with crossOrigin="anonymous", used for the files whose host
// answers with CORS (checked once per host), and never for HLS (.m3u8), which iOS keeps from Web Audio.
// A watchdog goes back to the plain element if the boosted one stays silent or frozen.
import { state } from '../state.js';
import { load, save } from './storage.js';
import { onMusicChange, musicPlayingHere } from './spotify.js';
import { shouldMixWithMusic } from './audio.js';

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : undefined;
export const BOOST_AVAILABLE = Boolean(AC);

// Pre-gain (dB), then a compressor whose automatic make-up gain lifts the quiet parts, then a limiter.
// With WebKit's compressor, quiet passages get about +8 dB (light), +15 dB (medium), +21 dB (strong);
// loud ones stay below full scale (test/music.test.mjs checks the static curve).
export const BOOST_LEVELS = {
  light: { pre: 4, threshold: -10, knee: 6, ratio: 4 },
  medium: { pre: 9, threshold: -12, knee: 6, ratio: 8 },
  strong: { pre: 14, threshold: -14, knee: 6, ratio: 12 }
};
export const BOOST_TIMING = { attack: 0.003, release: 0.25 };
export const LIMITER = { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.1 };

export function boostLevel(settings = state.settings) {
  const l = settings?.videoBoost;
  if (l === 'off' || BOOST_LEVELS[l]) return l;
  return 'medium';
}

/** Whether the video should come above the music now: level on, music mixed in (it may be playing here). */
export function wantsBoost({ settings = state.settings, playingHere = musicPlayingHere(), available = BOOST_AVAILABLE } = {}) {
  return Boolean(available) && !broken && boostLevel(settings) !== 'off' && shouldMixWithMusic({ settings, playingHere });
}

// ---------- which files ----------

const here = () => (typeof location !== 'undefined' ? location : null);

/** Host of a media URL that may be boosted ('' if not: not https, unreadable). Same-origin: 'self'. */
export function mediaHost(url, page = here()) {
  try {
    const u = new URL(url, page?.href);
    if (page && u.origin === page.origin) return 'self';
    if (u.protocol !== 'https:' && !(page?.protocol === 'http:' && u.protocol === 'http:')) return '';
    return u.host.toLowerCase();
  } catch {
    return '';
  }
}

/** Files Web Audio can hear: http(s) files, not HLS streams (iOS keeps their sound from Web Audio). */
export function boostableUrl(url, page = here()) {
  return Boolean(mediaHost(url, page)) && !/\.m3u8(?:[?#]|$)/i.test(String(url));
}

const CORS_KEY = 'cors';                     // { [host]: { ok, t } }
const CORS_OK_TTL = 7 * 24 * 3600 * 1000;
const CORS_NO_TTL = 6 * 3600 * 1000;
let corsCache = load(CORS_KEY, {}) || {};
const failedHosts = new Set();               // boosted playback went wrong there in this session
const silentCount = new Map();               // host → boosted files that stayed silent
const probes = new Map();
let broken = false;                          // the boosted element froze: plain player for this session

/** Whether a host answers with CORS: true / false, or null when unknown (or too old). */
export function corsFor(url, { now = Date.now(), cache = corsCache, page = here(), failed = failedHosts } = {}) {
  const host = mediaHost(url, page);
  if (!host || failed.has(host)) return false;
  if (host === 'self') return true;
  const e = cache[host];
  if (!e || typeof e.t !== 'number') return null;
  return now - e.t < (e.ok ? CORS_OK_TTL : CORS_NO_TTL) ? Boolean(e.ok) : null;
}

function keepCors(host, ok) {
  corsCache = { ...corsCache, [host]: { ok, t: Date.now() } };
  const hosts = Object.keys(corsCache);
  if (hosts.length > 60) for (const h of hosts.sort((a, b) => corsCache[a].t - corsCache[b].t).slice(0, hosts.length - 60)) delete corsCache[h];
  save(CORS_KEY, corsCache);
}

/** Asks the file's host once (HEAD, CORS mode): does it let Web Audio hear its files? */
export function probeCors(url, timeout = 2500) {
  const host = mediaHost(url);
  if (!host) return Promise.resolve(false);
  if (host === 'self') return Promise.resolve(true);
  if (probes.has(host)) return probes.get(host);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctrl?.abort(), timeout);
  const p = fetch(url, { method: 'HEAD', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: ctrl?.signal })
    .then(() => true, () => (ctrl?.signal.aborted || (typeof navigator !== 'undefined' && navigator.onLine === false) ? null : false))
    .then(ok => {
      clearTimeout(t);
      probes.delete(host);
      if (ok !== null) keepCors(host, ok);
      return Boolean(ok);
    });
  probes.set(host, p);
  return p;
}

/** The boosted player failed with this file: plain player for its host (or for everything) this session. */
export function boostFailed(url, reason) {
  if (reason === 'frozen') { broken = true; return; }
  if (reason === 'context') return; // the audio context stopped: it comes back with the next tap
  const host = mediaHost(url);
  if (!host || host === 'self') return;
  // One silent file may just start with silence; a second one means this host does not work.
  if (reason === 'silent') {
    const n = (silentCount.get(host) || 0) + 1;
    silentCount.set(host, n);
    if (n < 2) return;
  }
  failedHosts.add(host);
}

// ---------- the audio graph ----------

let ctx = null;
let resuming = null;
let graph = null; // { el, analyser, dry, pre, comp, limiter, wet, meter }

function context(create) {
  if (ctx || !create || !AC) return ctx;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch { try { ctx = new AC(); } catch { ctx = null; } }
  return ctx;
}

/** During a tap (viewer opened, play, sound): starts the audio context, which iOS only allows then. */
export function wakeBoost() {
  if (!wantsBoost()) return;
  const c = context(true);
  if (!c || c.state === 'running' || c.state === 'closed') return;
  try {
    const r = c.resume();
    resuming = Promise.resolve(r).catch(() => {}).finally(() => { resuming = null; });
  } catch { /* stays suspended: plain player */ }
}

/** The viewer closed: no audio work until the next video. */
export function sleepBoost() {
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

async function contextReady(wait = 800) {
  const c = ctx;
  if (!c) return false;
  if (c.state !== 'running' && resuming) await Promise.race([resuming, new Promise(r => setTimeout(r, wait))]);
  return c.state === 'running';
}

/**
 * Whether the next video should play on the boosted element: true / false when known now, else a promise
 * (first file of a host, audio context still starting).
 */
export function boostRoute(url) {
  if (!wantsBoost() || !boostableUrl(url)) return false;
  const known = corsFor(url);
  // No audio context started by a tap: nothing to send the sound to.
  if (known === false || !ctx || (ctx.state !== 'running' && !resuming)) return false;
  if (known === true && ctx.state === 'running') return true;
  return Promise.all([known === true || probeCors(url), contextReady()])
    .then(([ok, ready]) => Boolean(ok && ready && wantsBoost()), () => false);
}

const dbToGain = db => Math.pow(10, db / 20);

function setCompressor(node, p) {
  const t = ctx.currentTime;
  for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) {
    if (p[k] == null || !node[k]) continue;
    try { node[k].setValueAtTime(p[k], t); } catch { node[k].value = p[k]; }
  }
}

function glide(param, v, instant) {
  const t = ctx.currentTime;
  try {
    param.cancelScheduledValues(t);
    if (instant) param.setValueAtTime(v, t);
    else param.setTargetAtTime(v, t, 0.12);
  } catch {
    param.value = v;
  }
}

function mix(instant = false) {
  if (!graph || !ctx) return;
  const on = wantsBoost();
  const lv = BOOST_LEVELS[boostLevel()] || BOOST_LEVELS.medium;
  glide(graph.pre.gain, dbToGain(lv.pre), instant);
  setCompressor(graph.comp, { ...lv, ...BOOST_TIMING });
  glide(graph.wet.gain, on ? 1 : 0, instant);
  glide(graph.dry.gain, on ? 0 : 1, instant);
}

/** The level or the music changed: the video follows (back to its own sound when the music stops). */
export function applyBoostMix() {
  mix(false);
}

/**
 * Sends the boosted element's sound through the graph. Once only: a media element cannot leave
 * Web Audio afterwards, which is why the plain element exists. Returns false if it cannot be done.
 */
export function attachBoost(el) {
  if (graph) return graph.el === el;
  if (!ctx || !el) return false;
  try {
    // video → analyser ─┬─ dry ─────────────────────────────┬─ meter → speakers
    //                   └─ pre → compressor → limiter → wet ┘
    const src = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const dry = ctx.createGain();
    const pre = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    const limiter = ctx.createDynamicsCompressor();
    const wet = ctx.createGain();
    const meter = ctx.createAnalyser();
    meter.fftSize = 1024;
    src.connect(analyser);
    analyser.connect(dry);
    dry.connect(meter);
    analyser.connect(pre);
    pre.connect(comp);
    comp.connect(limiter);
    limiter.connect(wet);
    wet.connect(meter);
    meter.connect(ctx.destination);
    graph = { el, analyser, dry, pre, comp, limiter, wet, meter };
    setCompressor(limiter, LIMITER);
    mix(true);
    onMusicChange(() => mix(false));
    return true;
  } catch {
    return false;
  }
}

function hasAudio(el) {
  if (el.audioTracks && typeof el.audioTracks.length === 'number') return el.audioTracks.length > 0;
  if (typeof el.webkitAudioDecodedByteCount === 'number') return el.webkitAudioDecodedByteCount > 0;
  if (typeof el.mozHasAudio === 'boolean') return el.mozHasAudio;
  return false; // unknown: no silence check
}

/**
 * Watches the boosted element while it plays: onFail(reason) if the audio context is not running while
 * the sound is on ('context'), the picture stays frozen ('frozen'), or the sound stays silent although
 * the file has some ('silent'). Returns the function that stops watching.
 */
export function watchBoost(el, onFail) {
  if (!graph || graph.el !== el) return () => {};
  let last = -1, still = 0, silent = 0, heard = false;
  const id = setInterval(() => {
    if (el.paused || el.ended || el.readyState < 3) { still = 0; return; }
    if (!ctx || ctx.state !== 'running') {
      if (!el.muted) { clearInterval(id); onFail('context'); }
      return;
    }
    if (el.currentTime === last) {
      still += 500;
      if (still >= 4000) { clearInterval(id); onFail('frozen'); return; }
    } else { still = 0; last = el.currentTime; }
    if (el.muted || heard || !hasAudio(el)) return;
    if (peakOf(graph.analyser) > 1e-5) { heard = true; return; }
    silent += 500;
    if (silent >= 4000) { clearInterval(id); onFail('silent'); }
  }, 500);
  return () => clearInterval(id);
}

function peakOf(node) {
  if (!node) return 0;
  const buf = new Float32Array(node.fftSize);
  try { node.getFloatTimeDomainData(buf); } catch { return 0; }
  let peak = 0;
  for (const x of buf) { const a = x < 0 ? -x : x; if (a > peak) peak = a; }
  return peak;
}

/** What the boost is doing (diagnostics, tests): levels are the last ~20 ms, in and out of the graph. */
export function boostStatus() {
  return {
    available: BOOST_AVAILABLE,
    context: ctx?.state || 'none',
    attached: Boolean(graph),
    wanted: wantsBoost(),
    level: boostLevel(),
    broken,
    wet: graph ? graph.wet.gain.value : 0,
    inPeak: peakOf(graph?.analyser),
    outPeak: peakOf(graph?.meter)
  };
}
