// Sound of SearchX's videos next to the music of other apps (Spotify, Apple Music…).
//
// By default iOS pauses the music as soon as a web page plays sound. With the Audio Session API
// (Safari 17+), the page can ask to be "ambient": the music keeps playing and the video's sound is
// mixed with it. iOS does not let web apps lower ("duck") another app's music ("transient" mixes the
// same way), and ambient sound follows the silent switch. So SearchX asks for it only when music may
// be playing: Spotify connected → only while Spotify plays on this phone; otherwise whenever the
// setting is on.
//
// The mode is set as soon as the app opens and kept up to date (not only when a SearchX video starts):
// the players of other sites shown inside the app (RedGIFs' own page, tube players) follow it too.
// Since the music can't be lowered here, SearchX's own player raises the video above it (boost.js).
import { state } from '../state.js';
import { musicPlayingHere, onMusicChange } from './spotify.js';

const session = typeof navigator !== 'undefined' ? navigator.audioSession : undefined;
export const AUDIO_SESSION = Boolean(session && typeof session === 'object' && 'type' in session);

export function shouldMixWithMusic({ settings = state.settings, playingHere = musicPlayingHere() } = {}) {
  if (!settings.musicMix) return false;
  return playingHere !== false; // unknown (Spotify not connected) → trust the setting
}

function setType(type) {
  if (!AUDIO_SESSION) return;
  try { if (session.type !== type) session.type = type; } catch { /* not allowed now: keep iOS's choice */ }
}

/** Applies the current choice ("ambient" while music may be playing and the setting is on). */
export function applyAudioPolicy() {
  setType(shouldMixWithMusic() ? 'ambient' : 'auto');
}

/** Call right before a video starts (or is unmuted) with sound. */
export function prepareVideoSound() {
  applyAudioPolicy();
}

/** The viewer was closed: the app-wide choice stays (embedded players and the next videos need it). */
export function resetVideoSound() {
  applyAudioPolicy();
}

let started = false;

/** From the app's start: now, whenever Spotify starts / stops, and when the app comes back. */
export function startAudioPolicy() {
  if (started || !AUDIO_SESSION) return;
  started = true;
  applyAudioPolicy();
  onMusicChange(applyAudioPolicy);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyAudioPolicy(); });
}
