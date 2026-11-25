import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as F from './fixtures.mjs';
import { relayBase, redgifsRelayUrl } from '../public/js/shared/apis.js';

const require = createRequire(import.meta.url);
const handler = require('../../api/redgifs.js'); // the Vercel function at the repo root

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = F.mockFetch(''); });
after(() => { globalThis.fetch = realFetch; });

function call(path, method = 'GET') {
  return new Promise(resolve => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      end: body => resolve({ status: res.statusCode, headers, body: body ? JSON.parse(body) : null })
    };
    handler({ method, url: path }, res);
  });
}

test('relay address: bare domain or URL → https origin', () => {
  assert.equal(relayBase('sites-abc.vercel.app'), 'https://sites-abc.vercel.app');
  assert.equal(relayBase('https://sites-abc.vercel.app/api/redgifs?x=1'), 'https://sites-abc.vercel.app');
  assert.equal(relayBase('http://sites-abc.vercel.app'), '');
  assert.equal(relayBase(''), '');
  const u = new URL(redgifsRelayUrl('sites-abc.vercel.app', { q: 'blonde milf', page: 2, sort: 'newest', scope: 'hentai' }));
  assert.equal(u.origin + u.pathname, 'https://sites-abc.vercel.app/api/redgifs');
  assert.equal(u.searchParams.get('query'), 'blonde milf');
  assert.equal(u.searchParams.get('order'), 'latest');
  assert.equal(u.searchParams.get('page'), '2');
  assert.equal(u.searchParams.get('tags'), 'Hentai');
});

test('relay function: CORS, search, trimmed answer, input checks', async () => {
  const pre = await call('/api/redgifs?query=x', 'OPTIONS');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], '*');
  const r = await call('/api/redgifs?query=blonde&order=score&page=1&evil=1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.equal(r.body.gifs.length, 40);
  assert.deepEqual(Object.keys(r.body).sort(), ['gifs', 'page', 'pages', 'total']);
  assert.ok(r.body.gifs[0].urls && r.body.gifs[0].id && !('verified' in r.body.gifs[0]));
  assert.equal((await call('/api/redgifs?order=score')).status, 400);
  assert.equal((await call('/api/redgifs?query=x', 'POST')).status, 405);
});

test('relay function: a refused token (WrongSender) is renewed', async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = F.mockFetch('', { failSources: ['redgifs-wrongsender'] });
  try {
    const r = await call('/api/redgifs?query=blonde');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.gifs.length, 40);
  } finally {
    globalThis.fetch = prev;
  }
});
