import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { cx, Sheet, Spinner, Switch, Segmented } from './common.js';
import { state, updateSettings, closeSheet, toast } from '../state.js';
import { haptic } from '../lib/haptics.js';
import { duration } from '../lib/format.js';
import {
  useMusic, music, musicCommand, progressNow, beginConnect, cancelConnect, resumeConnect, disconnect,
  redirectUri, savedClientId, isClientId, SPOTIFY_DASHBOARD, spotifyOpenUrl
} from '../lib/spotify.js';
import { AUDIO_SESSION, applyAudioPolicy } from '../lib/audio.js';
import { BOOST_AVAILABLE, applyBoostMix } from '../lib/boost.js';

// ---------- the island ----------
// iOS only lets native apps draw in the Dynamic Island (it shows Spotify's own controls there).
// SearchX draws its island around it: in the installed app on an iPhone with a Dynamic Island, a black
// pill wraps the real one and opens into a square of controls, like a Live Activity. Elsewhere it is a
// small floating pill at the top of the screen.

let geoCache = null;
function measure() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const sat = probe.offsetHeight || 0;
  probe.remove();
  const portrait = window.innerHeight >= window.innerWidth;
  // iPhones with a Dynamic Island have a top safe area of 51 px or more (notch: 44 to 50).
  return { hw: standalone && portrait && sat >= 51, top: Math.max(8, sat - 48), sat };
}

function useGeometry() {
  const [geo, setGeo] = useState(() => geoCache || (geoCache = measure()));
  useEffect(() => {
    const update = () => { geoCache = measure(); setGeo(geoCache); };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('orientationchange', update); };
  }, []);
  return geo;
}

function clock(ms) {
  return duration(ms / 1000) || '0:00';
}

