import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Group, Row, Switch, Sheet, SourceBadge, Spinner, cx } from './common.js';
import { PinSetupSheet } from './lock.js';
import { state, notify, updateSettings, openSheet, closeSheet, toast, lockEnabled, lockNow, switchTab } from '../state.js';
import { SOURCES, LOCK_DELAYS, INSTALL_ICONS, APP_VERSION, LAYOUTS, MODES, modeOf, modeSources } from '../config.js';
import { clearRecent, disableSources, enableSource } from '../search.js';
import { switchMode } from './search-tab.js';
import { RelaySheet } from './relay.js';
import { SpotifySheet, MixRow } from './music.js';
import { useMusic } from '../lib/spotify.js';
import { clearHistory, exportData, importData } from '../library.js';
import { searchSource, health, resetDirect } from '../api.js';
import { biometricsAvailable, registerBiometrics } from '../lib/lock.js';
import { applyInstallIcon, isStandalone } from '../lib/install.js';
import { haptic } from '../lib/haptics.js';

function parseR34(text) {
  const t = String(text || '').replace(/\s+/g, '');
  const key = (/api_key=([^&]+)/.exec(t) || [])[1];
  const user = (/user_id=([^&]+)/.exec(t) || [])[1];
  return { key: key || '', user: user || '' };
}

function Rule34Sheet() {
  const s = state.settings;
  const [line, setLine] = useState('');
  const [key, setKey] = useState(s.r34key);
  const [user, setUser] = useState(s.r34user);
  const onPaste = v => {
    setLine(v);
    const p = parseR34(v);
    if (p.key) setKey(p.key);
    if (p.user) setUser(p.user);
  };
  const ok = key.trim() && user.trim();
  return html`<${Sheet} title="Identifiants Rule34" onClose=${closeSheet}>${close => html`
    <p class="sheet-text">Sur <b>rule34.xxx</b> → My Account → Options → <b>API Access Credentials</b> (coche « Generate New Key » puis Save si c'est vide). Copie toute la ligne et colle-la ici :</p>
    <textarea class="field" rows="3" placeholder="&api_key=…&user_id=…" value=${line} onInput=${e => onPaste(e.currentTarget.value)}
      autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
    <label class="field-label">Clé API</label>
    <input class="field" type="text" value=${key} onInput=${e => setKey(e.currentTarget.value.trim())} autocapitalize="off" autocorrect="off" spellcheck="false" />
    <label class="field-label">User ID</label>
    <input class="field" type="text" inputmode="numeric" value=${user} onInput=${e => setUser(e.currentTarget.value.trim())} />
    ${ok && html`<p class="ok-line"><${Icon} name="check" size=${16} /> Identifiants détectés (utilisateur ${user})</p>`}
    <div class="sheet-buttons col">
      <button type="button" class="btn" disabled=${!ok && !(s.r34key || s.r34user)}
        onClick=${() => { updateSettings({ r34key: key.trim(), r34user: user.trim() }); toast(ok ? 'Rule34 configuré' : 'Identifiants effacés'); close(); }}>
        ${ok ? 'Enregistrer' : 'Effacer les identifiants'}
      </button>
    </div>`}<//>`;
}

const TEST_QUERY = { porn: 'blonde', hentai: 'elf' };

function TestSheet() {
  const mode = modeOf(state.settings);
  const LIST = modeSources(mode);
  const q = TEST_QUERY[mode];
  const [run, setRun] = useState(0);
  const [rows, setRows] = useState(() => Object.fromEntries(LIST.map(s => [s, { state: 'loading' }])));
  useEffect(() => {
    let alive = true;
    setRows(Object.fromEntries(LIST.map(s => [s, { state: 'loading' }])));
    resetDirect(); // really try the phone path again on every test
    for (const src of LIST) {
      const t0 = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort('timeout'), 35000);
      searchSource(src, { q, page: 1, sort: 'relevance', media: 'all', dur: 'any', hd: 'any', cursor: '', fresh: true }, ctrl.signal)
        .then(r => ({ state: r.items.length ? 'ok' : 'empty', count: r.items.length, ms: performance.now() - t0, via: r.via }))
        .catch(e => ({ state: 'error', error: ctrl.signal.reason === 'timeout' ? 'Pas de réponse en 35 s.' : e.message, debug: e.debug, phone: e.phone }))
        .then(res => { clearTimeout(timer); if (alive) setRows(r => ({ ...r, [src]: res })); });
    }
    return () => { alive = false; };
  }, [run]);
  const failing = LIST.filter(src => rows[src].state === 'error' || rows[src].state === 'empty');
  const done = LIST.every(src => rows[src].state !== 'loading');
  const enabledFailing = failing.filter(src => state.filters.sources.includes(src));
  return html`<${Sheet} title="Test des sources" onClose=${closeSheet} tall
    actions=${html`<button type="button" class="text-btn" disabled=${!done} onClick=${() => { haptic(); setRun(n => n + 1); }}>Relancer</button>`}>
    <p class="sheet-text">Recherche « ${q} » sur chaque site du mode ${MODES[mode].label.toLowerCase()}. <b>Téléphone</b> = appel direct depuis ton iPhone, <b>serveur</b> = via Cloudflare.</p>
    <div class="test-list">
      ${LIST.map(src => {
        const r = rows[src];
        return html`<div class="test-row" key=${src}>
          <${SourceBadge} src=${src} />
          <div class="test-text">
            <strong>${SOURCES[src].name}${state.filters.sources.includes(src) ? '' : html` <small class="muted">(désactivée)</small>`}</strong>
            ${r.state === 'ok' && html`<span class="good">${r.count} résultats · ${(r.ms / 1000).toFixed(1)} s · via ${r.via === 'phone' ? 'téléphone' : 'serveur'}</span>`}
            ${r.state === 'empty' && html`<span class="bad">Aucun résultat (réponse vide) · via ${r.via === 'phone' ? 'téléphone' : 'serveur'}</span>`}
            ${r.state === 'error' && html`<span class="bad">${r.error}</span>`}
            ${r.state === 'error' && (r.debug || r.phone) && html`<span class="debug">${r.phone ? `Téléphone : ${r.phone}. ` : ''}${r.debug ? `Serveur : ${r.debug}` : ''}</span>`}
            ${r.state === 'loading' && html`<span class="muted">Test en cours…</span>`}
          </div>
          ${r.state === 'loading' ? html`<${Spinner} />` : html`<${Icon} name=${r.state === 'ok' ? 'check' : 'warn'} size=${20} class=${r.state === 'ok' ? 'good' : 'bad'} />`}
        </div>`;
      })}
    </div>
    ${done && enabledFailing.length ? html`<div class="sheet-buttons col">
      <button type="button" class="btn ghost" onClick=${() => { haptic(); disableSources(enabledFailing); toast(`${enabledFailing.length} source${enabledFailing.length > 1 ? 's' : ''} désactivée${enabledFailing.length > 1 ? 's' : ''}`); }}>
        Désactiver les sources en échec (${enabledFailing.map(s => SOURCES[s].name).join(', ')})
      </button>
    </div>` : null}
    <p class="sheet-hint">Fais une capture de cet écran et envoie-la pour que les sources en échec soient corrigées.</p>
  <//>`;
}

