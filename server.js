#!/usr/bin/env node
/**
 * Cancel Their Cash — Node server.
 *
 * Storage is pluggable:
 *   - DATABASE_URL set  → Postgres (durable; used on Railway). Adds one dep (pg).
 *   - DATABASE_URL unset → JSON file at ./data/state.json (local dev, zero deps).
 *
 * Each voter gets one $100 vote = ten $10 chips, allocated in the browser and
 * cast once. The server stores DOLLARS pledged per target plus a rolling event
 * log. Repeat casts are deterred three ways: a localStorage lock (client), a
 * per-IP rate limit, and — in Postgres — one cast per hashed IP per day.
 *
 *   PORT=4680 node server.js
 *   DATABASE_URL=postgres://… node server.js
 *   DEMO_SEED=0 node server.js       # local: start counters at zero
 *   HASH_PEPPER=<secret> …           # salts the daily IP hash (set in prod)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 5000;
const HASH_PEPPER = process.env.HASH_PEPPER || 'ctc-dev-pepper-change-me';

// ---------------------------------------------------------------------------
// Client IP + daily hash (for dedup; raw IP is never stored)
// ---------------------------------------------------------------------------

function clientIp(req) {
  // Behind Railway's proxy the socket address is the proxy, not the visitor —
  // the real client is the leftmost X-Forwarded-For entry.
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || '0.0.0.0';
}
const utcDay = () => new Date().toISOString().slice(0, 10);
function ipHashFor(ip) {
  return crypto.createHash('sha256').update(`${HASH_PEPPER}:${utcDay()}:${ip}`).digest('hex');
}

// ---------------------------------------------------------------------------
// Storage: shared shaping over two backends (Postgres / JSON file)
// ---------------------------------------------------------------------------

let store;

async function makeStore() {
  if (process.env.DATABASE_URL) return makePgStore();
  return makeJsonStore();
}

// ---- Postgres backend (durable) -------------------------------------------

async function makePgStore(poolOverride) {
  let pool = poolOverride;
  if (!pool) {
    const { Pool } = require('pg');
    const url = process.env.DATABASE_URL;
    const useSsl = /sslmode=require/.test(url) || process.env.DATABASE_SSL === '1';
    pool = new Pool({ connectionString: url, ssl: useSsl ? { rejectUnauthorized: false } : false, max: 5 });
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS counts (
      target_id text PRIMARY KEY,
      dollars   bigint NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS events (
      id         bigserial PRIMARY KEY,
      target_id  text NOT NULL,
      name       text,
      usd        integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at DESC);
    CREATE TABLE IF NOT EXISTS casts (
      ip_hash    text PRIMARY KEY,
      day        date NOT NULL DEFAULT CURRENT_DATE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS casts_day_idx ON casts (day);
  `);

  // Housekeeping: dedup rows only need "today"; events keep 7 days of history.
  const cleanup = () => pool.query(
    `DELETE FROM casts WHERE day < CURRENT_DATE - 1;
     DELETE FROM events WHERE created_at < now() - interval '7 days';`
  ).catch((e) => console.error('cleanup:', e.message));
  cleanup();
  setInterval(cleanup, 6 * 60 * 60 * 1000).unref();

  return {
    kind: 'postgres',
    async counts() {
      const { rows } = await pool.query('SELECT target_id, dollars FROM counts');
      const out = {};
      for (const r of rows) out[r.target_id] = Number(r.dollars);
      return out;
    },
    async latestEvents(limit) {
      const { rows } = await pool.query(
        `SELECT target_id, name, usd, (extract(epoch FROM created_at) * 1000)::bigint AS t
         FROM events ORDER BY id DESC LIMIT $1`, [limit]);
      return rows.map((r) => ({ target_id: r.target_id, name: r.name, usd: r.usd, t: Number(r.t) }));
    },
    async trending(limit) {
      const { rows } = await pool.query(
        `SELECT target_id, SUM(usd)::bigint AS day_usd FROM events
         WHERE created_at > now() - interval '24 hours'
         GROUP BY target_id ORDER BY day_usd DESC LIMIT $1`, [limit]);
      return rows.map((r) => ({ target_id: r.target_id, dayUsd: Number(r.day_usd) }));
    },
    // Returns { status:'ok', applied:{id:newTotal} } or { status:'duplicate' }.
    async applyCast(clean, name, ipHash) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        // Dedup: the casts PK makes a repeat (ip_hash) same-day insert throw a
        // unique_violation (23505). Catch it → this network already voted today.
        try {
          await c.query('INSERT INTO casts(ip_hash, day) VALUES ($1, $2)', [ipHash, utcDay()]);
        } catch (e) {
          if (e.code === '23505' || /unique|duplicate/i.test(e.message || '')) {
            await c.query('ROLLBACK'); return { status: 'duplicate' };
          }
          throw e;
        }
        const applied = {};
        for (const [id, usd] of clean) {
          const r = await c.query(
            `INSERT INTO counts(target_id, dollars) VALUES ($1, $2)
             ON CONFLICT (target_id) DO UPDATE SET dollars = counts.dollars + EXCLUDED.dollars
             RETURNING dollars`, [id, usd]);
          applied[id] = Number(r.rows[0].dollars);
          await c.query('INSERT INTO events(target_id, name, usd) VALUES ($1, $2, $3)', [id, name || null, usd]);
        }
        await c.query('COMMIT');
        return { status: 'ok', applied };
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
}

// ---- JSON-file backend (local dev; no IP dedup so testing is unrestricted) --

async function makeJsonStore() {
  let state = loadState();
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      fs.writeFile(STATE_FILE, JSON.stringify(state), (err) => { if (err) console.error('save:', err.message); });
    }, 1500);
  };
  return {
    kind: 'json',
    async counts() { return { ...state.counts }; },
    async latestEvents(limit) {
      return state.events.slice(-limit).reverse()
        .map((e) => ({ target_id: e.id, name: e.n, usd: e.usd, t: e.t }));
    },
    async trending(limit) {
      const cutoff = Date.now() - DAY_MS;
      const agg = new Map();
      for (let i = state.events.length - 1; i >= 0; i--) {
        const e = state.events[i];
        if (e.t < cutoff) break;
        agg.set(e.id, (agg.get(e.id) || 0) + e.usd);
      }
      return [...agg.entries()].map(([id, dayUsd]) => ({ target_id: id, dayUsd }))
        .sort((a, b) => b.dayUsd - a.dayUsd).slice(0, limit);
    },
    async applyCast(clean, name /* , ipHash: no dedup locally */) {
      const applied = {};
      const now = Date.now();
      for (const [id, usd] of clean) {
        state.counts[id] = (state.counts[id] || 0) + usd;
        applied[id] = state.counts[id];
        state.events.push({ id, n: name || '', usd, t: now });
      }
      if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
      scheduleSave();
      return { status: 'ok', applied };
    },
  };
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && raw.counts && raw.schema === 'usd' &&
        Object.keys(raw.counts).some((id) => TARGET_BY_ID.has(id))) return raw;
  } catch (_) { /* first run */ }
  return DEMO_SEED ? seedDemoState() : { schema: 'usd', counts: {}, events: [] };
}

