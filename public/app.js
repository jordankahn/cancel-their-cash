/* Cancel Out Their Vote — frontend, chip-allocation edition. No frameworks, no
   tracking. You hold one $100 vote = ten $10 chips; you allocate them across
   corporate PACs in your own browser, then cast once. */
'use strict';

const BUDGET_USD = 100;
const CHIP_USD = 10;
const BUDGET_CHIPS = BUDGET_USD / CHIP_USD; // 10
const WALLET_KEY = 'ctv-wallet-v1';

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => Number(n).toLocaleString('en-US');
const usd = (n) => '$' + fmt(Math.round(n));

let ROSTER = [];
const BY_ID = new Map();
let currentTag = 'ALL';
let searchQuery = '';
let currentSheet = 1;
const SHEET_SIZE = 12;
let boardMode = 'leader';

// ---------------------------------------------------------------------------
// Wallet (browser-local; no account)
// ---------------------------------------------------------------------------

function loadWallet() {
  try {
    const w = JSON.parse(localStorage.getItem(WALLET_KEY));
    if (w && typeof w.alloc === 'object') return { alloc: w.alloc || {}, cast: !!w.cast, name: w.name || '' };
  } catch (_) { /* fresh */ }
  return { alloc: {}, cast: false, name: '' };
}
let wallet = loadWallet();
function saveWallet() { localStorage.setItem(WALLET_KEY, JSON.stringify(wallet)); }

const chipsOn = (id) => wallet.alloc[id] || 0;
const placedChips = () => Object.values(wallet.alloc).reduce((s, n) => s + n, 0);
const remainingChips = () => BUDGET_CHIPS - placedChips();

function addChip(id) {
  if (wallet.cast || remainingChips() <= 0) return;
  wallet.alloc[id] = chipsOn(id) + 1;
  saveWallet();
  afterWalletChange(id);
}
function removeChip(id) {
  if (wallet.cast || chipsOn(id) <= 0) return;
  wallet.alloc[id] = chipsOn(id) - 1;
  if (wallet.alloc[id] === 0) delete wallet.alloc[id];
  saveWallet();
  afterWalletChange(id);
}
function afterWalletChange(id) {
  updateRow(id);      // patch only the touched row so its button survives the click
  renderWalletUI();
  // every + button also depends on the global remaining budget
  const dis = wallet.cast || remainingChips() <= 0;
  document.querySelectorAll('.lrow [data-plus]').forEach((b) => { b.disabled = dis; });
}

