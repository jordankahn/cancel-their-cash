/* Cancel Their Vote — frontend, money-pivot edition. No frameworks, no
   tracking, no data beyond an optional first name attached to a number.
   A pledge = one vote = $100 of influence at the Official Exchange Rate. */
'use strict';

const RATE = 100; // dollars per vote; the Bureau does not make change

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
let currentTag = 'ALL';
let searchQuery = '';
let currentSheet = 1;
const SHEET_SIZE = 12;
const myStamps = new Map(); // target id -> times stamped this session
let boardMode = 'leader';
let lastStatsTotal = 0;

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
  $('#filedBy').value = localStorage.getItem('ctv-name') || '';
  $('#filedBy').addEventListener('change', () => {
    localStorage.setItem('ctv-name', $('#filedBy').value.trim());
  });

  const [roster, stats, feed] = await Promise.all([
    api('/api/roster'), api('/api/stats'), api('/api/feed?limit=25'),
  ]);
  ROSTER = roster.targets;
  buildFilters();
  renderStats(stats);
  renderGrid();
  renderBoard();
  renderSnapshot();
  renderTicker(feed.feed);
  setInterval(refreshLive, 25000);
}

async function refreshLive() {
  try {
    const [stats, feed] = await Promise.all([api('/api/stats'), api('/api/feed?limit=25')]);
    renderStats(stats, true);
    renderTicker(feed.feed);
    renderBoard();
    renderSnapshot();
  } catch (_) { /* offline blip; try again next tick */ }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function buildFilters() {
  const tags = [...new Set(ROSTER.map((t) => t.industry))].sort();
  const tagSel = $('#tagPick');
  tagSel.innerHTML = '<option value="ALL">All industries</option>' +
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

// ---------------------------------------------------------------------------
// Stats + ticker
// ---------------------------------------------------------------------------

function renderStats(stats, quiet) {
  lastStatsTotal = stats.total;
  countTo($('#statTotal'), stats.total * RATE, quiet, usd);
  countTo($('#indexTotal'), stats.total * RATE, quiet, usd);
  $('#statOutstanding').textContent = usd(stats.outstanding);
  if (stats.top) $('#statTop').textContent = stats.top.name;
}

function countTo(el, target, quiet, format = fmt) {
  const start = Number((el.textContent || '0').replace(/[^0-9]/g, '')) || 0;
  if (quiet && start === target) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = format(target);
    return;
  }
  const t0 = performance.now();
  const dur = 900;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
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
    links.forEach((a, i) => {
      a.classList.toggle('is-current', i === current);
      if (i === current) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  };
  document.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  });
  update();
}

