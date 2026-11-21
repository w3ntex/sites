// Helpers for talking to the upstream sites and parsing what they return.

export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

/** kind: http | timeout | network | parse | auth | agegate | blocked */
export class UpstreamError extends Error {
  constructor(kind, status = 0, detail = '') {
    super(`${kind}${status ? ` ${status}` : ''}${detail ? `: ${detail}` : ''}`);
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/** User-facing (French) explanation of an upstream failure. */
export function friendlyMessage(err) {
  if (!(err instanceof UpstreamError)) {
    return `Erreur inattendue : ${err?.message || err}`;
  }
  switch (err.kind) {
    case 'timeout': return "Le site n'a pas répondu à temps. Réessaie dans un instant.";
    case 'network': return 'Impossible de joindre le site depuis le serveur.';
    case 'parse': return 'Le site a changé son format : les résultats sont illisibles pour le moment.';
    case 'agegate': return "Le site exige une vérification d'âge depuis la région du serveur.";
    case 'auth': return err.detail || 'Identifiants manquants ou invalides.';
    case 'blocked': return err.detail || 'Le site bloque les requêtes du serveur.';
    case 'http':
      switch (err.status) {
        case 401: return 'Accès refusé (401) : identifiants invalides.';
        case 403: return "Accès refusé (403) : le site bloque peut-être les serveurs ou la région.";
        case 404: return 'Introuvable (404).';
        case 429: return 'Trop de requêtes (429). Réessaie dans une minute.';
        case 451: return 'Indisponible dans cette région (451).';
        default:
          if (err.status >= 500) return `Le site a un problème (${err.status}).`;
          return `Réponse inattendue du site (${err.status}).`;
      }
    default: return 'Erreur inconnue.';
  }
}

const AGE_GATE_URL = /yoti\.|ageid\.|age-id\.|ageverif|verifymyage|go\.cam\/|agechecked|\/age[-_]?verification/i;

/**
 * fetch() with a timeout, browser-like headers and typed errors.
 * as: 'text' | 'json' | 'response'
 */
export async function upstream(url, { headers = {}, ua = DESKTOP_UA, timeout = 12000, as = 'text', method = 'GET', body, retried = false } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', ...headers }
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new UpstreamError('timeout');
    throw new UpstreamError('network', 0, e?.message || String(e));
  }
  if (res.url && AGE_GATE_URL.test(res.url)) throw new UpstreamError('agegate');
  if (!res.ok) {
    // Retry once after a short pause when rate limited.
    if (res.status === 429 && !retried) {
      await new Promise(r => setTimeout(r, 1500));
      return upstream(url, { headers, ua, timeout, as, method, body, retried: true });
    }
    throw new UpstreamError('http', res.status);
  }
  if (as === 'response') return res;
  const text = await res.text();
  if (as === 'json') {
    try { return JSON.parse(text); } catch { throw new UpstreamError('parse', res.status, text.slice(0, 160)); }
  }
  return text;
}

// ---------------------------------------------------------------------------------------------
// Text parsing

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç'
};

export function decodeEntities(s) {
  if (!s || !s.includes('&')) return s || '';
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** First capture group of `re` in `text`, or null. */
export function first(re, text) {
  const m = re.exec(text);
  return m ? m[1] : null;
}

/** "10:23" / "1:02:03" → seconds */
export function clockToSec(s) {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? Math.round(s) : null;
  const parts = String(s).trim().split(':').map(x => parseInt(x, 10));
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** "10 min", "1 h 5 min", "45 sec", "1h 02min" → seconds */
export function wordDurationToSec(s) {
  if (!s) return null;
  const t = String(s).toLowerCase();
  if (t.includes(':')) return clockToSec(t);
  let total = 0, found = false;
  for (const m of t.matchAll(/(\d+)\s*(h|min|m|sec|s)/g)) {
    const n = parseInt(m[1], 10);
    found = true;
    total += m[2] === 'h' ? n * 3600 : (m[2] === 'min' || m[2] === 'm') ? n * 60 : n;
  }
  return found ? total : null;
}

/** "1.2M", "345K", "12,345" → number */
export function compactNumber(s) {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  let t = String(s).trim().toUpperCase().replace(/,/g, '').replace(/\s+/g, '');
  if (!t) return null;
  let mult = 1;
  if (t.endsWith('B')) { mult = 1e9; t = t.slice(0, -1); }
  else if (t.endsWith('M')) { mult = 1e6; t = t.slice(0, -1); }
  else if (t.endsWith('K')) { mult = 1e3; t = t.slice(0, -1); }
  const v = parseFloat(t);
  return Number.isFinite(v) ? Math.round(v * mult) : null;
}

/** "720p", "1080p", "4K", "HD" → vertical resolution */
export function resolutionFromLabel(s) {
  if (!s) return null;
  const t = String(s).toLowerCase();
  if (/4k|2160|uhd/.test(t)) return 2160;
  if (t.includes('1440')) return 1440;
  if (t.includes('1080')) return 1080;
  if (t.includes('720') || t.includes('hd')) return 720;
  const n = parseInt(t.replace(/\D/g, ''), 10);
  return n > 100 ? n : null;
}

/** "2024-01-31 12:00:00" (UTC) → unix seconds */
export function sqlDateToUnix(s) {
  if (!s) return null;
  const ms = Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

/** Absolute http(s) URL or null. */
export function absUrl(u, base) {
  if (!u || typeof u !== 'string') return null;
  let s = decodeEntities(u.trim());
  if (s.startsWith('//')) s = 'https:' + s;
  try {
    const url = new URL(s, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Ratings from 0–5 scales become percentages; percentages are kept. */
export function toPercent(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.max(0, Math.min(100, Math.round(n <= 5 ? n * 20 : n)));
}