function updateRow(id) {
  const row = document.querySelector(`.lrow[data-id="${CSS.escape(id)}"]`);
  const t = BY_ID.get(id);
  if (!row || !t) return;
  const yours = chipsOn(id);
  const over = balanceUsd(t) < 0;
  const inkPct = pctOf(pledgedUsd(t), t);
  const youPct = pctOf(yourPendingUsd(t), t);
  row.classList.toggle('is-yours', yours > 0);
  row.classList.toggle('is-overdrawn', over);
  row.querySelector('.meter-ink').style.width = inkPct.toFixed(2) + '%';
  const my = row.querySelector('.meter-you');
  my.style.left = inkPct.toFixed(2) + '%';
  my.style.width = Math.min(100 - inkPct, youPct).toFixed(2) + '%';
  row.querySelector('.lrow-status').innerHTML = over
    ? `<span class="over-tag">OVERDRAWN ${usd(-balanceUsd(t))} past zero</span>`
    : `${usd(totalNeutralized(t))} canceled${yours ? ` · <span class="you-tag">you: ${usd(yours * CHIP_USD)}</span>` : ''}`;
  row.querySelector('.step-val').textContent = usd(yours * CHIP_USD);
  row.querySelector('[data-minus]').disabled = wallet.cast || yours === 0;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function boot() {
  initIndexSpy();
  buildSpendPicker();
  wireCastControls();

  const [roster, stats, feed] = await Promise.all([
    api('/api/roster'), api('/api/stats'), api('/api/feed?limit=25'),
  ]);
  ROSTER = roster.targets;
  ROSTER.forEach((t) => BY_ID.set(t.id, t));
  buildFilters();
  renderStats(stats);
  renderGrid();
  renderBoard();
  renderTicker(feed.feed);
  renderWalletUI();
  setInterval(refreshLive, 25000);
}

async function refreshLive() {
  try {
    const [stats, feed] = await Promise.all([api('/api/stats'), api('/api/feed?limit=25')]);
    renderStats(stats, true);
    renderTicker(feed.feed);
    renderBoard();
    // Deliberately do NOT rebuild the ledger grid here — that would destroy a
    // stepper button mid-click and interrupt allocation. The crowd totals in
    // visible rows refresh on the next user-driven render (filter/page/cast).
  } catch (_) { /* offline blip; try again next tick */ }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function buildFilters() {
  const tags = [...new Set(ROSTER.map((t) => t.industry))].sort();
  const tagSel = $('#tagPick');
  tagSel.innerHTML = '<option value="ALL">All industries</option>' +
    tags.map((t) => `<option value="${t}">${tagLabel(t)}</option>`).join('');
  tagSel.addEventListener('change', () => { currentTag = tagSel.value; currentSheet = 1; renderGrid(); });
  $('#docketSearch').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase(); currentSheet = 1; renderGrid();
  });
}

// ---------------------------------------------------------------------------
// Stats, ticker, index spy
// ---------------------------------------------------------------------------

function renderStats(stats, quiet) {
  countTo($('#indexTotal'), stats.total, quiet, usd);
  const live = $('#heroLive');
  if (live) live.innerHTML =
    `Voters have already placed <strong>${usd(stats.total)}</strong> against <strong>${usd(stats.outstanding)}</strong> of disclosed corporate PAC money. Your $100 is next.`;
}