function renderTicker(feed) {
  const items = feed.map((f) =>
    `<span class="wire-item"><span class="tk-x">✗</span> ${escapeHtml(f.name || 'A registered grudge-holder')} neutralized ${usd(f.times * RATE)} of ${escapeHtml(f.target)}'s influence · ${ago(f.agoMs)}</span>`
  ).join('');
  $('#tickerTrack').innerHTML = items + items; // duplicated for a seamless loop
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function renderSnapshot() {
  try {
    const [{ leaderboard }, { trending }] = await Promise.all([
      api('/api/leaderboard?limit=5'), api('/api/trending?limit=1'),
    ]);
    $('#snapList').innerHTML = leaderboard.map((r, i) => `
      <li>
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="nm">${escapeHtml(r.name)}</span>
        <span class="dots"></span>
        <span class="ct">${usd(r.count * RATE)}</span>
      </li>
    `).join('');
    const trend = $('#snapTrend');
    if (trending.length) {
      trend.hidden = false;
      trend.textContent = `Trending today: ${trending[0].name} −${usd(trending[0].dayCount * RATE).slice(1)} and falling`;
    } else {
      trend.hidden = true;
    }
  } catch (_) { /* snapshot is decorative; boards remain the source of truth */ }
}

// ---------------------------------------------------------------------------
// The ledger (Part 1)
// ---------------------------------------------------------------------------

function filteredRoster() {
  return ROSTER.filter((t) =>
    (currentTag === 'ALL' || t.industry === currentTag) &&
    (!searchQuery || t.name.toLowerCase().includes(searchQuery))
  ).sort((a, b) => b.totalUsd - a.totalUsd);
}

function neutralizedUsd(t) { return t.count * RATE; }
function balanceUsd(t) { return t.totalUsd - neutralizedUsd(t); }
function pct(t) { return Math.min(999, (neutralizedUsd(t) / t.totalUsd) * 100); }

function tagLabel(t) { return t.charAt(0) + t.slice(1).toLowerCase(); }

function renderRollup(list) {
  const rollup = $('#rollup');
  if (currentTag === 'ALL' || !list.length) { rollup.hidden = true; return; }
  const total = list.reduce((s, t) => s + t.totalUsd, 0);
  const neut = list.reduce((s, t) => s + neutralizedUsd(t), 0);
  rollup.hidden = false;
  rollup.innerHTML = `
    <span class="rollup-name">${escapeHtml(tagLabel(currentTag))} — industry ledger</span>
    <span class="rollup-fig">OUTSTANDING ${usd(total)}</span>
    <span class="rollup-fig rollup-neut">NEUTRALIZED ${usd(neut)} (${((neut / total) * 100).toFixed(1)}%)</span>
  `;
}

function renderGrid() {
  const grid = $('#celebGrid');
  const list = filteredRoster();

  const parts = ['Schedule of outstanding influence'];
  if (currentTag !== 'ALL') parts.push(tagLabel(currentTag));
  if (searchQuery) parts.push(`“${searchQuery}”`);
  const barText = `Part 1 — ${parts.join(' · ')} (${list.length} line item${list.length === 1 ? '' : 's'})`;
  if ($('#ballot').textContent !== barText) $('#ballot').textContent = barText;

  renderRollup(list);

  if (!list.length) {
    grid.innerHTML = '<p class="empty-note">No line items match. The money is still out there — loosen a filter and vote anyway.</p>';
    $('#pager').innerHTML = '';
    $('#pagerAnnounce').textContent = '';
    return;
  }

  const totalSheets = Math.ceil(list.length / SHEET_SIZE);
  if (currentSheet > totalSheets) currentSheet = totalSheets;
  const page = list.slice((currentSheet - 1) * SHEET_SIZE, currentSheet * SHEET_SIZE);

  grid.innerHTML = page.map((t) => {
    const over = balanceUsd(t) < 0;
    const stamped = myStamps.has(t.id);
    return `
    <article class="brow${over ? ' is-overdrawn' : ''}" data-id="${t.id}">
      <div class="brow-main">
        <button class="oval${stamped ? ' is-filled' : ''}" data-id="${t.id}"
          aria-label="Pledge one vote against ${escapeHtml(t.name)}"></button>
        <div class="brow-txt">
          <h3 class="brow-name">${escapeHtml(t.name)}</h3>
          <p class="brow-meta">${escapeHtml(tagLabel(t.industry))} · ${usd(t.totalUsd)} on ledger</p>
          <p class="brow-blurb">${escapeHtml(t.blurb)}</p>
        </div>
      </div>
      <div class="ledger-line">
        <div class="ledger-meter" role="img" aria-label="${pct(t).toFixed(1)} percent neutralized">
          <span class="ledger-fill" style="width:${Math.min(100, pct(t)).toFixed(2)}%"></span>
        </div>
        <p class="brow-count">
          ${over
            ? `<span class="over-balance">BALANCE ${usd(balanceUsd(t)).replace('$-', '−$')} · OVERDRAWN</span>`
            : `Neutralized <strong data-count>${usd(neutralizedUsd(t))}</strong> of ${usd(t.totalUsd)}`}
          <span class="dots"></span>
          <strong class="pct">${pct(t).toFixed(1)}%</strong>
        </p>
      </div>
      <div class="brow-actions" ${stamped ? '' : 'hidden'}>
        <p class="brow-status" data-status>${stampStatusText(myStamps.get(t.id) || 0)}</p>
        <div class="brow-links">
          <span class="spend-where">
            <label for="spend-${t.id}">Where will you spend it?</label>
            <select id="spend-${t.id}" data-spend aria-label="Pick your state for registration info">
              <option value="">state…</option>
              ${Object.entries(STATES).map(([c, n]) => `<option value="${c.toLowerCase()}">${n}</option>`).join('')}
            </select>
          </span>
          <a class="act-register" data-register href="https://vote.gov" target="_blank" rel="noopener">Register to vote →</a>
          <button type="button" data-cert>Certificate of deposit</button>
          <button type="button" data-share>Share</button>
          <button type="button" data-again>Deposit another $100</button>
        </div>
      </div>
      ${over ? '<span class="stamp-impression is-static" style="--rot:-5deg;right:10px;top:12px">OVERDRAWN</span>'
        : (stamped ? '<span class="stamp-impression is-static" style="--rot:-6deg;right:10px;top:12px">CANCELED</span>' : '')}
    </article>
  `; }).join('');

  renderPager(totalSheets);
}

function stampStatusText(times) {
  return times <= 1
    ? 'Status: pending. Your $100 clears only when you cast an actual ballot.'
    : `You've deposited ${usd(times * RATE)} of intent. Each $100 needs a voter behind it — bring ${times - 1} friend${times - 1 === 1 ? '' : 's'}. Still pending until you vote.`;
}

function renderPager(totalSheets) {
  const pager = $('#pager');
  const announce = $('#pagerAnnounce');
  if (totalSheets <= 1) {
    pager.innerHTML = '';
    if (announce) announce.textContent = '';
    return;
  }
  if (announce) announce.textContent = `Sheet ${currentSheet} of ${totalSheets}`;
  const numbers = totalSheets <= 8
    ? Array.from({ length: totalSheets }, (_, i) =>
        `<button class="sheet-no${i + 1 === currentSheet ? ' is-current' : ''}" data-sheet="${i + 1}" aria-label="Sheet ${i + 1}"${i + 1 === currentSheet ? ' aria-current="page"' : ''}>${i + 1}</button>`
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
  const label = btn.getAttribute('aria-label'); // arrow labels or "Sheet N"
  currentSheet = Number(btn.dataset.sheet);
  renderGrid();
  const pager = $('#pager');
  const target = (label && pager.querySelector(`button[aria-label="${label}"]:not([disabled])`)) ||
    pager.querySelector('.sheet-no.is-current') ||
    pager.querySelector('button[data-sheet]:not([disabled])');
  if (target) target.focus({ preventScroll: true });
  $('#ballot').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------------------------------------------------------------------------
// Returns tables
// ---------------------------------------------------------------------------

async function renderBoard() {
  const list = $('#boardList');
  try {
    if (boardMode === 'leader') {
      const { leaderboard } = await api('/api/leaderboard?limit=10');
      drawBoard(list, leaderboard, (r) => usd(r.count * RATE));
    } else {
      const { trending } = await api('/api/trending?limit=10');
      if (!trending.length) {
        list.innerHTML = '<li><span class="rank">—</span><span class="who"><span class="nm">A quiet day at the currency desk</span><span class="st">No deposits in 24h</span></span><span class="track"></span><span class="ct"></span></li>';
        return;
      }
      drawBoard(list, trending, (r) => `+${usd(r.dayCount * RATE)}`);
    }
  } catch (_) { /* leave old board */ }
}

function drawBoard(list, rows, ctFn) {
  const max = Math.max(...rows.map((r) => r.dayCount ?? r.count), 1);
  list.innerHTML = rows.map((r, i) => `
    <li>
      <span class="rank">${String(i + 1).padStart(2, '0')}</span>
      <span class="who">
        <span class="nm">${escapeHtml(r.name)}</span>
        <span class="st">${escapeHtml(tagLabel(r.industry))} · ${usd(r.totalUsd)} on ledger</span>
      </span>
      <span class="track"><span class="bar" style="width:${(((r.dayCount ?? r.count) / max) * 100).toFixed(1)}%"></span></span>
      <span class="ct">${ctFn(r)}</span>
    </li>
  `).join('');
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
// Pledging (the stamp)
// ---------------------------------------------------------------------------

$('#celebGrid').addEventListener('click', (e) => {
  const oval = e.target.closest('.oval');
  if (oval) return cancelVote(oval.dataset.id);
  const row = e.target.closest('.brow');
  if (!row) return;
  if (e.target.closest('[data-again]')) return cancelVote(row.dataset.id);
  if (e.target.closest('[data-cert]')) return downloadCertificate(row.dataset.id);
  if (e.target.closest('[data-share]')) return shareCancel(row.dataset.id, e.target.closest('[data-share]'));
});

$('#celebGrid').addEventListener('change', (e) => {
  const sel = e.target.closest('[data-spend]');
  if (!sel) return;
  const row = e.target.closest('.brow');
  const link = row.querySelector('[data-register]');
  link.href = sel.value ? `https://vote.gov/register/${sel.value}` : 'https://vote.gov';
  if (sel.value) localStorage.setItem('ctv-spend-state', sel.value);
});

async function cancelVote(id) {
  const target = ROSTER.find((t) => t.id === id);
  const row = document.querySelector(`.brow[data-id="${id}"]`);
  if (!target || !row) return;

  const times = (myStamps.get(id) || 0) + 1;
  myStamps.set(id, times);

  row.querySelector('.oval').classList.add('is-filled');
  slamStamp(row, times);
  if (navigator.vibrate) navigator.vibrate(25);

  const name = $('#filedBy').value.trim();
  if (name) localStorage.setItem('ctv-name', name);

  // optimistic bump; corrected by server response
  target.count += 1;
  lastStatsTotal += 1;
  countTo($('#statTotal'), lastStatsTotal * RATE, true, usd);
  countTo($('#indexTotal'), lastStatsTotal * RATE, true, usd);

  const actions = row.querySelector('.brow-actions');
  actions.hidden = false;
  const saved = localStorage.getItem('ctv-spend-state');
  if (saved) {
    const sel = row.querySelector('[data-spend]');
    if (sel && !sel.value) {
      sel.value = saved;
      row.querySelector('[data-register]').href = `https://vote.gov/register/${saved}`;
    }
  }
  const status = row.querySelector('[data-status]');
  status.textContent = stampStatusText(times);
  updateLedgerLine(row, target);

  try {
    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, times: 1 }),
    });
    const out = await res.json();
    if (res.ok) {
      target.count = out.count;
      updateLedgerLine(row, target);
    }
  } catch (_) { /* the stamp is the experience; counts sync next refresh */ }
}