function ServerSheet() {
  const [key, setKey] = useState(state.settings.accessKey);
  const [info, setInfo] = useState(null);
  const check = async () => {
    setInfo({ state: 'loading' });
    try { const h = await health(); setInfo({ state: 'ok', h }); } catch (e) { setInfo({ state: 'error', error: e.message }); }
  };
  useEffect(() => { check(); }, []);
  return html`<${Sheet} title="Serveur SearchX" onClose=${closeSheet}>${close => html`
    <div class="test-row">
      <span class="row-icon" style="background:#30a46c"><${Icon} name="server" size=${17} /></span>
      <div class="test-text">
        <strong>${location.host}</strong>
        ${info?.state === 'ok' && html`<span class="good">En ligne · version ${info.h.version}${info.h.locked ? ' · protégé par clé' : ''}</span>`}
        ${info?.state === 'error' && html`<span class="bad">${info.error}</span>`}
        ${info?.state === 'loading' && html`<span class="muted">Vérification…</span>`}
      </div>
    </div>
    <label class="field-label">Clé d'accès (seulement si tu as défini ACCESS_KEY sur Cloudflare)</label>
    <input class="field" type="text" value=${key} onInput=${e => setKey(e.currentTarget.value.trim())} autocapitalize="off" autocorrect="off" spellcheck="false" />
    <div class="sheet-buttons col">
      <button type="button" class="btn" onClick=${() => { updateSettings({ accessKey: key }); check(); toast('Enregistré'); }}>Enregistrer et tester</button>
    </div>`}<//>`;
}