function countTo(el, target, quiet, format = fmt) {
  if (!el) return;
  const start = Number((el.textContent || '0').replace(/[^0-9]/g, '')) || 0;
  if (quiet && start === target) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = format(target); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 900);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = format(Math.round(start + (target - start) * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function renderTicker(feed) {
  const items = feed.map((f) =>
    `<span class="wire-item"><span class="tk-x">✗</span> ${escapeHtml(f.name || 'A voter')} placed ${usd(f.usd)} on ${escapeHtml(f.target)} · ${ago(f.agoMs)}</span>`
  ).join('');
  $('#tickerTrack').innerHTML = items + items;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initIndexSpy() {
  const links = [...document.querySelectorAll('.index-links a')];
  const targets = links.map((a) => document.querySelector(a.getAttribute('href')));
  let ticking = false;
  const update = () => {
    ticking = false;
    let current = -1;
    targets.forEach((t, i) => { if (t && t.getBoundingClientRect().top <= 90) current = i; });
    links.forEach((a, i) => {
      a.classList.toggle('is-current', i === current);
      if (i === current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  };
  document.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } });
  update();
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

const tagLabel = (t) => t.charAt(0) + t.slice(1).toLowerCase();
const pledgedUsd = (t) => t.pledged || 0;

// Industry seals — original engraved line-art (no trademarks), tinted with a
// muted "stamp ink" color per sector so the ledger has visual rhythm. Red is
// deliberately absent (reserved for OVERDRAWN).
const INDUSTRY_COLORS = {
  'DEFENSE': '#2b5f6b', 'PHARMA': '#2f7d4f', 'OIL & GAS': '#7a5326',
  'WALL STREET': '#1c5f42', 'TELECOM & MEDIA': '#37477e', 'BIG TECH': '#1f7a72',
  'INSURANCE': '#3f5a7a', 'AGRIBUSINESS & FOOD': '#5f6b2b', 'TRANSPORT': '#3a5a6b',
  'VICE': '#7a3a5a', 'CRYPTO': '#8a6a1f',
};
const INDUSTRY_ICONS = {
  'DEFENSE': '<path d="M12 3l7 2.5v5.5c0 4-3 6.8-7 8-4-1.2-7-4-7-8V5.5L12 3z"/><path d="M12 8v4M10 10h4"/>',
  'PHARMA': '<rect x="4" y="8.5" width="16" height="7" rx="3.5"/><path d="M12 8.5v7"/>',
  'OIL & GAS': '<path d="M12 3.5c3 4.2 4.8 6.4 4.8 8.8a4.8 4.8 0 01-9.6 0c0-2.4 1.8-4.6 4.8-8.8z"/>',
  'WALL STREET': '<path d="M3.5 9L12 4.5 20.5 9"/><path d="M5.5 9.5v8M9.5 9.5v8M14.5 9.5v8M18.5 9.5v8"/><path d="M4 20h16"/>',
  'TELECOM & MEDIA': '<path d="M12 9v9"/><path d="M9 20h6l-3-11z"/><path d="M7.5 6.5a5 5 0 000 5M16.5 6.5a5 5 0 010 5"/>',
  'BIG TECH': '<rect x="8" y="8" width="8" height="8" rx="1"/><path d="M11 8V5M13 8V5M11 19v-3M13 19v-3M8 11H5M8 13H5M19 11h-3M19 13h-3"/>',
  'INSURANCE': '<path d="M4 11a8 8 0 0116 0z"/><path d="M12 11v6a2 2 0 01-4 0"/>',
  'AGRIBUSINESS & FOOD': '<path d="M12 20V8"/><path d="M12 12c-2.4 0-4-1.6-4-4 2.4 0 4 1.6 4 4zM12 12c2.4 0 4-1.6 4-4-2.4 0-4 1.6-4 4z"/><path d="M12 8c-2 0-3.3-1.3-3.3-3.3C11 4.7 12 6 12 8zM12 8c2 0 3.3-1.3 3.3-3.3C13 4.7 12 6 12 8z"/>',
  'TRANSPORT': '<rect x="2.5" y="7.5" width="11" height="7.5"/><path d="M13.5 10h3.5l3 3v2h-6.5z"/><circle cx="6" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>',
  'VICE': '<path d="M10 3.5h4v2.5l1 2.5V19a1.5 1.5 0 01-1.5 1.5h-3A1.5 1.5 0 019 19V8.5l1-2.5z"/><path d="M9 12h6"/>',
  'CRYPTO': '<circle cx="12" cy="12" r="8"/><path d="M12 7.5l3.2 4.5-3.2 4.5-3.2-4.5z"/>',
};
const industryColor = (ind) => INDUSTRY_COLORS[ind] || '#43402f';
const industrySeal = (ind) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${INDUSTRY_ICONS[ind] || ''}</svg>`;
const yourPendingUsd = (t) => (wallet.cast ? 0 : chipsOn(t.id) * CHIP_USD);
const totalNeutralized = (t) => pledgedUsd(t) + yourPendingUsd(t);
const balanceUsd = (t) => t.totalUsd - totalNeutralized(t);
const pctOf = (usdVal, t) => Math.min(100, (usdVal / t.totalUsd) * 100);

function filteredRoster() {
  return ROSTER.filter((t) =>
    (currentTag === 'ALL' || t.industry === currentTag) &&
    (!searchQuery || t.name.toLowerCase().includes(searchQuery))
  ).sort((a, b) => b.totalUsd - a.totalUsd);
}

function renderRollup(list) {
  const rollup = $('#rollup');
  if (currentTag === 'ALL' || !list.length) { rollup.hidden = true; return; }
  const total = list.reduce((s, t) => s + t.totalUsd, 0);
  const neut = list.reduce((s, t) => s + totalNeutralized(t), 0);
  rollup.hidden = false;
  rollup.innerHTML =
    `<span class="rollup-name">${escapeHtml(tagLabel(currentTag))} — industry total</span>
     <span class="rollup-fig">OUTSTANDING ${usd(total)}</span>
     <span class="rollup-fig rollup-neut">NEUTRALIZED ${usd(neut)} · ${((neut / total) * 100).toFixed(1)}%</span>`;
}

function renderGrid() {
  const grid = $('#ledgerGrid');
  const list = filteredRoster();

  const parts = ['The Money'];
  if (currentTag !== 'ALL') parts.push(tagLabel(currentTag));
  if (searchQuery) parts.push(`“${searchQuery}”`);
  const barText = `${parts.join(' · ')} (${list.length} PAC${list.length === 1 ? '' : 's'})`;
  if ($('#ledger').textContent !== barText) $('#ledger').textContent = barText;

  renderRollup(list);

  if (!list.length) {
    grid.innerHTML = '<p class="empty-note">No PACs match. The money is still out there — clear a filter and place your chips anyway.</p>';
    $('#pager').innerHTML = ''; $('#pagerAnnounce').textContent = '';
    return;
  }

  const totalSheets = Math.ceil(list.length / SHEET_SIZE);
  if (currentSheet > totalSheets) currentSheet = totalSheets;
  const page = list.slice((currentSheet - 1) * SHEET_SIZE, currentSheet * SHEET_SIZE);
  const locked = wallet.cast;
  const noBudget = remainingChips() <= 0;

  grid.innerHTML = page.map((t) => {
    const yours = chipsOn(t.id);
    const over = balanceUsd(t) < 0;
    const inkPct = pctOf(pledgedUsd(t), t);
    const youPct = pctOf(yourPendingUsd(t), t);
    return `
    <article class="lrow${over ? ' is-overdrawn' : ''}${yours ? ' is-yours' : ''}" data-id="${t.id}">
      <div class="lrow-head">
        <span class="lrow-seal" style="color:${industryColor(t.industry)}">${industrySeal(t.industry)}</span>
        <div class="lrow-headmain">
          <h3 class="lrow-name">${escapeHtml(t.name)}</h3>
          <p class="lrow-meta" style="color:${industryColor(t.industry)}">${escapeHtml(tagLabel(t.industry))}</p>
        </div>
        <span class="lrow-total">${usd(t.totalUsd)}<span class="lrow-total-lbl"> on the books</span></span>
      </div>
      <p class="lrow-blurb">${escapeHtml(t.blurb)}</p>
      <div class="meter" role="img" aria-label="${(inkPct + youPct).toFixed(0)}% neutralized">
        <span class="meter-ink" style="width:${inkPct.toFixed(2)}%"></span>
        <span class="meter-you" style="left:${inkPct.toFixed(2)}%;width:${Math.min(100 - inkPct, youPct).toFixed(2)}%"></span>
      </div>
      <div class="lrow-foot">
        <span class="lrow-status">${over
          ? `<span class="over-tag">OVERDRAWN ${usd(-balanceUsd(t))} past zero</span>`
          : `${usd(totalNeutralized(t))} canceled${yours ? ` · <span class="you-tag">you: ${usd(yours * CHIP_USD)}</span>` : ''}`}</span>
        <span class="stepper" ${locked ? 'data-locked' : ''}>
          <button type="button" class="step-btn" data-minus aria-label="Remove a $10 chip from ${escapeHtml(t.name)}" ${locked || yours === 0 ? 'disabled' : ''}>−</button>
          <span class="step-val" aria-live="polite">${usd(yours * CHIP_USD)}</span>
          <button type="button" class="step-btn" data-plus aria-label="Place a $10 chip on ${escapeHtml(t.name)}" ${locked || noBudget ? 'disabled' : ''}>+</button>
        </span>
      </div>
      ${over ? '<span class="paper-stamp" style="--rot:-5deg">OVERDRAWN</span>' : ''}
    </article>`;
  }).join('');

  renderPager(totalSheets);
}

$('#ledgerGrid').addEventListener('click', (e) => {
  const row = e.target.closest('.lrow'); if (!row) return;
  if (e.target.closest('[data-plus]')) return addChip(row.dataset.id);
  if (e.target.closest('[data-minus]')) return removeChip(row.dataset.id);
});

// ---------------------------------------------------------------------------
// Wallet UI (hero preview + sticky bar)
// ---------------------------------------------------------------------------

function chipPips(filled) {
  let out = '';
  for (let i = 0; i < BUDGET_CHIPS; i++) out += `<span class="pip${i < filled ? ' is-on' : ''}"></span>`;
  return out;
}

function renderWalletUI() {
  const placed = placedChips();
  const placedUsd = placed * CHIP_USD;
  const remUsd = remainingChips() * CHIP_USD;

  const heroChips = $('#heroChips');
  if (heroChips) heroChips.innerHTML = chipPips(placed);
  const heroRem = $('#heroRemaining');
  if (heroRem) heroRem.textContent = wallet.cast ? 'Cast ✓' : usd(remUsd);

  const bar = $('#walletBar');
  const msg = $('#walletMsg');
  const btn = $('#castBtn');
  $('#walletChips').innerHTML = chipPips(placed);

  if (wallet.cast) {
    bar.hidden = false;
    bar.classList.add('is-cast');
    msg.innerHTML = '<strong>Vote cast ✓</strong> — now go make it real.';
    btn.disabled = false;
    btn.textContent = 'View receipt';
    return;
  }
  bar.classList.remove('is-cast');
  if (placed === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  msg.innerHTML = remUsd > 0
    ? `<strong>${usd(placedUsd)}</strong> placed · ${usd(remUsd)} left`
    : '<strong>$100 placed</strong> — your vote is fully loaded.';
  btn.disabled = false;
  btn.textContent = remUsd > 0 ? `Cast ${usd(placedUsd)}` : 'Cast my $100';
}

// ---------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------

function wireCastControls() {
  const nameInput = $('#walletName');
  if (nameInput) {
    nameInput.value = wallet.name || '';
    nameInput.addEventListener('input', () => { wallet.name = nameInput.value.trim().slice(0, 20); saveWallet(); });
  }
  $('#castBtn').addEventListener('click', () => {
    if (wallet.cast) return openReceipt();
    castVote();
  });
  $('#castClose').addEventListener('click', closeReceipt);
  $('#castReset').addEventListener('click', resetWallet);
  $('#castVeil').addEventListener('click', (e) => { if (e.target === $('#castVeil')) closeReceipt(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#castVeil').hidden) closeReceipt(); });
  $('#certBtn').addEventListener('click', downloadCertificate);
  $('#shareBtn').addEventListener('click', (e) => shareCast(e.currentTarget));
  $('#spendState').addEventListener('change', (e) => {
    const v = e.target.value;
    $('#registerLink').href = v ? `https://vote.gov/register/${v.toLowerCase()}` : 'https://vote.gov';
    if (v) localStorage.setItem('ctv-spend-state', v);
  });
}

async function castVote() {
  if (placedChips() === 0) return;
  const allocations = {};
  for (const [id, chips] of Object.entries(wallet.alloc)) allocations[id] = chips * CHIP_USD;

  const btn = $('#castBtn');
  btn.disabled = true; btn.textContent = 'Casting…';
  try {
    const res = await fetch('/api/cast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allocations, name: wallet.name }),
    });
    const out = await res.json();
    if (!res.ok) { btn.disabled = false; renderWalletUI(); alert(out.error || 'Could not cast.'); return; }
    // fold into local aggregate so the boards/rows reflect it immediately
    for (const [id, newTotal] of Object.entries(out.applied)) { const t = BY_ID.get(id); if (t) t.pledged = newTotal; }
  } catch (_) { /* offline: still let them feel the cast locally */ }

  wallet.cast = true; saveWallet();
  renderGrid(); renderWalletUI();
  api('/api/stats').then((s) => renderStats(s, true)).catch(() => {});
  openReceipt(true);
}

