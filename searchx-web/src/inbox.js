// Accounts shared from the X app wait here until SearchX, opened again, collects them. On iPhone a
// web app cannot appear in the share sheet: a Shortcut named "SearchX" does, and sends what X shared
// to this phone's mailbox, named by a random token the app made (shown in its setup steps).
//
//   GET /api/inbox/<token>/add?u=<what X shared>   the Shortcut (no access key: the token is the key)
//   GET /api/inbox/<token>/take                    the app: the waiting accounts, handed out once
//
// Storage: a Durable Object (binding MAILBOX) so every Cloudflare location sees it; memory otherwise.
import { xUserFromShared } from '../public/js/shared/xshare.js';

export const INBOX_TOKEN_RE = /^[\w-]{20,64}$/;
const TTL = 30 * 86400 * 1000;
const MAX = 50;
const memory = new Map();

export class Mailbox {
  constructor(ctx) {
    this.storage = ctx.storage;
  }

  async fetch(request) {
    if (request.method === 'POST') {
      const { user } = await request.json();
      const list = (await this.storage.get('users')) || [];
      if (!list.some(u => u.toLowerCase() === String(user).toLowerCase())) list.push(String(user));
      await this.storage.put('users', list.slice(-MAX));
      try { await this.storage.setAlarm(Date.now() + TTL); } catch { /* emptied at the next read */ }
      return new Response('ok');
    }
    const list = (await this.storage.get('users')) || [];
    if (list.length) await this.storage.deleteAll();
    return new Response(JSON.stringify({ users: list }), { headers: { 'Content-Type': 'application/json' } });
  }

  async alarm() {
    await this.storage.deleteAll();
  }
}

function mailbox(env, token) {
  const ns = env?.MAILBOX;
  return ns?.idFromName ? ns.get(ns.idFromName(token)) : null;
}

export async function inboxAdd(env, token, user) {
  const box = mailbox(env, token);
  if (box) return (await box.fetch('https://mailbox/', { method: 'POST', body: JSON.stringify({ user }) })).ok;
  const list = memory.get(token) || [];
  if (!list.some(u => u.toLowerCase() === user.toLowerCase())) list.push(user);
  memory.set(token, list.slice(-MAX));
  return true;
}

export async function inboxTake(env, token) {
  const box = mailbox(env, token);
  if (box) {
    const res = await box.fetch('https://mailbox/', { method: 'GET' });
    return res.ok ? ((await res.json()).users || []) : [];
  }
  const list = memory.get(token) || [];
  memory.delete(token);
  return list;
}

function text(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

/** /api/inbox/<token>/add | /take. The Shortcut shows the text answer in its notification. */
export async function handleInbox(url, env, json) {
  const m = /^\/api\/inbox\/([^/]+)\/(add|take)$/.exec(url.pathname);
  if (!m || !INBOX_TOKEN_RE.test(m[1])) return json({ ok: false, error: 'Adresse de partage invalide.' }, 400);
  const [, token, op] = m;
  if (op === 'take') {
    let users = [];
    try { users = await inboxTake(env, token); } catch { users = []; }
    return json({ ok: true, users: users.filter(u => /^\w{1,15}$/.test(u)) });
  }
  // Whatever X shared is appended as is after "?u=" (often unencoded, with X's own ?s=…&t=…).
  const user = xUserFromShared(url.search.slice(1));
  if (!user) return text('✗ Aucun compte X dans ce partage. Partage le profil (ou un post) depuis l’app X.', 400);
  try {
    await inboxAdd(env, token, user);
  } catch {
    return text('✗ SearchX n’a pas pu enregistrer ce compte. Réessaie.', 502);
  }
  return text(`✓ @${user} ajouté à SearchX`);
}
