// X account in something shared from the X app (used by the server and by the app).
//   https://x.com/PornPalace?s=21&t=…           → PornPalace (profile)
//   https://twitter.com/user/status/123?s=46     → user (a post: its author)
//   "@user", "user", fxtwitter / vxtwitter / fixupx links, URL-encoded or not

const RESERVED = new Set([
  'home', 'i', 'search', 'explore', 'settings', 'messages', 'notifications', 'hashtag', 'intent', 'share',
  'compose', 'login', 'logout', 'signup', 'tos', 'privacy', 'about', 'account', 'jobs', 'download', 'status',
  'lists', 'communities', 'premium', 'verified', 'bookmarks', 'topics', 'help', 'x', 'twitter'
]);

export function xUserFromShared(raw) {
  let s = String(raw || '');
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(s); i++) {
    try { s = decodeURIComponent(s.replace(/\+/g, ' ')); } catch { break; }
  }
  const link = /(?:^|[^\w.-])(?:(?:www|mobile)\.)?(?:fx|vx|fixup|fixv)?(?:x|twitter)\.com\/(?:#!\/)?([A-Za-z0-9_]{1,15})(?=$|[/?#&\s"'])/gi;
  for (const m of s.matchAll(link)) {
    if (!RESERVED.has(m[1].toLowerCase())) return m[1];
  }
  const at = /(?:^|[^\w@])@([A-Za-z0-9_]{1,15})(?![\w@])/.exec(s);
  if (at && !RESERVED.has(at[1].toLowerCase())) return at[1];
  const plain = /^\s*(?:u=)?([A-Za-z0-9_]{1,15})\s*$/.exec(s);
  return plain && !RESERVED.has(plain[1].toLowerCase()) ? plain[1] : null;
}