function updateLedgerLine(row, target) {
  const over = balanceUsd(target) < 0;
  const line = row.querySelector('.brow-count');
  const fill = row.querySelector('.ledger-fill');
  fill.style.width = Math.min(100, pct(target)).toFixed(2) + '%';
  line.innerHTML = over
    ? `<span class="over-balance">BALANCE ${usd(balanceUsd(target)).replace('$-', '−$')} · OVERDRAWN</span><span class="dots"></span><strong class="pct">${pct(target).toFixed(1)}%</strong>`
    : `Neutralized <strong data-count>${usd(neutralizedUsd(target))}</strong> of ${usd(target.totalUsd)}<span class="dots"></span><strong class="pct">${pct(target).toFixed(1)}%</strong>`;
  if (over && !row.classList.contains('is-overdrawn')) {
    row.classList.add('is-overdrawn');
    const imp = document.createElement('span');
    imp.className = 'stamp-impression';
    imp.textContent = 'OVERDRAWN';
    imp.style.setProperty('--rot', '-5deg');
    imp.style.right = '10px';
    imp.style.top = '12px';
    row.appendChild(imp);
  }
}

function slamStamp(row, times) {
  const imp = document.createElement('span');
  imp.className = 'stamp-impression';
  imp.textContent = 'CANCELED';
  imp.style.setProperty('--rot', (Math.random() * 14 - 7).toFixed(1) + 'deg');
  if (times === 1) {
    imp.style.right = '10px';
    imp.style.top = '12px';
  } else {
    imp.style.left = (8 + Math.random() * 50) + '%';
    imp.style.top = (10 + Math.random() * 60) + '%';
    imp.style.fontSize = (0.8 + Math.random() * 0.5) + 'rem';
  }
  row.appendChild(imp);
  const imps = row.querySelectorAll('.stamp-impression');
  if (imps.length > 9) imps[0].remove();
}

