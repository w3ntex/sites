// Fake upstream responses in each site's real format. Used by the unit tests and by
// `npm run dev:mock` (thumbnails then point to local placeholder images).

const WORDS = ['Sunset', 'Beach', 'Studio', 'Weekend', 'Night', 'City', 'Lake', 'Summer', 'Session', 'Holiday', 'Garden', 'Morning'];
const title = (src, i) => `${WORDS[i % WORDS.length]} ${WORDS[(i * 5 + 3) % WORDS.length].toLowerCase()} ${src} clip ${i + 1}`;
const CREATORS = ['Alfacontent World', 'dick_dickson', 'Violet Studio', 'bigpainter123', 'maldoai', 'NightOwlFilms'];

export function thumbUrl(base, src, i) {
  return base ? `${base}/__mock/img/${src}-${i}.svg` : `https://cdn.example.com/${src}/${i}.jpg`;
}

export function xvideosHTML(n = 24, base = '', page = 1) {
  let out = '<html><body><div id="content"><div class="mozaique">';
  for (let k = 0; k < n; k++) {
    const i = (page - 1) * n + k;
    const id = 70000 + i;
    out += `<div id="video_${id}" data-id="${id}" class="frame-block thumb-block tb_full_init">` +
      `<div class="thumb-inside"><div class="thumb"><a href="/video.oa${id}/sample_${i}">` +
      `<img src="https://static-cdn77.xvideos-cdn.com/v3/img/skins/default/lightbox/blank.gif" data-src="${thumbUrl(base, 'xvideos', i)}" id="pic_${id}" /></a></div>` +
      (i % 3 === 0 ? '<span class="video-hd-mark">1080p</span>' : i % 3 === 1 ? '<span class="video-hd-mark">720p</span>' : '') +
      `</div><div class="thumb-under"><p class="title"><a href="/video.oa${id}/sample_${i}" title="${title('xvideos', i)} &amp; more">${title('xvideos', i)}` +
      `<span class="duration">${(i % 5) * 7 + 3} min</span></a></p><p class="metadata"><span class="bg"><span class="duration">${(i % 5) * 7 + 3} min</span>` +
      `<span><a href="/channels/c"><span class="name">${CREATORS[i % CREATORS.length]}</span></a></span>` +
      `<span><span class="sprfluous"> - </span>${(i % 9) + 1}.${i % 10}M <span class="sprfluous">Views</span></span></span></p></div></div>\n`;
  }
  return out + '</div></div></body></html>';
}

export function xhamsterHTML(n = 24, base = '', page = 1) {
  const videos = [];
  for (let k = 0; k < n; k++) {
    const i = (page - 1) * n + k;
    videos.push({
      id: 900000 + i,
      title: title('xhamster', i),
      duration: 300 + i * 97,
      views: 10000 * (i + 1),
      pageURL: `https://xhamster.com/videos/sample-${i}-xh${i}`,
      thumbURL: thumbUrl(base, 'xhamster', i),
      isHD: i % 2 === 0,
      isUHD: i % 7 === 0,
      created: 1730000000 - i * 3600,
      landing: { name: CREATORS[(i + 2) % CREATORS.length] }
    });
  }
  const initials = { searchResult: { videoThumbProps: videos }, other: { foo: [1, 2, 3] } };
  return `<html><head><script>window.initials=${JSON.stringify(initials)};</script></head><body><div class="thumb-list"></div></body></html>`;
}

export function redtubeJSON(n = 20, base = '', page = 1) {
  const videos = [];
  for (let k = 0; k < n; k++) {
    const i = (page - 1) * n + k;
    videos.push({
      video: {
        duration: `${10 + (i % 40)}:${String(i % 60).padStart(2, '0')}`,
        views: 2200000 - i * 1000,
        video_id: String(40000000 + i),
        rating: String(70 + (i % 30)),
        ratings: 100,
        title: title('redtube', i),
        url: `https://www.redtube.com/${40000000 + i}`,
        default_thumb: thumbUrl(base, 'redtube', i),
        thumb: thumbUrl(base, 'redtube', i),
        publish_date: `2025-0${(i % 9) + 1}-1${i % 9} 10:00:00`,
        thumbs: [{ size: 'big', width: 432, height: 324, src: thumbUrl(base, 'redtube', i) }],
        tags: [{ tag_name: 'Sample' }],
        pornstars: i % 2 ? [{ pornstar_name: CREATORS[i % CREATORS.length] }] : []
      }
    });
  }
  return { count: 1000, videos };
}

