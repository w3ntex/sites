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

/** fetch() replacement answering like the real sites (for tests / mock dev server). */
export function mockFetch(base = '', { failSources = [] } = {}) {
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
      if (url.pathname.includes('/auth/temporary')) return json({ token: 'tok', addr: '1.2.3.4', agent: 'x' });
      return failing('redgifs') ? json({ error: 'x' }, 401) : json(redgifsJSON(40, base, page));
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