function allocationRows() {
  return Object.entries(wallet.alloc)
    .map(([id, chips]) => ({ t: BY_ID.get(id), usdv: chips * CHIP_USD }))
    .filter((r) => r.t)
    .sort((a, b) => b.usdv - a.usdv);
}

function openReceipt(fresh) {
  const rows = allocationRows();
  const total = rows.reduce((s, r) => s + r.usdv, 0);
  $('#castReceipt').innerHTML = rows.map((r) =>
    `<li><span class="cr-name">${escapeHtml(r.t.name)}</span><span class="cr-dots"></span><span class="cr-amt">${usd(r.usdv)}</span></li>`
  ).join('') + `<li class="cr-total"><span class="cr-name">Your vote, deployed</span><span class="cr-dots"></span><span class="cr-amt">${usd(total)}</span></li>`;
  const saved = localStorage.getItem('ctv-spend-state');
  if (saved) { $('#spendState').value = saved; $('#registerLink').href = `https://vote.gov/register/${saved.toLowerCase()}`; }
  const veil = $('#castVeil');
  veil.hidden = false;
  veil.classList.toggle('is-fresh', !!fresh);
  document.body.style.overflow = 'hidden';
  $('#castClose').focus();
}
function closeReceipt() { $('#castVeil').hidden = true; document.body.style.overflow = ''; }

