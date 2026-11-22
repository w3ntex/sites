// Pure parsing helpers shared by the Worker and the app (no network, no DOM).

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
