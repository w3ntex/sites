import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as F from './fixtures.mjs';
import worker from '../src/worker.js';
import { parseNitterRss, pickTwitterVideo, accountOf, twimgUrl } from '../src/sources/x.js';
import { parseHstream, hstreamUrl } from '../src/sources/hstream.js';
import { parseR34Video, r34videoUrl } from '../src/sources/r34video.js';
import { danbooruTags } from '../src/sources/danbooru.js';
import { yandereTags } from '../src/sources/yandere.js';
import { redgifsSearchUrl, danbooruPostsUrl, parseDanbooru, parseYandere } from '../public/js/shared/apis.js';
import { isQueryAllowed, isItemAllowed } from '../public/js/shared/safety.js';

const realFetch = globalThis.fetch;
const api = async path => {
  const res = await worker.fetch(new Request(`https://searchx.test${path}`), {}, { waitUntil() {} });
  return { status: res.status, body: await res.json() };
};
const withFetch = async (opts, fn) => {
  const prev = globalThis.fetch;
  globalThis.fetch = F.mockFetch('', opts);
  try { return await fn(); } finally { globalThis.fetch = prev; }
};
before(() => { globalThis.fetch = F.mockFetch(''); });
after(() => { globalThis.fetch = realFetch; });

test('RedGIFs: words go in `query` (not the ignored search_text), hentai scope keeps to the Hentai tag', () => {
  const u = new URL(redgifsSearchUrl({ q: 'blonde milf', page: 2, sort: 'relevance' }));
  assert.equal(u.searchParams.get('query'), 'blonde milf');
  assert.equal(u.searchParams.get('search_text'), null);
  assert.equal(u.searchParams.get('order'), 'score');
  assert.equal(u.searchParams.get('page'), '2');
  assert.equal(new URL(redgifsSearchUrl({ q: 'x', sort: 'newest' })).searchParams.get('order'), 'latest');
  assert.equal(new URL(redgifsSearchUrl({ q: 'x', sort: 'rating' })).searchParams.get('order'), 'top28');
  assert.equal(new URL(redgifsSearchUrl({ q: 'elf', scope: 'hentai' })).searchParams.get('tags'), 'Hentai');
});

test('RedGIFs through the Worker, including a "WrongSender" token (server address changed)', async () => {
  const ok = await api('/api/search?src=redgifs&q=blonde&fresh=1');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.items.length > 30);
  await withFetch({ failSources: ['redgifs-wrongsender'] }, async () => {
    const r = await api('/api/search?src=redgifs&q=wrongsender&fresh=1');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.items.length > 30);
  });
});

test('X: account media feed, search, and media addresses', async () => {
  assert.equal(accountOf('@Some_Name'), 'Some_Name');
  assert.equal(accountOf('from:abc'), 'abc');
  assert.equal(accountOf('blonde'), null);
  assert.equal(twimgUrl('http://n.example/pic/media%2FHXabc.jpg'), 'https://pbs.twimg.com/media/HXabc.jpg');
  assert.equal(twimgUrl('http://n.example/pic/https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F1%2Fa.jpg'), 'https://pbs.twimg.com/profile_images/1/a.jpg');

  const { items, profile } = parseNitterRss(F.nitterRss({ account: 'samplecreator', n: 4 }));
  assert.deepEqual(profile, { name: 'Sample Creator', user: 'samplecreator', avatar: 'https://pbs.twimg.com/profile_images/111/avatar_400x400.jpg' });
  assert.deepEqual(items.map(i => i.type), ['image', 'video', 'gif', 'image', 'image']); // the last post has 2 photos
  assert.equal(items[0].media, 'https://pbs.twimg.com/media/HXsample0A.jpg?name=large');
  assert.equal(items[1].media, null); // resolved when opened
  assert.equal(items[2].media, 'https://video.twimg.com/tweet_video/GIFsample2.mp4');
  assert.match(items[0].url, /^https:\/\/x\.com\/samplecreator\/status\/\d+$/);
  assert.deepEqual(items[0].by, ['@samplecreator']);

  const acc = await api('/api/search?src=x&q=%40samplecreator&fresh=1');
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal(acc.body.profile.user, 'samplecreator');
  assert.ok(acc.body.items.length >= 12);
  const s = await api('/api/search?src=x&q=sunset&fresh=1');
  assert.equal(s.status, 200);
  assert.ok(s.body.items.length > 0);
  const missing = await api('/api/search?src=x&q=%40nobody&fresh=1');
  assert.equal(missing.status, 502);
  assert.match(missing.body.error, /n'existe pas/);
});

test('X: video address from a post page, best mp4 first', async () => {
  const v = pickTwitterVideo(F.nitterStatusHtml('2100000000000000001'));
  assert.equal(v.hls, false);
  assert.match(v.url, /1080x1920\/big\.mp4/);
  const r = await api('/api/xvideo?user=samplecreator&id=2100000000000000001');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.url, /^https:\/\/video\.twimg\.com\/.+big\.mp4/);
  const bad = await api('/api/xvideo?user=a%2Fb&id=1');
  assert.equal(bad.status, 502);
});

