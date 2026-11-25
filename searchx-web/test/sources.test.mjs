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

test('X: an account keeps going page after page (Nitter Min-Id cursor)', async () => {
  const p1 = await api('/api/search?src=x&q=%40pagedcreator&fresh=1');
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  assert.equal(p1.body.more, true);
  assert.equal(p1.body.cursor, 'p2');
  const p2 = await api(`/api/search?src=x&q=%40pagedcreator&page=2&cursor=${p1.body.cursor}&fresh=1`);
  assert.equal(p2.status, 200, JSON.stringify(p2.body));
  assert.equal(p2.body.cursor, 'p3');
  const ids1 = new Set(p1.body.items.map(i => i.id));
  assert.ok(p2.body.items.length > 0 && p2.body.items.every(i => !ids1.has(i.id)), 'new posts on page 2');
  const p3 = await api(`/api/search?src=x&q=%40pagedcreator&page=3&cursor=${p2.body.cursor}&fresh=1`);
  assert.equal(p3.body.more, false, 'last page');
  assert.equal(p3.body.cursor, null);
  const s2 = await api('/api/search?src=x&q=sunset&page=2&cursor=p2&fresh=1');
  assert.equal(s2.status, 200);
  assert.ok(s2.body.items.length > 0, 'keyword searches page too');
  const none = await api('/api/search?src=x&q=%40pagedcreator&page=2&fresh=1');
  assert.deepEqual(none.body.items, [], 'no cursor: no next page');
});

test('X: account suggestions (Nitter account search)', async () => {
  const { parseNitterUsers } = await import('../src/sources/x.js');
  const users = parseNitterUsers(F.nitterUsersHtml('palace'));
  assert.deepEqual(users.map(u => u.user), ['palace', 'palace_vids', 'thepalace', 'palace_priv']);
  assert.equal(users[0].name, 'Palace 🏰');
  assert.equal(users[0].verified, true);
  assert.equal(users[1].verified, false);
  assert.equal(users[3].locked, true);
  assert.equal(users[0].avatar, 'https://pbs.twimg.com/profile_images/16/palace_bigger.jpg');
  assert.equal(users[0].bio, 'Official palace & friends');
  assert.deepEqual(parseNitterUsers('<div class="timeline"><div class="timeline-none">No items found</div></div>'), []);
  const r = await api('/api/xusers?q=%40palace');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.users.length, 4);
  assert.equal(r.body.users[0].user, 'palace');
  assert.deepEqual((await api('/api/xusers?q=p')).body.users, [], 'too short: nothing asked');
});

