# Money Pivot: Cancel the Money in Politics — With Votes

**Date:** 2026-07-10
**Status:** Approved by Jordan (approach A; celebs dropped entirely; "build it, I need to see it" — spec review gate and plan ceremony waived for speed-to-visible)
**Branch:** `money-pivot`

## Concept

The site stops targeting celebrities' votes and starts targeting **corporate money in
politics**. Users pledge one vote against a corporate PAC's influence. Pledges convert
to dollars at the Bureau's **Official Exchange Rate — 1 vote = $100** — derived
tongue-in-cheek from real numbers ($15.9B total 2024 federal election spending per
OpenSecrets ÷ ~155M ballots cast ≈ $102.45; "the Bureau does not make change").
Each target shows real FEC disbursement totals and a progress meter toward full
neutralization. Inspired by integrityindex.us (Political Integrity Project); a future
collab could replace the static data with their live feed.

## Decisions

- **Approach A:** individual corporate PACs (~60) as ledger rows; ~10 industry rollups
  as the category filter, with an industry summary strip when filtered.
- **Celebrity canceling deleted** — data, code, copy.
- **Data:** static curated `data/pacs.json`; schema feed-compatible for a later
  Integrity Index integration. Figures rounded to the nearest $100k, each entry
  carries `source` + `asOf`. Displayed with a "figures rounded / as of" disclaimer.
- **State's role:** demoted to the GOTV payoff — a small "where will you spend it?"
  state picker in the post-stamp strip that builds the vote.gov/register/XX link.
  No state filter.

## Data model

`data/pacs.json`: array of
`{ id, name, industry, totalUsd, blurb, source, asOf }`
- `industry` ∈ {DEFENSE, PHARMA, OIL & GAS, WALL STREET, TELECOM & MEDIA, BIG TECH,
  INSURANCE, AGRIBUSINESS & FOOD, TRANSPORT, VICE, CRYPTO}
- `totalUsd`: 2024-cycle federal contributions/disbursements, rounded to $100k
  (crypto super-PAC entry uses its reported independent-expenditure war chest and
  says so in the blurb).
- Blurbs joke about the money and arithmetic only — never allege crimes or corruption
  ("we allege arithmetic").

Server (`server.js`): same zero-dep architecture and API shape. Roster payload key
becomes `targets`. Counters keyed by target id in `data/state.json` (delete old file
on deploy; demo seed regenerates). `apiStats` returns
`{ total (pledges), top (most-neutralized target), outstanding (Σ totalUsd), roster }`.
Demo seed boosts a couple of small-total targets past 100% so the OVERDRAWN state is
visible in demos. Feed/wire events unchanged structurally.

## UI (paper ledger — same design system)

- **Masthead:** "Official Influence Cancellation Ledger" · Form CTV-26-M ·
  "Unofficial · Non-binding · Mathematically petty". Title/meta/OG updated.
- **Exchange-rate exhibit** (new strip after intake): boxed math —
  $15,900,000,000 ÷ 155,238,302 ballots = $102.43/vote → OFFICIAL RATE $100
  ("the Bureau does not make change"), citation to OpenSecrets.
- **Intake tallies:** Influence neutralized ($) · Most-neutralized PAC ·
  Outstanding on ledger ($) · Elections literally purchased: 0 ("keep it that way").
- **Instructions** rewritten for the money mechanic (fill the oval = deposit one
  $100 vote against the target; PENDING until you actually vote).
- **Part 1 — Schedule of Outstanding Influence:** rows = oval + PAC name + industry
  tag + blurb + ledger line: `NEUTRALIZED $X OF $Y · Z%` + thin progress bar.
  Stamp = +$100 (optimistic, server-synced). **OVERDRAWN** flip state when
  neutralized > total: red stamp, red negative balance, full bar.
  Filters: industry select + search. Industry rollup strip when filtered.
  12-per-sheet pagination, focus/ARIA behavior unchanged.
- **Part 2 — Unofficial returns:** Table A "Most neutralized, all-time ($)",
  Table B "Trending, last 24h ($)". Snapshot strip in dollars.
- **Post-stamp strip:** status PENDING copy + state picker → vote.gov/register/XX +
  Certificate + Share + Stamp again.
- **Certificate of Deposit** (canvas): one (1) vote, face value $100,
  non-transferable, redeemable only at your polling place, drawn against the
  account of [target].
- **Part 3 methodology:** exchange-rate math with citations and sub-rates
  (2022 discount $79, Georgia-runoff premium $111); data provenance note;
  "we allege arithmetic"; credit + link to Integrity Index and OpenSecrets
  (clearly unaffiliated).
- **Fine print + terms.html:** corporations edition — nominative use, no logos,
  FEC public records, no candidate mapping (bright line), no inducements,
  same minimal-data policy.

## Non-changes

Zero dependencies; API shape; ballot-paper design system (light-only); index bar,
snapshot, filters, pagination, wire, stamp mechanics; rate limiting; privacy posture.

## Testing (browser)

1. Ledger renders ~60 targets sorted by outstanding total desc; industry filter +
   search combine; rollup strip totals match.
2. Stamping adds $100 to row, live totals, and wire; overdrawn target displays
   negative balance + OVERDRAWN stamp.
3. Certificate downloads with target name and $100 face value; share text correct.
4. State picker in post-stamp strip builds correct vote.gov link.
5. Mobile 375px: no horizontal scroll; progress lines wrap cleanly.
6. No console errors; `node --check` passes.
