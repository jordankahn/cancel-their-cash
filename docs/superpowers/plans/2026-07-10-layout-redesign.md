# Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Note (2026-07-11):** written during the celebrity-ballot era; the project has since been renamed **Cancel Their Cash** and pivoted to corporate-PAC targets. Kept as a historical record.

**Goal:** Add a sticky section-index bar, a top-5 returns snapshot above the ballot, and category/search filtering with 12-per-sheet pagination to the ballot document.

**Architecture:** All changes are client-side in the three frontend files (`public/index.html`, `public/styles.css`, `public/app.js`). Filtering/pagination operate on the already-fetched 153-row roster in memory. No server or API changes. The site is a zero-dependency vanilla-JS document — there is no test framework; each task verifies through the running dev server (`node server.js`, port 4680) in a browser, with exact checks listed. Spec: `docs/superpowers/specs/2026-07-09-layout-redesign-design.md`.

**Tech Stack:** Vanilla HTML/CSS/JS, Node built-in http server (unchanged). Fonts/vars already defined: `--font-mono` (Courier Prime), `--ink/--paper/--ledger/--red`.

**Verification setup (all tasks):** run `node server.js` from the repo root and open `http://localhost:4680`. Hard-reload (Cmd+Shift+R) after each change.

---

### Task 1: Section anchors + sticky index bar

**Files:**
- Modify: `public/index.html` (insert nav after the wire div; add ids to part bars and footer)
- Modify: `public/styles.css` (append `.index-bar` styles + scroll offsets)
- Modify: `public/app.js` (active-section spy, running total, retarget `#rosterBar` → `#ballot`)

- [ ] **Step 1: Confirm the feature is absent (baseline check)**

Open `http://localhost:4680`, scroll down: there is no navigation strip; you must scroll past all ballot rows to reach Part 2. This is the failure state the task fixes.

- [ ] **Step 2: Add section ids in `public/index.html`**

Change the Part 1 bar (currently `id="rosterBar"`):

```html
<div class="part-bar" id="ballot">Part 1 — Cancelable residents on file</div>
```

Change the Part 2 bar:

```html
<div class="part-bar" id="returns">Part 2 — Unofficial returns <span class="part-bar-right">51 of 51 states reporting · 0% of anything legally affected</span></div>
```

Change the Part 3 bar:

```html
<div class="part-bar" id="methodology">Part 3 — Notes on methodology</div>
```

Change the footer opening tag:

```html
<footer class="fine-print" id="fine-print">
```

- [ ] **Step 3: Insert the index bar in `public/index.html`**

Directly after the closing `</div>` of `<div class="wire" …>…</div>` and before `<div class="specimen" …>`:

```html
<nav class="index-bar" id="indexBar" aria-label="Section index">
  <div class="index-links">
    <a href="#ballot">Ballot</a>
    <a href="#returns">Returns</a>
    <a href="#methodology">Methodology</a>
    <a href="#fine-print">Fine print</a>
  </div>
  <span class="index-total"><strong id="indexTotal">0</strong>&nbsp;filed</span>
</nav>
```

- [ ] **Step 4: Append index-bar styles to `public/styles.css`**

Add after the `.wire` rules (location is cosmetic; end of file also works):

```css
/* ---------- sticky index bar ---------- */

.index-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  background: var(--paper);
  border-bottom: 1.5px solid var(--rule);
  padding: 0 26px;
}
.index-links { display: flex; overflow-x: auto; }
.index-links a {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--ink-60);
  padding: 9px 14px 7px;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
}
.index-links a:first-child { padding-left: 0; }
.index-links a:hover { color: var(--red); }
.index-links a.is-current { color: var(--ink); border-bottom-color: var(--red); }
.index-total {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-60);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.index-total strong { color: var(--ink); }
@media (max-width: 480px) { .index-total { display: none; } }

/* keep anchored sections clear of the sticky bar */
#ballot, #returns, #methodology, #fine-print { scroll-margin-top: 44px; }
```

- [ ] **Step 5: Wire up the spy + running total in `public/app.js`**