// Deterministic demo data so local boards/wire look alive. $10 multiples.
function seedDemoState() {
  const counts = {};
  const events = [];
  const names = ['Dana', 'Marcus', 'Priya', 'Jo', 'Tyler', 'Elena', 'Sam', 'Keisha',
    'Brett', 'Maria', 'Colin', 'Ava', 'Hank', 'Lucia', 'Devon', 'Rosa', 'Kyle',
    'Nia', 'Walt', 'June', 'Otis', 'Faye', 'Gus', 'Isla', ''];
  let h = 88675123;
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  const toChips = (usdVal) => Math.round(usdVal / CHIP_USD) * CHIP_USD;
  const hot = new Set(['fairshake', 'koch-industries', 'exxonmobil', 'pfizer', 'comcast',
    'unitedhealth', 'amazon', 'boeing', 'goldman-sachs', 'altria']);
  const overdrawn = new Set(['apple', 'coinbase']);
  const now = Date.now();
  for (const t of TARGETS) {
    let dollars;
    if (overdrawn.has(t.id)) dollars = Math.ceil((t.totalUsd / CHIP_USD) * (1.05 + rand() * 0.35)) * CHIP_USD;
    else dollars = toChips(rand() * rand() * (hot.has(t.id) ? 620000 : 55000));
    counts[t.id] = dollars;
    const heat = hot.has(t.id) ? 6 : 1;
    const recent = Math.floor(rand() * rand() * 40 * (heat > 1 ? 3 : 1));
    for (let i = 0; i < recent; i++) {
      events.push({ id: t.id, n: names[Math.floor(rand() * names.length)], t: now - Math.floor(rand() * DAY_MS), usd: (1 + Math.floor(rand() * 5)) * CHIP_USD });
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { schema: 'usd', counts, events, demo: true };
}

// ---------------------------------------------------------------------------
// Per-IP rate limit (in-memory): 20 casts/minute is plenty for a human
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
// API shaping (shared over both stores + the static PACS roster)
// ---------------------------------------------------------------------------

const withCount = (t, counts) => ({ ...t, pledged: counts[t.id] || 0 });

async function apiRoster() {
  const counts = await store.counts();
  return { asOf: PACS.meta.asOf, budgetUsd: BUDGET_USD, chipUsd: CHIP_USD, targets: TARGETS.map((t) => withCount(t, counts)) };
}
async function apiStats() {
  const counts = await store.counts();
  let total = 0, outstanding = 0, top = null;
  for (const t of TARGETS) {
    const n = counts[t.id] || 0;
    total += n; outstanding += t.totalUsd;
    if (!top || n > (counts[top.id] || 0)) top = t;
  }
  return { total, votes: Math.round(total / BUDGET_USD), top: top ? withCount(top, counts) : null, outstanding, roster: TARGETS.length };
}
async function apiLeaderboard(limit) {
  const counts = await store.counts();
  const rows = TARGETS.map((t) => withCount(t, counts)).sort((a, b) => b.pledged - a.pledged);
  return { leaderboard: rows.slice(0, limit) };
}
async function apiTrending(limit) {
  const counts = await store.counts();
  const rows = await store.trending(limit);
  return { trending: rows.map((r) => { const t = TARGET_BY_ID.get(r.target_id); return t ? { ...withCount(t, counts), dayUsd: r.dayUsd } : null; }).filter(Boolean) };
}
async function apiFeed(limit) {
  const now = Date.now();
  const rows = await store.latestEvents(limit);
  return { feed: rows.map((e) => { const t = TARGET_BY_ID.get(e.target_id); return t ? { name: e.name || null, target: t.name, agoMs: now - e.t, usd: e.usd } : null; }).filter(Boolean) };
}

async function apiCast(body, ip) {
  if (!allow(ip)) return { status: 429, json: { error: 'Easy there. Even arithmetic has limits. Try again in a minute.' } };
  const alloc = body && body.allocations;
  if (!alloc || typeof alloc !== 'object') return { status: 400, json: { error: 'No allocation provided.' } };
  let name = String((body && body.name) || '').replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 20);
  const clean = [];
  let total = 0;
  for (const [id, rawUsd] of Object.entries(alloc)) {
    if (!TARGET_BY_ID.has(id)) continue;
    let usd = Math.round((Math.floor(Number(rawUsd) || 0)) / CHIP_USD) * CHIP_USD;
    if (usd <= 0) continue;
    clean.push([id, usd]); total += usd;
  }
  if (!clean.length) return { status: 400, json: { error: 'Place at least one chip first.' } };
  if (total > BUDGET_USD) return { status: 400, json: { error: 'That exceeds one $100 vote.' } };

  const result = await store.applyCast(clean, name, ipHashFor(ip));
  if (result.status === 'duplicate') {
    return { status: 409, json: { error: 'Looks like this network already cast a $100 vote today. The Bureau allows one per network per day — try again tomorrow.' } };
  }
  return { status: 200, json: { ok: true, total, applied: result.applied } };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
  res.end(buf);
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (!path.extname(rel)) return serveStatic(req, res, '/index.html');
      res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

function handleApi(req, res, url) {
  const p = url.pathname;
  const ip = clientIp(req);
  if (req.method === 'GET') {
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    const send = (fn, ...a) => fn(...a).then((j) => sendJson(res, 200, j)).catch((e) => { console.error(p, e.message); sendJson(res, 500, { error: 'Server error.' }); });
    if (p === '/api/roster') return send(apiRoster);
    if (p === '/api/stats') return send(apiStats);
    if (p === '/api/leaderboard') return send(apiLeaderboard, limit);
    if (p === '/api/trending') return send(apiTrending, limit);
    if (p === '/api/feed') return send(apiFeed, Math.min(limit, 30));
    return sendJson(res, 404, { error: 'No such endpoint.' });
  }
  if (req.method === 'POST' && p === '/api/cast') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 4096) req.destroy(); });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (_) { /* fall through */ }
      apiCast(body, ip).then((out) => sendJson(res, out.status, out.json))
        .catch((e) => { console.error('cast:', e.message); sendJson(res, 500, { error: 'Could not record your vote. Try again.' }); });
    });
    return;
  }
  return sendJson(res, 405, { error: 'Method not allowed.' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, url.pathname);
});

if (require.main === module) {
  makeStore().then((s) => {
    store = s;
    server.listen(PORT, () => console.log(`Cancel Their Cash → http://localhost:${PORT}  (store: ${s.kind}${s.kind === 'json' && DEMO_SEED ? ', demo seed on' : ''})`));
  }).catch((err) => {
    console.error('Failed to init storage:', err.message);
    process.exit(1);
  });
}

module.exports = { makePgStore, makeJsonStore };