export function epornerJSON(n = 40, base = '', page = 1) {
  const videos = [];
  for (let k = 0; k < n; k++) {
    const i = (page - 1) * n + k;
    videos.push({
      id: `EP${i}abc`,
      title: title('eporner', i),
      keywords: 'sample, test, clip',
      views: 50000 + i * 321,
      rate: (3 + (i % 20) / 10).toFixed(2),
      url: `https://www.eporner.com/video-EP${i}abc/sample-${i}/`,
      added: '2025-06-01 12:00:00',
      length_sec: 600 + i * 61,
      length_min: '10:00',
      embed: `https://www.eporner.com/embed/EP${i}abc/`,
      default_thumb: { size: 'big', width: 640, height: 360, src: thumbUrl(base, 'eporner', i) },
      thumbs: []
    });
  }
  return { count: n, start: 0, per_page: n, page, time_ms: 10, total_count: 400, total_pages: 10, videos };
}

export function rule34JSON(n = 42, base = '', page = 1, tag = 'missionary_position') {
  const posts = [];
  for (let k = 0; k < n; k++) {
    const i = (page - 1) * n + k;
    const ext = i % 6 === 0 ? 'mp4' : i % 6 === 1 ? 'gif' : 'jpg';
    posts.push({
      preview_url: thumbUrl(base, 'rule34', i),
      sample_url: thumbUrl(base, 'rule34', i),
      file_url: ext === 'jpg' ? thumbUrl(base, 'rule34', i) : `https://api-cdn-mp4.rule34.xxx/images/${i}/file.${ext}`,
      directory: 1, hash: 'abc', width: 1920, height: 1080, id: 8000000 + i, image: `file.${ext}`,
      change: 1730000000 - i * 60, owner: CREATORS[(i + 4) % CREATORS.length], parent_id: 0, rating: 'explicit',
      sample: true, sample_height: 850, sample_width: 1511, score: 100 - i, tags: `1girl ${tag} solo sample_art`,
      source: '', status: 'active', has_notes: false, comment_count: 0
    });
  }
  return posts;
}

export const rule34Autocomplete = q => [
  { label: `${q}_position (234567)`, value: `${q}_position`, type: 'general' },
  { label: `${q} (1200)`, value: q, type: 'general' },
  { label: `${q}_sex (99)`, value: `${q}_sex`, type: 'general' },
  { label: 'loli (5)', value: 'loli', type: 'general' }
];

export function redgifsJSON(n = 40, base = '', page = 1) {
  const gifs = [];
  for (let k = 0; k < n; k++) {
    const i = (page - 1) * n + k;
    gifs.push({
      id: `sampleclip${i}`, createDate: 1730000000 - i * 100, hasAudio: i % 2 === 0, width: 1080, height: 1920,
      likes: 500 - i, tags: ['Sample', 'Clip'], verified: true, views: 20000 - i * 10, duration: 12.5, published: true,
      type: i % 8 === 7 ? 2 : 1, userName: CREATORS[(i + 1) % CREATORS.length], description: i % 3 ? title('redgifs', i) : '',
      urls: {
        sd: `https://media.redgifs.com/Sample${i}-mobile.mp4`, hd: `https://media.redgifs.com/Sample${i}.mp4`,
        poster: thumbUrl(base, 'redgifs', i), thumbnail: thumbUrl(base, 'redgifs', i)
      }
    });
  }
  return { page, pages: 5, total: 200, gifs };
}