test('X: no mirror answering gives a clear message; strict safety applies', async () => {
  await withFetch({ failSources: ['x'] }, async () => {
    const r = await api('/api/search?src=x&q=blonde&fresh=1');
    assert.equal(r.status, 502);
    assert.match(r.body.error, /miroir/);
  });
  const refused = await api('/api/search?src=x&q=teen');
  assert.equal(refused.status, 400);
  assert.equal(isQueryAllowed('teen'), true); // tube sites: 18+ performers
  assert.equal(isQueryAllowed('teen', { drawn: true }), false);
  assert.equal(isItemAllowed({ src: 'x', title: 'my daughter', tags: [] }, { drawn: true }), false);
});

test('Hstream: genres searched as genres, school-girl always excluded, parser', async () => {
  const g = new URL(hstreamUrl({ q: 'Tentacles', sort: 'views' }));
  assert.deepEqual(g.searchParams.getAll('tags[]'), ['tentacle']);
  assert.deepEqual(g.searchParams.getAll('blacklist[]'), ['school-girl']);
  assert.equal(g.searchParams.get('order'), 'view-count');
  assert.equal(new URL(hstreamUrl({ q: 'kyonyuu elf oyako', page: 2 })).searchParams.get('search'), 'kyonyuu elf oyako');
  const items = parseHstream(F.hstreamHtml(6));
  assert.equal(items.length, 6);
  assert.equal(items[0].thumb, 'https://hstream.moe/images/hentai/sample-series-1/gallery-ep-1-0-thumbnail.webp');
  assert.equal(items[0].url, 'https://hstream.moe/hentai/sample-series-1-1');
  assert.equal(items[0].title, 'Sample Series 1 - 1');
  assert.equal(items[0].h, 2160);
  assert.equal(items[1].h, 1080);
  assert.equal(items[0].views, 100000);
  assert.equal(items[0].likes, 300);
  const r = await api('/api/search?src=hstream&q=elf&fresh=1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 25);
  assert.equal(r.body.more, true);
});

test('Rule34Video: parser, embed player and preview clips', async () => {
  assert.equal(r34videoUrl({ q: 'Monster Girl', page: 2 }), 'https://rule34video.com/search/monster-girl/2/');
  const items = parseR34Video(F.r34videoHtml(4));
  assert.equal(items.length, 4);
  assert.equal(items[0].embed, 'https://rule34video.com/embed/3500000');
  assert.match(items[0].preview, /_preview\.mp4\/$/);
  assert.equal(items[1].dur, 71);
  assert.equal(items[1].h, 720);
  assert.equal(items[0].h, null);
  const r = await api('/api/search?src=r34video&q=elf&fresh=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 24);
});

test('Danbooru: words become real tags, 2-tag limit respected, only explicit posts kept', async () => {
  const fetchJSON = async url => (await fetch(url)).json();
  assert.deepEqual(await danbooruTags('milf', fetchJSON), ['mature_female']);
  assert.deepEqual(await danbooruTags('tentacle', fetchJSON), ['tentacles']);
  assert.deepEqual(await danbooruTags('elf, maid, extra', fetchJSON), ['elf', 'maid']);
  assert.equal(new URL(danbooruPostsUrl({ tags: ['elf'] })).searchParams.get('tags'), 'elf rating:e');
  assert.equal(new URL(danbooruPostsUrl({ tags: ['elf', 'maid'] })).searchParams.get('tags'), 'elf maid');
  const items = parseDanbooru(F.danbooruJSON(6));
  assert.equal(items.length, 7); // 6 + the minor-tagged one (dropped later by safety); 'q' and zip skipped
  assert.equal(items[2].type, 'video');
  assert.equal(items[0].thumb, 'https://cdn.donmai.us/720x720/aa/bb/file0.webp');
  const r = await api('/api/search?src=danbooru&q=elf&fresh=1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 6);
  assert.ok(r.body.items.every(i => !i.tags.includes('oppai_loli')));
});

test('Yande.re: tag resolution and parser', async () => {
  assert.deepEqual(await yandereTags('tentacle'), ['tentacles']);
  const items = parseYandere(F.yandereJSON(3));
  assert.equal(items.length, 3);
  assert.equal(items[0].thumb, 'https://files.yande.re/sample/h0/sample.jpg');
  assert.equal(items[0].full, 'https://files.yande.re/image/h0/file.png');
  const r = await api('/api/search?src=yandere&q=elf&fresh=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 5);
});