test('X: "Load more" cursor of a Nitter HTML timeline', async () => {
  const { nitterShowMoreCursor } = await import('../src/sources/x.js');
  const html = '<div class="timeline"><div class="timeline-item">…</div><div class="show-more"><a href="?cursor=DAABCgABG%2Bx_y-z">Load more</a></div></div>';
  assert.equal(nitterShowMoreCursor(html), 'DAABCgABG+x_y-z');
  assert.equal(nitterShowMoreCursor('<div class="timeline"></div>'), '');
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

// Formats seen on the live sites in November 2026: attributes on their own lines (Hstream), two spaces
// before title= and lazy images with a placeholder src (Rule34Video).
test('Hstream: current markup (multi-line tags)', () => {
  const block = i => `<div
                    wire:key="episode-${2000 + i}">
    <div class="group w-full p-1">
    <a
        href="https://hstream.moe/hentai/sample-show-${i}"
        class="block overflow-hidden rounded-2xl"
    >
        <div class="relative overflow-hidden">
            <!--[if BLOCK]><![endif]-->                                <img
                    src="/images/hentai/sample-show/gallery-ep-${i}-0-thumbnail.webp"
                    alt="Sample Show - ${i}"
                    loading="lazy"
                    data-gallery='["\\/images\\/x.webp"]'
                    class="preview-gallery aspect-video"
                >
            <div class="ml-auto rounded-full bg-black/70 px-2 py-1 text-[11px]">
                    4k | FHD 48fps
                </div>
                <h3 class=" text-sm font-semibold">
                    Sample Show - ${i}
                </h3>
                        <span class="flex items-center gap-1">
                            <i class="fa-regular fa-eye text-neutral-200 font-bold"></i>
                            98k
                        </span>
                        <span class="flex items-center gap-1">
                            <i class="fa-regular fa-heart text-neutral-200 font-bold"></i>
                            226
                        </span>
    </a>
</div></div>
`;
  const items = parseHstream(`<html><body>${block(1)}${block(2)}</body></html>`);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://hstream.moe/hentai/sample-show-1');
  assert.equal(items[0].thumb, 'https://hstream.moe/images/hentai/sample-show/gallery-ep-1-0-thumbnail.webp');
  assert.equal(items[0].title, 'Sample Show - 1');
  assert.equal(items[0].h, 2160);
  assert.equal(items[0].views, 98000);
  assert.equal(items[0].likes, 226);
});

test('Rule34Video: current markup (double spaces, lazy images, views and rating)', () => {
  const card = (id, lazy) => `<div class="item thumb video_1   " data-video-card-id="${id}" >
								<a class="th" href="https://rule34video.com/video/${id}/sample/"  title="Sample &amp; co">
					<div class="img wrap_image" data-watched-label="Watched" data-preview="https://rule34video.com/get_file/47/abc/${id}/${id}_preview.mp4/">
						${lazy
    ? `<img class="thumb rd-lz" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP" data-rd-src="https://rule34video.com/contents/videos_screenshots/1/${id}/336x189/1.jpg" alt="Sample" width="320" height="180" loading="lazy"/>`
    : `<img class="thumb" src="https://rule34video.com/contents/videos_screenshots/1/${id}/336x189/3.jpg" alt="Sample" width="320" height="180" loading="eager"/>`}
						<div class="quality"><svg class="custom-svg custom-hd"></svg></div>
						<div class="time">2:37</div>
					</div>
					<div class="thumb_title">Sample</div>
						<div class="rating video-card-meta__item"> <svg></svg>
							96% (78)
						</div>
						<div class="views video-views-count" title="Views: 237K" aria-label="Views: 237K"> 237K </div>
				</a>
							</div>
`;
  const items = parseR34Video(`<html><body>${card(4213254, false)}${card(4440929, true)}</body></html>`);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://rule34video.com/video/4213254/sample/');
  assert.equal(items[0].title, 'Sample & co');
  assert.equal(items[0].dur, 157);
  assert.equal(items[0].views, 237000);
  assert.equal(items[0].rating, 96);
  assert.equal(items[1].thumb, 'https://rule34video.com/contents/videos_screenshots/1/4440929/336x189/1.jpg', 'lazy image: the real picture, not the placeholder');
  assert.equal(items[1].embed, 'https://rule34video.com/embed/4440929');
});

test('X: Nitter /pic/ addresses in every form (plain, host, https, orig, base64)', async () => {
  const { twimgUrl } = await import('../src/sources/x.js');
  const b64 = s => Buffer.from(s).toString('base64url');
  assert.equal(twimgUrl('/pic/media%2FHXabc.jpg'), 'https://pbs.twimg.com/media/HXabc.jpg');
  assert.equal(twimgUrl('/pic/pbs.twimg.com%2Fprofile_images%2F1%2Fa_bigger.jpg'), 'https://pbs.twimg.com/profile_images/1/a_bigger.jpg');
  assert.equal(twimgUrl('http://n.example/pic/https%3A%2F%2Fpbs.twimg.com%2Fmedia%2FX.jpg'), 'https://pbs.twimg.com/media/X.jpg');
  assert.equal(twimgUrl('/pic/orig/media%2FX.jpg'), 'https://pbs.twimg.com/media/X.jpg');
  assert.equal(twimgUrl(`/pic/enc/${b64('media/HXenc.jpg')}`), 'https://pbs.twimg.com/media/HXenc.jpg');
  assert.equal(twimgUrl(`/pic/orig/enc/${b64('pbs.twimg.com/media/HXorig.jpg')}`), 'https://pbs.twimg.com/media/HXorig.jpg');
  assert.equal(twimgUrl(`/pic/enc/${b64('amplify_video_thumb/1/img/t.jpg')}`), 'https://pbs.twimg.com/amplify_video_thumb/1/img/t.jpg');
  assert.equal(twimgUrl('https://example.com/x.jpg'), null);
});