function resetWallet() {
  wallet = { alloc: {}, cast: false, name: wallet.name };
  saveWallet();
  closeReceipt();
  // clear our local pending; server aggregate stays (their cast already counted)
  renderGrid(); renderWalletUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Returns tables
// ---------------------------------------------------------------------------

async function renderBoard() {
  const list = $('#boardList');
  try {
    if (boardMode === 'leader') {
      const { leaderboard } = await api('/api/leaderboard?limit=10');
      drawBoard(list, leaderboard, (r) => usd(r.pledged), (r) => r.pledged);
    } else {
      const { trending } = await api('/api/trending?limit=10');
      if (!trending.length) {
        list.innerHTML = '<li><span class="rank">—</span><span class="who"><span class="nm">A quiet day at the currency desk</span><span class="st">No pledges in 24h</span></span><span class="track"></span><span class="ct"></span></li>';
        return;
      }
      drawBoard(list, trending, (r) => `+${usd(r.dayUsd)}`, (r) => r.dayUsd);
    }
  } catch (_) { /* keep prior board */ }
}

function drawBoard(list, rows, ctFn, valFn) {
  const max = Math.max(...rows.map(valFn), 1);
  list.innerHTML = rows.map((r, i) => `
    <li>
      <span class="rank">${String(i + 1).padStart(2, '0')}</span>
      <span class="who"><span class="nm">${escapeHtml(r.name)}</span>
        <span class="st">${escapeHtml(tagLabel(r.industry))} · ${usd(r.totalUsd)} on the books</span></span>
      <span class="track"><span class="bar" style="width:${((valFn(r) / max) * 100).toFixed(1)}%"></span></span>
      <span class="ct">${ctFn(r)}</span>
    </li>`).join('');
}

$('#tabLeader').addEventListener('click', () => setBoard('leader'));
$('#tabTrend').addEventListener('click', () => setBoard('trend'));
function setBoard(mode) {
  boardMode = mode;
  $('#tabLeader').classList.toggle('is-active', mode === 'leader');
  $('#tabTrend').classList.toggle('is-active', mode === 'trend');
  $('#tabLeader').setAttribute('aria-selected', mode === 'leader');
  $('#tabTrend').setAttribute('aria-selected', mode === 'trend');
  renderBoard();
}

// ---------------------------------------------------------------------------
// Pager
// ---------------------------------------------------------------------------

function renderPager(totalSheets) {
  const pager = $('#pager');
  const announce = $('#pagerAnnounce');
  if (totalSheets <= 1) { pager.innerHTML = ''; if (announce) announce.textContent = ''; return; }
  if (announce) announce.textContent = `Page ${currentSheet} of ${totalSheets}`;
  const numbers = totalSheets <= 8
    ? Array.from({ length: totalSheets }, (_, i) =>
        `<button class="sheet-no${i + 1 === currentSheet ? ' is-current' : ''}" data-sheet="${i + 1}" aria-label="Page ${i + 1}"${i + 1 === currentSheet ? ' aria-current="page"' : ''}>${i + 1}</button>`).join('')
    : `<span>Page ${currentSheet} of ${totalSheets}</span>`;
  pager.innerHTML =
    `<button data-sheet="${currentSheet - 1}" ${currentSheet === 1 ? 'disabled' : ''} aria-label="Previous page">◀</button>
     ${numbers}
     <button data-sheet="${currentSheet + 1}" ${currentSheet === totalSheets ? 'disabled' : ''} aria-label="Next page">▶</button>`;
}

$('#pager').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sheet]');
  if (!btn || btn.disabled) return;
  const label = btn.getAttribute('aria-label');
  currentSheet = Number(btn.dataset.sheet);
  renderGrid();
  const pager = $('#pager');
  const target = (label && pager.querySelector(`button[aria-label="${label}"]:not([disabled])`)) ||
    pager.querySelector('.sheet-no.is-current') || pager.querySelector('button[data-sheet]:not([disabled])');
  if (target) target.focus({ preventScroll: true });
  $('#ledger').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------------------------------------------------------------------------