async function exportBackup() {
  const data = JSON.stringify(exportData(), null, 1);
  const name = `searchx-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([data], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Sauvegarde SearchX' }); return; }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Réglages → Musique: Spotify remote, island, music during videos. */
function MusicGroup() {
  const m = useMusic();
  const s = state.settings;
  const now = m.playback?.track;
  return html`<${Group} title="Musique" footer="Pendant une vidéo, ta musique continue au même volume : iOS réserve la baisse automatique (comme sur Reddit) aux apps de l’App Store. Astuce : dans Spotify → Paramètres et confidentialité → Lecture, mets le niveau du volume sur « Faible » : la musique restera plus douce que les vidéos. La vraie Dynamic Island est aussi réservée aux apps de l’App Store : SearchX ajoute sa propre île juste autour.">
    <${Row} icon="spotify" iconColor="#1db954" title="Spotify" chevron
      subtitle=${m.connected ? (now ? `${now.name} · ${now.artist}` : 'Connecté · rien en lecture') : 'Contrôle ta musique depuis SearchX (Premium)'}
      right=${m.connected ? 'Connecté' : m.pending ? 'En cours…' : 'À connecter'}
      onClick=${() => switchTab('music')} />
    ${m.connected && html`<${Row} icon="music" iconColor="#1db954" title="Île musicale" subtitle="En haut de l’écran ; touche-la pour les commandes."
      right=${html`<${Switch} checked=${s.musicIsland} onChange=${v => updateSettings({ musicIsland: v })} label="Île musicale" />`} />`}
    <${MixRow} inGroup />
  <//>`;
}