In `buildStatePicker()`, the state-change handler currently ends with `$('#rosterBar').scrollIntoView(...)`. Replace that line with:

```js
    $('#ballot').scrollIntoView({ behavior: 'smooth', block: 'start' });
```

In `renderGrid()`, replace both `$('#rosterBar').textContent = …` lines with `$('#ballot').textContent = …` (full renderGrid is rewritten in Task 3; for now a find-replace of the selector is enough).

In `renderStats(stats, quiet)`, add one line after the `countTo($('#statTotal'), …)` call:

```js
  countTo($('#indexTotal'), stats.total, quiet);
```

Add this new function anywhere top-level (e.g., after `renderTicker`):

```js
function initIndexSpy() {
  const links = [...document.querySelectorAll('.index-links a')];
  const targets = links.map((a) => document.querySelector(a.getAttribute('href')));
  let ticking = false;
  const update = () => {
    ticking = false;
    let current = -1;
    targets.forEach((t, i) => {
      if (t && t.getBoundingClientRect().top <= 80) current = i;
    });
    links.forEach((a, i) => a.classList.toggle('is-current', i === current));
  };
  document.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
}
```

Call it in `boot()` right after `buildStatePicker();`:

```js
  initIndexSpy();
```

- [ ] **Step 6: Verify in browser**

Reload `http://localhost:4680`. Expected: index strip appears under the wire; scrolling past the header pins it to the top; clicking RETURNS smooth-scrolls to Part 2 with the bar not covering it; the red underline moves BALLOT → RETURNS → METHODOLOGY → FINE PRINT as you scroll; the right side shows the live total (matches "Cancellations on file" tally). At 375px width the links scroll horizontally and the total hides; no horizontal page scroll.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat: sticky section index bar with scroll spy and running total"
```

---

### Task 2: Returns snapshot strip

**Files:**
- Modify: `public/index.html` (insert snapshot section before the Part 1 bar)
- Modify: `public/styles.css` (append `.snapshot` styles)
- Modify: `public/app.js` (renderSnapshot + hook into boot/refresh)

- [ ] **Step 1: Baseline check**

On the page, the first returns information appears only in Part 2, below all ballot rows.

- [ ] **Step 2: Insert snapshot markup in `public/index.html`**

Directly before `<div class="part-bar" id="ballot">…`:

```html
<section class="snapshot" aria-label="Returns snapshot">
  <div class="snap-head">
    <h2>Unofficial Returns — Snapshot</h2>
    <a href="#returns">Full tables →</a>
  </div>
  <ol class="snap-list" id="snapList"></ol>
  <p class="snap-trend" id="snapTrend" hidden></p>
</section>
```

- [ ] **Step 3: Append snapshot styles to `public/styles.css`**

```css
/* ---------- returns snapshot ---------- */

.snapshot { border-bottom: 1.5px solid var(--rule); padding: 14px 26px 12px; }
.snap-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.snap-head h2 {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
}
.snap-head a {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--red);
  text-decoration-color: var(--red);
  white-space: nowrap;
}
.snap-list { list-style: none; margin-top: 8px; columns: 1; }
.snap-list li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.85rem;
  padding: 3px 0 2px;
  border-bottom: 1px solid var(--ledger-soft);
}
.snap-list .rank { font-family: var(--font-mono); font-size: 0.7rem; color: var(--ink-60); }
.snap-list .nm { font-weight: 700; text-transform: uppercase; }
.snap-list .st {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-60);
}
.snap-list .dots { flex: 1; border-bottom: 1.5px dotted var(--ledger); min-width: 16px; }
.snap-list .ct { font-family: var(--font-mono); font-size: 0.82rem; font-variant-numeric: tabular-nums; }
.snap-trend {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--red);
  padding-top: 7px;
}
@media (min-width: 720px) {
  .snap-list { columns: 2; column-gap: 40px; }
  .snap-list li { break-inside: avoid; }
}
```

- [ ] **Step 4: Add renderer in `public/app.js`**

Add top-level (e.g., after `renderTicker`):

```js
async function renderSnapshot() {
  try {
    const [{ leaderboard }, { trending }] = await Promise.all([
      api('/api/leaderboard?limit=5'), api('/api/trending?limit=1'),
    ]);
    $('#snapList').innerHTML = leaderboard.map((r, i) => `
      <li>
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="nm">${escapeHtml(r.name)}</span>
        <span class="st">${r.state}</span>
        <span class="dots"></span>
        <span class="ct">${fmt(r.count)}</span>
      </li>
    `).join('');
    const trend = $('#snapTrend');
    if (trending.length) {
      trend.hidden = false;
      trend.textContent = `Trending today: ${trending[0].name} +${fmt(trending[0].dayCount)}`;
    } else {
      trend.hidden = true;
    }
  } catch (_) { /* snapshot is decorative; boards remain the source of truth */ }
}
```

In `boot()`, after `renderBoard();` add:

```js
  renderSnapshot();