export function redditJSON(n = 25, base = '', after = 't3_next') {
  const children = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 4;
    const p = {
      id: `abc${i}`, title: title('reddit', i), subreddit: 'nsfw', permalink: `/r/nsfw/comments/abc${i}/sample/`,
      over_18: true, is_self: false, ups: 900 - i, upvote_ratio: 0.95, created_utc: 1730000000 - i * 500,
      thumbnail: thumbUrl(base, 'reddit', i), domain: 'i.redd.it', author: `user${i % 5}`,
      preview: { images: [{ source: { url: thumbUrl(base, 'reddit', i).replace(/&/g, '&amp;'), width: 1080, height: 1350 }, resolutions: [], variants: {} }] }
    };
    if (kind === 0) { p.post_hint = 'image'; p.url = `https://i.redd.it/sample${i}.jpg`; }
    if (kind === 1) {
      p.is_video = true; p.domain = 'v.redd.it'; p.url = `https://v.redd.it/sample${i}`;
      p.secure_media = { reddit_video: { fallback_url: `https://v.redd.it/sample${i}/DASH_720.mp4?source=fallback`, duration: 45, height: 720, is_gif: false } };
    }
    if (kind === 2) { p.domain = 'redgifs.com'; p.url = `https://www.redgifs.com/watch/sampleclip${i}`; p.post_hint = 'rich:video'; }
    if (kind === 3) { p.is_self = true; } // text post: must be skipped
    children.push({ kind: 't3', data: p });
  }
  // A non-NSFW post that must be filtered out.
  children.push({ kind: 't3', data: { id: 'sfw', title: 'sfw', over_18: false, permalink: '/r/pics/x', url: 'https://i.redd.it/x.jpg', post_hint: 'image', preview: { images: [{ source: { url: 'https://x/y.jpg' } }] } } });
  return { kind: 'Listing', data: { after, children } };
}

// ---- v2.5 sources ---------------------------------------------------------------------------------

export const NITTER = 'nitter.mie.foundation';

