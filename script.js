/* ═══════════════════════════════════════════════════════
   Raffle Draw — script.js  v5.1
   - Self-calculates from "List Ticket" sheet
   - Winner reveal overlay (click to continue)
   ═══════════════════════════════════════════════════════ */

let participants = [];
let ticketPool   = [];
let winnerCount  = 1;
let winners      = [];
let rolling      = false;
let revealResolve = null;  // promise resolve for reveal dismiss

console.log('[Raffle] script.js v5.1 loaded');

// ── Load Excel ────────────────────────────────────────
async function loadExcel() {
  try {
    const url = 'TICKET_TRACKER.xlsx?v=' + Date.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const buf = await res.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });
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
  let sheetName = wb.SheetNames[0];
  if (wb.SheetNames.includes('List Ticket')) sheetName = 'List Ticket';

  const ws  = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

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
    showError('⚠️ Kolom tanggal tidak ditemukan.');
    return;
  }

  const result = [];

  for (let r = 4; r < raw.length; r++) {
    const row = raw[r];
    if (!row) continue;
    const name = cleanName(row[1]);
    if (!name) continue;

    const calc    = calcTickets(row, firstDateCol, lastDateCol);
    if (calc.total <= 0) continue;

    result.push({
      name,
      tickets: Math.round(calc.total),
      deposits: calc.deposits,
      streakBonus: calc.bonus
    });
  }

  console.log('[Raffle] ✅ Peserta:', result.length,
              '| Total tiket:', result.reduce((s, p) => s + p.tickets, 0));

  if (result.length === 0) {
    showError('⚠️ 0 peserta ditemukan.');
    return;
  }

  participants = result.sort((a, b) => b.tickets - a.tickets);

  ticketPool = [];
  participants.forEach(p => {
    for (let i = 0; i < p.tickets; i++) ticketPool.push(p.name);
  });

  renderStats();
  renderTable();
  enableDraw();
}

function cleanName(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (s === '' || s === '0' || s.toUpperCase() === 'TOTAL') return null;
  return s;
}

function calcTickets(row, firstCol, lastCol) {
  let deposits = 0, streak = 0, bonus5 = 0, bonus10 = 0;
  for (let c = firstCol; c <= lastCol; c++) {
    const v = Number(row[c]);
    if (v === 1) {
      deposits++; streak++;
      if (streak === 5)  bonus5++;
      if (streak === 10) bonus10++;
    } else { streak = 0; }
  }
  const bonus = (bonus5 * 5) + (bonus10 * 20);
  return { deposits, bonus, total: deposits + bonus };
}

// ── Render Stats ──────────────────────────────────────
function renderStats() {
  animNum('stat-peserta', participants.length);
  animNum('stat-tiket', ticketPool.length);
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
    `${participants.length} peserta · ${total} tiket`;

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

function enableDraw() {
  document.getElementById('draw-btn').disabled = false;
  document.getElementById('draw-btn-text').textContent = 'Draw Winner!';
}

function changeWinnerCount(delta) {
  const max = Math.min(participants.length, 10);
  winnerCount = Math.max(1, Math.min(winnerCount + delta, max));
  document.getElementById('winner-count').textContent = winnerCount;
}

// ── Draw Flow ─────────────────────────────────────────
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
  drawSequence(available, drawN, 0, []);
}

async function drawSequence(pool, total, idx, newWinners) {
  if (idx >= total) {
    winners = [...winners, ...newWinners];
    rolling = false;
    hideDrum();
    renderWinners();
    highlightWinnerRows();

    const btn = document.getElementById('draw-btn');
    btn.classList.remove('rolling');

    if (winners.length < participants.length) {
      btn.disabled = false;
      document.getElementById('draw-btn-text').textContent = 'Draw Lagi!';
    } else {
      document.getElementById('draw-btn-text').textContent = 'Selesai';
      btn.disabled = true;
    }

    document.getElementById('reset-btn').classList.add('visible');
    return;
  }

  const available = pool.filter(n => !newWinners.includes(n));
  if (available.length === 0) {
    drawSequence(pool, total, total, newWinners);
    return;
  }

  // Roll animation → pick winner
  const winner = await new Promise(resolve => {
    rollAnimation(available, () => {
      const picked = available[Math.floor(Math.random() * available.length)];
      document.getElementById('drum-name').textContent = picked;
      resolve(picked);
    });
  });

  newWinners.push(winner);

  // Show reveal overlay
  hideDrum();
  launchConfetti();
  await showReveal(winner, winners.length + newWinners.length);

  // Continue to next winner (re-show drum if more to go)
  if (idx + 1 < total) showDrum();
  drawSequence(pool, total, idx + 1, newWinners);
}