```

In `refreshLive()`, after `renderBoard();` add:

```js
    renderSnapshot();
```

- [ ] **Step 5: Verify in browser**

Reload. Expected: a compact ruled strip titled UNOFFICIAL RETURNS — SNAPSHOT sits between the intake section and the Part 1 bar; five entries (two columns on desktop, one on mobile) matching the first five rows of Part 2 Table A; a red `TRENDING TODAY: <NAME> +<N>` line matching Table B's top row; FULL TABLES → jumps to Part 2. The ballot's first rows are still visible within one scroll of the fold.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat: top-5 returns snapshot with trending line above the ballot"
```

---

### Task 3: Filter row (state + category + search)

**Files:**
- Modify: `public/index.html` (remove state select from intake; replace `.part-note` with filter row)
- Modify: `public/styles.css` (append `.filter-row` styles)
- Modify: `public/app.js` (filter state, buildFilters, renderGrid filtering)

- [ ] **Step 1: Baseline check**

State select lives in the intake form; there is no category or search control; choosing "All states" renders all 153 rows at once.

- [ ] **Step 2: Remove the state fill-line from the intake form in `public/index.html`**

Delete this block (the "Filed by" fill-line stays):

```html
      <div class="fill-line">
        <label for="statePick">State of grievance</label>
        <select id="statePick" aria-label="Select your state"></select>
      </div>
```

- [ ] **Step 3: Replace the part-note with the filter row**

Delete:

```html
  <p class="part-note" id="rosterSub">Reported home states. We don't know how anyone votes. Neither do you. That's the point.</p>
```

Insert in its place (after the `id="ballot"` part bar, before `<section class="ballot-grid"…>`):

```html
<div class="filter-row">
  <div class="f-field">
    <label for="statePick">State</label>
    <select id="statePick" aria-label="Select your state"></select>
  </div>
  <div class="f-field">
    <label for="tagPick">Category</label>
    <select id="tagPick" aria-label="Filter by category"></select>
  </div>
  <div class="f-field f-search">
    <label for="docketSearch">Search</label>
    <input id="docketSearch" type="search" placeholder="SEARCH THE DOCKET…" autocomplete="off" aria-label="Search names">
  </div>
  <p class="f-note">Reported home states. We don't know how anyone votes. Neither do you.</p>
</div>
```

- [ ] **Step 4: Append filter-row styles to `public/styles.css`**

```css
/* ---------- ballot filter row ---------- */

.filter-row {
  display: flex;
  align-items: flex-end;
  gap: 22px;
  flex-wrap: wrap;
  padding: 12px 26px 14px;
  border-bottom: 1px solid var(--ledger);
}
.f-field { min-width: 150px; }
.f-field label {
  display: block;
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  margin-bottom: 2px;
}
.f-field select, .f-field input {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 0.92rem;
  color: var(--ink);
  background: transparent;
  border: none;
  border-bottom: 1.5px dotted var(--ink);
  padding: 4px 2px 3px;
  border-radius: 0;
}
.f-field select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='7' viewBox='0 0 11 7'%3E%3Cpath d='M1 1l4.5 4.5L10 1' fill='none' stroke='%2355534f' stroke-width='1.6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 4px center;
  padding-right: 24px;
  cursor: pointer;
}
.f-field input::placeholder { color: var(--ink-60); opacity: 0.7; letter-spacing: 0.06em; }
.f-search { flex: 1; min-width: 190px; }
.f-note {
  flex-basis: 100%;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-60);
  margin-top: 2px;
}
@media (min-width: 900px) {
  .f-note { flex-basis: auto; margin-left: auto; text-align: right; max-width: 300px; }
}
```