// Spend-state picker (in receipt)
// ---------------------------------------------------------------------------

function buildSpendPicker() {
  $('#spendState').innerHTML = '<option value="">your state…</option>' +
    Object.entries(STATES).map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
}

// ---------------------------------------------------------------------------
// Certificate of Deposit (1200×630 canvas → PNG)
// ---------------------------------------------------------------------------

async function drawCertificate() {
  const name = (wallet.name || '').trim() || 'A Registered Voter';
  await document.fonts.load('700 44px "Archivo Narrow"');
  await document.fonts.load('900 40px "Fraunces"');
  const rows = allocationRows();
  const total = rows.reduce((s, r) => s + r.usdv, 0);

  const cv = $('#certCanvas');
  const x = cv.getContext('2d');
  const W = cv.width, H = cv.height;

  x.fillStyle = '#f2ead6'; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 1500; i++) { x.fillStyle = `rgba(23,22,26,${Math.random() * 0.03})`; x.fillRect(Math.random() * W, Math.random() * H, 1.2, 1.2); }

  x.fillStyle = '#1c5f42'; x.fillRect(28, 28, W - 56, 74);
  x.fillStyle = '#f2ead6'; x.textAlign = 'left';
  x.font = '700 30px "Archivo Narrow", sans-serif';
  x.fillText('CERTIFICATE OF DEPOSIT — ONE (1) $100 VOTE', 50, 74);
  x.textAlign = 'right'; x.font = '14px "Courier Prime", monospace';
  x.fillText('FORM CTV-26-M · BUREAU OF BALLOT GRIEVANCES', W - 50, 62);

  x.strokeStyle = '#1c5f42'; x.lineWidth = 2; x.strokeRect(28, 28, W - 56, H - 56);
  x.strokeStyle = '#17161a'; x.lineWidth = 1; x.strokeRect(40, 116, W - 80, H - 156);

  x.textAlign = 'left'; x.fillStyle = '#55534f'; x.font = '19px "Archivo Narrow", sans-serif';
  x.fillText('THIS CERTIFIES THAT', 62, 158);
  x.fillStyle = '#17161a'; x.font = '900 46px "Fraunces", serif';
  x.fillText(name.toUpperCase(), 62, 204);
  x.fillStyle = '#55534f'; x.font = '19px "Archivo Narrow", sans-serif';
  x.fillText('DEPLOYED ONE $100 VOTE AT THE OFFICIAL EXCHANGE RATE AGAINST CORPORATE MONEY:', 62, 246);

  // allocation table (up to 6 lines)
  const shown = rows.slice(0, 6);
  let y = 292;
  x.font = '700 24px "Archivo Narrow", sans-serif';
  for (const r of shown) {
    x.fillStyle = '#17161a'; x.textAlign = 'left';
    x.fillText(r.t.name.toUpperCase(), 62, y);
    x.fillStyle = '#1c5f42'; x.textAlign = 'right';
    x.fillText(usd(r.usdv), W - 62, y);
    x.strokeStyle = '#cbb98f'; x.lineWidth = 1; x.beginPath(); x.moveTo(62, y + 9); x.lineTo(W - 62, y + 9); x.stroke();
    y += 40;
  }
  if (rows.length > 6) { x.fillStyle = '#55534f'; x.textAlign = 'left'; x.font = '18px "Courier Prime", monospace'; x.fillText(`+ ${rows.length - 6} more line items`, 62, y); y += 30; }

  x.fillStyle = '#17161a'; x.textAlign = 'left'; x.font = '700 30px "Archivo Narrow", sans-serif';
  x.fillText('TOTAL DEPLOYED', 62, y + 10);
  x.fillStyle = '#1c5f42'; x.textAlign = 'right'; x.fillText(usd(total), W - 62, y + 10);

  x.textAlign = 'center'; x.fillStyle = '#55534f'; x.font = '700 15px "Courier Prime", monospace';
  x.fillText('NON-TRANSFERABLE · NON-PURCHASABLE · CLEARS ONLY WHEN YOU ACTUALLY VOTE · VOTE.GOV', W / 2, H - 52);

  x.save(); x.translate(W - 195, 200); x.rotate(-0.14);
  x.strokeStyle = 'rgba(28,95,66,0.85)'; x.lineWidth = 5; x.strokeRect(-120, -34, 240, 66);
  x.fillStyle = 'rgba(28,95,66,0.85)'; x.textAlign = 'center'; x.font = '700 34px "Courier Prime", monospace';
  x.fillText('CAST', 0, 12); x.restore();

  return cv;
}

