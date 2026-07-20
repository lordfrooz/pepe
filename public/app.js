/* ============================================================
   ROBINPEPE — airdrop flow + boarding pass renderer
   ============================================================ */

// X_HANDLE ve PINNED_TWEET_ID sunucudan gelir (/api/config → env degiskenleri).
// Buradakiler yalnizca sunucuya ulasilamazsa kullanilan varsayilanlardir.
const CONFIG = {
  X_HANDLE: 'robinpepega',
  PINNED_TWEET_ID: '',
  SITE_URL: window.location.origin,
  VERIFY_SECONDS: 6,
};

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg.x_handle) CONFIG.X_HANDLE = cfg.x_handle;
    CONFIG.PINNED_TWEET_ID = cfg.pinned_tweet_id || '';
    // handle'i gosteren yerleri guncelle
    const headerX = document.querySelector('.header-x');
    headerX.textContent = `@${CONFIG.X_HANDLE}`;
    headerX.href = `https://x.com/${CONFIG.X_HANDLE}`;
    document.querySelector('.task[data-task="follow"] .task-name').textContent =
      `Follow @${CONFIG.X_HANDLE}`;
  } catch (_) { /* varsayilanlarla devam */ }
}

const state = {
  username: '',
  wallet: '',
  tasksDone: new Set(),
  pass: null, // { x_username, wallet, pass_code, created_at, existing }
};

const $ = (sel) => document.querySelector(sel);

/* ---------------- persistence (survive a refresh mid-flow) ------------- */
function saveState() {
  try {
    localStorage.setItem(
      'rpepe_flow',
      JSON.stringify({ username: state.username, tasks: [...state.tasksDone] })
    );
  } catch (_) { /* storage disabled — flow still works */ }
}
function loadState() {
  try {
    const raw = localStorage.getItem('rpepe_flow');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.username) state.username = data.username;
    (data.tasks || []).forEach((t) => state.tasksDone.add(t));
  } catch (_) { /* ignore corrupt state */ }
}

/* ---------------- steps ---------------- */
function goToStep(n) {
  document.querySelectorAll('.stepper .step').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('is-active', s === n);
    li.classList.toggle('is-done', s < n);
  });
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('is-active'));
  const panel = n === 4 ? $('#panel-pass') : $(`#panel-${n}`);
  panel.classList.add('is-active');
  if (n === 4) {
    document.querySelectorAll('.stepper .step').forEach((li) => {
      li.classList.remove('is-active');
      li.classList.add('is-done');
    });
  }
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------------- step 1: username ---------------- */
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

$('#btn-step1').addEventListener('click', () => {
  const input = $('#x-username');
  const err = $('#username-error');
  const username = input.value.trim().replace(/^@/, '');
  if (!USERNAME_RE.test(username)) {
    err.textContent = 'Enter a valid X username — letters, numbers and underscore only.';
    input.focus();
    return;
  }
  err.textContent = '';
  state.username = username;
  saveState();
  goToStep(2);
});

$('#x-username').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-step1').click();
});

/* ---------------- step 2: missions ---------------- */
function taskUrl(action) {
  const { X_HANDLE, PINNED_TWEET_ID } = CONFIG;
  if (action === 'follow') {
    return `https://x.com/intent/follow?screen_name=${X_HANDLE}`;
  }
  if (!PINNED_TWEET_ID) return `https://x.com/${X_HANDLE}`;
  if (action === 'like') return `https://x.com/intent/like?tweet_id=${PINNED_TWEET_ID}`;
  if (action === 'repost') return `https://x.com/intent/retweet?tweet_id=${PINNED_TWEET_ID}`;
  if (action === 'comment') {
    const text = encodeURIComponent('$RPEPE 🐸💚');
    return `https://x.com/intent/tweet?in_reply_to=${PINNED_TWEET_ID}&text=${text}`;
  }
  return `https://x.com/${X_HANDLE}`;
}

function markTaskDone(li, btn, action) {
  state.tasksDone.add(action);
  li.classList.remove('is-verifying');
  li.classList.add('is-done');
  btn.textContent = 'DONE ✓';
  btn.disabled = true;
  saveState();
  updateMissionGate();
}