- [ ] **Step 5: Rework filtering in `public/app.js`**

Add state variables next to the existing `let currentState = …` line:

```js
let currentTag = 'ALL';
let searchQuery = '';
let currentSheet = 1;
const SHEET_SIZE = 12;
```

Replace the body of `buildStatePicker()`'s change handler and add a new `buildFilters()`. Full replacement of `buildStatePicker` plus the new function:

```js
function buildStatePicker() {
  const sel = $('#statePick');
  sel.innerHTML = '<option value="ALL">All states</option>' +
    Object.entries(STATES)
      .map(([code, name]) => `<option value="${code}">${name}</option>`)
      .join('');
  sel.value = currentState;
  sel.addEventListener('change', () => {
    currentState = sel.value;
    localStorage.setItem('ctv-state', currentState);
    currentSheet = 1;
    renderGrid();
  });
}

function buildFilters() {
  const tags = [...new Set(ROSTER.map((c) => c.tag))].sort();
  const tagSel = $('#tagPick');
  tagSel.innerHTML = '<option value="ALL">All categories</option>' +
    tags.map((t) => `<option value="${t}">${t.charAt(0) + t.slice(1).toLowerCase()}</option>`).join('');
  tagSel.addEventListener('change', () => {
    currentTag = tagSel.value;
    currentSheet = 1;
    renderGrid();
  });
  $('#docketSearch').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    currentSheet = 1;
    renderGrid();
  });
}
```

Note: `buildFilters()` reads ROSTER, so `boot()` must call it *after* the roster
fetch. In `boot()`, move nothing else — just add after `ROSTER = roster.celebs;`:

```js
  buildFilters();
```

Add a pure helper above `renderGrid`:

```js
function filteredRoster() {
  return ROSTER.filter((c) =>
    (currentState === 'ALL' || c.state === currentState) &&
    (currentTag === 'ALL' || c.tag === currentTag) &&
    (!searchQuery || c.name.toLowerCase().includes(searchQuery))
  ).sort((a, b) => b.count - a.count);
}
```

In `renderGrid()`, replace the list computation and bar-text section at the top
of the function with:

```js
  const grid = $('#celebGrid');
  const list = filteredRoster();

  const parts = [];
  parts.push(currentState === 'ALL' ? 'Cancelable residents on file' : `Cancelable residents of ${STATES[currentState]}`);
  if (currentTag !== 'ALL') parts.push(currentTag);
  if (searchQuery) parts.push(`“${searchQuery}”`);
  $('#ballot').textContent = `Part 1 — ${parts.join(' · ')} (${list.length} on file)`;
```

(The old `$('#rosterSub').textContent = …` assignment is deleted — `#rosterSub` no longer exists.)

Update the empty-state copy in the same function:

```js
  if (!list.length) {
    grid.innerHTML = '<p class="empty-note">No famous ballots match this combination of grievances. Loosen a filter — then vote anyway.</p>';
    $('#pager').innerHTML = '';
    return;
  }
```

(`#pager` is added in Task 4; until then this line is a harmless no-op if you
add Task 4's markup first, or temporarily guard with `if ($('#pager'))`. If
executing tasks strictly in order, add the guard:)

```js
    const pagerEl = $('#pager');
    if (pagerEl) pagerEl.innerHTML = '';
```

- [ ] **Step 6: Verify in browser**

