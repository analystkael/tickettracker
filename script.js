/* ═══════════════════════════════════════════════════════
   Raffle Draw — script.js  v5
   - ALWAYS self-calculates from "List Ticket" sheet
   - Reads raw 0/1 deposit data → counts tickets + streak bonus
   - Never relies on Lark/Excel formula columns
   ═══════════════════════════════════════════════════════ */

let participants = [];
let ticketPool   = [];
let winnerCount  = 1;
let winners      = [];
let rolling      = false;

console.log('[Raffle] script.js v5 loaded');

// ── Load Excel ────────────────────────────────────────
async function loadExcel() {
  try {
    const url = 'TICKET_TRACKER.xlsx?v=' + Date.now();
    console.log('[Raffle] Fetching:', url);

    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' — file tidak ditemukan');

    const buf = await res.arrayBuffer();
    console.log('[Raffle] File size:', buf.byteLength, 'bytes');

    const wb = XLSX.read(buf, { type: 'array' });
    console.log('[Raffle] Sheets:', wb.SheetNames.join(', '));

    parseWorkbook(wb);
  } catch (e) {
    console.error('[Raffle] Error:', e);
    showError('⚠️ Gagal membaca TICKET_TRACKER.xlsx — ' + e.message);
  }
}

function showError(msg) {
  document.getElementById('table-body').innerHTML =
    '<tr><td colspan="4" class="loading-row">' + msg + '</td></tr>';
  document.getElementById('draw-btn-text').textContent = 'Data Error';
}

// ── Parse Workbook ────────────────────────────────────
function parseWorkbook(wb) {
  // Always use "List Ticket" — it has the raw 0/1 deposit data
  // Fall back to first sheet if "List Ticket" not found
  let sheetName = wb.SheetNames[0];
  if (wb.SheetNames.includes('List Ticket')) sheetName = 'List Ticket';

  const ws  = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log('[Raffle] Using sheet:', sheetName, '| Rows:', raw.length);

  // Find date columns: serial dates (40000-60000) in header row
  const headerRow  = raw[1] || [];
  let firstDateCol = -1;
  let lastDateCol  = -1;

  for (let c = 2; c < headerRow.length; c++) {
    const hdr = headerRow[c];
    if (typeof hdr === 'number' && hdr > 40000 && hdr < 60000) {
      if (firstDateCol === -1) firstDateCol = c;
      lastDateCol = c;
    }
  }

  if (firstDateCol === -1 || lastDateCol === -1) {
    showError('⚠️ Kolom tanggal tidak ditemukan di sheet "' + sheetName + '"');
    return;
  }

  console.log('[Raffle] Date columns:', firstDateCol, '→', lastDateCol,
              '(' + (lastDateCol - firstDateCol + 1) + ' hari)');

  // Parse all participants
  const result = [];

  for (let r = 4; r < raw.length; r++) {
    const row = raw[r];
    if (!row) continue;

    const name = cleanName(row[1]);
    if (!name) continue;

    const calc    = calcTickets(row, firstDateCol, lastDateCol);
    const tickets = calc.total;

    if (tickets <= 0) continue;

    result.push({
      name,
      tickets,
      deposits: calc.deposits,
      streakBonus: calc.bonus
    });
  }

  console.log('[Raffle] ✅ Peserta:', result.length,
              '| Total tiket:', result.reduce((s, p) => s + p.tickets, 0));

  if (result.length === 0) {
    showError('⚠️ 0 peserta ditemukan. Pastikan ada data deposit di sheet "' + sheetName + '".');
    return;
  }

  participants = result.sort((a, b) => b.tickets - a.tickets);

  // Build ticket pool (weighted random)
  ticketPool = [];
  participants.forEach(p => {
    for (let i = 0; i < p.tickets; i++) ticketPool.push(p.name);
  });

  renderStats();
  renderTable();
  enableDraw();
}

// ── Helpers ───────────────────────────────────────────
function cleanName(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (s === '' || s === '0' || s.toUpperCase() === 'TOTAL') return null;
  return s;
}

