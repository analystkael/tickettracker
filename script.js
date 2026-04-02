/* ═══════════════════════════════════════════════════════
   Raffle Draw — script.js
   Reads TICKET_TRACKER.xlsx via SheetJS
   Sheet "Streak" col 31 (index 31) = TOTAL TIKET
   ═══════════════════════════════════════════════════════ */

let participants = [];   // [{name, tickets}]
let ticketPool   = [];   // flat array: name repeated by ticket count
let winnerCount  = 1;
let winners      = [];
let rolling      = false;

// ── Load Excel ────────────────────────────────────────
async function loadExcel() {
  try {
    const res  = await fetch('TICKET_TRACKER.xlsx?v=' + Date.now());
    const buf  = await res.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });

    // Prefer "Streak" sheet (has TOTAL TIKET col), fallback to first sheet
    const sheetName = wb.SheetNames.includes('Streak') ? 'Streak' : wb.SheetNames[0];
    const ws   = wb.Sheets[sheetName];
    const raw  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    parseData(raw);
  } catch (e) {
    console.error('Gagal membaca Excel:', e);
    document.getElementById('table-body').innerHTML =
      '<tr><td colspan="4" class="loading-row">⚠️ Gagal membaca TICKET_TRACKER.xlsx. Pastikan file ada di folder yang sama.</td></tr>';
  }
}

// ── Parse Sheet Data ──────────────────────────────────
function parseData(raw) {
  /*
    Row 0  : aturan
    Row 1  : header (col 0 = no, col 1 = MEMBER, col 31 = TOTAL TIKET for Streak sheet)
    Row 2  : day labels
    Row 3  : TOTAL row
    Row 4+ : data peserta
  */

  // Find the correct TOTAL TIKET column
  const headerRow = raw[1] || [];
  let totalTicketCol = -1;

  // Collect all candidate columns whose header contains "total" + "tiket"
  const candidates = [];
  for (let c = 0; c < headerRow.length; c++) {
    const val = String(headerRow[c] || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (val.includes('total') && val.includes('tiket')) candidates.push(c);
  }

  // Pick the rightmost candidate that actually has numeric data in row 4+
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    for (let r = 4; r < Math.min(raw.length, 15); r++) {
      const v = raw[r] && raw[r][c];
      if (v !== null && v !== undefined && v !== '' && !isNaN(Number(v)) && Number(v) > 0) {
        totalTicketCol = c;
        break;
      }
    }
    if (totalTicketCol !== -1) break;
  }

  // Fallback: scan rightmost columns of data rows for the last column with numbers
  if (totalTicketCol === -1) {
    const maxCol = Math.max(...raw.slice(0, 5).map(r => (r || []).length));
    for (let c = maxCol - 1; c >= 2; c--) {
      let hasData = false;
      for (let r = 4; r < Math.min(raw.length, 15); r++) {
        const v = raw[r] && raw[r][c];
        if (v !== null && v !== undefined && v !== '' && !isNaN(Number(v)) && Number(v) > 0) {
          hasData = true;
          break;
        }
      }
      if (hasData) { totalTicketCol = c; break; }
    }
  }

  // Last resort: use the very last column
  if (totalTicketCol === -1) {
    totalTicketCol = headerRow.length - 1;
  }

  console.log('Using TOTAL TIKET column index:', totalTicketCol);

  const useSumFallback = false;

  const result = [];

  for (let r = 4; r < raw.length; r++) {
    const row  = raw[r];
    if (!row) continue;

    const name = row[1];
    if (!name || String(name).trim() === '' || String(name).trim() === '0') continue;

    let tickets = 0;

    if (useSumFallback) {
      // Sum day columns (cols 2 to 25)
      for (let c = 2; c <= 25; c++) {
        const v = Number(row[c]);
        if (!isNaN(v)) tickets += v;
      }
    } else {
      tickets = Number(row[totalTicketCol]);
      if (isNaN(tickets) || tickets === null) tickets = 0;
    }

    if (tickets <= 0) continue; // skip peserta without tickets

    result.push({ name: String(name).trim(), tickets: Math.round(tickets) });
  }

  participants = result.sort((a, b) => b.tickets - a.tickets);

  // Build ticket pool
  ticketPool = [];
  participants.forEach(p => {
    for (let i = 0; i < p.tickets; i++) ticketPool.push(p.name);
  });

  renderStats();
  renderTable();
  enableDraw();
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
  const el   = document.getElementById(id);
  const dur  = 800;
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
    const pct = total > 0 ? ((p.tickets / total) * 100).toFixed(2) : '0.00';
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

  // Filter pool: exclude already-drawn winners
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

  // Draw all winners sequentially
  drawNext(available, drawN, 0, []);
}

function drawNext(pool, total, idx, newWinners) {
  if (idx >= total) {
    // All done
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

  // Exclude already picked in this draw session too
  const available = pool.filter(n => !newWinners.includes(n));
  if (available.length === 0) {
    drawNext(pool, total, total, newWinners); // done
    return;
  }

  rollAnimation(available, () => {
    const winner = available[Math.floor(Math.random() * available.length)];
    newWinners.push(winner);
    // Show final name briefly then continue
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
  const nameEl = document.getElementById('drum-name');
  const DURATION = 2000;
  const start = performance.now();
  let interval = 60;

  function frame(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / DURATION, 1);

    // Random name from pool
    nameEl.textContent = pool[Math.floor(Math.random() * pool.length)];

    // Slow down towards end
    interval = 60 + progress * 180;

    if (progress < 1) {
      setTimeout(() => requestAnimationFrame(frame), interval);
    } else {
      callback();
    }
  }

  requestAnimationFrame(frame);
}

// ── Render Winners ────────────────────────────────────
function renderWinners() {
  const sec = document.getElementById('winners-section');
  sec.classList.add('visible');

  const medals = ['🥇','🥈','🥉'];
  const list = document.getElementById('winners-list');
  list.innerHTML = winners.map((name, i) => {
    const p = participants.find(x => x.name === name);
    const tickets = p ? p.tickets : 0;
    const pct = ticketPool.length > 0 ? ((tickets / ticketPool.length) * 100).toFixed(2) : '0';
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

      if (frame > TOTAL * 0.6) p.alpha = Math.max(0, 1 - (frame - TOTAL * 0.6) / (TOTAL * 0.4));

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