// ── Winner Reveal Overlay ─────────────────────────────
function showReveal(name, rank) {
  const medals = ['🥇','🥈','🥉'];
  const p = participants.find(x => x.name === name);
  const tickets = p ? p.tickets : 0;
  const pct = ticketPool.length > 0 ? ((tickets / ticketPool.length) * 100).toFixed(2) : '0';

  document.getElementById('reveal-tag').textContent = 'PEMENANG #' + rank;
  document.getElementById('reveal-medal').textContent = medals[rank - 1] || '🏆';
  document.getElementById('reveal-name').textContent = name;
  document.getElementById('reveal-info').textContent = tickets + ' tiket · peluang ' + pct + '%';

  const el = document.getElementById('reveal');
  el.classList.add('visible');

  // Reset animation
  const content = el.querySelector('.reveal-content');
  content.style.animation = 'none';
  content.offsetHeight; // reflow
  content.style.animation = '';

  return new Promise(resolve => {
    revealResolve = resolve;
  });
}

function dismissReveal() {
  const el = document.getElementById('reveal');
  el.style.opacity = '0';
  setTimeout(() => {
    el.classList.remove('visible');
    el.style.opacity = '';
    if (revealResolve) {
      revealResolve();
      revealResolve = null;
    }
  }, 250);
}

// ── Drum ──────────────────────────────────────────────
function showDrum() {
  const el = document.getElementById('drum-section');
  el.classList.add('visible');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideDrum() {
  document.getElementById('drum-section').classList.remove('visible');
}

function rollAnimation(pool, callback) {
  const nameEl   = document.getElementById('drum-name');
  const DURATION = 2500;
  const start    = performance.now();

  function frame(now) {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / DURATION, 1);
    nameEl.textContent = pool[Math.floor(Math.random() * pool.length)];
    const interval = 50 + progress * 200;
    if (progress < 1) setTimeout(() => requestAnimationFrame(frame), interval);
    else callback();
  }

  requestAnimationFrame(frame);
}

// ── Render Winners List ───────────────────────────────
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
        <div class="winner-rank">${medals[i] || '🏆'}</div>
        <div class="winner-info">
          <div class="winner-name">${escHtml(name)}</div>
          <div class="winner-meta">${tickets} tiket · peluang ${pct}%</div>
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

// ── Reset ─────────────────────────────────────────────
function resetDraw() {
  winners = [];
  rolling = false;

  document.getElementById('winners-section').classList.remove('visible');
  document.getElementById('drum-section').classList.remove('visible');
  document.getElementById('winners-list').innerHTML = '';
  document.getElementById('reset-btn').classList.remove('visible');
  document.getElementById('reveal').classList.remove('visible');

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

  const COLORS = ['#22d68a','#f0c645','#ffffff','#3be8b0','#5b8df0','#f05545'];
  const pieces = Array.from({ length: 150 }, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * 300,
    r: 3 + Math.random() * 5,
    d: 1.5 + Math.random() * 2.5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    tiltAngle: 0,
    tiltSpeed: 0.04 + Math.random() * 0.1,
    alpha: 1
  }));

  let frame = 0;
  const TOTAL = 220;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.tiltAngle += p.tiltSpeed;
      p.y += p.d + Math.sin(p.tiltAngle) * 0.5;
      const tilt = Math.sin(p.tiltAngle) * 12;

      if (frame > TOTAL * 0.6)
        p.alpha = Math.max(0, 1 - (frame - TOTAL * 0.6) / (TOTAL * 0.4));

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.5, tilt * Math.PI / 180, 0, 2 * Math.PI);
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
