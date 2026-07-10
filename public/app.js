/* Cancel Their Vote — frontend. No frameworks, no tracking, no data
   beyond an optional first name attached to a number. */
'use strict';

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

let ROSTER = [];
let currentState = localStorage.getItem('ctv-state') || 'ALL';
let currentTag = 'ALL';
let searchQuery = '';
let currentSheet = 1;
const SHEET_SIZE = 12;
const myStamps = new Map(); // celeb id -> times stamped this session
let boardMode = 'leader';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function boot() {
  buildStatePicker();
  initIndexSpy();
  $('#filedBy').value = localStorage.getItem('ctv-name') || '';
  $('#filedBy').addEventListener('change', () => {
    localStorage.setItem('ctv-name', $('#filedBy').value.trim());
  });

  const [roster, stats, feed] = await Promise.all([
    api('/api/roster'), api('/api/stats'), api('/api/feed?limit=25'),
  ]);
  ROSTER = roster.celebs;
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
// State picker
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Stats + ticker
// ---------------------------------------------------------------------------

function renderStats(stats, quiet) {
  countTo($('#statTotal'), stats.total, quiet);
  countTo($('#indexTotal'), stats.total, quiet);
  $('#statStates').textContent = stats.states;
  if (stats.top) $('#statTop').textContent = stats.top.name;
}

function countTo(el, target, quiet) {
  const start = Number((el.textContent || '0').replace(/,/g, '')) || 0;
  if (quiet && start === target) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = fmt(target);
    return;
  }
  const t0 = performance.now();
  const dur = 900;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(start + (target - start) * eased));
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
    `<span class="wire-item"><span class="tk-x">✗</span> ${escapeHtml(f.name || 'A registered grudge-holder')} canceled ${escapeHtml(f.celeb)}'s vote in ${f.state}${f.times > 1 ? ` ×${f.times}` : ''} · ${ago(f.agoMs)}</span>`
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

// ---------------------------------------------------------------------------
// Ballot grid
// ---------------------------------------------------------------------------

function filteredRoster() {
  return ROSTER.filter((c) =>
    (currentState === 'ALL' || c.state === currentState) &&
    (currentTag === 'ALL' || c.tag === currentTag) &&
    (!searchQuery || c.name.toLowerCase().includes(searchQuery))
  ).sort((a, b) => b.count - a.count);
}

function renderGrid() {
  const grid = $('#celebGrid');
  const list = filteredRoster();

  const parts = [];
  parts.push(currentState === 'ALL' ? 'Cancelable residents, all states' : `Cancelable residents of ${STATES[currentState]}`);
  if (currentTag !== 'ALL') parts.push(currentTag);
  if (searchQuery) parts.push(`“${searchQuery}”`);
  $('#ballot').textContent = `Part 1 — ${parts.join(' · ')} (${list.length} on file)`;

  if (!list.length) {
    grid.innerHTML = '<p class="empty-note">No famous ballots match this combination of grievances. Loosen a filter — then vote anyway.</p>';
    const pagerEl = $('#pager');
    if (pagerEl) pagerEl.innerHTML = '';
    const annEl = $('#pagerAnnounce');
    if (annEl) annEl.textContent = '';
    return;
  }

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
}

function stampStatusText(times) {
  return times <= 1
    ? 'Status: pending until you actually vote.'
    : `Stamped ×${times}. It only had 1 vote — ${times - 1} filed under SPITE, SURPLUS. Still pending until you vote.`;
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
  const label = btn.getAttribute('aria-label'); // "Previous sheet" | "Next sheet" | null
  currentSheet = Number(btn.dataset.sheet);
  renderGrid();
  const pager = $('#pager');
  const target = (label && pager.querySelector(`button[aria-label="${label}"]:not([disabled])`)) ||
    pager.querySelector('.sheet-no.is-current') ||
    pager.querySelector('button[data-sheet]:not([disabled])');
  if (target) target.focus({ preventScroll: true });
  $('#ballot').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#celebGrid').addEventListener('click', (e) => {
  const oval = e.target.closest('.oval');
  if (oval) return cancelVote(oval.dataset.id);
  const row = e.target.closest('.brow');
  if (!row) return;
  if (e.target.closest('[data-again]')) return cancelVote(row.dataset.id);
  if (e.target.closest('[data-cert]')) return downloadCertificate(row.dataset.id);
  if (e.target.closest('[data-share]')) return shareCancel(row.dataset.id, e.target.closest('[data-share]'));
});

