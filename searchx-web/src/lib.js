// Helpers for talking to the upstream sites, with typed errors and diagnostics.

export {
  decodeEntities, stripTags, first, clockToSec, wordDurationToSec, compactNumber, resolutionFromLabel,
  sqlDateToUnix, absUrl, num, toPercent
} from '../public/js/shared/parse.js';

export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache'
};

/** kind: http | timeout | network | parse | unexpected | auth | agegate | blocked */
export class UpstreamError extends Error {
  constructor(kind, status = 0, detail = '', debug = '') {
    super(`${kind}${status ? ` ${status}` : ''}${detail ? `: ${detail}` : ''}`);
    this.kind = kind;
    this.status = status;
    this.detail = detail;
    this.debug = debug;
  }
}

/** One-line description of what a site actually returned (shown in the app's test screen). */
export function pageInfo(res, text = '') {
  let where = '';
  try { const u = new URL(res?.url || ''); where = `${u.host}${u.pathname}`.slice(0, 60); } catch { /* ignore */ }
  const title = (/<title[^>]*>([\s\S]{0,120}?)<\/title>/i.exec(text) || [])[1];
  const clean = title ? title.replace(/\s+/g, ' ').trim() : '';
  const snippet = clean ? `« ${clean} »` : `« ${String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)} »`;
  const type = (res?.headers?.get?.('content-type') || '').split(';')[0];
  return [`HTTP ${res?.status ?? '?'}`, where, type, snippet, `${Math.round(String(text).length / 1024)} Ko`].filter(Boolean).join(' · ');
}

/** Guess why a site sent an unexpected page, from its text. */
export function explainPage(text) {
  const t = String(text || '').slice(0, 20000).toLowerCase();
  if (t.includes('please visit') && t.includes('xvideos')) {
    return "xVideos refuse les recherches venant de serveurs (il renvoie une page vide). Utilise « Chercher sur xVideos ».";
  }
  if (/just a moment|cf-chl|challenge-platform|attention required|enable javascript and cookies/.test(t)) return 'Le site protège sa recherche par un contrôle anti-robot.';
  if (/not available in your (country|region)|unavailable in your (country|region)|restricted in your (country|region)|blocked in your country|indisponible dans votre pays/.test(t)) return "Le site n'est pas disponible depuis la région du serveur.";
  if (/age verification|verify your age|vérification de l'âge|vérifier votre âge|yoti|ageverif/.test(t)) return "Le site exige une vérification d'âge depuis la région du serveur.";
  if (/access denied|forbidden|request blocked/.test(t)) return 'Le site refuse les requêtes du serveur.';
  return 'Le site a renvoyé une page inattendue.';
}

/** User-facing (French) explanation of an upstream failure. */
export function friendlyMessage(err) {
  if (!(err instanceof UpstreamError)) return `Erreur inattendue : ${err?.message || err}`;
  switch (err.kind) {
    case 'timeout': return "Le site n'a pas répondu à temps.";
    case 'network': return 'Impossible de joindre le site depuis le serveur.';
    case 'parse': return 'Le site a changé son format : les résultats sont illisibles pour le moment.';
    case 'unexpected': return err.detail || 'Le site a renvoyé une page inattendue.';
    case 'agegate': return "Le site exige une vérification d'âge depuis la région du serveur.";
    case 'auth': return err.detail || 'Identifiants manquants ou invalides.';
    case 'blocked': return err.detail || 'Le site bloque les requêtes du serveur.';
    case 'http':
      switch (err.status) {
        case 401: return 'Accès refusé (401) : identifiants invalides.';
        case 403: return 'Accès refusé (403) : le site bloque les serveurs ou la région.';
        case 404: return 'Introuvable (404).';
        case 429: return 'Trop de requêtes (429) : le site limite le serveur.';
        case 451: return 'Indisponible dans cette région (451).';
        case 503: return 'Le site refuse le serveur pour le moment (503, souvent une protection anti-robot).';
        default:
          if (err.status >= 500) return `Le site a un problème (${err.status}).`;
          return `Réponse inattendue du site (${err.status}).`;
      }
    default: return 'Erreur inconnue.';
  }
}

const AGE_GATE_URL = /yoti\.|ageid\.|age-id\.|ageverif|verifymyage|go\.cam\/|agechecked|\/age[-_]?verification/i;

/**
 * fetch() with a timeout, browser-like headers and typed errors (with diagnostics).
 * as: 'text' | 'json' | 'response' | 'page' ({ text, res }, for HTML scrapers that need diagnostics)
 */
export async function upstream(url, { headers = {}, ua = DESKTOP_UA, timeout = 12000, as = 'text', method = 'GET', body, retried = false } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method, body, redirect: 'follow', signal: AbortSignal.timeout(timeout),
      headers: { ...BROWSER_HEADERS, 'User-Agent': ua, ...headers }
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new UpstreamError('timeout');
    throw new UpstreamError('network', 0, '', String(e?.message || e).slice(0, 120));
  }
  if (res.url && AGE_GATE_URL.test(res.url)) throw new UpstreamError('agegate', res.status, '', pageInfo(res, ''));
  if (!res.ok) {
    // Rate limited: wait (honouring Retry-After, max 4 s) and retry up to twice.
    const attempt = typeof retried === 'number' ? retried : (retried ? 1 : 0);
    if (res.status === 429 && attempt < 2) {
      const ra = parseFloat(res.headers.get('retry-after') || '');
      const wait = Math.min(4000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1200 * (attempt + 1));
      await new Promise(r => setTimeout(r, wait));
      return upstream(url, { headers, ua, timeout, as, method, body, retried: attempt + 1 });
    }
    let text = '';
    try { text = await res.text(); } catch { /* ignore */ }
    const err = new UpstreamError('http', res.status, '', pageInfo(res, text));
    if (res.status === 403 || res.status === 503) err.detail = `${friendlyMessage(err)} ${explainPage(text) !== 'Le site a renvoyé une page inattendue.' ? explainPage(text) : ''}`.trim();
    throw err;
  }
  if (as === 'response') return res;
  const text = await res.text();
  if (as === 'json') {
    try { return JSON.parse(text); } catch {
      throw new UpstreamError('unexpected', res.status, explainPage(text), pageInfo(res, text));
    }
  }
  return as === 'page' ? { text, res } : text;
}

/** For HTML sources: an 'unexpected' error describing the page that came back. */
export function unexpectedPage({ text, res }) {
  return new UpstreamError('unexpected', res?.status || 200, explainPage(text), pageInfo(res, text));
}
