import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQueryAllowed, isItemAllowed, isBlockedTag, looksDrawn, BOORU_NEGATIVE_TAGS } from '../public/js/shared/safety.js';
import { parseSuggestions } from '../src/sources/rule34.js';
import { redditUrls } from '../public/js/shared/reddit.js';
import { pullpushUrl } from '../public/js/shared/apis.js';

test('drawn content: school-age terms are refused, adult themes are not', () => {
  // Real-people sites keep their adult role-play terms…
  assert.equal(isQueryAllowed('schoolgirl'), true);
  // …but not for drawn content (hentai mode, Rule34, or a query that says it is drawn).
  assert.equal(isQueryAllowed('schoolgirl', { drawn: true }), false);
  assert.equal(isQueryAllowed('hentai schoolgirl'), false);
  assert.equal(isQueryAllowed('high school', { drawn: true }), false);
  assert.equal(isQueryAllowed('jk', { drawn: true }), false);
  assert.equal(isQueryAllowed('lycéenne', { drawn: true }), false);
  assert.equal(isQueryAllowed('aged down', { drawn: true }), false);
  for (const q of ['elf', 'succubus', 'milf', 'tentacle', 'monster girl', 'futanari', 'yuri', 'netorare', 'maid', 'school uniform']) {
    assert.equal(isQueryAllowed(q, { drawn: true }), true, q);
  }
});

test('hyphenated words are checked part by part', () => {
  assert.equal(isQueryAllowed('onee-shota'), false);
  assert.equal(isQueryAllowed('pre-teen'), false);
  assert.equal(isQueryAllowed('self-shot'), true);
});

test('booru tags built on loli/shota and school-age tags are blocked', () => {
  for (const t of ['oppai_loli', 'loli_focus', 'onee-shota', 'shotacon', 'aged_down', 'high_school_student', 'randoseru', 'elementary_school']) {
    assert.equal(isBlockedTag(t), true, t);
  }
  for (const t of ['cumshot', 'cumshot_aftermath', 'school_uniform', 'elf', 'big_breasts', 'monster_girl', 'mature_female']) {
    assert.equal(isBlockedTag(t), false, t);
  }
  assert.ok(BOORU_NEGATIVE_TAGS.includes('aged_down'));
});

test('items: Rule34 and drawn-looking results get the drawn rules', () => {
  assert.equal(isItemAllowed({ src: 'rule34', title: 'x', tags: ['oppai_loli'] }), false);
  assert.equal(isItemAllowed({ src: 'rule34', title: 'x', tags: ['elf', 'big_breasts'] }), true);
  assert.equal(isItemAllowed({ src: 'xvideos', title: 'Hentai schoolgirl uncensored', tags: [] }), false);
  assert.equal(isItemAllowed({ src: 'xvideos', title: 'Hentai elf uncensored', tags: [] }), true);
  // Hentai mode: every result is treated as drawn.
  assert.equal(isItemAllowed({ src: 'redgifs', title: 'schoolgirl', tags: [] }, { drawn: true }), false);
  assert.equal(isItemAllowed({ src: 'redgifs', title: 'schoolgirl', tags: [] }), true);
  assert.equal(looksDrawn('3D animated'), true);
  assert.equal(looksDrawn('amateur couple'), false);
});

test('Rule34 suggestions never offer blocked tags', () => {
  const list = parseSuggestions([
    { value: 'elf', label: 'elf (300000)' },
    { value: 'oppai_loli', label: 'oppai_loli (5000)' },
    { value: 'high_school_student', label: 'high_school_student (900)' }
  ]);
  assert.deepEqual(list.map(t => t.tag), ['elf']);
});

test('hentai scope: Reddit searches hentai subreddits, PullPush r/hentai', () => {
  const normal = redditUrls({ q: 'elf' });
  const h = redditUrls({ q: 'elf', scope: 'hentai' });
  assert.match(normal.priority, /\/r\/porn\+/);
  assert.match(h.priority, /\/r\/hentai\+HENTAI_GIF\+/);
  assert.equal(new URL(h.priority).searchParams.get('q'), 'elf');
  assert.equal(new URL(h.global).searchParams.get('q'), 'elf hentai');
  assert.equal(new URL(redditUrls({ q: 'hentai elf', scope: 'hentai' }).global).searchParams.get('q'), 'hentai elf');
  assert.equal(new URL(pullpushUrl({ q: 'elf', scope: 'hentai' })).searchParams.get('subreddit'), 'hentai');
  assert.equal(new URL(pullpushUrl({ q: 'elf' })).searchParams.get('subreddit'), null);
});
