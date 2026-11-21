import { upstream, UpstreamError, DESKTOP_UA } from '../lib.js';
import { redditUrls, parseRedditListing, mergeRedditResults } from '../../public/js/shared/reddit.js';

// Server-side fallback; the app first asks Reddit directly from the phone.
export async function search({ q, page, sort, cursor }) {
  const urls = redditUrls({ q, sort, cursor, page });
  const fetchOne = async url => {
    if (!url) return { items: [], after: null };
    const json = await upstream(url, { as: 'json', ua: DESKTOP_UA, headers: { Accept: 'application/json' } });
    return parseRedditListing(json);
  };
  const [p, g] = await Promise.allSettled([fetchOne(urls.priority), fetchOne(urls.global)]);
  if (p.status === 'rejected' && g.status === 'rejected') {
    const e = p.reason;
    if (e instanceof UpstreamError && e.kind === 'http' && [401, 403, 429].includes(e.status)) {
      throw new UpstreamError('blocked', e.status, 'Reddit bloque les serveurs. Il sera interrogé directement depuis ton téléphone.');
    }
    throw e;
  }
  return mergeRedditResults(p.status === 'fulfilled' ? p.value : null, g.status === 'fulfilled' ? g.value : null);
}