async function cancelVote(id) {
  const celeb = ROSTER.find((c) => c.id === id);
  const row = document.querySelector(`.brow[data-id="${id}"]`);
  if (!celeb || !row) return;

  const times = (myStamps.get(id) || 0) + 1;
  myStamps.set(id, times);

  row.querySelector('.oval').classList.add('is-filled');
  slamStamp(row, times);
  if (navigator.vibrate) navigator.vibrate(25);

  const name = $('#filedBy').value.trim();
  if (name) localStorage.setItem('ctv-name', name);

  // optimistic count bump; corrected by server response
  const countEl = row.querySelector('[data-count]');
  celeb.count += 1;
  countEl.textContent = fmt(celeb.count);

  const actions = row.querySelector('.brow-actions');
  actions.hidden = false;
  const status = row.querySelector('[data-status]');
  status.textContent = stampStatusText(times);

  try {
    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, times: 1 }),
    });
    const out = await res.json();
    if (res.ok) {
      celeb.count = out.count;
      countEl.textContent = fmt(celeb.count);
    }
  } catch (_) { /* the stamp is the experience; counts sync next refresh */ }
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
// Returns tables
// ---------------------------------------------------------------------------

async function renderBoard() {
  const list = $('#boardList');
  try {
    if (boardMode === 'leader') {
      const { leaderboard } = await api('/api/leaderboard?limit=10');
      drawBoard(list, leaderboard, (r) => fmt(r.count));
    } else {
      const { trending } = await api('/api/trending?limit=10');
      if (!trending.length) {
        list.innerHTML = '<li><span class="rank">—</span><span class="who"><span class="nm">A quiet day at the bureau</span><span class="st">No cancellations in 24h</span></span><span class="track"></span><span class="ct"></span></li>';
        return;
      }
      drawBoard(list, trending, (r) => `+${fmt(r.dayCount)}`);
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
        <span class="st">${STATES[r.state] || r.state} · ${r.tag}</span>
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
// Certificate (1200×630 canvas → PNG)
// ---------------------------------------------------------------------------

async function drawCertificate(id) {
  const c = ROSTER.find((r) => r.id === id);
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
  x.fillText('OFFICIAL CANCELLATION BALLOT — RECEIPT', 52, 78);
  x.font = '15px "Courier Prime", monospace';
  x.textAlign = 'right';
  x.fillText('FORM CTV-26-C · UNOFFICIAL', W - 52, 60);
  x.fillText('BUREAU OF BALLOT GRIEVANCES', W - 52, 82);

  // frame
  x.strokeStyle = '#17161a';
  x.lineWidth = 1.5;
  x.strokeRect(28, 28, W - 56, H - 56);

  x.textAlign = 'left';
  x.fillStyle = '#55534f';
  x.font = '20px "Archivo Narrow", sans-serif';
  x.fillText('THIS RECEIPT CERTIFIES THAT', 72, 168);

  x.fillStyle = '#17161a';
  x.font = '700 52px "Archivo Narrow", sans-serif';
  x.fillText(name.toUpperCase(), 72, 224);
  x.strokeStyle = '#a9bccd';
  x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(72, 238); x.lineTo(W - 320, 238); x.stroke();

  x.fillStyle = '#55534f';
  x.font = '20px "Archivo Narrow", sans-serif';
  x.fillText('HAS PLEDGED TO PERSONALLY CANCEL OUT THE ONE (1) VOTE OF', 72, 286);

  x.fillStyle = '#17161a';
  x.font = '700 60px "Archivo Narrow", sans-serif';
  x.fillText(c.name.toUpperCase(), 72, 352);
  x.beginPath(); x.moveTo(72, 368); x.lineTo(W - 320, 368); x.stroke();

  x.fillStyle = '#55534f';
  x.font = '20px "Archivo Narrow", sans-serif';
  x.fillText(`IN THE STATE OF ${STATES[c.state].toUpperCase()}, BY THE RADICAL ACT OF ALSO VOTING.`, 72, 414);

  // filled oval exhibit
  x.strokeStyle = '#17161a';
  x.lineWidth = 3;
  x.beginPath(); x.ellipse(96, 470, 26, 13, 0, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#17161a';
  x.beginPath(); x.ellipse(96, 470, 20, 8, -0.04, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#55534f';
  x.font = '16px "Courier Prime", monospace';
  x.fillText('EXHIBIT A: THE OVAL, FILLED. PRACTICE COMPLETE.', 140, 476);

  x.font = '700 17px "Courier Prime", monospace';
  x.fillStyle = '#17161a';
  x.fillText('STATUS: PENDING UNTIL BALLOT CAST — REGISTER AT VOTE.GOV', 72, 540);
  x.font = '15px "Courier Prime", monospace';
  x.fillStyle = '#55534f';
  x.fillText(`FILED ${new Date().toLocaleDateString('en-US')} · CANCELTHEIRVOTE`, 72, 566);

  // stamp
  x.save();
  x.translate(W - 210, H - 190);
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
  const c = ROSTER.find((r) => r.id === id);
  const text = `I just pledged to cancel out ${c.name}'s vote in ${STATES[c.state]} — by voting. Their ballot has been canceled ${fmt(c.count)} times (it was only worth 1).`;
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
  $('#celebGrid').innerHTML = '<p class="empty-note">The bureau is experiencing technical difficulties. Your grievance persists.</p>';
});