function updateMissionGate() {
  const all = ['follow', 'like', 'repost', 'comment'].every((t) => state.tasksDone.has(t));
  $('#btn-step2').disabled = !all;
}

document.querySelectorAll('.btn-task').forEach((btn) => {
  const li = btn.closest('.task');
  const action = btn.dataset.action;

  btn.addEventListener('click', () => {
    if (li.classList.contains('is-done') || li.classList.contains('is-verifying')) return;
    window.open(taskUrl(action), '_blank', 'noopener');
    li.classList.add('is-verifying');
    btn.disabled = true;
    let left = CONFIG.VERIFY_SECONDS;
    btn.textContent = `VERIFYING… ${left}`;
    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        markTaskDone(li, btn, action);
      } else {
        btn.textContent = `VERIFYING… ${left}`;
      }
    }, 1000);
  });
});

$('#btn-step2').addEventListener('click', () => goToStep(3));

/* ---------------- step 3: wallet + register ---------------- */
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

$('#btn-step3').addEventListener('click', async () => {
  const input = $('#wallet');
  const err = $('#wallet-error');
  const btn = $('#btn-step3');
  const wallet = input.value.trim();

  if (!WALLET_RE.test(wallet)) {
    err.textContent = 'Enter a valid EVM address — 0x followed by 40 hex characters.';
    input.focus();
    return;
  }
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'ISSUING…';

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x_username: state.username, wallet }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed. Please try again.');

    state.wallet = data.wallet;
    state.pass = data;
    if (data.existing) {
      $('#pass-sub').textContent =
        'This handle or wallet already boarded — here is your original pass.';
    }
    goToStep(4);
    await drawPass(data);
    refreshStats();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'ISSUE MY PASS';
  }
});

$('#wallet').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-step3').click();
});

/* ---------------- stats counter ---------------- */
async function refreshStats() {
  try {
    const res = await fetch('/api/stats');
    const { count } = await res.json();
    $('#stat-count').textContent = Number(count).toLocaleString('en-US');
  } catch (_) {
    $('#stat-count').textContent = '—';
  }
}

/* ============================================================
   BOARDING PASS — drawn on canvas so the pass on screen and the
   downloaded PNG are the exact same pixels.
   Lime ticket (#ccff00), black ink, Code-128-style barcode.
   ============================================================ */

const PASS = {
  W: 1600,
  H: 640,
  R: 32,       // corner radius
  DIV: 1168,   // perforation x — main section | stub
  PAD: 56,
  LIME: '#ccff00',
  INK: '#000000',
};

function seedFrom(str) {
  let h = 2166136261;
  for (const c of str) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawBarcode(ctx, x, y, w, h, seedStr) {
  const rand = mulberry32(seedFrom(seedStr));
  ctx.fillStyle = PASS.INK;
  const guard = [4, 3, 2, 3, 4]; // bar,gap,bar,gap,bar
  let cx = x;
  // start guard
  ctx.fillRect(cx, y, guard[0], h); cx += guard[0] + guard[1];
  ctx.fillRect(cx, y, guard[2], h); cx += guard[2] + guard[3];
  ctx.fillRect(cx, y, guard[4], h); cx += guard[4] + 6;
  const endGuardW = 22;
  while (cx < x + w - endGuardW - 10) {
    const bw = 2 + Math.floor(rand() * 5);
    const gap = 2 + Math.floor(rand() * 4);
    ctx.fillRect(cx, y, bw, h);
    cx += bw + gap;
  }
  // end guard
  let ex = x + w - endGuardW;
  ctx.fillRect(ex, y, 4, h); ex += 7;
  ctx.fillRect(ex, y, 2, h); ex += 5;
  ctx.fillRect(ex, y, 4, h);
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadLogo() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = 'logo.jpeg';
  });
}