export function SettingsTab() {
  const s = state.settings;
  const [bioOK, setBioOK] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { biometricsAvailable().then(setBioOK); }, []);

  const setPinEnabled = on => {
    if (on) openSheet('custom', { render: () => html`<${PinSetupSheet} />` });
    else { updateSettings({ pinHash: null, pinSalt: null }); toast(state.settings.bioId ? 'Code désactivé (Face ID reste actif)' : 'Verrouillage désactivé'); }
  };
  const setBio = async on => {
    if (!on) { updateSettings({ bioId: null }); return; }
    try {
      const id = await registerBiometrics();
      updateSettings({ bioId: id, lockDelay: state.settings.lockDelay || 0 });
      toast("Face ID activé : demandé à chaque ouverture");
    } catch (e) {
      toast(e?.name === 'NotAllowedError' ? 'Face ID annulé.' : `Face ID indisponible : ${e?.message || e}`);
    }
  };
  // A new key (e.g. into Apple's Passwords instead of Chrome, which adds its own steps to each unlock).
  const renewBio = async () => {
    try {
      const id = await registerBiometrics();
      updateSettings({ bioId: id });
      toast('Nouvelle clé Face ID enregistrée');
    } catch (e) {
      toast(e?.name === 'NotAllowedError' ? 'Annulé : l’ancienne clé reste active.' : `Face ID indisponible : ${e?.message || e}`);
    }
  };
  const setIcon = key => {
    haptic();
    updateSettings({ installIcon: key });
    applyInstallIcon(key);
    toast(isStandalone() ? "Supprime l'icône actuelle puis ré-ajoute SearchX depuis Safari." : `Prêt : ajoute à l'écran d'accueil (« ${INSTALL_ICONS[key].name} »).`);
  };
  const onImport = async e => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      const res = importData(JSON.parse(await f.text()));
      toast(`Importé : ${res.favorites} favoris, ${res.playlists} playlists`);
    } catch (err) {
      toast(err.message || 'Fichier invalide.');
    }
  };
  const clearCache = async () => {
    try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignore */ }
    toast('Cache vidé, rechargement…');
    setTimeout(() => location.reload(), 700);
  };
  const r34ok = s.r34key && s.r34user;
  const mode = modeOf(s);

  return html`<div class="tab">
    <header class="topbar plain"><h1 class="page-title" data-jp="設定">Réglages</h1></header>
    <main class="content settings">
      ${!isStandalone() && html`<div class="install-card compact">
        <div class="install-icon"><img src=${INSTALL_ICONS[s.installIcon]?.icon || 'icons/app-180.png'} alt="" /></div>
        <div><strong>Installer l'app</strong><p>Safari → <span class="kbd"><${Icon} name="share" size=${13} /></span> → « Sur l'écran d'accueil ». Les réglages de l'app installée sont séparés de ceux de Safari.</p></div>
      </div>`}

      <div class="mode-card">
        <p class="mode-card-title">Mode</p>
        <div class="mode-pick">
          ${Object.entries(MODES).map(([k, m]) => html`<button type="button" key=${k} class=${cx('mode-opt', `m-${k}`, mode === k && 'on')}
            onClick=${e => switchMode(k, e)}>
            <span class="mode-opt-icon"><${Icon} name=${m.icon} size=${22} /></span>
            <strong>${m.label}</strong><small>${m.sub}</small>
            ${mode === k && html`<span class="mode-opt-check"><${Icon} name="check" size=${14} stroke=${3} /></span>`}
          </button>`)}
        </div>
        <p class="mode-card-foot">Chaque mode a ses propres sites (affichés un par un, jamais mélangés) et son propre thème.
          Le filtre anti-mineurs reste actif partout, plus strict pour le hentai et X.</p>
      </div>

      <${Group} title="Sécurité" footer=${bioOK
          ? "Face ID se lance tout seul à l'ouverture et à chaque retour dans l'app. iOS affiche alors sa fenêtre « Se connecter » : un seul bouton à toucher, puis Face ID. Si Face ID échoue, iOS propose le code de ton iPhone."
          : "Face ID n'est pas disponible dans ce navigateur : installe l'app sur l'écran d'accueil depuis Safari pour l'utiliser."}>
        <${Row} icon="faceid" iconColor="#30a46c" title="Face ID à l'ouverture"
          subtitle=${bioOK ? null : 'Indisponible ici'}
          right=${html`<${Switch} checked=${Boolean(s.bioId)} disabled=${!bioOK && !s.bioId} onChange=${setBio} label="Face ID" />`} />
        ${s.bioId && bioOK && html`<${Row} icon="refresh" iconColor="#30a46c" title="Recréer la clé Face ID" chevron
          subtitle="Si l'iPhone parle de Chrome au déverrouillage : recrée-la et choisis « Mots de passe »."
          onClick=${renewBio} />`}
        <${Row} icon="lock" iconColor="#e5484d" title="Code SearchX" subtitle=${s.bioId ? 'Code à 4 chiffres en plus de Face ID' : 'Code à 4 chiffres'}
          right=${html`<${Switch} checked=${Boolean(s.pinHash)} onChange=${setPinEnabled} label="Code" />`} />
        ${lockEnabled() && html`<${Row} icon="timer" iconColor="#8e4ec6" title="Verrouiller" chevron
          right=${(LOCK_DELAYS.find(d => d[0] === s.lockDelay) || LOCK_DELAYS[0])[1]}
          onClick=${() => openSheet('options', { title: 'Verrouiller', key: 'lock', options: LOCK_DELAYS, value: s.lockDelay, onPick: v => updateSettings({ lockDelay: v }) })} />`}
        <${Row} icon="eye" iconColor="#3e63dd" title="Masquer dans les apps récentes" subtitle="Écran noir dès que tu quittes l'app"
          right=${html`<${Switch} checked=${s.blur} onChange=${v => updateSettings({ blur: v })} label="Masquer" />`} />
        ${lockEnabled() && html`<${Row} icon="lock" iconColor="#6f6e77" title="Verrouiller maintenant" onClick=${lockNow} />`}
      <//>

      <${Group} title="Affichage">
        <${Row} icon="layers" iconColor="#3e63dd" title="Disposition des résultats" chevron
          right=${(LAYOUTS.find(l => l[0] === s.layout) || LAYOUTS[0])[1]}
          onClick=${() => openSheet('options', { title: 'Disposition', key: 'layout', options: LAYOUTS, value: s.layout, onPick: v => updateSettings({ layout: v }) })} />
        <${Row} icon="film" iconColor="#e93d82" title="Aperçus animés des GIFs" subtitle="Les GIFs bougent dans la grille (utilise plus de données)"
          right=${html`<${Switch} checked=${s.previews} onChange=${v => updateSettings({ previews: v })} label="Aperçus" />`} />
      <//>

      <${Group} title="Icône et nom sur l'écran d'accueil" footer="Choisis avant d'ajouter SearchX à l'écran d'accueil. Pour changer une icône déjà installée : supprime-la puis ré-ajoute depuis Safari (exporte d'abord tes favoris).">
        <div class="icon-picker">
          ${Object.entries(INSTALL_ICONS).map(([k, v]) => html`<button type="button" key=${k} class=${cx('icon-choice', s.installIcon === k && 'on')} onClick=${() => setIcon(k)}>
            <img src=${v.icon} alt="" /><span>${v.label || v.name}</span>
          </button>`)}
        </div>
      <//>

      <${Group} title=${`Sites du mode ${MODES[mode].label.toLowerCase()}`} footer="Chaque site a son onglet dans les résultats. Les sites désactivés ne sont plus interrogés.">
        ${modeSources(mode).map(src => html`<${Row} key=${src} title=${SOURCES[src].name} subtitle=${SOURCES[src].note + (SOURCES[src].extra ? ' (optionnel)' : '')}
          lead=${html`<${SourceBadge} src=${src} />`}
          right=${html`<${Switch} checked=${state.filters.sources.includes(src)} onChange=${on => enableSource(src, on)} label=${SOURCES[src].name} />`} />`)}
        <${Row} icon="zap" iconColor=${s.rgRelay ? '#46a758' : '#ff4b6e'} title="Relais RedGIFs" chevron
          subtitle="Indispensable : RedGIFs limite les serveurs Cloudflare."
          right=${s.rgRelay ? 'Actif' : 'À activer'} onClick=${() => openSheet('custom', { render: () => html`<${RelaySheet} />` })} />
        ${mode === 'porn' && html`<${Row} icon="at" iconColor="#1d9bf0" title="Comptes X suivis" chevron
          right=${state.xFollows.length ? String(state.xFollows.length) : 'Aucun'} onClick=${() => openSheet('xaccounts')} />`}
        ${mode === 'hentai' && html`<${Row} icon="key" iconColor=${r34ok ? '#46a758' : '#f76b15'} title="Identifiants Rule34" chevron
          right=${r34ok ? `user ${s.r34user}` : 'À configurer'} onClick=${() => openSheet('custom', { render: () => html`<${Rule34Sheet} />` })} />`}
        <${Row} icon="zap" iconColor="#ffb224" title="Tester les sites de ce mode" chevron onClick=${() => openSheet('custom', { render: () => html`<${TestSheet} />` })} />
      <//>

      <${Group} title="Lecture">
        <${Row} icon="shield" iconColor="#30a46c" title="Bloquer pubs et pop-ups des lecteurs" subtitle="Désactivable vidéo par vidéo si un lecteur refuse de démarrer."
          right=${html`<${Switch} checked=${s.sandbox} onChange=${v => updateSettings({ sandbox: v })} label="Anti-pubs" />`} />
        <${Row} icon="play" iconColor="#e5484d" title="Lecture automatique des vidéos" subtitle="Lance le lecteur dès que la vidéo s'affiche"
          right=${html`<${Switch} checked=${s.autoplayVideos} onChange=${v => updateSettings({ autoplayVideos: v })} label="Autoplay vidéos" />`} />
        <${Row} icon="play" iconColor="#e93d82" title="Lecture automatique des GIFs" right=${html`<${Switch} checked=${s.autoplayGifs} onChange=${v => updateSettings({ autoplayGifs: v })} label="Autoplay" />`} />
        <${Row} icon="mute" iconColor="#6f6e77" title="GIFs sans le son" right=${html`<${Switch} checked=${s.muteGifs} onChange=${v => updateSettings({ muteGifs: v })} label="Muet" />`} />
        <${Row} icon="hand" iconColor="#0091ff" title="Retour haptique" right=${html`<${Switch} checked=${s.haptics} onChange=${v => updateSettings({ haptics: v })} label="Haptique" />`} />
      <//>

      <${MusicGroup} />

      <${Group} title="Recherche">
        <${Row} icon="sliders" iconColor="#3e63dd" title="Filtres par défaut" chevron onClick=${() => openSheet('filters', { target: 'default' })} />
        <${Row} icon="clock" iconColor="#6f6e77" title="Effacer les recherches récentes" onClick=${() => { clearRecent({ all: true }); toast('Recherches récentes effacées'); }} />
      <//>

      <${Group} title="Données" footer="Tout est stocké uniquement sur ce téléphone. Exporte une sauvegarde avant de réinstaller l'app.">
        <${Row} icon="upload" iconColor="#0091ff" title="Exporter une sauvegarde" onClick=${exportBackup} />
        <${Row} icon="download" iconColor="#0091ff" title="Importer une sauvegarde" onClick=${() => fileRef.current?.click()} />
        <input ref=${fileRef} type="file" accept="application/json,.json" hidden onChange=${onImport} />
        <${Row} icon="trash" iconColor="#e5484d" title="Effacer l'historique" danger
          onClick=${() => openSheet('confirm', { title: "Effacer l'historique ?", text: "C'est définitif.", confirm: 'Effacer', onConfirm: () => { clearHistory(); toast('Historique effacé'); } })} />
        <${Row} icon="refresh" iconColor="#6f6e77" title="Vider le cache de l'app" onClick=${clearCache} />
      <//>

      <${Group} title="Avancé">
        <${Row} icon="server" iconColor="#30a46c" title="Serveur" chevron right=${location.host} onClick=${() => openSheet('custom', { render: () => html`<${ServerSheet} />` })} />
      <//>

      <p class="about">SearchX ${APP_VERSION} · réservé aux adultes (18+).<br />SearchX n'héberge aucun contenu : les résultats viennent de sites tiers.
        Les contenus impliquant des mineurs sont toujours bloqués.</p>
    </main>
  </div>`;
}
