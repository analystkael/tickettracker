/* ═══════════════════════════════════════════════════════
   Community Reward — script.js  v6.1
   - Self-calculates from "List Ticket" sheet
   - Winner loses 1 ticket per win (can win again if > 0)
   - Table updates live after each draw
   - Winner reveal overlay
   - Weighted spin wheel: visual slice size = current tickets
   ═══════════════════════════════════════════════════════ */

let participants = [];   // [{name, tickets, original}]
let ticketPool   = [];   // flat: name repeated by current ticket count
let winnerCount  = 1;
let winners      = [];   // [{name, rank}] — same name can appear multiple times
let rolling      = false;
let revealResolve = null;
let wheelSegments = [];
let wheelRotation = 0;

const WHEEL_COLORS = [
  '#22d68a', '#f0c645', '#5b8df0', '#f05545', '#a855f7', '#14b8a6',
  '#f97316', '#ec4899', '#84cc16', '#06b6d4', '#eab308', '#8b5cf6'
];

// Random helper: memakai crypto jika tersedia, fallback ke Math.random.
function randomInt(max) {
  if (!Number.isFinite(max) || max <= 0) return 0;

  const cryptoObj = window.crypto || window.msCrypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    const values = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / max) * max;

    do {
      cryptoObj.getRandomValues(values);
    } while (values[0] >= limit);

    return values[0] % max;
  }

  return Math.floor(Math.random() * max);
}

function shuffleArray(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randomizeVisualOrder(list) {
  return shuffleArray(list).map((p, i) => ({
    ...p,
    randomOrder: i,
    colorIndex: i
  }));
}

console.log('[Raffle] script.js v6.1 loaded');

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
  let firstDateCol = -1, lastDateCol = -1;

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

    const calc = calcTickets(row, firstDateCol, lastDateCol);
    if (calc.total <= 0) continue;

    const t = Math.round(calc.total);
    result.push({ name, tickets: t, original: t });
  }

  console.log('[Raffle] ✅ Peserta:', result.length,
              '| Total tiket:', result.reduce((s, p) => s + p.tickets, 0));

  if (result.length === 0) {
    showError('⚠️ 0 peserta ditemukan.');
    return;
  }

  // Acak urutan visual agar tabel dan roda tidak terlihat tersusun dari tiket terbesar.
  // Peluang tetap weighted berdasarkan jumlah tiket masing-masing peserta.
  participants = randomizeVisualOrder(result);
  rebuildPool();
  renderStats();
  renderTable();
  renderWheel();
  enableDraw();
}

function cleanName(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (s === '' || s === '0' || s.toUpperCase() === 'TOTAL') return null;
  return s;
}

function calcTickets(row, firstCol, lastCol) {
  let deposits = 0, streak = 0;
  let ac_count = 0, ad_count = 0; // Lark formula logic

  for (let c = firstCol; c <= lastCol; c++) {
    if (Number(row[c]) === 1) {
      deposits++;
      streak++;
      if (streak % 10 === 0) ad_count++;           // hits multiple of 10 → x10 bonus
      else if (streak % 5 === 0) ac_count++;        // hits multiple of 5 (not 10) → x5 bonus
    } else {
      streak = 0;
    }
  }

  const bonus = (Math.min(3, ac_count) * 5) + (Math.min(2, ad_count) * 20);
  return { deposits, bonus, total: deposits + bonus };
}

// ── Pool Management ───────────────────────────────────
function rebuildPool() {
  ticketPool = [];
  participants.forEach(p => {
    for (let i = 0; i < p.tickets; i++) ticketPool.push(p.name);
  });

  // Pool juga diacak supaya slot tiket tidak terkumpul per nama.
  ticketPool = shuffleArray(ticketPool);
}

function consumeTicket(name) {
  const p = participants.find(x => x.name === name);
  if (p && p.tickets > 0) {
    p.tickets--;
    // Remove one instance from pool
    const idx = ticketPool.indexOf(name);
    if (idx !== -1) ticketPool.splice(idx, 1);
  }
}

