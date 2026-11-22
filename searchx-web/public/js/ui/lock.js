import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.mjs';
import { Icon } from './icons.js';
import { Sheet, cx } from './common.js';
import { state, notify, updateSettings, closeSheet, toast } from '../state.js';
import { hashPin, newSalt, verifyBiometrics } from '../lib/lock.js';
import { haptic } from '../lib/haptics.js';

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
  const [busy, setBusy] = useState(false);
  const [showPin, setShowPin] = useState(!s.bioId);
  const tried = useRef(false);

  const bio = async (auto = false) => {
    if (!s.bioId || busy) return;
    if (!auto) haptic();
    setBusy(true);
    try {
      if (await verifyBiometrics(s.bioId)) { unlock(); return; }
    } catch (e) {
      // Without a tap, iOS may refuse to show Face ID: the screen stays tappable.
      if (!auto && e?.name !== 'NotAllowedError') toast("Face ID n'a pas fonctionné.");
      if (!auto && s.pinHash) setShowPin(true);
    } finally {
      setBusy(false);
    }
  };

  // Ask for Face ID right away when the lock screen appears, and again each time the app comes back.
  useEffect(() => {
    const attempt = () => {
      if (s.bioId && document.visibilityState === 'visible' && !tried.current) {
        tried.current = true;
        bio(true);
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') tried.current = false;
      else setTimeout(attempt, 350);
    };
    attempt();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

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

  if (s.bioId && !showPin) {
    return html`<button type="button" class="lock-screen tap" onClick=${() => bio(false)} aria-label="Déverrouiller avec Face ID">
      <div class="lock-top">
        <div class="lock-icon big"><${Icon} name="faceid" size=${44} stroke=${1.7} /></div>
        <h2>SearchX est verrouillé</h2>
        <p class="muted">${busy ? 'Face ID…' : 'Touche l\'écran pour déverrouiller avec Face ID'}</p>
      </div>
      ${s.pinHash && html`<span class="text-btn lock-alt" onClick=${e => { e.stopPropagation(); haptic(); setShowPin(true); }}>Utiliser le code</span>`}
    </button>`;
  }

  return html`<div class="lock-screen">
    <div class="lock-top">
      <div class="lock-icon"><${Icon} name="lock" size=${26} /></div>
      <h2>SearchX est verrouillé</h2>
      <p class="muted">Entre ton code${s.bioId ? ' ou utilise Face ID' : ''}</p>
    </div>
    <${PinPad} value=${pin} error=${error} onDigit=${digit} onDelete=${() => { haptic(); setPin(pin.slice(0, -1)); }}
      extraKey=${s.bioId ? html`<button type="button" class="pin-bio" aria-label="Face ID" onClick=${() => bio(false)}><${Icon} name="faceid" size=${30} /></button>` : null} />
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
