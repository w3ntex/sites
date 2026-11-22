import { upstream, UpstreamError, DESKTOP_UA } from '../lib.js';
import { redditUrls, parseRedditListing, mergeRedditResults } from '../../public/js/shared/reddit.js';
import { pullpushUrl, parsePullPush } from '../../public/js/shared/apis.js';

// Server-side fallback; the app first asks Reddit (then PullPush) straight from the phone.
// Order here: www.reddit.com → old.reddit.com → PullPush (public Reddit archive).
export async function search({ q, page, sort, cursor }) {
  if (String(cursor || '').startsWith('pp:')) return pullpush(q, cursor);
  let lastError = null;
  for (const base of ['https://www.reddit.com', 'https://old.reddit.com']) {
    try {
      return await reddit(base, q, page, sort, cursor);
    } catch (e) {
      lastError = e;
    }
  }
  try {
    return await pullpush(q, page > 1 ? cursor : '');
  } catch (e) {
    const status = lastError?.status || e?.status || 0;
    throw new UpstreamError('blocked', status,
      'Reddit refuse les requêtes anonymes (serveur et téléphone) et l\'archive PullPush ne répond pas.',
      [lastError?.debug, e?.debug].filter(Boolean).join(' | '));
  }
}

async function reddit(base, q, page, sort, cursor) {
  const urls = redditUrls({ q, sort, cursor, page, base });
  const one = async url => {
    if (!url) return { items: [], after: null };
    const json = await upstream(url, { as: 'json', ua: DESKTOP_UA, headers: { Accept: 'application/json' } });
    return parseRedditListing(json);
  };
  const [p, g] = await Promise.allSettled([one(urls.priority), one(urls.global)]);
  if (p.status === 'rejected' && g.status === 'rejected') throw p.reason;
  return mergeRedditResults(p.status === 'fulfilled' ? p.value : null, g.status === 'fulfilled' ? g.value : null);
}

async function pullpush(q, cursor) {
  const data = await upstream(pullpushUrl({ q, cursor }), { as: 'json', headers: { Accept: 'application/json' } });
  return parsePullPush(data);
}