// ── Calculate tickets from raw 0/1 deposit data ──────
// Rules: 1 deposit = 1 tiket
//        5-day streak = +5 bonus
//        10-day streak = +20 bonus
function calcTickets(row, firstCol, lastCol) {
  let deposits = 0;
  let streak   = 0;
  let bonus5   = 0;
  let bonus10  = 0;

  for (let c = firstCol; c <= lastCol; c++) {
    const v = Number(row[c]);
    if (v === 1) {
      deposits++;
      streak++;
      if (streak === 5)  bonus5++;
      if (streak === 10) bonus10++;
    } else {
      streak = 0;
    }
  }

  const bonus = (bonus5 * 5) + (bonus10 * 20);
  return { deposits, bonus, total: deposits + bonus };
}

// ── Render Stats ──────────────────────────────────────
function renderStats() {
  const total = ticketPool.length;
  animNum('stat-peserta', participants.length);
  animNum('stat-tiket', total);
  document.getElementById('stat-date-val').textContent =
    new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function animNum(id, target) {
  const el  = document.getElementById(id);
  const dur = 800;
  const start = performance.now();
  (function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    el.textContent = Math.round(easeOut(p) * target).toLocaleString('id-ID');
    if (p < 1) requestAnimationFrame(tick);
  })(start);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// ── Render Table ──────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('table-body');
  const total = ticketPool.length;
  document.getElementById('table-note').textContent =
    `${participants.length} peserta · ${total} tiket total`;

  tbody.innerHTML = participants.map((p, i) => {
    const pct  = total > 0 ? ((p.tickets / total) * 100).toFixed(2) : '0.00';
    const barW = total > 0 ? Math.min((p.tickets / participants[0].tickets) * 100, 100) : 0;
    return `
      <tr id="row-${sanitize(p.name)}">
        <td>${i + 1}</td>
        <td>${escHtml(p.name)}</td>
        <td>${p.tickets}</td>
        <td>
          <div class="prob-cell">
            <div class="prob-bar-bg">
              <div class="prob-bar-fill" style="width:${barW}%"></div>
            </div>
            <span class="prob-text">${pct}%</span>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function sanitize(name) { return name.replace(/[^a-z0-9]/gi, '_'); }
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Enable Draw ───────────────────────────────────────
function enableDraw() {
  const btn = document.getElementById('draw-btn');
  btn.disabled = false;
  document.getElementById('draw-btn-text').textContent = 'Draw Winner!';
}

// ── Winner Count Stepper ──────────────────────────────
function changeWinnerCount(delta) {
  const max = Math.min(participants.length, 10);
  winnerCount = Math.max(1, Math.min(winnerCount + delta, max));
  document.getElementById('winner-count').textContent = winnerCount;
}

// ── Start Draw ────────────────────────────────────────
function startDraw() {
  if (rolling || ticketPool.length === 0) return;

  const available = ticketPool.filter(n => !winners.includes(n));
  if (available.length === 0) {
    alert('Semua peserta sudah menang! Reset dulu ya.');
    return;
  }

  const drawN = Math.min(winnerCount - winners.length, available.length);
  if (drawN <= 0) {
    alert('Pemenang sudah mencapai target. Reset untuk draw ulang.');
    return;
  }

  rolling = true;
  const btn = document.getElementById('draw-btn');
  btn.disabled = true;
  btn.classList.add('rolling');
  document.getElementById('draw-btn-text').textContent = 'Rolling…';

  showDrum();
  drawNext(available, drawN, 0, []);
}

function drawNext(pool, total, idx, newWinners) {
  if (idx >= total) {
    winners = [...winners, ...newWinners];
    rolling = false;

    hideDrum();
    renderWinners();
    highlightWinnerRows();
    launchConfetti();

    const btn = document.getElementById('draw-btn');
    btn.classList.remove('rolling');

    if (winners.length < participants.length && winners.length < winnerCount + 1) {
      btn.disabled = false;
      document.getElementById('draw-btn-text').textContent = 'Draw Lagi!';
    } else {
      document.getElementById('draw-btn-text').textContent = 'Draw Winner!';
      btn.disabled = true;
    }

    document.getElementById('reset-btn').classList.add('visible');
    return;
  }

  const available = pool.filter(n => !newWinners.includes(n));
  if (available.length === 0) {
    drawNext(pool, total, total, newWinners);
    return;
  }

  rollAnimation(available, () => {
    const winner = available[Math.floor(Math.random() * available.length)];
    newWinners.push(winner);
    document.getElementById('drum-name').textContent = winner;
    setTimeout(() => drawNext(pool, total, idx + 1, newWinners), 800);
  });
}

// ── Drum Animation ────────────────────────────────────
function showDrum() {
  document.getElementById('drum-section').classList.add('visible');
  document.getElementById('drum-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideDrum() {
  document.getElementById('drum-section').classList.remove('visible');
}

function rollAnimation(pool, callback) {
  const nameEl   = document.getElementById('drum-name');
  const DURATION = 2000;
  const start    = performance.now();

  function frame(now) {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / DURATION, 1);
    nameEl.textContent = pool[Math.floor(Math.random() * pool.length)];
    const interval = 60 + progress * 180;
    if (progress < 1) setTimeout(() => requestAnimationFrame(frame), interval);
    else callback();
  }

  requestAnimationFrame(frame);
}

// ── Render Winners ────────────────────────────────────
function renderWinners() {
  const sec = document.getElementById('winners-section');
  sec.classList.add('visible');

  const medals = ['🥇','🥈','🥉'];
  const list   = document.getElementById('winners-list');
  list.innerHTML = winners.map((name, i) => {
    const p       = participants.find(x => x.name === name);
    const tickets = p ? p.tickets : 0;
    const pct     = ticketPool.length > 0 ? ((tickets / ticketPool.length) * 100).toFixed(2) : '0';
    return `
      <div class="winner-card" style="animation-delay:${i * 0.12}s">
        <div class="winner-rank">${medals[i] || `#${i+1}`}</div>
        <div class="winner-info">
          <div class="winner-name">${escHtml(name)}</div>
          <div class="winner-meta">${tickets} tiket &nbsp;·&nbsp; peluang ${pct}%</div>
        </div>
        <div class="winner-trophy">🎉</div>
      </div>`;
  }).join('');

  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function highlightWinnerRows() {
  document.querySelectorAll('tbody tr').forEach(tr => tr.classList.remove('is-winner'));
  winners.forEach(name => {
    const row = document.getElementById('row-' + sanitize(name));
    if (row) row.classList.add('is-winner');
  });
}

// ── Reset Draw ────────────────────────────────────────
function resetDraw() {
  winners = [];
  rolling = false;

  document.getElementById('winners-section').classList.remove('visible');
  document.getElementById('drum-section').classList.remove('visible');
  document.getElementById('winners-list').innerHTML = '';
  document.getElementById('reset-btn').classList.remove('visible');

  document.querySelectorAll('tbody tr').forEach(tr => tr.classList.remove('is-winner'));

  const btn = document.getElementById('draw-btn');
  btn.disabled = false;
  btn.classList.remove('rolling');
  document.getElementById('draw-btn-text').textContent = 'Draw Winner!';
}

// ── Confetti ──────────────────────────────────────────
function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLORS = ['#e8c547','#ff6b35','#ffffff','#a8e6cf','#ff8b94'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * 200,
    r: 4 + Math.random() * 6,
    d: 1 + Math.random() * 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    tilt: Math.random() * 10 - 5,
    tiltAngle: 0,
    tiltSpeed: 0.05 + Math.random() * 0.1,
    alpha: 1
  }));

  let frame = 0;
  const TOTAL = 200;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.tiltAngle += p.tiltSpeed;
      p.y += p.d + Math.sin(p.tiltAngle) * 0.5;
      p.tilt = Math.sin(p.tiltAngle) * 12;

      if (frame > TOTAL * 0.6)
        p.alpha = Math.max(0, 1 - (frame - TOTAL * 0.6) / (TOTAL * 0.4));

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.5, p.tilt * Math.PI / 180, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    });

    frame++;
    if (frame < TOTAL) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(draw);
}

// ── Init ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', loadExcel);
