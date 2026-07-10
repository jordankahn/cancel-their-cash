# Layout Redesign: Navigation, Returns Snapshot, Ballot Filtering & Pagination

**Date:** 2026-07-09
**Status:** Approved by Jordan (brainstorm option A)
**Scope:** Frontend only — `public/index.html`, `public/styles.css`, `public/app.js`. No server/API changes.

## Problem

The site is one long document. With 150+ ballot rows in Part 1, the returns
tables (Part 2), methodology (Part 3), and fine print are buried below several
screens of scrolling. There is no navigation. The ballot itself has no
filtering beyond the state select and no pagination.

## Design

### 1. Sticky index bar

- A thin strip rendered under the wire ticker, styled as a form section index,
  not a web navbar: Courier, uppercase, hairline top/bottom rules on paper.
- Contents: `BALLOT · RETURNS · METHODOLOGY · FINE PRINT` as anchor links, plus
  a live running total right-aligned (`82,331 FILED`, updates with the existing
  25s refresh and on each cancellation).
- Positioning: normal document flow until the ballot header scrolls off, then
  `position: sticky; top: 0` pins it to the viewport. It spans the paper width
  (stays inside the document, not the desk).
- The section currently in view gets a red underline (rAF-throttled
  scroll/resize listener picking the last anchor target above the 80px line —
  deliberate substitution for IntersectionObserver, whose threshold model fits
  this poorly).
- Anchor clicks smooth-scroll (existing `scroll-behavior: smooth`, respects
  reduced motion). No routing, no hash-state persistence.
- Mobile: horizontal scroll if cramped (`overflow-x: auto`, no wrap); the
  running total may be hidden below ~480px to save space.

### 2. Document order

New order, top to bottom:

1. Ballot header bar (unchanged)
2. Cancellation wire (unchanged)
3. **Sticky index bar (new)**
4. Instructions + intake form (unchanged, incl. specimen stamp)
5. **Returns snapshot (new)** — no anchor of its own (the index bar's RETURNS
   link targets Part 2); visually part of the intake→ballot flow
6. Part 1 — Ballot (anchor `#ballot`)
7. Part 2 — Full returns (anchor `#returns`)
8. Part 3 — Notes on methodology (anchor `#methodology`)
9. Fine print (anchor `#fine-print`) + footer bar (unchanged)

### 3. Returns snapshot

- One compact strip titled `UNOFFICIAL RETURNS — SNAPSHOT` with a
  `FULL TABLES →` link that jumps to Part 2.
- Body: top 5 all-time as dense ruled rows — rank, name (caps), home state,
  count. No bar charts in the snapshot.
- One extra line: `TRENDING TODAY: <NAME> +<24h count>` — the top trending
  entry from `/api/trending?limit=1` (falls back to hiding the line if the
  24h window is empty).
- Height budget: roughly two ballot rows, so Part 1 still starts near the fold.
- Data source: same payloads already fetched for the boards; refreshed on the
  existing 25s cycle.

### 4. Ballot filter row

- Location: directly under the Part 1 bar, replacing the current `.part-note`
  line (the "reported home states" disclaimer moves into the filter row as a
  small right-aligned footnote, or below it if cramped).
- Controls, styled as form fields on one rule line:
  - **State select** — the existing `#statePick` moves here from the intake
    form. The intake form keeps only "Filed by". (Single source of truth for
    state; no duplicate selects.)
  - **Category select** — `ALL CATEGORIES / POLITICS / MUSIC / SPORTS /
    SCREEN / TECH / BUSINESS / CULTURE` (values from the roster's `tag` field).
  - **Name search** — text input, placeholder `SEARCH THE DOCKET…`,
    case-insensitive substring match on the celeb name, filters on input.
- Filters combine with AND. Any filter change resets to sheet 1.
- The Part 1 bar text echoes active filters:
  `PART 1 — CANCELABLE RESIDENTS OF TEXAS · MUSIC (3 ON FILE)`.
- Empty result: existing `.empty-note` pattern ("No famous ballots match…").

### 5. Pagination

- 12 rows per sheet, client-side over the filtered list (sorted by count desc,
  as today).
- Pager centered under the grid, ballot-furniture styling in Courier:
  `◀ SHEET 1 OF 13 ▶`. Arrows are plain bracketed buttons; when the filtered
  set has ≤ 8 sheets, individual sheet-number links render between the arrows.
- Paging scrolls to the top of Part 1 (`#ballot`).
- Pager hidden entirely when there's only one sheet.
- Session stamp state: `myStamps` map persists across paging/filtering; rows
  re-render with filled ovals and one representative stamp impression for
  already-canceled celebs (fresh impressions still animate on new stamps).

### 6. Non-changes (explicit)

- No server or API changes; no new endpoints. 153 rows are filtered/paged
  client-side.
- No URL routing or hash-persisted filter state.
- Cancel flow, certificate, share, wire ticker, terms page: unchanged.
- Light-mode-only paper aesthetic: unchanged. All new elements use the existing
  ink/paper/ledger/red variables, zero border-radius, red reserved for stamps
  and the active-section underline.

## Error handling

- `/api/trending` failure or empty: snapshot omits the trending line.
- Search input is display-filtering only (no server round trip); nothing to
  sanitize beyond existing `escapeHtml` on render.

## Testing (manual, via preview browser)

1. Index bar sticks after scrolling past the header; active section underline
   moves through all four sections; anchors land correctly.
2. Snapshot shows top 5 + trending line matching Part 2's Table A/B.
3. Filters: state+category+search combine; Part 1 bar text updates; empty
   state renders; filter change resets to sheet 1.
4. Pagination: sheet counts correct for ALL states (13 sheets) and small sets
   (pager hidden); paging preserves filled ovals on previously stamped rows.
5. Cancel flow still works from any sheet; running total in index bar ticks up.
6. Mobile 375px: index bar scrolls horizontally, filter row wraps, no
   horizontal page scroll.