/** Nitter RSS: photos, videos, X "GIFs" and a two-photo post (search or account media feed). */
export function nitterRss({ account = null, n = 8, q = 'sample' } = {}) {
  const title = account ? `Sample Creator / @${account}` : `Search results for "${q}"`;
  const image = account ? `<image><title>${title}</title><link>http://${NITTER}/${account}</link><url>http://${NITTER}/pic/https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F111%2Favatar_400x400.jpg</url><width>128</width><height>128</height></image>` : '';
  let items = '';
  for (let i = 0; i < n; i++) {
    const user = account || `creator${i % 3}`;
    const id = 2100000000000000000n + BigInt(i);
    const kind = i % 4;
    const link = `http://${NITTER}/${user}/status/${id}#m`;
    let media;
    if (kind === 0) media = `<img src="http://${NITTER}/pic/media%2FHXsample${i}A.jpg" style="max-width:250px;" />`;
    else if (kind === 1) media = `<a href="${link}"> <br>Video<br> <img src="http://${NITTER}/pic/amplify_video_thumb%2F${id}%2Fimg%2Fthumb${i}.jpg" style="max-width:250px;" /> </a>`;
    else if (kind === 2) media = `<a href="${link}"> <br>Gif<br> <img src="http://${NITTER}/pic/tweet_video_thumb%2FGIFsample${i}.jpg" style="max-width:250px;" /> </a>`;
    else media = `<img src="http://${NITTER}/pic/media%2FHXsample${i}A.jpg" style="max-width:250px;" /> <img src="http://${NITTER}/pic/media%2FHXsample${i}B.jpg" style="max-width:250px;" />`;
    const text = `Sample post ${i + 1} about ${q}`;
    items += `<item><title>${text}</title><dc:creator>@${user}</dc:creator><description><![CDATA[<p>${text}</p> ${media}]]></description>` +
      `<pubDate>Fri, 20 Nov 2026 0${i % 10}:00:01 GMT</pubDate><guid isPermaLink="false">${id}</guid><link>${link}</link></item>\n`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0"><channel>` +
    `<title>${title}</title><link>http://${NITTER}/${account || 'search'}</link><description>Twitter feed</description>${image}\n${items}</channel></rss>`;
}

/** A Nitter post page with a video (HLS player + download links in two sizes). */
export function nitterStatusHtml(id = '2100000000000000001') {
  const v = encodeURIComponent(`https://video.twimg.com/amplify_video/${id}/vid/avc1/720x1280/small.mp4?tag=29`);
  const big = encodeURIComponent(`https://video.twimg.com/amplify_video/${id}/vid/avc1/1080x1920/big.mp4?tag=29`);
  const hls = encodeURIComponent(`https://video.twimg.com/amplify_video/${id}/pl/list.m3u8?tag=29&v=081`);
  return `<html><body><div class="main-tweet"><video poster="/pic/amplify_video_thumb%2F${id}%2Fimg%2Fx.jpg" data-url="/video/AB12/${hls}" data-autoload="false" data-type="hls"></video>` +
    `<a class="video-download" href="/video/CD34/${v}" download="">small</a><a class="video-download" href="/video/EF56/${big}" download="">big</a></div></body></html>`;
}

export function hstreamHtml(n = 12, page = 1) {
  let out = '<html><head><title>Search | hstream.moe</title></head><body><input type="hidden" id="ts_reference" value="1" /><div class="grid">';
  for (let k = 0; k < n; k++) {
    const i = (page - 1) * n + k;
    const slug = `sample-series-${Math.floor(i / 2) + 1}-${(i % 2) + 1}`;
    out += `<div wire:key="episode-${1000 + i}"> <div class="group w-full p-1"> <a href="https://hstream.moe/hentai/${slug}" class="block overflow-hidden rounded-2xl" >` +
      ` <div class="relative overflow-hidden"> <img src="/images/hentai/sample-series-${Math.floor(i / 2) + 1}/gallery-ep-${(i % 2) + 1}-0-thumbnail.webp" alt="Sample Series ${Math.floor(i / 2) + 1} - ${(i % 2) + 1}" loading="lazy" width="1000" data-gallery='["x"]' class="preview-gallery" >` +
      ` <div class="pointer-events-none absolute inset-x-0 top-0 z-20 flex"> <div class="ml-auto rounded-full bg-black/70 px-2 py-1 text-[11px] font-semibold"> ${i % 3 === 0 ? '4k | FHD 48fps' : 'FHD'} </div> </div>` +
      ` <div class="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4"> <h3 class=" text-sm font-semibold"> Sample Series ${Math.floor(i / 2) + 1} - ${(i % 2) + 1} </h3>` +
      ` <div class="mt-3 flex"> <span class="flex items-center gap-1"> <i class="fa-regular fa-eye text-neutral-200 font-bold"></i> ${100 + i}k </span>` +
      ` <span class="flex items-center gap-1"> <i class="fa-regular fa-heart text-neutral-200 font-bold"></i> ${300 + i} </span> </div> </div> </div> </a> </div> </div>\n`;
  }
  return out + '</div></body></html>';
}

export function r34videoHtml(n = 24) {
  let out = '<html><head><title>Search Results for sample</title></head><body><div class="thumbs">';
  for (let i = 0; i < n; i++) {
    const id = 3500000 + i;
    out += `<div class="item thumb video_${id} " data-video-card-id="${id}" > <a class="th" href="https://rule34video.com/video/${id}/sample-${i}/" title="Sample animation ${i + 1}">` +
      ` <div class="img wrap_image" data-watched-label="Watched" data-preview="https://rule34video.com/get_file/47/abc/${id}/${id}_preview.mp4/">` +
      ` <img class="thumb" src="https://rule34video.com/contents/videos_screenshots/3500000/${id}/336x189/1.jpg" alt="Sample" width="320" height="180"/>` +
      `${i % 2 ? ' <div class="quality"> <svg class="custom-svg custom-hd"><use xlink:href="#custom-hd"></use></svg> </div>' : ''}` +
      ` <div class="time">${i % 5}:${String(10 + i).padStart(2, '0')}</div> </div> <div class="thumb_title">Sample animation ${i + 1}</div> </a> </div>\n`;
  }
  return out + '</div></body></html>';
}

export function danbooruJSON(n = 6) {
  const posts = [];
  for (let i = 0; i < n; i++) {
    posts.push({
      id: 12600000 + i, rating: 'e', file_ext: i === 2 ? 'mp4' : 'jpg', score: 50 - i, image_width: 2000, image_height: 3000,
      file_url: `https://cdn.donmai.us/original/aa/bb/file${i}.${i === 2 ? 'mp4' : 'jpg'}`,
      large_file_url: `https://cdn.donmai.us/sample/aa/bb/sample-file${i}.jpg`,
      preview_file_url: `https://cdn.donmai.us/180x180/aa/bb/file${i}.jpg`,
      media_asset: { variants: [{ type: '180x180', url: `https://cdn.donmai.us/180x180/aa/bb/file${i}.jpg` }, { type: '720x720', url: `https://cdn.donmai.us/720x720/aa/bb/file${i}.webp` }] },
      tag_string: 'elf 1girl large_breasts sample_tag', tag_string_general: '1girl large_breasts', tag_string_character: i % 2 ? 'sample_character' : '',
      tag_string_artist: 'sample_artist', created_at: '2026-11-24T10:55:16.718-05:00'
    });
  }
  posts.push({ ...posts[0], id: 1, rating: 'q' });                       // not explicit: skipped
  posts.push({ ...posts[0], id: 2, file_ext: 'zip' });                    // ugoira: skipped
  posts.push({ ...posts[0], id: 3, tag_string: 'elf oppai_loli 1girl' }); // minor tag: dropped by safety
  return posts;
}

export const danbooruAutocomplete = q => (q === 'milf'
  ? [{ type: 'tag-alias', label: 'mature female', value: 'mature_female', post_count: 52007, antecedent: 'milf' }]
  : [{ type: 'tag', label: q, value: q.replace(/\s+/g, '_') + (q === 'tentacle' ? 's' : ''), post_count: 1000 }, { type: 'tag', label: `${q} x`, value: `${q.replace(/\s+/g, '_')}_x`, post_count: 5 }]);

export function yandereJSON(n = 5) {
  const posts = [];
  for (let i = 0; i < n; i++) {
    posts.push({
      id: 1273000 + i, rating: 'e', file_ext: 'png', score: 12 + i, width: 4000, height: 6000, author: 'sample_author', created_at: 1795000000 - i,
      tags: 'elf thighhighs sample_tag', file_url: `https://files.yande.re/image/h${i}/file.png`,
      sample_url: `https://files.yande.re/sample/h${i}/sample.jpg`, sample_width: 1060, preview_url: `https://assets.yande.re/data/preview/h${i}.jpg`
    });
  }
  posts.push({ ...posts[0], id: 9, rating: 's' });
  return posts;
}

/** fetch() replacement answering like the real sites (for tests / mock dev server). */
export function mockFetch(base = '', { failSources = [] } = {}) {
  let redgifsTokens = 0;
  let redgifsRetried = false;
  return async function fetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const host = url.hostname;
    const page = parseInt(url.searchParams.get('page') || url.searchParams.get('p') || url.searchParams.get('pid') || '1', 10) || 1;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    const text = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
    const failing = s => failSources.includes(s);
    await new Promise(r => setTimeout(r, 40 + Math.random() * 260));

    if (host.endsWith('xvideos.com')) {
      if (failing('xvideos')) return text('busy', 429);
      if (failing('xvideos-challenge')) return text('<html><head><title>Just a moment...</title></head><body><div id="cf-chl">Checking</div></body></html>');
      if (failing('xvideos-stub')) return text('Please visit https://www.xvideos.com');
      return text(xvideosHTML(24, base, (parseInt(url.searchParams.get('p') || '0', 10) || 0) + 1));
    }
    if (host.endsWith('xhamster.com')) {
      if (url.pathname.startsWith('/api/front/search')) return text('<html>not json</html>');
      return failing('xhamster') ? text('no', 403) : text(xhamsterHTML(24, base, page));
    }
    if (host === 'api.redtube.com') return failing('redtube') ? text('x', 500) : json(redtubeJSON(20, base, page));
    if (host.endsWith('eporner.com')) {
      if (failing('eporner')) return text('x', 503);
      if (failing('eporner-geo')) return text('<html><head><title>Eporner</title></head><body>This website is not available in your country.</body></html>');
      return json(epornerJSON(40, base, page));
    }
    if (host === 'ac.rule34.xxx' || (host === 'api.rule34.xxx' && url.pathname.includes('autocomplete'))) {
      return json(rule34Autocomplete(url.searchParams.get('q') || ''));
    }
    if (host === 'api.rule34.xxx') {
      if (failing('rule34')) return text('"Missing authentication. Go to api.rule34.xxx for more information"');
      const tags = url.searchParams.get('tags') || '';
      return json(rule34JSON(42, base, (parseInt(url.searchParams.get('pid') || '0', 10) || 0) + 1, tags.split(' ')[0]));
    }
    if (host === 'api.redgifs.com') {
      if (url.pathname.includes('/auth/temporary')) return json({ token: `tok${++redgifsTokens}` });
      if (failing('redgifs')) return json({ error: { code: 'x' } }, 401);
      if (failing('redgifs-wrongsender') && !redgifsRetried) {
        redgifsRetried = true;
        return json({ error: { code: 'WrongSender', message: 'This token belongs to a different device, please request a new one.', status: 401 } }, 401);
      }
      // The search words must be sent as `query` (RedGIFs ignores `search_text`).
      if (!url.searchParams.get('query')) return json({ page, pages: 1, total: 0, gifs: [] });
      return json(redgifsJSON(40, base, page));
    }
    if (host === NITTER || host.startsWith('nitter.')) {
      if (failing('x') || host !== NITTER) return text('<html><head><title>Attention Required! | Cloudflare</title></head></html>', 403);
      const path = url.pathname;
      if (path === '/search/rss') return new Response(nitterRss({ q: url.searchParams.get('q') || '', n: 8 }), { headers: { 'content-type': 'application/rss+xml' } });
      const acc = /^\/([A-Za-z0-9_]+)\/media\/rss$/.exec(path);
      if (acc) return acc[1] === 'nobody' ? text('User not found', 404) : new Response(nitterRss({ account: acc[1], n: 12 }), { headers: { 'content-type': 'application/rss+xml' } });
      const st = /^\/[A-Za-z0-9_]+\/status\/(\d+)$/.exec(path);
      if (st) return text(nitterStatusHtml(st[1]));
      return text('not found', 404);
    }
    if (host === 'hstream.moe') return failing('hstream') ? text('<html><title>Just a moment...</title></html>', 403) : text(hstreamHtml(url.searchParams.get('page') === '2' ? 5 : 25, page));
    if (host === 'rule34video.com') return failing('r34video') ? text('x', 503) : text(r34videoHtml(24));
    if (host === 'danbooru.donmai.us') {
      if (url.pathname === '/autocomplete.json') return json(danbooruAutocomplete(url.searchParams.get('search[query]') || ''));
      if (url.searchParams.get('tags')?.split(' ').length > 2) return json({ success: false, error: 'PostQuery::TagLimitError', message: 'You cannot search for more than 2 tags at a time.' }, 422);
      return json(danbooruJSON(6));
    }
    if (host === 'yande.re') {
      if (url.pathname === '/tag.json') return json(url.searchParams.get('name') === 'tentacle' ? [{ name: 'tentacles', count: 4043 }] : [{ name: url.searchParams.get('name'), count: 10 }]);
      return json(yandereJSON(5));
    }
    if (host.endsWith('reddit.com')) return failing('reddit') ? text('<html><title>Blocked</title>blocked</html>', 403) : json(redditJSON(25, base, page < 3 ? `t3_p${page}` : null));
    if (host === 'api.pullpush.io') {
      if (failing('pullpush')) return text('down', 502);
      return json({ data: redditJSON(25, base).data.children.map(c => c.data) });
    }
    if (host.endsWith('redgifs.com') || host.endsWith('redd.it') || host.endsWith('rule34.xxx')) {
      return new Response('MEDIA', { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '5' } });
    }
    return text('not found', 404);
  };
}

/** xVideos markup as served to phones: attribute order differs (class before id). */
export function xvideosMobileHTML(n = 3) {
  return xvideosHTML(n).replace(/<div id="video_(\d+)" data-id="(\d+)" class="([^"]+)">/g, '<div class="$3" data-id="$2" id="video_$1">');
}