Reload. Expected: intake shows only "Filed by"; Part 1 bar is followed by the filter row (state / category / search on one dotted-underline rule line, disclaimer note right-aligned on desktop); selecting Texas + Music shows only Texas musicians and the bar reads `PART 1 — CANCELABLE RESIDENTS OF TEXAS · MUSIC (N ON FILE)`; typing "swift" with state=All shows Taylor Swift; nonsense text shows the empty note. State persists across reload (localStorage). Console shows no errors.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat: ballot filter row — state moved from intake, category + name search added"
```

---

### Task 4: Pagination (12 per sheet)

**Files:**
- Modify: `public/index.html` (pager element after the grid)
- Modify: `public/styles.css` (append `.pager` + static stamp styles)
- Modify: `public/app.js` (sheet slicing, pager render, preserved stamp re-render)

- [ ] **Step 1: Baseline check**

With filters cleared ("All states"), the grid renders all 153 rows in one unbroken run.

- [ ] **Step 2: Add pager markup in `public/index.html`**

Directly after `<section class="ballot-grid" id="celebGrid"></section>`:

```html
<nav class="pager" id="pager" aria-label="Ballot sheets"></nav>
```

- [ ] **Step 3: Append pager + static-stamp styles to `public/styles.css`**

```css
/* ---------- ballot pager ---------- */

.pager {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-60);
  padding: 12px 26px 16px;
  border-bottom: 1px solid var(--ledger);
}
.pager:empty { display: none; }
.pager button {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  letter-spacing: 0.06em;
  background: none;
  border: none;
  color: var(--ink);
  padding: 2px 6px;
  text-transform: uppercase;
}
.pager button:hover:not(:disabled) { color: var(--red); }
.pager button:disabled { color: var(--ledger); cursor: default; }
.pager .sheet-no.is-current { color: var(--red); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }

/* representative stamp on re-rendered, already-canceled rows */
.stamp-impression.is-static { animation: none; opacity: 0.88; }
```

- [ ] **Step 4: Slice + pager rendering in `public/app.js`**

In `renderGrid()`, after the empty-state return, wrap the row rendering in a
sheet slice. The full remainder of `renderGrid()` becomes:

```js
  const totalSheets = Math.ceil(list.length / SHEET_SIZE);
  if (currentSheet > totalSheets) currentSheet = totalSheets;
  const page = list.slice((currentSheet - 1) * SHEET_SIZE, currentSheet * SHEET_SIZE);

  grid.innerHTML = page.map((c) => `
    <article class="brow" data-id="${c.id}">
      <div class="brow-main">
        <button class="oval${myStamps.has(c.id) ? ' is-filled' : ''}" data-id="${c.id}"
          aria-label="Cancel ${escapeHtml(c.name)}'s vote"></button>
        <div class="brow-txt">
          <h3 class="brow-name">${escapeHtml(c.name)}</h3>
          <p class="brow-meta">${STATES[c.state] || c.state} · ${c.tag}</p>
          <p class="brow-blurb">${escapeHtml(c.blurb)}</p>
        </div>
      </div>
      <p class="brow-count">Cancellations on file <span class="dots"></span> <strong data-count>${fmt(c.count)}</strong></p>
      <div class="brow-actions" ${myStamps.has(c.id) ? '' : 'hidden'}>
        <p class="brow-status" data-status>${stampStatusText(myStamps.get(c.id) || 0)}</p>
        <div class="brow-links">
          <a class="act-register" href="https://vote.gov/register/${c.state.toLowerCase()}" target="_blank" rel="noopener">Register to vote →</a>
          <button type="button" data-cert>Certificate</button>
          <button type="button" data-share>Share</button>
          <button type="button" data-again>Stamp again</button>
        </div>
      </div>
      ${myStamps.has(c.id) ? '<span class="stamp-impression is-static" style="--rot:-6deg;right:10px;top:12px">CANCELED</span>' : ''}
    </article>
  `).join('');

  renderPager(totalSheets);
