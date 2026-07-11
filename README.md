# Cancel Their Vote — "Your vote is only worth $100"

Satirical GOTV site: corporate PACs put real money into federal elections. At the Bureau's
Official Exchange Rate (1 vote = $100, derived from $15.9B of 2024 federal spending ÷ ~155M
ballots, per OpenSecrets), you hold one scarce **$100 vote — ten $10 chips**. You allocate
them across the corporate PACs whose influence you most want to zero out, then **cast** once.
Scarcity is the point: no infinite spam-clicking, one deliberate choice. Chips live in the
browser (localStorage) until cast — no accounts. Votes don't literally cancel dollars; that's
the joke, and the fine print says so. Inspired by the
[Integrity Index](https://integrityindex.us) (unaffiliated; collab wanted).

## Run

```bash
node server.js            # http://localhost:4680, demo-seeded counters
DEMO_SEED=0 node server.js  # production: start all counters at zero
PORT=8080 node server.js    # custom port
```

Zero dependencies — plain Node (18+). Static frontend in `public/`, JSON API,
write-through persistence to `data/state.json` (delete it to reset).

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
