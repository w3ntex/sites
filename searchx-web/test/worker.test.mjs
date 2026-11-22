import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as F from './fixtures.mjs';
import { parseXVideos } from '../src/sources/xvideos.js';
import { extractXHamster, initialsJSON } from '../src/sources/xhamster.js';
import { parseRedTube } from '../src/sources/redtube.js';
import { parseEporner } from '../src/sources/eporner.js';
import { parseRule34, parseSuggestions, resolveTags } from '../src/sources/rule34.js';
import { parseRedGifs } from '../src/sources/redgifs.js';
import { parseRedditListing, redditUrls, mergeRedditResults } from '../public/js/shared/reddit.js';
import { parsePullPush, pullpushUrl, redgifsSearchUrl, epornerSearchUrl } from '../public/js/shared/apis.js';
import { isQueryAllowed, isItemAllowed, isBlockedText } from '../public/js/shared/safety.js';
import { wordDurationToSec, clockToSec, compactNumber, decodeEntities, toPercent } from '../src/lib.js';
import worker from '../src/worker.js';

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = F.mockFetch(''); });
after(() => { globalThis.fetch = realFetch; });

function assertItem(it, src) {
  assert.equal(it.src, src);
  assert.ok(it.id.startsWith(`${src}:`), it.id);
  assert.ok(it.title && typeof it.title === 'string');
  assert.match(it.thumb, /^https?:\/\//);
  assert.match(it.url, /^https:\/\//);
  assert.ok(['video', 'gif', 'image'].includes(it.type));
  assert.ok(Array.isArray(it.tags) && Array.isArray(it.by));
}

test('helpers', () => {
  assert.equal(wordDurationToSec('12 min'), 720);
  assert.equal(wordDurationToSec('1 h 5 min'), 3900);
  assert.equal(wordDurationToSec('45 sec'), 45);
  assert.equal(clockToSec('1:02:03'), 3723);
  assert.equal(compactNumber('1.2M'), 1200000);
  assert.equal(compactNumber('345K'), 345000);
  assert.equal(decodeEntities('a &amp; b &#39;c&#x27;'), "a & b 'c'");
  assert.equal(toPercent('4.5'), 90);
  assert.equal(toPercent('85'), 85);
});

test('xvideos parser', () => {
  const items = parseXVideos(F.xvideosHTML(5));
  assert.equal(items.length, 5);
  items.forEach(it => assertItem(it, 'xvideos'));
  assert.equal(items[0].dur, 180);
  assert.equal(items[0].h, 1080);
  assert.equal(items[0].embed, 'https://www.xvideos.com/embedframe/70000');
  assert.ok(items[0].title.endsWith('& more'));
  assert.equal(items[0].by[0], 'Alfacontent World');
  assert.equal(items[1].views, 2100000);
});

test('xhamster extractor', () => {
  const json = JSON.parse(initialsJSON(F.xhamsterHTML(6)));
  const items = extractXHamster(json);
  assert.equal(items.length, 6);
  items.forEach(it => assertItem(it, 'xhamster'));
  assert.equal(items[0].h, 2160);
  assert.equal(items[1].h, null);
  assert.equal(items[0].embed, 'https://xhamster.com/xembed.php?video=900000');
  assert.equal(items[0].by[0], 'Violet Studio');
});

test('redtube parser (rating already a percentage)', () => {
  const items = parseRedTube(F.redtubeJSON(4));
  assert.equal(items.length, 4);
  items.forEach(it => assertItem(it, 'redtube'));
  assert.equal(items[0].rating, 70);
  assert.equal(items[0].embed, 'https://embed.redtube.com/?id=40000000&bgcolor=000000');
  assert.equal(items[1].by[0], 'dick_dickson');
});

test('eporner parser', () => {
  const items = parseEporner(F.epornerJSON(3));
  assert.equal(items.length, 3);
  items.forEach(it => assertItem(it, 'eporner'));
  assert.equal(items[0].rating, 60);
  assert.ok(items[0].embed.includes('/embed/'));
});

test('rule34 parser + tag resolution', async () => {
  const items = parseRule34(F.rule34JSON(6));
  assert.equal(items.length, 6);
  items.forEach(it => assertItem(it, 'rule34'));
  assert.equal(items[0].type, 'video');
  assert.equal(items[1].type, 'gif');
  assert.equal(items[2].type, 'image');
  const sugg = parseSuggestions(F.rule34Autocomplete('missionary'));
  assert.deepEqual(sugg.map(s => s.tag), ['missionary_position', 'missionary', 'missionary_sex']); // "loli" removed
  // exact tag exists → kept
  const fake = async q => parseSuggestions(F.rule34Autocomplete(q));
  assert.deepEqual(await resolveTags('missionary', fake), ['missionary']);
  // multi-word without a joined tag → joined prefix match first
  assert.deepEqual(await resolveTags('anime girl', async q => (q === 'anime_girl' ? [] : parseSuggestions([{ label: `${q} (5)`, value: q }]))), ['anime', 'girl']);
  assert.deepEqual(await resolveTags('big tits, blonde', fake), ['big_tits', 'blonde']);
});

test('redgifs parser', () => {
  const items = parseRedGifs(F.redgifsJSON(8));
  assert.equal(items.length, 8);
  items.forEach(it => assertItem(it, 'redgifs'));
  assert.equal(items[0].type, 'gif');
  assert.equal(items[7].type, 'image');
  assert.match(items[0].media, /\.mp4$/);
});

test('reddit parser keeps only NSFW media posts', () => {
  const { items, after: next } = parseRedditListing(F.redditJSON(8));
  assert.equal(next, 't3_next');
  assert.equal(items.length, 6); // 2 text posts + 1 SFW dropped
  items.forEach(it => assertItem(it, 'reddit'));
  assert.equal(items[0].type, 'image');
  assert.equal(items[1].type, 'video');
  assert.match(items[1].media, /DASH_720\.mp4/);
  assert.equal(items[2].type, 'gif');
  assert.equal(items[2].embed, 'https://www.redgifs.com/ifr/sampleclip2');
  const urls = redditUrls({ q: 'test', page: 2, cursor: 'p:t3_a|g:' });
  assert.ok(urls.priority.includes('after=t3_a'));
  assert.equal(urls.global, null);
  const merged = mergeRedditResults({ items: items.slice(0, 2), after: 'x' }, { items: items.slice(1, 3), after: null });
  assert.equal(merged.items.length, 3);
  assert.equal(merged.cursor, 'p:x|g:');
});

test('safety rules', () => {
  assert.equal(isQueryAllowed('missionary'), true);
  assert.equal(isQueryAllowed('teen 18+'), true);
  assert.equal(isQueryAllowed('loli'), false);
  assert.equal(isQueryAllowed('15 yo'), false);
  assert.equal(isQueryAllowed('16 ans'), false);
  assert.equal(isQueryAllowed('enfant'), false);
  assert.equal(isBlockedText('kidding around'), false);
  assert.equal(isItemAllowed({ src: 'rule34', title: 'ok', tags: ['young'] }), false);
  assert.equal(isItemAllowed({ src: 'xvideos', title: 'ok', tags: [] }), true);
});

async function call(path, headers = {}) {
  const res = await worker.fetch(new Request(`https://searchx.test${path}`, { headers }), {}, { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}

test('worker /api/search for every source', async () => {
  for (const src of ['xvideos', 'xhamster', 'redtube', 'eporner', 'rule34', 'redgifs', 'reddit']) {
    const { status, body } = await call(`/api/search?src=${src}&q=missionary&page=1`);
    assert.equal(status, 200, `${src}: ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);
    assert.ok(body.items.length > 0, src);
    body.items.forEach(it => assertItem(it, src));
  }
});

test('worker resolves rule34 tags and filters blocked queries', async () => {
  const r = await call('/api/search?src=rule34&q=missionary');
  assert.deepEqual(r.body.tags, ['missionary']);
  const blocked = await call('/api/search?src=xvideos&q=loli');
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.ok, false);
  const sugg = await call('/api/suggest?q=missio');
  assert.ok(sugg.body.tags.length >= 1);
  assert.ok(!sugg.body.tags.some(t => t.tag === 'loli'));
});

test('worker reports upstream errors in French', async () => {
  globalThis.fetch = F.mockFetch('', { failSources: ['xhamster', 'rule34', 'xvideos'] });
  try {
    const x = await call('/api/search?src=xhamster&q=a');
    assert.equal(x.body.ok, false);
    assert.match(x.body.error, /403/);
    const r = await call('/api/search?src=rule34&q=a');
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /clé API/);
    const v = await call('/api/search?src=xvideos&q=a');
    assert.match(v.body.error, /429/);
  } finally {
    globalThis.fetch = F.mockFetch('');
  }
});

test('worker access key + unknown routes', async () => {
  const res = await worker.fetch(new Request('https://searchx.test/api/search?src=xvideos&q=a'), { ACCESS_KEY: 'k1' }, {});
  assert.equal(res.status, 401);
  const ok = await worker.fetch(new Request('https://searchx.test/api/search?src=xvideos&q=a', { headers: { 'x-sx-key': 'k1' } }), { ACCESS_KEY: 'k1' }, {});
  assert.equal(ok.status, 200);
  const h = await call('/api/health');
  assert.equal(h.body.ok, true);
  const nf = await call('/api/nope');
  assert.equal(nf.status, 404);
  const dl = await call('/api/dl?url=https://evil.example.com/x.mp4');
  assert.equal(dl.status, 400);
});

test('xvideos parser handles mobile attribute order', () => {
  const items = parseXVideos(F.xvideosMobileHTML(3));
  assert.equal(items.length, 3);
  assert.equal(items[0].id, 'xvideos:70000');
});

test('pullpush parser + urls', () => {
  const r = parsePullPush({ data: F.redditJSON(8).data.children.map(c => c.data) });
  assert.equal(r.items.length, 6);
  assert.match(r.cursor, /^pp:\d+$/);
  assert.ok(pullpushUrl({ q: 'a b', cursor: 'pp:123' }).includes('before=123'));
  assert.ok(redgifsSearchUrl({ q: 'x', media: 'image' }).includes('type=i'));
  assert.ok(epornerSearchUrl({ q: 'x', hd: 'hd' }).includes('lq=0'));
});

test('reddit gif posts get an animated preview', () => {
  const { items } = parseRedditListing(F.redditJSON(4));
  assert.equal(items.find(i => i.type === 'video').preview, null);
});

test('worker explains unexpected pages (anti-bot / region)', async () => {
  globalThis.fetch = F.mockFetch('', { failSources: ['xvideos-challenge', 'eporner-geo'] });
  try {
    const x = await call('/api/search?src=xvideos&q=diag1');
    assert.equal(x.body.ok, false);
    assert.match(x.body.error, /anti-robot/);
    assert.match(x.body.debug, /Just a moment/);
    const e = await call('/api/search?src=eporner&q=diag2');
    assert.equal(e.body.ok, false);
    assert.match(e.body.error, /région/);
  } finally {
    globalThis.fetch = F.mockFetch('');
  }
});

test('worker reddit falls back to PullPush when Reddit refuses', async () => {
  globalThis.fetch = F.mockFetch('', { failSources: ['reddit'] });
  try {
    const r = await call('/api/search?src=reddit&q=fallback1');
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    assert.ok(r.body.items.length > 0);
    assert.match(r.body.cursor, /^pp:/);
    globalThis.fetch = F.mockFetch('', { failSources: ['reddit', 'pullpush'] });
    const r2 = await call('/api/search?src=reddit&q=fallback2');
    assert.equal(r2.body.ok, false);
    assert.match(r2.body.error, /PullPush/);
  } finally {
    globalThis.fetch = F.mockFetch('');
  }
});
