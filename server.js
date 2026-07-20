const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

// Yerelde .env dosyasini yukle; Railway'de degiskenler panelden gelir.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (_) { /* .env yok */ }

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const X_HANDLE = process.env.X_HANDLE || 'robinpepega';
const PINNED_TWEET_ID = process.env.PINNED_TWEET_ID || '';

app.set('trust proxy', true); // Railway proxy'si arkasinda dogru protokol/host icin

app.use(express.json());

// index.html'i, OG/Twitter onizleme etiketlerindeki __ORIGIN__ yer tutucusunu
// gercek site adresiyle doldurarak servis et. Adres SITE_URL env degiskeninden,
// o yoksa istegin kendisinden (Railway domain'i, custom domain...) alinir.
const PUB = path.join(__dirname, 'public');
function renderIndex(req, res) {
  const origin = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`)
    .replace(/\/+$/, '');
  const html = fs
    .readFileSync(path.join(PUB, 'index.html'), 'utf8')
    .replaceAll('__ORIGIN__', origin);
  res.type('html').send(html);
}
app.get('/', renderIndex);
app.get('/index.html', renderIndex);
app.use(express.static(PUB, { index: false }));

// ---------------------------------------------------------------------------
// Storage: Postgres on Railway (DATABASE_URL). Falls back to an in-memory map
// for local development so the flow can be tested without a database.
// ---------------------------------------------------------------------------
let pool = null;
const memory = []; // fallback store: { id, x_username, wallet, pass_code, created_at }

function sslFor(url) {
  // Railway's internal network and localhost don't use SSL; public proxies do.
  return /railway\.internal|localhost|127\.0\.0\.1/.test(url)
    ? false
    : { rejectUnauthorized: false };
}

async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[robinpepe] DATABASE_URL yok - gecici bellek deposu kullaniliyor.');
    console.warn('[robinpepe] Railway uzerinde Postgres ekleyip DATABASE_URL degiskenini baglayin.');
    return;
  }
  pool = new Pool({ connectionString: url, ssl: sslFor(url) });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id         SERIAL PRIMARY KEY,
      x_username TEXT NOT NULL,
      wallet     TEXT NOT NULL,
      pass_code  TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS registrations_username_key ON registrations (LOWER(x_username));`
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS registrations_wallet_key ON registrations (LOWER(wallet));`
  );
  console.log('[robinpepe] Postgres hazir.');
}

function makePassCode() {
  // Unambiguous alphabet (no 0/O, 1/I) — reads like a printed ticket number.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return `RPEPE-${code.slice(0, 4)}-${code.slice(4)}`;
}

const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

// --- tiny in-memory rate limit: 20 registration attempts / 10 min / IP ------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}

async function findExisting(username, wallet) {
  const u = username.toLowerCase();
  const w = wallet.toLowerCase();
  if (pool) {
    const { rows } = await pool.query(
      `SELECT x_username, wallet, pass_code, created_at
         FROM registrations
        WHERE LOWER(x_username) = $1 OR LOWER(wallet) = $2
        LIMIT 1`,
      [u, w]
    );
    return rows[0] || null;
  }
  return (
    memory.find(
      (r) => r.x_username.toLowerCase() === u || r.wallet.toLowerCase() === w
    ) || null
  );
}

async function insertRegistration(username, wallet) {
  const passCode = makePassCode();
  if (pool) {
    const { rows } = await pool.query(
      `INSERT INTO registrations (x_username, wallet, pass_code)
       VALUES ($1, $2, $3)
       RETURNING x_username, wallet, pass_code, created_at`,
      [username, wallet, passCode]
    );
    return rows[0];
  }
  const row = {
    id: memory.length + 1,
    x_username: username,
    wallet,
    pass_code: passCode,
    created_at: new Date().toISOString(),
  };
  memory.push(row);
  return row;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ ok: true }));

// Frontend'in kullandigi kampanya ayarlari — kaynak: env degiskenleri.
app.get('/api/config', (_req, res) => {
  res.json({ x_handle: X_HANDLE, pinned_tweet_id: PINNED_TWEET_ID });
});

app.get('/api/stats', async (_req, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM registrations');
      return res.json({ count: rows[0].count });
    }
    return res.json({ count: memory.length });
  } catch (err) {
    console.error('[robinpepe] stats error:', err.message);
    return res.json({ count: 0 });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    if (rateLimited(ip)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    }

    let { x_username: username, wallet } = req.body || {};
    username = String(username || '').trim().replace(/^@/, '');
    wallet = String(wallet || '').trim();

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Enter a valid X username (letters, numbers, underscore).' });
    }
    if (!WALLET_RE.test(wallet)) {
      return res.status(400).json({ error: 'Enter a valid wallet address (0x + 40 hex characters).' });
    }

    const existing = await findExisting(username, wallet);
    if (existing) {
      return res.json({
        existing: true,
        x_username: existing.x_username,
        wallet: existing.wallet,
        pass_code: existing.pass_code,
        created_at: existing.created_at,
      });
    }

    let row;
    try {
      row = await insertRegistration(username, wallet);
    } catch (err) {
      if (err.code === '23505') {
        // Unique violation from a concurrent insert — return the winner's pass.
        const again = await findExisting(username, wallet);
        if (again) {
          return res.json({ existing: true, ...again });
        }
      }
      throw err;
    }

    return res.json({
      existing: false,
      x_username: row.x_username,
      wallet: row.wallet,
      pass_code: row.pass_code,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error('[robinpepe] register error:', err.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// CSV export of the airdrop list. Requires ADMIN_KEY env var to be set.
app.get('/api/export', async (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = pool
    ? (await pool.query('SELECT id, x_username, wallet, pass_code, created_at FROM registrations ORDER BY id')).rows
    : memory;
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [
    'id,x_username,wallet,pass_code,created_at',
    ...rows.map((r) => [r.id, r.x_username, r.wallet, r.pass_code, r.created_at].map(esc).join(',')),
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="robinpepe-registrations.csv"');
  return res.send(csv);
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`[robinpepe] http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[robinpepe] DB init failed:', err.message);
    process.exit(1);
  });