function drawLogoBadge(ctx, img, x, y, size) {
  ctx.save();
  roundedRectPath(ctx, x, y, size, size, size * 0.24);
  if (img) {
    ctx.clip();
    // cover-crop: center-square the source so a non-square logo isn't squashed
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, x, y, size, size);
  } else {
    ctx.fillStyle = PASS.INK;
    ctx.fill();
    ctx.fillStyle = PASS.LIME;
    ctx.font = `${size * 0.55}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🐸', x + size / 2, y + size / 2 + size * 0.04);
  }
  ctx.restore();
}

async function drawPass(pass) {
  const canvas = $('#pass-canvas');
  const ctx = canvas.getContext('2d');
  const { W, H, R, DIV, PAD, LIME, INK } = PASS;

  // Fonts must be resolved before canvas text renders with them.
  await Promise.all([
    document.fonts.load('54px "Archivo Black"'),
    document.fonts.load('700 26px "IBM Plex Mono"'),
    document.fonts.load('600 17px "IBM Plex Mono"'),
    document.fonts.ready,
  ]).catch(() => {});
  const logo = await loadLogo();

  const handle = `@${pass.x_username}`;
  const walletShort = `${pass.wallet.slice(0, 6)}…${pass.wallet.slice(-4)}`;
  const issued = new Date(pass.created_at);
  const dateStr = issued
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();

  ctx.clearRect(0, 0, W, H);

  // ticket body (rounded, so downloaded PNG has clean corners)
  ctx.save();
  roundedRectPath(ctx, 0, 0, W, H, R);
  ctx.clip();
  ctx.fillStyle = LIME;
  ctx.fillRect(0, 0, W, H);

  // faint diagonal watermark
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = INK;
  ctx.font = '92px "Archivo Black"';
  ctx.rotate((-24 * Math.PI) / 180);
  for (let yy = -400; yy < H + 800; yy += 150) {
    for (let xx = -600; xx < W + 400; xx += 460) {
      ctx.fillText('RPEPE', xx + (yy % 300 === 0 ? 120 : 0), yy);
    }
  }
  ctx.restore();

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const label = (text, x, y, align = 'left') => {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.font = '600 15px "IBM Plex Mono"';
    ctx.textAlign = align;
    // letter-spacing by hand for canvas
    if (align === 'left') {
      let cx = x;
      for (const ch of text) {
        ctx.fillText(ch, cx, y);
        cx += ctx.measureText(ch).width + 2.5;
      }
    } else {
      ctx.fillText(text.split('').join(' '), x, y);
    }
    ctx.restore();
  };

  /* ---- main section header ---- */
  drawLogoBadge(ctx, logo, PAD, 46, 88);
  ctx.font = '52px "Archivo Black"';
  ctx.fillText('ROBINPEPE', 164, 98);
  ctx.font = '600 17px "IBM Plex Mono"';
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillText('AIRDROP BOARDING PASS · $RPEPE', 165, 128);
  ctx.restore();

  label('PASS Nº', DIV - PAD, 66, 'right');
  ctx.font = '700 28px "IBM Plex Mono"';
  ctx.textAlign = 'right';
  ctx.fillText(pass.pass_code, DIV - PAD, 100);
  ctx.textAlign = 'left';

  // hairline under header
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillRect(PAD, 168, DIV - PAD * 2, 2);
  ctx.restore();

  /* ---- route ---- */
  label('FROM', PAD, 218);
  label('TO', DIV - PAD, 218, 'right');
  ctx.font = '44px "Archivo Black"';
  ctx.fillText('ROBINHOOD CHAIN', PAD, 268);
  const fromW = ctx.measureText('ROBINHOOD CHAIN').width;
  ctx.textAlign = 'right';
  ctx.fillText('THE MOON', DIV - PAD, 268);
  const toW = ctx.measureText('THE MOON').width;
  ctx.textAlign = 'left';

  // dashed flight path with frog in the middle
  const lineY = 252;
  const x1 = PAD + fromW + 30;
  const x2 = DIV - PAD - toW - 30;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([2, 9]);
  ctx.beginPath();
  ctx.moveTo(x1, lineY);
  ctx.lineTo(x2, lineY);
  ctx.stroke();
  ctx.restore();
  const midX = (x1 + x2) / 2;
  ctx.save();
  ctx.fillStyle = LIME;
  ctx.beginPath();
  ctx.arc(midX, lineY, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '32px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  ctx.fillText('🐸', midX, lineY + 2);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';

  /* ---- data fields ---- */
  const cols = [PAD, 380, 700, 940];
  label('PASSENGER', cols[0], 340);
  label('WALLET', cols[1], 340);
  label('GATE', cols[2], 340);
  label('BOARDING', cols[3], 340);
  ctx.font = '700 27px "IBM Plex Mono"';
  ctx.fillText(handle, cols[0], 376);
  ctx.fillText(walletShort, cols[1], 376);
  ctx.fillText('RH-420', cols[2], 376);
  ctx.fillText(dateStr, cols[3], 376);

  /* ---- barcode ---- */
  drawBarcode(ctx, PAD, 436, DIV - PAD * 2, 118, pass.pass_code);
  ctx.font = '600 18px "IBM Plex Mono"';
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillText(pass.pass_code.split('').join(' '), PAD, 592);
  ctx.textAlign = 'right';
  ctx.globalAlpha = 0.55;
  ctx.font = '600 14px "IBM Plex Mono"';
  ctx.fillText('NON-TRANSFERABLE · VOID IF DUPLICATED', DIV - PAD, 590);
  ctx.restore();

  /* ---- stub ---- */
  const sx = DIV + 40;
  const sw = W - PAD - sx;
  drawLogoBadge(ctx, logo, sx, 46, 52);
  ctx.font = '28px "Archivo Black"';
  ctx.fillText('RPEPE', sx + 66, 82);

  label('PASS Nº', sx, 148);
  ctx.font = '700 21px "IBM Plex Mono"';
  ctx.fillText(pass.pass_code, sx, 176);

  label('PASSENGER', sx, 232);
  ctx.font = '700 22px "IBM Plex Mono"';
  ctx.fillText(handle, sx, 260);

  label('SEAT', sx, 316);
  label('BOARDING', sx + 140, 316);
  ctx.font = '700 22px "IBM Plex Mono"';
  ctx.fillText('420A', sx, 344);
  ctx.fillText(dateStr, sx + 140, 344);

  label('DESTINATION', sx, 400);
  ctx.font = '24px "Archivo Black"';
  ctx.fillText('THE MOON', sx, 430);

  drawBarcode(ctx, sx, 470, sw, 84, pass.pass_code + '-stub');
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.font = '600 14px "IBM Plex Mono"';
  ctx.fillText(pass.pass_code, sx, 580);
  ctx.restore();

  /* ---- perforation ---- */
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 9]);
  ctx.beginPath();
  ctx.moveTo(DIV, 38);
  ctx.lineTo(DIV, H - 38);
  ctx.stroke();
  ctx.restore();

  ctx.restore(); // release rounded clip

  // punch the perforation notches out of the ticket (transparent in PNG)
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(DIV, 0, 26, 0, Math.PI * 2);
  ctx.arc(DIV, H, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ---------------- pass actions ---------------- */
$('#btn-download').addEventListener('click', () => {
  const canvas = $('#pass-canvas');
  const code = state.pass ? state.pass.pass_code : 'RPEPE';
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `robinpepe-pass-${code}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
});

$('#btn-share').addEventListener('click', () => {
  const text =
    `The $RPEPE airdrop is coming and my seat is booked 🐸💚\n\n` +
    `Just claimed my Robinpepe Boarding Pass on Robinhood Chain.\n\n` +
    `Register before takeoff 👉 ${CONFIG.SITE_URL}\n\n` +
    `@${CONFIG.X_HANDLE}`;
  window.open(
    `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`,
    '_blank',
    'noopener'
  );
});

/* ---------------- boot ---------------- */
loadState();
if (state.username) $('#x-username').value = state.username;
document.querySelectorAll('.btn-task').forEach((btn) => {
  const action = btn.dataset.action;
  if (state.tasksDone.has(action)) {
    markTaskDone(btn.closest('.task'), btn, action);
  }
});
updateMissionGate();
loadConfig();
refreshStats();
