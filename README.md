# Cancel Their Cash — "Your vote is only worth $100"

> Repo/dir still named `cancel-out-their-vote` / `cancel-their-vote` for now; the
> product name is **Cancel Their Cash** (corporations don't vote — their money does).

Satirical GOTV site: corporate PACs put real money into federal elections. At the Bureau's
Official Exchange Rate (1 vote = $100, derived from $15.9B of 2024 federal spending ÷ ~155M
ballots, per OpenSecrets), you hold one scarce **$100 vote — ten $10 chips**. You allocate
them across the corporate PACs whose influence you most want to zero out, then **cast** once.
Scarcity is the point: no infinite spam-clicking, one deliberate choice. Chips live in the
browser (localStorage) until cast — no accounts. Votes don't literally cancel dollars; that's
the joke, and the fine print says so. Inspired by the
[Integrity Index](https://integrityindex.us) (unaffiliated; collab wanted).

## Run (local)

```bash
npm install               # installs pg (only needed when DATABASE_URL is set)
node server.js            # http://localhost:4680, JSON-file store, demo-seeded
DEMO_SEED=0 node server.js # start counters at zero
PORT=8080 node server.js   # custom port
```

Node 18+. Static frontend in `public/`. **Storage is pluggable:** with no
`DATABASE_URL` it uses a write-through JSON file at `data/state.json` (local dev,
demo seed, no IP dedup so testing is unrestricted). With `DATABASE_URL` set it
uses Postgres (durable, and enforces one cast per IP per day).

## Deploy on Railway

1. **Create the app service** from this GitHub repo. Railway detects `package.json`
   and runs `npm start` (`node server.js`). `PORT` is injected automatically.
2. **Add a PostgreSQL database** (New → Database → PostgreSQL) in the same project.
3. **Wire the DB into the app** — in the app service's *Variables*, add:
   - `DATABASE_URL = ${{Postgres.DATABASE_URL}}` (Railway reference to the DB's
     private URL — no SSL needed).
   - `HASH_PEPPER = <a long random string>` — salts the daily IP hash. Keep it
     secret and stable; changing it resets the per-day dedup.
4. Deploy. On boot the app creates its tables (`counts`, `events`, `casts`) and
   **starts at real zeros** (the demo seed only applies to the local JSON store).

No `DEMO_SEED` needed in production. If you ever use Railway's *public* DB URL
instead of the internal reference, add `DATABASE_SSL=1`.

## What it stores

Postgres: dollars per PAC (`counts`), a 7-day rolling `events` log for the wire /
trending (target, optional first name ≤20 chars, dollar amount), and a `casts`
dedup table holding only a **salted SHA-256 of the day + IP** (never the raw IP;
rows older than a day are pruned). No emails, no accounts, no cookies, no
analytics. The user's in-progress chip allocation and cast-lock live only in their
own browser (localStorage key `ctv-wallet-v1`).

### Repeat-pledge prevention

Three layers, none perfect (true dedup would need accounts): (1) a client-side
localStorage cast-lock, (2) a per-IP rate limit (20 casts/min, in memory), and
(3) **one cast per IP per day** via the `casts` unique key on the salted IP hash.
Caveat: shared IPs (offices, campuses, mobile carriers) can block real users, and
VPNs/incognito bypass it — proportional to a deliberately "Unofficial" site.

## What it stores

Server-side, per cast: dollars added to each targeted PAC's running total, plus one
wire event per funded target carrying the dollar amount and an optional first name
(≤20 chars, sanitized). Nothing else — no emails, no accounts, no cookies, no analytics.
The user's in-progress chip allocation and their cast-lock live only in their own
browser (localStorage key `ctv-wallet-v1`).

## Data

`data/pacs.json` — 66 corporate PACs across 11 industries with 2024-cycle FEC
contribution totals, rounded to the nearest $100,000, each with source + as-of date.
**Figures are curated estimates and MUST be verified against FEC/OpenSecrets before
any public launch.** The schema (`id, name, industry, totalUsd, blurb, source, asOf`)
is deliberately feed-shaped so an Integrity Index live feed can replace it without
frontend changes.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/roster` | All targets + dollars pledged, plus `budgetUsd`/`chipUsd` |
| `GET /api/stats` | Total $ neutralized, votes cast, most-neutralized, outstanding total |
| `GET /api/leaderboard?limit=10` | Most $ neutralized, all-time |
| `GET /api/trending?limit=10` | Most $ neutralized, last 24h |
| `GET /api/feed?limit=25` | Recent pledge events (wire), with $ amounts |
| `POST /api/cast` | `{allocations:{id:usd,…}, name?}` → adds a whole $100 vote at once; rejects >$100 or empty; snaps to $10; rate-limited 20/min/IP |

Server stores dollars directly (all $10 multiples). One `/api/cast` per voter carries
their full allocation, so the server never sees mid-allocation fiddling.

## Content rules (the legal guardrails — keep them)

- **We allege arithmetic, not crimes.** Every figure is a lawful, publicly disclosed
  FEC contribution. Blurbs joke about money and math, never accuse anyone of corruption.
- **Nominative use only** — company/PAC names in commentary; never logos or trademarks.
- **Never map a target to specific candidates** to vote for/against (express-advocacy
  line). Users do their own homework via Integrity Index / OpenSecrets links.
- **No prizes, sweepstakes, or rewards** for pledging/registering/voting (52 U.S.C. §10307(c)).
- **Link out** to vote.gov for registration; never collect registrations.
- Honor removal/correction requests from named organizations (see terms §9).

## Deploy notes

Single Node process; any host works. For real traffic, swap the JSON-file store for
Redis/SQLite — the API surface is 6 endpoints. Set `DEMO_SEED=0` and verify
`data/pacs.json` figures before launch.
