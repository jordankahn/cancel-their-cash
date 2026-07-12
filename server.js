#!/usr/bin/env node
/**
 * Cancel Their Vote — zero-dependency Node server (chip-allocation edition).
 *
 * Serves the static frontend from ./public and a small JSON API backed by
 * a write-through JSON file (./data/state.json). No accounts, no cookies,
 * no personal data beyond an optional first name on each cast.
 *
 * Targets are corporate PACs (./data/pacs.json). Each voter gets one $100
 * vote, split into ten $10 chips, and allocates it across targets in the
 * browser. Casting posts the final allocation here; the server only stores
 * DOLLARS pledged per target plus a rolling event log for the wire/boards.
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

const PACS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'pacs.json'), 'utf8'));
const TARGETS = PACS.targets;
const TARGET_BY_ID = new Map(TARGETS.map((t) => [t.id, t]));

const BUDGET_USD = 100;   // one vote
const CHIP_USD = 10;      // ten chips

// ---------------------------------------------------------------------------
// State: dollars pledged per target + a rolling event log (wire & trending)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 5000;

let state = loadState();

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // accept only state that references known targets AND the dollar schema
    if (raw && raw.counts && raw.schema === 'usd' &&
        Object.keys(raw.counts).some((id) => TARGET_BY_ID.has(id))) {
      return raw;
    }
  } catch (_) { /* first run */ }
  return DEMO_SEED ? seedDemoState() : { schema: 'usd', counts: {}, events: [] };
}

// Deterministic pseudo-random demo data so the boards and wire have life in
// them before real traffic exists. Disabled with DEMO_SEED=0. Counts are
// DOLLARS, always $10 multiples.
function seedDemoState() {
  const counts = {};
  const events = [];
  const names = ['Dana', 'Marcus', 'Priya', 'Jo', 'Tyler', 'Elena', 'Sam', 'Keisha',
    'Brett', 'Maria', 'Colin', 'Ava', 'Hank', 'Lucia', 'Devon', 'Rosa', 'Kyle',
    'Nia', 'Walt', 'June', 'Otis', 'Faye', 'Gus', 'Isla', ''];
  let h = 88675123;
  const rand = () => {
    // xorshift32 — deterministic across restarts
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
  const hot = new Set(['fairshake', 'koch-industries', 'exxonmobil', 'pfizer', 'comcast',
    'unitedhealth', 'amazon', 'boeing', 'goldman-sachs', 'altria']);
  const overdrawn = new Set(['apple', 'coinbase']); // small totals → visible OVERDRAWN flip
  const toChips = (usdVal) => Math.round(usdVal / CHIP_USD) * CHIP_USD; // snap to $10
  const now = Date.now();
  for (const t of TARGETS) {
    let dollars;
    if (overdrawn.has(t.id)) {
      // comfortably past the PAC's own total, but not enough to top the board
      dollars = Math.ceil((t.totalUsd / CHIP_USD) * (1.05 + rand() * 0.35)) * CHIP_USD;
    } else {
      // crowd pledges; notorious PACs attract far more. rand*rand biases low
      // so a handful of leaders emerge naturally. Always a $10 multiple.
      const scale = hot.has(t.id) ? 620000 : 55000;
      dollars = toChips(rand() * rand() * scale);
    }
    counts[t.id] = dollars;
    const heat = hot.has(t.id) ? 6 : 1;
    const recent = Math.floor(rand() * rand() * 40 * (heat > 1 ? 3 : 1));
    for (let i = 0; i < recent; i++) {
      events.push({
        id: t.id,
        n: names[Math.floor(rand() * names.length)],
        t: now - Math.floor(rand() * DAY_MS),
        usd: (1 + Math.floor(rand() * 5)) * CHIP_USD,
      });
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { schema: 'usd', counts, events, demo: true };
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
// Tiny per-IP rate limit: 20 casts/minute is plenty for a human
// ---------------------------------------------------------------------------

const buckets = new Map();
function allow(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.ts > 60_000) { b = { ts: now, n: 0 }; buckets.set(ip, b); }
  b.n += 1;
  if (buckets.size > 10_000) buckets.clear();
  return b.n <= 20;
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function targetPayload(t) {
  return { ...t, pledged: state.counts[t.id] || 0 };
}

function apiRoster() {
  return { asOf: PACS.meta.asOf, budgetUsd: BUDGET_USD, chipUsd: CHIP_USD, targets: TARGETS.map(targetPayload) };
}

function apiStats() {
  let total = 0;      // dollars pledged across all targets
  let top = null;
  let outstanding = 0;
  for (const t of TARGETS) {
    const n = state.counts[t.id] || 0;
    total += n;
    outstanding += t.totalUsd;
    if (!top || n > (state.counts[top.id] || 0)) top = t;
  }
  return {
    total,
    votes: Math.round(total / BUDGET_USD),
    top: top ? targetPayload(top) : null,
    outstanding,
    roster: TARGETS.length,
  };
}

function apiLeaderboard(limit) {
  const rows = TARGETS.map(targetPayload).sort((a, b) => b.pledged - a.pledged);
  return { leaderboard: rows.slice(0, limit) };
}

function apiTrending(limit) {
  const cutoff = Date.now() - DAY_MS;
  const recent = new Map();
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (e.t < cutoff) break;
    recent.set(e.id, (recent.get(e.id) || 0) + e.usd);
  }
  const rows = [...recent.entries()]
    .map(([id, dayUsd]) => ({ ...targetPayload(TARGET_BY_ID.get(id)), dayUsd }))
    .sort((a, b) => b.dayUsd - a.dayUsd);
  return { trending: rows.slice(0, limit) };
}

function apiFeed(limit) {
  const now = Date.now();
  const rows = [];
  for (let i = state.events.length - 1; i >= 0 && rows.length < limit; i--) {
    const e = state.events[i];
    const t = TARGET_BY_ID.get(e.id);
    if (!t) continue;
    rows.push({ name: e.n || null, target: t.name, agoMs: now - e.t, usd: e.usd });
  }
  return { feed: rows };
}

// Cast a whole allocation at once: { allocations: { id: usd, ... }, name }
function apiCast(body, ip) {
  if (!allow(ip)) return { status: 429, json: { error: 'Easy there. Even arithmetic has limits. Try again in a minute.' } };
  const alloc = body && body.allocations;
  if (!alloc || typeof alloc !== 'object') return { status: 400, json: { error: 'No allocation provided.' } };

  let name = String((body && body.name) || '').replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 20);
  const clean = [];
  let total = 0;
  for (const [id, rawUsd] of Object.entries(alloc)) {
    const t = TARGET_BY_ID.get(id);
    if (!t) continue;
    let usd = Math.floor(Number(rawUsd) || 0);
    usd = Math.round(usd / CHIP_USD) * CHIP_USD; // snap to chip
    if (usd <= 0) continue;
    clean.push([id, usd]);
    total += usd;
  }
  if (!clean.length) return { status: 400, json: { error: 'Place at least one chip first.' } };
  if (total > BUDGET_USD) return { status: 400, json: { error: 'That exceeds one $100 vote.' } };

  const now = Date.now();
  for (const [id, usd] of clean) {
    state.counts[id] = (state.counts[id] || 0) + usd;
    state.events.push({ id, n: name, t: now, usd });
  }
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  scheduleSave();

  const applied = {};
  for (const [id, usd] of clean) applied[id] = state.counts[id];
  return { status: 200, json: { ok: true, total, applied } };
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
    if (req.method === 'POST' && p === '/api/cast') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 4096) req.destroy();
      });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch (_) { /* fall through */ }
        const out = apiCast(body, ip);
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