```

Add the two helpers top-level (near `renderGrid`):

```js
function stampStatusText(times) {
  return times <= 1
    ? 'Status: pending until you actually vote.'
    : `Stamped ×${times}. It only had 1 vote — ${times - 1} filed under SPITE, SURPLUS. Still pending until you vote.`;
}

function renderPager(totalSheets) {
  const pager = $('#pager');
  if (totalSheets <= 1) { pager.innerHTML = ''; return; }
  const numbers = totalSheets <= 8
    ? Array.from({ length: totalSheets }, (_, i) =>
        `<button class="sheet-no${i + 1 === currentSheet ? ' is-current' : ''}" data-sheet="${i + 1}">${i + 1}</button>`
      ).join('')
    : `<span>Sheet ${currentSheet} of ${totalSheets}</span>`;
  pager.innerHTML = `
    <button data-sheet="${currentSheet - 1}" ${currentSheet === 1 ? 'disabled' : ''} aria-label="Previous sheet">◀</button>
    ${numbers}
    <button data-sheet="${currentSheet + 1}" ${currentSheet === totalSheets ? 'disabled' : ''} aria-label="Next sheet">▶</button>
  `;
}

$('#pager').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sheet]');
  if (!btn || btn.disabled) return;
  currentSheet = Number(btn.dataset.sheet);
  renderGrid();
  $('#ballot').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
```

In `cancelVote()`, the status-text assignment can now reuse the helper —
replace the `status.textContent = times === 1 ? … : …;` ternary with:

```js
  status.textContent = stampStatusText(times);
```

- [ ] **Step 5: Verify in browser**

Reload with state=All states, no filters. Expected: 12 rows render; pager shows `◀ Sheet 1 of 13 ▶` (13 sheets: numbered links suppressed above 8 sheets); ▶ pages forward and scrolls back to the Part 1 bar; filter to Texas → pager disappears if ≤ 12 results, or shows numbered sheet links when 2–8 sheets exist (e.g., California + no category). Stamp a row on sheet 1, page to sheet 2 and back: the oval stays filled, a static CANCELED impression shows without replaying the slam, actions strip still present, "Stamp again" works. Filter changes always land you on sheet 1.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat: 12-per-sheet ballot pagination with preserved stamp state"
```

---

### Task 5: Full-spec verification pass

**Files:** none modified (fixes, if any, happen inline and get committed with a descriptive message).

- [ ] **Step 1: Run the spec's testing checklist (§Testing, items 1–6) end-to-end**

At `http://localhost:4680`, desktop width:
1. Index bar sticks after the header scrolls off; underline traverses all four sections; each anchor lands unobscured.
2. Snapshot top-5 and trending line match Part 2 Table A rows 1–5 and Table B row 1.
3. Texas · Politics · search "cruz" → exactly Ted Cruz; bar text echoes all three; gibberish search shows empty note; every filter change resets to sheet 1.
4. All-states pager math: 153 rows → 13 sheets; last sheet shows the remainder (9 rows). Previously stamped rows keep state across paging.
5. Cancel from sheet 3: wire ticker gains the event within 25s; `#indexTotal` and `#statTotal` tick up.
6. Resize to 375px: index links scroll horizontally, total hidden, filter row wraps, no horizontal page scroll.

- [ ] **Step 2: Console + server check**

Browser console: zero errors/warnings. Server log: no 4xx/5xx on `/api/*`.

- [ ] **Step 3: Final commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix: layout redesign verification fixes"
```

---

## Self-Review

- **Spec coverage:** §1 index bar → Task 1; §2 order + §3 snapshot → Task 2; §4 filters → Task 3; §5 pagination → Task 4; §6 non-changes → no tasks touch server/API/routing; spec §Testing → Task 5. No gaps.
- **Placeholders:** none — every code step shows complete code.
- **Type consistency:** `currentSheet`/`SHEET_SIZE`/`filteredRoster()`/`stampStatusText()`/`renderPager()` names match across Tasks 3–4; `#ballot` retarget in Task 1 matches Task 3's bar-text code; Task 3's temporary `#pager` guard is superseded by Task 4's markup.