async function downloadCertificate() {
  const cv = await drawCertificate();
  const a = document.createElement('a');
  a.download = 'my-100-dollar-vote.png';
  a.href = cv.toDataURL('image/png'); a.click();
}

async function shareCast(btn) {
  const rows = allocationRows();
  const top = rows[0];
  const text = top
    ? `I just deployed my $100 vote against corporate money in politics — ${usd(top.usdv)} on ${top.t.name}${rows.length > 1 ? ` and ${rows.length - 1} more` : ''}. Your vote's worth $100 too. Spend it, then vote.`
    : `Your vote is worth $100 of the corporate money in politics. Spend it, then vote.`;
  try {
    const cv = await drawCertificate();
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const file = new File([blob], 'my-100-dollar-vote.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ text, files: [file] }); return; }
    if (navigator.share) { await navigator.share({ text, url: location.origin }); return; }
  } catch (_) { /* fall through */ }
  try {
    await navigator.clipboard.writeText(text + ' ' + location.origin);
    const old = btn.textContent; btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = old; }, 1600);
  } catch (_) { /* no-op */ }
}

boot().catch((err) => {
  console.error(err);
  $('#ledgerGrid').innerHTML = '<p class="empty-note">The currency desk is having technical difficulties. The money, regrettably, is fine.</p>';
});