export function Eq() {
  return html`<span class="isl-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
}

export function Art({ src, cls = '' }) {
  return src
    ? html`<img class=${cx('isl-art', cls)} src=${src} alt="" referrerpolicy="no-referrer" draggable="false" />`
    : html`<span class=${cx('isl-art', 'empty', cls)}><${Icon} name="music" size=${14} /></span>`;
}

export function ProgressBar({ p }) {
  const bar = useRef(null);
  const [drag, setDrag] = useState(null); // fraction while dragging
  const total = p.track.duration || 0;
  const now = drag != null ? drag * total : progressNow(p);
  const frac = total ? Math.min(1, now / total) : 0;
  const at = e => {
    const r = bar.current.getBoundingClientRect();
    return r.width ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0;
  };
  const canSeek = total > 0 && !p.disallows?.seeking;
  return html`<div class="isl-progress">
    <span>${clock(now)}</span>
    <div class=${cx('isl-bar', drag != null && 'dragging')} ref=${bar} style=${`--p:${frac}`}
      role="slider" aria-label="Position dans le titre" aria-valuemin="0" aria-valuemax=${Math.round(total / 1000)} aria-valuenow=${Math.round(now / 1000)}
      onPointerDown=${e => { if (!canSeek) return; e.stopPropagation(); try { bar.current.setPointerCapture(e.pointerId); } catch { /* ignore */ } setDrag(at(e)); }}
      onPointerMove=${e => { if (drag != null) setDrag(at(e)); }}
      onPointerUp=${async () => {
        if (drag == null) return;
        const ms = drag * total;
        setDrag(null);
        haptic();
        const err = await musicCommand('seek', ms);
        if (err) toast(err);
      }}
      onPointerCancel=${() => setDrag(null)}><i></i></div>
    <span>-${clock(Math.max(0, total - now))}</span>
  </div>`;
}

export function MusicIsland() {
  const m = useMusic();
  const geo = useGeometry();
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const p = m.playback;
  const track = p?.track;

  // While open and playing, the time moves every second (only the island re-renders).
  useEffect(() => {
    if (!open || !p?.playing) return;
    const t = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [open, p?.playing]);
  // Closes by itself after a while without a touch, like the real island.
  const idle = useRef(null);
  const touch = () => {
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setOpen(false), 9000);
  };
  useEffect(() => { if (open) touch(); else clearTimeout(idle.current); return () => clearTimeout(idle.current); }, [open]);
  useEffect(() => { if (!track) setOpen(false); }, [Boolean(track)]);
  // The mini player (no Dynamic Island) takes room above the tab bar: the page makes space for it.
  const floating = Boolean(m.connected && track && !geo.hw);
  useEffect(() => {
    document.documentElement.classList.toggle('float-island', floating);
    return () => document.documentElement.classList.remove('float-island');
  }, [floating]);

  if (!m.connected || !track) return null;

  const run = async (name, arg) => {
    haptic();
    touch();
    const err = await musicCommand(name, arg);
    if (err) toast(err);
  };
  const playing = p.playing;
  const note = m.error || (p.device?.name ? `Sur ${p.device.name}` : '');
  const style = geo.hw ? `--isl-top:${geo.top}px` : '';
  return html`
    ${open && html`<div class="isl-backdrop" onClick=${() => setOpen(false)} onTouchMove=${() => setOpen(false)}></div>`}
    <div class=${cx('island', geo.hw ? 'hw' : 'float', open ? 'open' : 'compact', playing && 'playing', open && m.error && 'has-note')}
      style=${style} onClick=${() => { if (!open) { haptic(); setOpen(true); } else touch(); }}
      role=${open ? 'dialog' : 'button'} aria-label=${open ? 'Lecteur Spotify' : `Musique : ${track.name}. Toucher pour les commandes`}>
      <div class="isl-compact" aria-hidden=${open ? 'true' : 'false'}>
        <${Art} src=${track.art} />
        ${!geo.hw && html`<span class="isl-ctext"><b>${track.name}</b>${track.artist ? ` · ${track.artist}` : ''}</span>`}
        ${playing ? html`<${Eq} />` : html`<span class="isl-paused"><${Icon} name="pause" size=${13} /></span>`}
      </div>
      <div class="isl-full" aria-hidden=${open ? 'false' : 'true'}>
        <div class="isl-top">
          <${Eq} />
          ${!geo.hw && html`<span class="isl-device">${p.device?.name ? `Spotify · ${p.device.name}` : 'Spotify'}</span>`}
          <a class="isl-brand" href=${spotifyOpenUrl(track)} aria-label="Ouvrir dans Spotify" onClick=${e => { e.stopPropagation(); haptic(); }}>
            <${Icon} name="spotify" size=${22} />
          </a>
        </div>
        <div class="isl-meta">
          <${Art} src=${track.art} cls="big" />
          <div class="isl-titles"><b>${track.name}</b><span>${track.artist}</span></div>
          ${!track.episode && html`<button type="button" class=${cx('isl-like', m.saved && 'on')} aria-label=${m.saved ? 'Retirer des titres likés' : 'Ajouter aux titres likés'}
            onClick=${e => { e.stopPropagation(); run('like'); }}><${Icon} name=${m.saved ? 'checkCircle' : 'plusCircle'} size=${24} /></button>`}
        </div>
        <${ProgressBar} p=${p} />
        <div class="isl-ctrls">
          <button type="button" class=${cx('isl-btn', p.shuffle ? 'on' : 'dim')} aria-label="Lecture aléatoire" disabled=${p.disallows?.toggling_shuffle}
            onClick=${e => { e.stopPropagation(); run('shuffle'); }}><${Icon} name="shuffle" size=${19} /></button>
          <button type="button" class="isl-btn" aria-label="Précédent" disabled=${p.disallows?.skipping_prev && p.disallows?.seeking}
            onClick=${e => { e.stopPropagation(); run('previous'); }}><${Icon} name="skipBack" size=${26} /></button>
          <button type="button" class="isl-btn main" aria-label=${playing ? 'Pause' : 'Lecture'}
            onClick=${e => { e.stopPropagation(); run('toggle'); }}><${Icon} name=${playing ? 'pause' : 'play'} size=${32} /></button>
          <button type="button" class="isl-btn" aria-label="Suivant" disabled=${p.disallows?.skipping_next}
            onClick=${e => { e.stopPropagation(); run('next'); }}><${Icon} name="skipForward" size=${26} /></button>
          <button type="button" class="isl-btn dim" aria-label="Réduire" onClick=${e => { e.stopPropagation(); haptic(); setOpen(false); }}>
            <${Icon} name="chevronUp" size=${22} /></button>
        </div>
        ${m.error ? html`<p class="isl-note bad">${m.error}</p>` : null}
      </div>
    </div>`;
}

// ---------- Réglages → Musique → Spotify ----------

function Copyable({ value, label }) {
  return html`<div class="copy-field">
    <code>${value}</code>
    <button type="button" class="btn small" onClick=${async () => {
      haptic();
      try { await navigator.clipboard.writeText(value); toast(`${label} copiée`); } catch { toast('Copie impossible : sélectionne le texte.'); }
    }}><${Icon} name="copy" size=${15} /> Copier</button>
  </div>`;
}

export function ConnectSteps({ page = false }) {
  const m = useMusic();
  const [clientId, setClientId] = useState(savedClientId());
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const redirect = redirectUri();

  const connect = async () => {
    haptic();
    setMsg('');
    try {
      location.href = await beginConnect(clientId);
    } catch (e) {
      setMsg(e.message);
    }
  };
  const paste = async setter => {
    haptic();
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (t) setter(t); else toast('Le presse-papiers est vide.');
    } catch {
      toast('Fais un appui long dans le champ, puis « Coller ».');
    }
  };
  const usePasted = async () => {
    haptic();
    setBusy(true);
    setMsg('');
    try {
      const ok = await resumeConnect({ poll: false, text: code });
      if (!ok) setMsg(music.error || 'Code non reconnu : touche à nouveau « Connecter Spotify ».');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (m.pending) {
    return html`
      <div class="music-wait"><${Spinner} size=${22} /><p>Termine la connexion sur la page Spotify (bouton <b>Accepter</b>), puis reviens ici : SearchX la reçoit tout seul.</p></div>
      <label class="field-label">La page Spotify t’a donné un code ? Colle-le ici</label>
      <div class="field-with-btn">
        <input class="field" type="text" placeholder="SX1.…" value=${code} onInput=${e => setCode(e.currentTarget.value.trim())}
          autocapitalize="off" autocorrect="off" spellcheck="false" />
        <button type="button" class="btn small ghost" onClick=${() => paste(setCode)}><${Icon} name="clipboard" size=${15} /> Coller</button>
      </div>
      ${(msg || m.error) && html`<p class="bad relay-msg">${msg || m.error}</p>`}
      <div class="sheet-buttons col">
        <button type="button" class="btn" disabled=${!code || busy} onClick=${usePasted}>${busy ? 'Connexion…' : 'Valider le code'}</button>
        <button type="button" class="btn ghost" onClick=${() => { haptic(); cancelConnect(); }}>Annuler</button>
      </div>`;
  }

  return html`
    ${!page && html`<p class="sheet-text">Pilote ta musique Spotify depuis SearchX : titre en cours, lecture, pause, précédent, suivant, aléatoire et « J’aime ».
      La musique joue dans l’app Spotify (Spotify ne permet pas à une autre app de la jouer sur iPhone).</p>`}
    <p class="music-req"><${Icon} name="info" size=${15} /><span>Spotify demande un compte <b>Premium</b> et une petite « app développeur » gratuite (3 minutes, une seule fois).</span></p>
    <ol class=${cx('steps', page && 'step-cards')}>
      <li>Ouvre <a href=${SPOTIFY_DASHBOARD} target="_blank" rel="noopener noreferrer">developer.spotify.com/dashboard</a> et connecte-toi avec ton compte Spotify (accepte les conditions la première fois).</li>
      <li>Touche <b>Create app</b>. Nom : <b>SearchX</b>, description : <b>Télécommande</b>. Dans <b>Redirect URIs</b>, colle cette adresse puis touche <b>Add</b> :
        <${Copyable} value=${redirect} label="Adresse" /></li>
      <li>Coche <b>Web API</b>, accepte les conditions et touche <b>Save</b>.</li>
      <li>Dans l’app créée, ouvre <b>Settings</b>, copie le <b>Client ID</b> et colle-le ici :</li>
    </ol>
    <label class="field-label">Client ID</label>
    <div class="field-with-btn">
      <input class="field" type="text" inputmode="text" placeholder="32 caractères" value=${clientId} maxlength="40"
        onInput=${e => setClientId(e.currentTarget.value.trim())} autocapitalize="off" autocorrect="off" spellcheck="false" />
      <button type="button" class="btn small ghost" onClick=${() => paste(setClientId)}><${Icon} name="clipboard" size=${15} /> Coller</button>
    </div>
    ${(msg || m.error) && html`<p class="bad relay-msg">${msg || m.error}</p>`}
    <div class="sheet-buttons col">
      <button type="button" class=${cx('btn spotify', page && 'big')} disabled=${!isClientId(clientId)} onClick=${connect}><${Icon} name="spotify" size=${18} /> Connecter Spotify</button>
    </div>
    <p class="sheet-hint">Si Spotify affiche « not registered » ou « not allowed » : dans ton app Spotify → <b>User Management</b>, ajoute l’e-mail de ton compte Spotify.
      Les jetons restent sur ce téléphone ; SearchX ne voit jamais ton mot de passe.</p>`;
}

function Connected() {
  const m = useMusic();
  const s = state.settings;
  const track = m.playback?.track;
  return html`
    <div class="music-now">
      <${Art} src=${track?.art} cls="big" />
      <div class="music-now-text">
        <b>${track ? track.name : 'Rien en lecture'}</b>
        <span>${track ? [track.artist, m.playback.device?.name].filter(Boolean).join(' · ') : 'Lance une musique dans Spotify : elle s’affiche ici et dans l’île.'}</span>
      </div>
    </div>
    ${m.error && html`<p class="bad relay-msg">${m.error}</p>`}
    <div class="sheet-buttons col">
      <a class="btn spotify" href=${spotifyOpenUrl(track)} onClick=${() => haptic()}><${Icon} name="spotify" size=${18} /> Ouvrir Spotify</a>
    </div>
    <div class="group-body music-opts">
      <div class="row">
        <span class="row-text"><span class="row-title">Île musicale</span><span class="row-sub">En haut de l’écran, autour de la Dynamic Island. Touche-la pour les commandes.</span></span>
        <span class="row-right"><${Switch} checked=${s.musicIsland} onChange=${v => updateSettings({ musicIsland: v })} label="Île musicale" /></span>
      </div>
      <${MixRow} />
      <${BoostRow} />
    </div>
    <div class="sheet-buttons col">
      <button type="button" class="btn ghost danger-text" onClick=${() => { haptic(); disconnect(); toast('Spotify déconnecté'); }}>Déconnecter Spotify</button>
    </div>`;
}

/** "Musique pendant les vidéos" switch, shared by the sheet and the settings tab. */
export function MixRow({ inGroup = false }) {
  const s = state.settings;
  const m = useMusic();
  const sub = !AUDIO_SESSION
    ? 'Pas disponible sur ce navigateur (iOS 17 ou plus récent nécessaire).'
    : m.connected
      ? 'Ta musique n’est plus coupée par les vidéos : elle continue, mélangée à leur son (quand Spotify joue).'
      : 'Ta musique n’est plus coupée par les vidéos : elle continue, mélangée à leur son. En mode silencieux, le son des vidéos est alors coupé.';
  return html`<div class=${cx('row', inGroup && 'in-group')}>
    ${inGroup && html`<span class="row-icon" style="background:#1db954"><${Icon} name="volume" size=${17} /></span>`}
    <span class="row-text"><span class="row-title">Musique pendant les vidéos</span><span class="row-sub">${sub}</span></span>
    <span class="row-right"><${Switch} checked=${AUDIO_SESSION && s.musicMix} disabled=${!AUDIO_SESSION} onChange=${v => { updateSettings({ musicMix: v }); applyAudioPolicy(); applyBoostMix(); }} label="Musique pendant les vidéos" /></span>
  </div>`;
}

const BOOST_OPTIONS = [['off', 'Non'], ['light', 'Léger'], ['medium', 'Moyen'], ['strong', 'Fort']];

/**
 * "Vidéo au-dessus de la musique": Spotify on another device is lowered during videos; on this phone,
 * where iOS lets no web app lower another app, the video's sound is raised above the music.
 */
export function BoostRow({ inGroup = false }) {
  const s = state.settings;
  useMusic();
  const level = s.videoBoost || 'medium';
  const phone = BOOST_AVAILABLE && AUDIO_SESSION;
  let sub;
  if (level === 'off') sub = 'La vidéo et la musique gardent chacune leur volume.';
  else if (!phone) sub = 'Spotify sur un ordi, une enceinte ou une TV baisse pendant les vidéos, puis revient.';
  else if (!s.musicMix) sub = 'Spotify sur un ordi, une enceinte ou une TV baisse pendant les vidéos. Sur l’iPhone, la musique est coupée par les vidéos (option ci-dessus).';
  else sub = 'Sur l’iPhone, iOS interdit aux web apps de baisser Spotify : SearchX monte donc le son de la vidéo au-dessus de la musique, sans saturer. Sur un ordi, une enceinte ou une TV, c’est Spotify qui baisse, puis revient.';
  return html`<div class=${cx('row', 'boost-row', inGroup && 'in-group')}>
    ${inGroup && html`<span class="row-icon" style="background:#1db954"><${Icon} name="sliders" size=${17} /></span>`}
    <div class="row-text">
      <span class="row-title">Vidéo au-dessus de la musique</span>
      <span class="row-sub">${sub}</span>
      <${Segmented} value=${level} options=${BOOST_OPTIONS} onChange=${v => { updateSettings({ videoBoost: v }); applyBoostMix(); }} />
    </div>
  </div>`;
}

export function SpotifySheet() {
  const m = useMusic();
  return html`<${Sheet} title="Spotify" onClose=${closeSheet} tall>
    ${m.connected ? html`<${Connected} />` : html`<${ConnectSteps} />`}
  <//>`;
}