// ---------------------------------------------------------------------------
// Certificate of Deposit (1200×630 canvas → PNG)
// ---------------------------------------------------------------------------

async function drawCertificate(id) {
  const t = ROSTER.find((r) => r.id === id);
  const name = $('#filedBy').value.trim() || 'A Registered Grudge-Holder';
  await document.fonts.load('700 44px "Archivo Narrow"');
  await document.fonts.load('700 20px "Courier Prime"');

  const cv = $('#certCanvas');
  const x = cv.getContext('2d');
  const W = cv.width, H = cv.height;

  x.fillStyle = '#f7f4ea';
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 1600; i++) {
    x.fillStyle = `rgba(23,22,26,${Math.random() * 0.035})`;
    x.fillRect(Math.random() * W, Math.random() * H, 1.2, 1.2);
  }

  // header bar
  x.fillStyle = '#17161a';
  x.fillRect(28, 28, W - 56, 78);
  x.fillStyle = '#f7f4ea';
  x.textAlign = 'left';
  x.font = '700 34px "Archivo Narrow", sans-serif';
  x.fillText('CERTIFICATE OF DEPOSIT — ONE (1) VOTE', 52, 78);
  x.font = '15px "Courier Prime", monospace';
  x.textAlign = 'right';
  x.fillText('FORM CTV-26-M · UNOFFICIAL', W - 52, 60);
  x.fillText('BUREAU OF BALLOT GRIEVANCES · CURRENCY DESK', W - 52, 82);

  // frame + inner rule like a banknote
  x.strokeStyle = '#17161a';
  x.lineWidth = 1.5;
  x.strokeRect(28, 28, W - 56, H - 56);
  x.strokeRect(40, 118, W - 80, H - 158);

  // face value corners
  x.fillStyle = '#17161a';
  x.font = '700 40px "Archivo Narrow", sans-serif';
  x.textAlign = 'left';
  x.fillText('$100', 58, 168);
  x.textAlign = 'right';
  x.fillText('$100', W - 58, 168);
  x.fillText('$100', W - 58, H - 68);
  x.textAlign = 'left';
  x.fillText('$100', 58, H - 68);

  x.textAlign = 'center';
  x.fillStyle = '#55534f';
  x.font = '20px "Archivo Narrow", sans-serif';
  x.fillText('THIS CERTIFIES THAT', W / 2, 175);

  x.fillStyle = '#17161a';
  x.font = '700 50px "Archivo Narrow", sans-serif';
  x.fillText(name.toUpperCase(), W / 2, 230);

  x.fillStyle = '#55534f';
  x.font = '20px "Archivo Narrow", sans-serif';
  x.fillText('HOLDS ONE (1) VOTE · FACE VALUE $100 AT THE OFFICIAL EXCHANGE RATE', W / 2, 278);
  x.fillText('PLEDGED AGAINST THE INFLUENCE ACCOUNT OF', W / 2, 320);

  x.fillStyle = '#b5271d';
  x.font = '700 54px "Archivo Narrow", sans-serif';
  x.fillText(t.name.toUpperCase(), W / 2, 382);

  x.fillStyle = '#55534f';
  x.font = '20px "Archivo Narrow", sans-serif';
  x.fillText(`${usd(t.totalUsd)} ON LEDGER, PER FEC FILINGS · EVERY $100 OF IT NEEDS A VOTER`, W / 2, 428);

  x.font = '700 17px "Courier Prime", monospace';
  x.fillStyle = '#17161a';
  x.fillText('NON-TRANSFERABLE · NON-PURCHASABLE · REDEEMABLE ONLY AT YOUR POLLING PLACE', W / 2, 486);
  x.font = '15px "Courier Prime", monospace';
  x.fillStyle = '#55534f';
  x.fillText(`STATUS: PENDING UNTIL BALLOT CAST — REGISTER AT VOTE.GOV · ISSUED ${new Date().toLocaleDateString('en-US')}`, W / 2, 516);

  // stamp
  x.save();
  x.translate(W - 210, H - 130);
  x.rotate(-0.14);
  x.strokeStyle = 'rgba(181,39,29,0.85)';
  x.lineWidth = 5;
  x.strokeRect(-135, -40, 270, 76);
  x.fillStyle = 'rgba(181,39,29,0.85)';
  x.textAlign = 'center';
  x.font = '700 42px "Courier Prime", monospace';
  x.fillText('CANCELED', 0, 14);
  x.restore();

  return cv;
}

async function downloadCertificate(id) {
  const cv = await drawCertificate(id);
  const a = document.createElement('a');
  a.download = `canceled-${id}.png`;
  a.href = cv.toDataURL('image/png');
  a.click();
}

async function shareCancel(id, btn) {
  const t = ROSTER.find((r) => r.id === id);
  const text = `I just pledged my vote against ${t.name} — ${usd(t.totalUsd)} of influence on the ledger, and my ballot is worth $100 of it that money can't buy. ${usd(t.count * RATE)} neutralized so far.`;
  try {
    const cv = await drawCertificate(id);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const file = new File([blob], 'certificate.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ text, files: [file] });
      return;
    }
    if (navigator.share) { await navigator.share({ text, url: location.origin }); return; }
  } catch (_) { /* fall through to clipboard */ }
  try {
    await navigator.clipboard.writeText(text + ' ' + location.origin);
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = old; }, 1600);
  } catch (_) { /* no-op */ }
}

boot().catch((err) => {
  console.error(err);
  $('#celebGrid').innerHTML = '<p class="empty-note">The currency desk is experiencing technical difficulties. The money, regrettably, is fine.</p>';
});
