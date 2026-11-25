import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitsMode, itemMode, isDrawnItem, translateQuery, keywords, matchesKeywords, isHentaiQuery, splitRecents, forMode } from '../public/js/modes.js';

test('porn mode never shows drawn content, hentai mode never real photos', () => {
  const real = { src: 'redgifs', title: 'Amateur couple', tags: ['Amateur', 'Couple'] };
  const drawnRg = { src: 'redgifs', title: 'Elf', tags: ['Hentai', 'Elf'] };
  const anim = { src: 'redgifs', title: 'Loop', tags: ['Animation', 'Ass'] };
  const tweetAnime = { src: 'x', title: 'new anime art drop', tags: [] };
  assert.equal(fitsMode(real, 'porn'), true);
  assert.equal(fitsMode(drawnRg, 'porn'), false);
  assert.equal(fitsMode(anim, 'porn'), false);
  assert.equal(fitsMode(tweetAnime, 'porn'), false);
  assert.equal(fitsMode({ src: 'danbooru', title: 'x', tags: ['photo_(medium)', 'cosplay_photo'] }, 'hentai'), false);
  assert.equal(fitsMode({ src: 'danbooru', title: 'x', tags: ['elf', '1girl'] }, 'hentai'), true);
  assert.equal(isDrawnItem({ src: 'hstream', title: 'Episode 1', tags: [] }), true);
});

test('saved items keep (or get) their mode', () => {
  assert.equal(itemMode({ src: 'redgifs', title: 'x', tags: [], mode: 'hentai' }), 'hentai');
  assert.equal(itemMode({ src: 'rule34', title: 'x', tags: [] }), 'hentai');
  assert.equal(itemMode({ src: 'redgifs', title: 'x', tags: ['Hentai'] }), 'hentai');
  assert.equal(itemMode({ src: 'redgifs', title: 'x', tags: ['Blonde'] }), 'porn');
  assert.equal(itemMode({ src: 'eporner', title: 'Hentai elf episode', tags: [] }), 'hentai'); // v2.4 hentai-mode tube results
});

test('French words are searched in English', () => {
  assert.equal(translateQuery('gros seins rousse'), 'big tits redhead');
  assert.equal(translateQuery('Infirmière levrette'), 'nurse doggystyle');
  assert.equal(translateQuery('elfe non censuré'), 'elf uncensored');
  assert.equal(translateQuery('blonde milf'), 'blonde milf');
  assert.equal(translateQuery('@SomeOne'), '@SomeOne');
});

test('exact keywords: every word must be in the result', () => {
  const it = { title: 'Hot one in the shower', tags: ['Blonde', 'MILF', 'Big Tits'], by: ['user1'] };
  assert.equal(matchesKeywords(it, keywords('blonde milf')), true);
  assert.equal(matchesKeywords(it, keywords('blondes')), true);
  assert.equal(matchesKeywords(it, keywords('big tits')), true);
  assert.equal(matchesKeywords(it, keywords('redhead')), false);
  assert.equal(matchesKeywords(it, keywords('blonde redhead')), false);
  assert.equal(matchesKeywords({ title: 'squirting compilation', tags: [], by: [] }, keywords('squirt')), true);
  assert.equal(matchesKeywords(it, []), true);
});

test('hentai queries are recognised; old recent searches are split per mode', () => {
  assert.equal(isHentaiQuery('anime girl'), true);
  assert.equal(isHentaiQuery('Rule34 overwatch'), true);
  assert.equal(isHentaiQuery('blonde milf'), false);
  assert.deepEqual(splitRecents(['blonde', 'elf', 'hentai milf', 'pov', 'tentacle']), { porn: ['blonde', 'pov'], hentai: ['elf', 'hentai milf', 'tentacle'] });
});

test('hentai mode: "hentai" / "anime" are dropped from the words sent', () => {
  assert.equal(forMode('hentai elf', 'hentai'), 'elf');
  assert.equal(forMode('anime maid', 'hentai'), 'maid');
  assert.equal(forMode('hentai', 'hentai'), 'hentai');
  assert.equal(forMode('hentai elf', 'porn'), 'hentai elf');
});

test('X keeps X\'s own order (keywords and accounts), whatever the sort', async () => {
  const { rank } = await import('../public/js/search.js');
  // As X sends them: newest first; the best keyword match is last.
  const list = [
    { id: 'x:3', src: 'x', title: 'morning walk', date: 300, likes: 1 },
    { id: 'x:2', src: 'x', title: 'sunset at the beach', date: 200, likes: 9 },
    { id: 'x:1', src: 'x', title: 'sunset beach sunset beach', date: 100, likes: 50 }
  ];
  const ids = l => l.map(i => i.id).join(',');
  for (const sort of ['relevance', 'views', 'newest', 'rating']) {
    assert.equal(ids(rank(list, sort, 'sunset beach', 'x')), 'x:3,x:2,x:1', `keywords, ${sort}`);
    assert.equal(ids(rank(list, sort, '@someone', 'x')), 'x:3,x:2,x:1', `account, ${sort}`);
  }
  // Other sites still follow the chosen sort.
  assert.equal(ids(rank(list, 'views', 'sunset beach', 'redgifs')), 'x:1,x:2,x:3');
});
