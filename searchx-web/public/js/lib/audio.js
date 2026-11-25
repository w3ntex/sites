// Sound of SearchX's videos next to the music of other apps (Spotify, Apple Music…).
//
// By default iOS pauses the music as soon as a web page plays sound. With the Audio Session API
// (Safari 17+), the page can ask to be "ambient": the music keeps playing and the video's sound is
// mixed with it. iOS does not let web apps lower ("duck") another app's music, and ambient sound
// follows the silent switch. So SearchX only asks for it when music is playing: Spotify connected →
// only while Spotify plays on this phone; otherwise whenever the setting is on.
import { state } from '../state.js';
import { musicPlayingHere } from './spotify.js';

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

/** Call right before a video starts (or is unmuted) with sound. */
export function prepareVideoSound() {
  setType(shouldMixWithMusic() ? 'ambient' : 'auto');
}

/** Back to the default once the viewer is closed. */
export function resetVideoSound() {
  setType('auto');
}
