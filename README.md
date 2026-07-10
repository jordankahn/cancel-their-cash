# Cancel Their Vote

Satirical GOTV site: pledge to "cancel out" a famous person's vote in your state —
by registering and actually voting. Votes don't literally cancel; that's the joke,
and the fine print says so loudly.

## Run

```bash
node server.js            # http://localhost:4680, demo-seeded counters
DEMO_SEED=0 node server.js  # production: start all counters at zero
PORT=8080 node server.js    # custom port
```

Zero dependencies — plain Node (18+). Static frontend in `public/`, JSON API,
write-through persistence to `data/state.json` (delete it to reset).

## What it stores

Per pledge: a counter increment and an optional first name (≤20 chars, sanitized),
shown in the public ticker. Nothing else — no emails, no accounts, no cookies,
no analytics. The user's state choice lives in their own localStorage.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/roster` | All celebs + cancellation counts |
| `GET /api/stats` | Total cancellations, most-canceled, state coverage |
| `GET /api/leaderboard?limit=10` | All-time most canceled |
| `GET /api/trending?limit=10` | Most canceled in last 24h |
| `GET /api/feed?limit=25` | Recent pledge events (ticker) |
| `POST /api/cancel` | `{id, name?, times?}` → increments (rate-limited 30/min/IP) |

## Content rules (the legal guardrails — keep them)

- **Names only, never photos** of celebrities (photo copyright is the sharpest claim).
- **No prizes, sweepstakes, or rewards** for pledging/registering/voting (52 U.S.C. §10307(c)).
- **Never assert how anyone votes** — copy always frames it as the *user's* speculation;
  ballots are secret. "Home states" are hedged as reported/speculative.
- **Link out** to vote.gov for registration; never collect registrations (state TPVRO laws).
- Honor removal requests from named individuals (see terms §9).
- Roster: `data/celebrities.json` — id, name, state, tag, blurb. Blurbs punch at fame,
  never at how someone votes.

## Deploy notes

Single Node process; any host works (Fly.io, Render, a $5 VPS). For real traffic,
swap the JSON-file store for Redis/SQLite — the API surface is 6 endpoints.
Set `DEMO_SEED=0` before launch.