// ── Render Stats ──────────────────────────────────────
function renderStats() {
  const active = participants.filter(p => p.tickets > 0).length;
  animNum('stat-peserta', active);
  animNum('stat-tiket', ticketPool.length);
  document.getElementById('stat-date-val').textContent =
    new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function animNum(id, target) {
  const el  = document.getElementById(id);
  const dur = 600;
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
  const totalPool = ticketPool.length;
  const active = participants.filter(p => p.tickets > 0).length;

  document.getElementById('table-note').textContent =
    `${active} peserta aktif · ${totalPool} poin tersisa`;

  // Sort visual acak/stabil, bukan berdasarkan tiket.
  // Jadi daftar tidak selalu menampilkan peserta dengan tiket terbesar di atas.
  const sorted = [...participants].sort((a, b) => (a.randomOrder ?? 0) - (b.randomOrder ?? 0));
  const maxTickets = Math.max(...participants.map(p => p.tickets), 0);

  tbody.innerHTML = sorted.map((p, i) => {
    const pct  = totalPool > 0 ? ((p.tickets / totalPool) * 100).toFixed(2) : '0.00';
    const barW = totalPool > 0 && maxTickets > 0
      ? Math.min((p.tickets / maxTickets) * 100, 100) : 0;
    const used = p.original - p.tickets;
    const dimClass = p.tickets === 0 ? ' class="row-empty"' : '';
    const winCount = winners.filter(w => w.name === p.name).length;

    return `
      <tr id="row-${sanitize(p.name)}"${dimClass}>
        <td>${i + 1}</td>
        <td>
          ${escHtml(p.name)}
          ${winCount > 0 ? '<span class="win-badge">' + winCount + 'x terpilih</span>' : ''}
        </td>
        <td>
          <span class="ticket-current">${p.tickets}</span><span class="ticket-original">/${p.original}</span>
        </td>
        <td>
          <div class="prob-cell">
            <div class="prob-bar-bg">
              <div class="prob-bar-fill" style="width:${barW}%"></div>
            </div>
            <span class="prob-text">${p.tickets > 0 ? pct + '%' : '—'}</span>
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
  document.getElementById('draw-btn-text').textContent = 'Pilih Penerima!';
}

function changeWinnerCount(delta) {
  const max = Math.min(participants.filter(p => p.tickets > 0).length, 10);
  winnerCount = Math.max(1, Math.min(winnerCount + delta, max));
  document.getElementById('winner-count').textContent = winnerCount;
}

// ── Draw Flow ─────────────────────────────────────────
function startDraw() {
  if (rolling || ticketPool.length === 0) return;

  if (ticketPool.length === 0) {
    alert('Semua poin sudah habis! Reset untuk memilih ulang.');
    return;
  }

  rolling = true;
  const btn = document.getElementById('draw-btn');
  btn.disabled = true;
  btn.classList.add('rolling');
  document.getElementById('draw-btn-text').textContent = 'Memilih…';

  showWheel();
  drawSequence(winnerCount, 0);
}

async function drawSequence(total, idx) {
  if (idx >= total || ticketPool.length === 0) {
    rolling = false;
    hideDrum();
    renderWheel();
    renderWinners();
    highlightWinnerRows();

    const btn = document.getElementById('draw-btn');
    btn.classList.remove('rolling');

    if (ticketPool.length > 0) {
      btn.disabled = false;
      document.getElementById('draw-btn-text').textContent = 'Pilih Lagi!';
    } else {
      document.getElementById('draw-btn-text').textContent = 'Poin Habis';
      btn.disabled = true;
    }

    document.getElementById('reset-btn').classList.add('visible');
    return;
  }

  // Weighted random pick: setiap tiket punya 1 slot di ticketPool.
  // Jadi peserta dengan tiket lebih banyak otomatis punya peluang lebih besar.
  const winner = pickWeightedWinner();
  const before = participants.find(x => x.name === winner);
  const ticketsBefore = before ? before.tickets : 0;
  const totalBefore = ticketPool.length;
  const chanceBefore = totalBefore > 0 ? (ticketsBefore / totalBefore) * 100 : 0;

  await spinWheelToWinner(winner);

  // Winner hanya kehilangan 1 tiket per win, jadi masih bisa menang lagi jika tiketnya tersisa.
  consumeTicket(winner);
  winners.push({
    name: winner,
    rank: winners.length + 1,
    ticketsBefore,
    chanceBefore
  });

  renderStats();
  renderTable();
  launchConfetti();

  const after = participants.find(x => x.name === winner);
  const remaining = after ? after.tickets : 0;
  await showReveal(winner, winners.length, remaining, ticketsBefore, chanceBefore);

  // Refresh ukuran irisan roda berdasarkan tiket yang sudah berkurang.
  renderWheel();

  drawSequence(total, idx + 1);
}

function pickWeightedWinner() {
  if (ticketPool.length === 0) return null;
  return ticketPool[randomInt(ticketPool.length)];
}

// ── Winner Reveal ─────────────────────────────────────
function showReveal(name, rank, remaining, ticketsBefore = 0, chanceBefore = 0) {
  const medals = ['🥇','🥈','🥉'];
  const p = participants.find(x => x.name === name);
  const orig = p ? p.original : 0;

  document.getElementById('reveal-tag').textContent = 'PENERIMA #' + rank;
  document.getElementById('reveal-medal').textContent = medals[rank - 1] || '🏆';
  document.getElementById('reveal-name').textContent = name;
  document.getElementById('reveal-info').textContent =
    ticketsBefore + ' poin saat pemilihan · peluang ' + chanceBefore.toFixed(2) + '% · sisa ' + remaining + '/' + orig;

  const el = document.getElementById('reveal');
  el.classList.add('visible');

  const content = el.querySelector('.reveal-content');
  content.style.animation = 'none';
  content.offsetHeight;
  content.style.animation = '';

  return new Promise(resolve => { revealResolve = resolve; });
}

function dismissReveal() {
  const el = document.getElementById('reveal');
  el.style.opacity = '0';
  setTimeout(() => {
    el.classList.remove('visible');
    el.style.opacity = '';
    if (revealResolve) { revealResolve(); revealResolve = null; }
  }, 250);
}

// ── Weighted Spin Wheel ───────────────────────────────
function buildWheelSegments() {
  const active = participants
    .filter(p => p.tickets > 0)
    .sort((a, b) => (a.randomOrder ?? 0) - (b.randomOrder ?? 0));

  const total = active.reduce((sum, p) => sum + p.tickets, 0);
  let angle = -Math.PI / 2;

  wheelSegments = active.map((p, i) => {
    const size = total > 0 ? (p.tickets / total) * Math.PI * 2 : 0;
    const seg = {
      name: p.name,
      tickets: p.tickets,
      original: p.original,
      percent: total > 0 ? (p.tickets / total) * 100 : 0,
      start: angle,
      end: angle + size,
      size,
      color: WHEEL_COLORS[(p.colorIndex ?? i) % WHEEL_COLORS.length]
    };
    seg.mid = seg.start + (seg.size / 2);
    angle += size;
    return seg;
  });

  return wheelSegments;
}

function renderWheel() {
  const canvas = document.getElementById('wheel-canvas');
  if (!canvas) return;

  const segments = buildWheelSegments();
  drawWheel(wheelRotation);
  renderWheelLegend(segments);

  const total = ticketPool.length;
  const active = participants.filter(p => p.tickets > 0).length;
  const status = document.getElementById('wheel-status');
  if (status) status.textContent = active + ' peserta · ' + total.toLocaleString('id-ID') + ' poin';

  if (!rolling) {
    const selected = document.getElementById('wheel-selected');
    if (selected) {
      selected.innerHTML = `<span>Status</span><strong>Siap dipilih</strong><small>Irisan mengikuti poin aktif saat ini.</small>`;
    }
  }
}

function drawWheel(rotation = wheelRotation) {
  const canvas = document.getElementById('wheel-canvas');
  if (!canvas) return;

  const wrap = document.getElementById('wheel-wrap') || canvas.parentElement;
  const size = Math.max(280, Math.min(wrap ? wrap.clientWidth : 520, 520));
  const dpr = window.devicePixelRatio || 1;

  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) - 12;

  // Base glow
  const grad = ctx.createRadialGradient(cx, cy, radius * .15, cx, cy, radius);
  grad.addColorStop(0, 'rgba(255,255,255,.08)');
  grad.addColorStop(1, 'rgba(255,255,255,.015)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.fill();

  if (wheelSegments.length === 0) {
    ctx.fillStyle = '#161a24';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9ba2b4';
    ctx.font = '600 16px Instrument Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Menunggu data poin', cx, cy - 8);
    ctx.font = '12px Space Mono, monospace';
    ctx.fillText('TICKET_TRACKER.xlsx', cx, cy + 14);
    return;
  }

  wheelSegments.forEach((seg) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, seg.start + rotation, seg.end + rotation);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();

    ctx.strokeStyle = 'rgba(8,9,12,.55)';
    ctx.lineWidth = Math.max(1, size * 0.004);
    ctx.stroke();

    // Label hanya ditampilkan jika irisannya cukup besar agar roda tetap rapi.
    if (seg.size > 0.11) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(seg.mid + rotation);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,.94)';
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = 3;
      const name = trimLabel(seg.name, seg.size > 0.24 ? 18 : 11);
      ctx.font = `700 ${seg.size > 0.24 ? 12 : 9}px Instrument Sans, sans-serif`;
      ctx.fillText(name, radius - 20, 0);
      if (seg.size > 0.20) {
        ctx.font = '700 10px Space Mono, monospace';
        ctx.fillText(seg.tickets + ' poin', radius - 20, 14);
      }
      ctx.restore();
    }
  });

  // Ring luar dan ring tengah
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, radius * .22, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(8,9,12,.55)';
  ctx.lineWidth = 8;
  ctx.stroke();
}

function renderWheelLegend(segments) {
  const el = document.getElementById('wheel-legend');
  if (!el) return;

  const top = [...segments].sort((a, b) => b.tickets - a.tickets).slice(0, 5);

  if (top.length === 0) {
    el.innerHTML = '<div class="wheel-legend-item"><span></span><span class="wheel-legend-name">Belum ada peserta aktif</span><span class="wheel-legend-meta">—</span></div>';
    return;
  }

  el.innerHTML = top.map(seg => `
    <div class="wheel-legend-item">
      <span class="wheel-dot" style="background:${seg.color}; color:${seg.color}"></span>
      <span class="wheel-legend-name">${escHtml(seg.name)}</span>
      <span class="wheel-legend-meta">${seg.tickets} · ${seg.percent.toFixed(2)}%</span>
    </div>
  `).join('');
}

function showWheel() {
  const el = document.getElementById('wheel-section');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function spinWheelToWinner(name) {
  return new Promise(resolve => {
    const segments = buildWheelSegments();
    const seg = segments.find(x => x.name === name);
    if (!seg) {
      resolve();
      return;
    }

    const selected = document.getElementById('wheel-selected');
    const landingAngle = seg.start + seg.size * (0.18 + Math.random() * 0.64);
    const pointerAngle = -Math.PI / 2;
    const targetBase = pointerAngle - landingAngle;
    const full = Math.PI * 2;
    const currentMod = normalizeAngle(wheelRotation);
    const targetMod = normalizeAngle(targetBase);
    let delta = targetMod - currentMod;
    if (delta < 0) delta += full;

    const extraSpins = (5 + Math.floor(Math.random() * 3)) * full;
    const start = wheelRotation;
    const end = wheelRotation + extraSpins + delta;
    const duration = 4600;
    const started = performance.now();

    function animate(now) {
      const t = Math.min((now - started) / duration, 1);
      const eased = easeOutCubic(t);
      wheelRotation = start + (end - start) * eased;
      drawWheel(wheelRotation);

      const current = segmentUnderPointer(wheelRotation);
      if (selected && current) {
        selected.innerHTML = `<span>Memilih…</span><strong>${escHtml(current.name)}</strong><small>${current.tickets} poin · ${current.percent.toFixed(2)}%</small>`;
      }

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        wheelRotation = normalizeAngle(end);
        drawWheel(wheelRotation);
        if (selected) {
          selected.innerHTML = `<span>Terpilih</span><strong>${escHtml(name)}</strong><small>${seg.tickets} poin · peluang ${seg.percent.toFixed(2)}%</small>`;
        }
        resolve();
      }
    }

    requestAnimationFrame(animate);
  });
}

function segmentUnderPointer(rotation) {
  const pointerBaseAngle = normalizeAngle((-Math.PI / 2) - rotation);
  return wheelSegments.find(seg => angleInSegment(pointerBaseAngle, seg.start, seg.end));
}

function angleInSegment(angle, start, end) {
  const a = normalizeAngle(angle);
  const s = normalizeAngle(start);
  const e = normalizeAngle(end);
  if (s <= e) return a >= s && a < e;
  return a >= s || a < e;
}

function normalizeAngle(angle) {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function trimLabel(name, max) {
  const str = String(name || '');
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
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

function rollAnimation(callback) {
  const nameEl   = document.getElementById('drum-name');
  const pool     = ticketPool.length > 0 ? ticketPool : participants.map(p => p.name);
  const names    = [...new Set(pool)]; // unique names for visual variety
  const DURATION = 2500;
  const start    = performance.now();

  function frame(now) {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / DURATION, 1);
    nameEl.textContent = names[Math.floor(Math.random() * names.length)];
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

  list.innerHTML = winners.map((w, i) => {
    const p = participants.find(x => x.name === w.name);
    return `
      <div class="winner-card" style="animation-delay:${i * 0.1}s">
        <div class="winner-rank">${medals[i] || '🏆'}</div>
        <div class="winner-info">
          <div class="winner-name">${escHtml(w.name)}</div>
          <div class="winner-meta">Seleksi #${i + 1}</div>
        </div>
        <div class="winner-trophy">⭐</div>
      </div>`;
  }).join('');

  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function highlightWinnerRows() {
  document.querySelectorAll('tbody tr').forEach(tr => tr.classList.remove('is-winner'));
  const winnerNames = [...new Set(winners.map(w => w.name))];
  winnerNames.forEach(name => {
    const row = document.getElementById('row-' + sanitize(name));
    if (row) row.classList.add('is-winner');
  });
}

// ── Shuffle Visual Order ──────────────────────────────
function shuffleVisualOrder() {
  if (rolling || participants.length === 0) return;

  participants = randomizeVisualOrder(participants);
  rebuildPool();
  renderStats();
  renderTable();
  renderWheel();
  highlightWinnerRows();
}

// ── Reset ─────────────────────────────────────────────
function resetDraw() {
  // Restore original tickets dan acak ulang urutan visual saat reset.
  participants = randomizeVisualOrder(
    participants.map(p => ({ ...p, tickets: p.original }))
  );
  winners = [];
  rolling = false;

  rebuildPool();

  document.getElementById('winners-section').classList.remove('visible');
  document.getElementById('drum-section').classList.remove('visible');
  document.getElementById('winners-list').innerHTML = '';
  document.getElementById('reset-btn').classList.remove('visible');
  document.getElementById('reveal').classList.remove('visible');

  renderStats();
  renderTable();
  renderWheel();

  const btn = document.getElementById('draw-btn');
  btn.disabled = false;
  btn.classList.remove('rolling');
  document.getElementById('draw-btn-text').textContent = 'Pilih Penerima!';
}

// ── Confetti ──────────────────────────────────────────
function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLORS = ['#22d68a','#3be8b0','#ffffff','#9ba2b4'];
  const pieces = Array.from({ length: 50 }, () => ({
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
  const TOTAL = 120;

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
      ctx.fillStyle = p.color;
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
window.addEventListener('resize', () => {
  if (participants.length > 0) drawWheel(wheelRotation);
});
