#!/usr/bin/env node
/**
 * Cancel Their Vote — zero-dependency Node server.
 *
 * Serves the static frontend from ./public and a small JSON API backed by
 * a write-through JSON file (./data/state.json). No accounts, no cookies,
 * no personal data beyond an optional first name on each pledge.
 *
 *   PORT=4680 node server.js
 *   DEMO_SEED=0 node server.js   # start with zeroed counters (production)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4680;
const DEMO_SEED = process.env.DEMO_SEED !== '0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const CELEBS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'celebrities.json'), 'utf8'));
const CELEB_BY_ID = new Map(CELEBS.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------
// State: counts per celeb + a rolling event log (for trending & the live feed)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 5000;

let state = loadState();

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && raw.counts) return raw;
  } catch (_) { /* first run */ }
  return DEMO_SEED ? seedDemoState() : { counts: {}, events: [] };
}

// Deterministic pseudo-random demo data so the leaderboard/trending/feed have
// life in them before real traffic exists. Disabled with DEMO_SEED=0.
function seedDemoState() {
  const counts = {};
  const events = [];
  const names = ['Dana', 'Marcus', 'Priya', 'Jo', 'Tyler', 'Elena', 'Sam', 'Keisha',
    'Brett', 'Maria', 'Colin', 'Ava', 'Hank', 'Lucia', 'Devon', 'Rosa', 'Kyle',
    'Nia', 'Walt', 'June', 'Otis', 'Faye', 'Gus', 'Isla', ''];
  let h = 2463534242;
  const rand = () => {
    // xorshift32 — deterministic across restarts
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
  const now = Date.now();
  for (const c of CELEBS) {
    // Fame-ish weight: politicians and big names attract more cancellations
    const base = 40 + Math.floor(rand() * 400);
    const boost = ['elon-musk', 'donald-trump', 'taylor-swift', 'joe-rogan', 'aoc',
      'ted-cruz', 'oprah-winfrey', 'lebron-james', 'marjorie-taylor-greene',
      'bernie-sanders', 'kanye-west', 'mark-zuckerberg'].includes(c.id) ? 6 + rand() * 18 : 1;
    counts[c.id] = Math.floor(base * boost);
    // A few recent events per celeb so trending has a 24h signal
    const recent = Math.floor(rand() * rand() * 30 * (boost > 1 ? 4 : 1));
    for (let i = 0; i < recent; i++) {
      events.push({
        id: c.id,
        n: names[Math.floor(rand() * names.length)],
        t: now - Math.floor(rand() * DAY_MS),
        k: Math.ceil(rand() * 3),
      });
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { counts, events, demo: true };
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(STATE_FILE, JSON.stringify(state), (err) => {
      if (err) console.error('state save failed:', err.message);
    });
  }, 1500);
}

// ---------------------------------------------------------------------------
// Tiny per-IP rate limit: 30 cancel posts/minute is plenty for a human
// ---------------------------------------------------------------------------

const buckets = new Map();
function allow(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.ts > 60_000) { b = { ts: now, n: 0 }; buckets.set(ip, b); }
  b.n += 1;
  if (buckets.size > 10_000) buckets.clear();
  return b.n <= 30;
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function celebPayload(c) {
  return { ...c, count: state.counts[c.id] || 0 };
}

function apiRoster() {
  return { celebs: CELEBS.map(celebPayload) };
}

function apiStats() {
  let total = 0;
  let top = null;
  for (const c of CELEBS) {
    const n = state.counts[c.id] || 0;
    total += n;
    if (!top || n > (state.counts[top.id] || 0)) top = c;
  }
  const states = new Set(CELEBS.map((c) => c.state));
  return {
    total,
    top: top ? celebPayload(top) : null,
    states: states.size,
    roster: CELEBS.length,
  };
}

function apiLeaderboard(limit) {
  const rows = CELEBS.map(celebPayload).sort((a, b) => b.count - a.count);
  return { leaderboard: rows.slice(0, limit) };
}

function apiTrending(limit) {
  const cutoff = Date.now() - DAY_MS;
  const recent = new Map();
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (e.t < cutoff) break;
    recent.set(e.id, (recent.get(e.id) || 0) + e.k);
  }
  const rows = [...recent.entries()]
    .map(([id, dayCount]) => ({ ...celebPayload(CELEB_BY_ID.get(id)), dayCount }))
    .sort((a, b) => b.dayCount - a.dayCount);
  return { trending: rows.slice(0, limit) };
}

function apiFeed(limit) {
  const now = Date.now();
  const rows = [];
  for (let i = state.events.length - 1; i >= 0 && rows.length < limit; i--) {
    const e = state.events[i];
    const c = CELEB_BY_ID.get(e.id);
    if (!c) continue;
    rows.push({ name: e.n || null, celeb: c.name, state: c.state, agoMs: now - e.t, times: e.k });
  }
  return { feed: rows };
}

function apiCancel(body, ip) {
  if (!allow(ip)) return { status: 429, json: { error: 'Easy there. Even spite has limits. Try again in a minute.' } };
  const c = CELEB_BY_ID.get(String(body.id || ''));
  if (!c) return { status: 400, json: { error: 'Unknown target.' } };
  const times = Math.min(100, Math.max(1, Math.floor(Number(body.times) || 1)));
  // Optional first name only — strip anything that isn't a short display name
  let name = String(body.name || '').replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 20);
  state.counts[c.id] = (state.counts[c.id] || 0) + times;
  state.events.push({ id: c.id, n: name, t: Date.now(), k: times });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  scheduleSave();
  const count = state.counts[c.id];
  return { status: 200, json: { celeb: celebPayload(c), count, surplus: Math.max(0, count - 1) } };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (!path.extname(rel)) return serveStatic(req, res, '/index.html');
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const ip = req.socket.remoteAddress || '?';

  if (p.startsWith('/api/')) {
    if (req.method === 'GET') {
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
      if (p === '/api/roster') return sendJson(res, 200, apiRoster());
      if (p === '/api/stats') return sendJson(res, 200, apiStats());
      if (p === '/api/leaderboard') return sendJson(res, 200, apiLeaderboard(limit));
      if (p === '/api/trending') return sendJson(res, 200, apiTrending(limit));
      if (p === '/api/feed') return sendJson(res, 200, apiFeed(Math.min(limit, 30)));
      return sendJson(res, 404, { error: 'No such endpoint.' });
    }
    if (req.method === 'POST' && p === '/api/cancel') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 2048) req.destroy();
      });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch (_) { /* fall through */ }
        const out = apiCancel(body, ip);
        sendJson(res, out.status, out.json);
      });
      return;
    }
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, p);
});

server.listen(PORT, () => {
  console.log(`Cancel Their Vote → http://localhost:${PORT}  (demo seed: ${DEMO_SEED ? 'on' : 'off'})`);
});
