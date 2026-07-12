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

---

## Revision 2 (2026-07-11) — chip allocation + hero redesign

User feedback: too much text up front, flat color, and infinite stamping made
pledges feel meaningless. Changes, all on branch `money-pivot`:

- **Scarcity mechanic.** Replaced unlimited per-row stamps with one scarce
  **$100 vote = ten $10 chips**. The voter allocates chips across targets
  (browser-local, freely re-balanceable), then **casts once** — a single
  `POST /api/cast {allocations:{id:usd}}`. No accounts; wallet + cast-lock live
  in localStorage (`ctv-wallet-v1`). Anti-spam by design.
- **Hero-first page.** New big Fraunces-serif hero ("Your vote is only worth
  $100.") with one-line hook, brief intro, a live chip wallet preview, and a
  single primary CTA. Instructions trimmed; exchange-rate math + notes moved
  below the ledger.
- **Visual depth.** Added a money-green accent (chips, cast, links, "your pick"
  row tint), a display serif (Fraunces), a guilloché engraving texture in the
  hero, warmer paper, and a larger type scale — addressing the "flat" note.
- **Ledger rows** now carry an inline chip stepper (− $X +), a two-tone
  neutralization meter, an `is-yours` green highlight, and the OVERDRAWN flip.
- **Casting ceremony.** A modal Certificate-of-Deposit receipt itemizes the
  allocation, shows PENDING status, a state picker → vote.gov link, and
  certificate/share. The canvas certificate lists the allocation breakdown.
- **Server** stores dollars directly (all $10 multiples); `/api/cancel` removed
  in favor of `/api/cast`; demo seed reworked to dollars with two OVERDRAWN
  showcases that don't top the board.

Superseded from Rev 1: per-row stamp counter, `/api/cancel`, the standalone
returns-snapshot strip, the exchange-rate "Exhibit A" box position.

---

## Revision 3 (2026-07-11) — rename, legal copy, visual polish

- **Renamed the product to "Cancel Their Cash."** "Cancel (Out) Their Vote" no
  longer fit once targets became corporations (they don't vote — their money
  does). Form-number initials CTV → CTC (Form CTC-26 / CTC-26-Legal; the
  certificate reads FORM CTC-26). The GitHub repo and working-dir names are a
  separate action and may still read `cancel-out-their-vote` / `cancel-their-vote`.
  The masthead references in Rev 1/2 above ("Official Influence Cancellation
  Ledger", "Form CTV-26-M") are superseded by this.
- **No-real-money copy discipline.** The metaphor now reads as canceling THEIR
  money, never spending yours: the user "uses / aims / cancels," corporations
  "spend" (factual). Purged from visible copy: spend (user-side), buy, pay,
  deposit, face value, non-purchasable, "make change", "clears", "Currency Desk",
  "Certificate of Deposit". An explicit "no real money changes hands, nobody is
  paid, the $100 is a figure of speech" now appears on-surface (hero note), in
  the cast modal, **baked into the shareable certificate image**, in the fine
  print, and in terms §1a — not only the disclaimer.
- **Engagement + clarity pass.** Chip placement now pops the seal, floats a
  "+$10", buzzes, and flashes the wallet bar on the last chip; the voter's
  contribution gets a guaranteed-visible 6px green nub on the meter; the effect
  verb is unified to "canceled" ("place" = the act of placing your own chips).
- **Visual:** per-industry engraved **seals** (11 original line-art icons in
  muted stamp-ink colors — no corporate logos, for trademark safety); ledger
  cards decluttered to 3 rows (blurb moved to hover `title`); methodology +
  fine-print footer cleaned up; leftover copy trimmed (dead part-bar text,
  duplicated exchange-rate note, filler masthead lines, demo-only "Start over").
