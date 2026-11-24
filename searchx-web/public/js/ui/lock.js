import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Sheet, cx } from './common.js';
import { state, notify, updateSettings, closeSheet, toast, resetEverything } from '../state.js';
import { hashPin, newSalt, verifyBiometrics, describeAuthError } from '../lib/lock.js';
import { haptic } from '../lib/haptics.js';
import { Petals, isNeon } from './theme.js';

export function PinPad({ value, length = 4, error = false, onDigit, onDelete, extraKey = null }) {
  return html`<div class="pinpad-wrap">
    <div class=${cx('pin-dots', error && 'shake')}>
      ${Array.from({ length }, (_, i) => html`<span key=${i} class=${cx(i < value.length && 'on')}></span>`)}
    </div>
    <div class="pinpad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => html`<button type="button" key=${d} onClick=${() => onDigit(d)}>${d}</button>`)}
      ${extraKey || html`<span></span>`}
      <button type="button" onClick=${() => onDigit('0')}>0</button>
      <button type="button" class="pin-del" aria-label="Effacer" onClick=${onDelete}><${Icon} name="chevronLeft" size=${26} /></button>
    </div>
  </div>`;
}

function unlock() {
  state.locked = false;
  notify();
}

export function LockScreen() {
  const s = state.settings;
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [showPin, setShowPin] = useState(!s.bioId);
  const [prompting, setPrompting] = useState(false);
  const [msg, setMsg] = useState('');
  const [help, setHelp] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ctrl = useRef(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  // Called straight from the tap (iOS only shows Face ID in response to a touch). A previous
  // request can never block a new tap: it is cancelled first.
  const bio = () => {
    if (!s.bioId) return;
    try { ctrl.current?.abort(); } catch { /* ignore */ }
    const c = new AbortController();
    ctrl.current = c;
    setMsg('');
    setPrompting(true);
    verifyBiometrics(s.bioId, c.signal)
      .then(ok => { if (ok) unlock(); else setMsg('Face ID a échoué.'); })
      .catch(e => { if (ctrl.current === c) setMsg(describeAuthError(e)); })
      .finally(() => { if (ctrl.current === c) setPrompting(false); });
    haptic();
  };

  const check = async p => {
    if (await hashPin(p, s.pinSalt) === s.pinHash) { haptic(); unlock(); return; }
    haptic();
    setError(true);
    setTimeout(() => { setError(false); setPin(''); }, 480);
  };
  const digit = d => {
    if (pin.length >= 4 || error) return;
    haptic();
    const p = pin + d;
    setPin(p);
    if (p.length === 4) check(p);
  };

  const helpPanel = help && html`<div class="lock-help" onClick=${e => e.stopPropagation()}>
    <h3>Impossible d'entrer ?</h3>
    ${s.bioId && html`<button type="button" class="btn" onClick=${bio}><${Icon} name="faceid" size=${18} /> Réessayer Face ID</button>`}
    ${s.pinHash && html`<button type="button" class="btn ghost" onClick=${() => { setHelp(false); setShowPin(true); }}>Utiliser le code SearchX</button>`}
    ${!confirmReset
      ? html`<button type="button" class="btn ghost danger-text" onClick=${() => setConfirmReset(true)}>Réinitialiser SearchX…</button>`
      : html`<div class="reset-confirm">
          <p>Efface tes favoris, playlists, historique et réglages sur ce téléphone, puis rouvre SearchX sans verrouillage. Ta clé Rule34 est gardée. Rien n'est envoyé nulle part.</p>
          <button type="button" class="btn danger" onClick=${() => resetEverything()}>Tout effacer et entrer</button>
          <button type="button" class="btn ghost" onClick=${() => setConfirmReset(false)}>Annuler</button>
        </div>`}
    <button type="button" class="text-btn" onClick=${() => { setHelp(false); setConfirmReset(false); }}>Fermer</button>
  </div>`;

  if (s.bioId && !showPin) {
    return html`<div class="lock-screen">
      ${isNeon() && html`<${Petals} count=${6} />`}
      <button type="button" class="lock-tap" onClick=${bio} aria-label="Déverrouiller avec Face ID">
        <div class="lock-top">
          <div class=${cx('lock-icon big', prompting && 'pulse')}><${Icon} name="faceid" size=${44} stroke=${1.7} /></div>
          ${isNeon() && html`<p class="lock-kicker" lang="ja">ロック中</p>`}
          <h2>SearchX est verrouillé</h2>
          <p class="muted">${prompting ? 'Regarde ton iPhone…' : 'Touche ici pour déverrouiller avec Face ID'}</p>
          ${msg && html`<p class="lock-msg">${msg}</p>`}
        </div>
      </button>
      <div class="lock-links">
        ${s.pinHash && html`<button type="button" class="text-btn" onClick=${() => { haptic(); setShowPin(true); }}>Utiliser le code</button>`}
        <button type="button" class="text-btn muted-btn" onClick=${() => { haptic(); setHelp(true); }}>Impossible d'entrer ?</button>
      </div>
      ${helpPanel}
    </div>`;
  }

  return html`<div class="lock-screen">
    ${isNeon() && html`<${Petals} count=${6} />`}
    <div class="lock-top">
      <div class="lock-icon"><${Icon} name="lock" size=${26} /></div>
      ${isNeon() && html`<p class="lock-kicker" lang="ja">ロック中</p>`}
      <h2>SearchX est verrouillé</h2>
      <p class="muted">Entre ton code${s.bioId ? ' ou utilise Face ID' : ''}</p>
      ${msg && html`<p class="lock-msg">${msg}</p>`}
    </div>
    <${PinPad} value=${pin} error=${error} onDigit=${digit} onDelete=${() => { haptic(); setPin(pin.slice(0, -1)); }}
      extraKey=${s.bioId ? html`<button type="button" class="pin-bio" aria-label="Face ID" onClick=${bio}><${Icon} name="faceid" size=${30} /></button>` : null} />
    <div class="lock-links">
      <button type="button" class="text-btn muted-btn" onClick=${() => { haptic(); setHelp(true); }}>Code oublié ?</button>
    </div>
    ${helpPanel}
  </div>`;
}

export function PinSetupSheet() {
  const [step, setStep] = useState('new');
  const [first, setFirst] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const digit = async (d, close) => {
    if (pin.length >= 4 || error) return;
    haptic();
    const p = pin + d;
    setPin(p);
    if (p.length < 4) return;
    if (step === 'new') {
      setTimeout(() => { setFirst(p); setPin(''); setStep('confirm'); }, 180);
      return;
    }
    if (p !== first) {
      setError(true);
      setTimeout(() => { setError(false); setPin(''); setFirst(''); setStep('new'); toast('Les codes ne correspondent pas.'); }, 480);
      return;
    }
    const salt = newSalt();
    updateSettings({ pinSalt: salt, pinHash: await hashPin(p, salt) });
    toast('Code activé');
    close();
  };
  return html`<${Sheet} title=${step === 'new' ? 'Choisis un code à 4 chiffres' : 'Confirme le code'} onClose=${closeSheet}>
    ${close => html`<${PinPad} value=${pin} error=${error} onDigit=${d => digit(d, close)} onDelete=${() => setPin(pin.slice(0, -1))} />`}
  <//>`;
}
