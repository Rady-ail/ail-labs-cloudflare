const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../db/pool');
const { transporter } = require('../db/mailer');
const { requireAdmin } = require('./authMiddleware');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[1-9]\d{7,14}$/;
const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
let tablesReady = false;

function clean(value, max = 255) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function normalizePhone(value) {
  const raw = clean(value, 40).replace(/[\s().-]/g, '');
  if (raw.startsWith('00')) return '+' + raw.slice(2);
  if (raw.startsWith('08')) return '+62' + raw.slice(1);
  if (raw.startsWith('62')) return '+' + raw;
  return raw.startsWith('+') ? raw : '+' + raw;
}
function sameOrigin(req) {
  const allow = String(process.env.ALLOWED_ORIGIN || 'https://ail-aesthetic-labs.my.id').split(',').map(v => v.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = clean(req.get('origin'), 300).replace(/\/$/, '');
  return !origin || allow.includes(origin);
}
function requestIp(req) {
  return clean((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0], 100);
}
async function ensureTables() {
  if (tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_captures (
      id SERIAL PRIMARY KEY, session_id TEXT, name TEXT NOT NULL, company TEXT NOT NULL,
      phone TEXT NOT NULL, email TEXT NOT NULL, email_verified_at TIMESTAMPTZ NOT NULL,
      consent_at TIMESTAMPTZ NOT NULL, marketing_consent BOOLEAN NOT NULL DEFAULT false,
      lead_token_hash TEXT UNIQUE NOT NULL, ip_address TEXT, country TEXT, region TEXT, city TEXT,
      user_agent TEXT, first_page TEXT, referrer TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_lead_captures_email ON lead_captures(email);
    CREATE INDEX IF NOT EXISTS idx_lead_captures_created_at ON lead_captures(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lead_captures_country ON lead_captures(country);
    CREATE TABLE IF NOT EXISTS lead_email_otps (
      id SERIAL PRIMARY KEY, email TEXT NOT NULL, otp_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      request_ip TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), consumed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_lead_otps_email_created ON lead_email_otps(email, created_at DESC);
  `);
  tablesReady = true;
}

router.get('/status', async (req, res) => {
  try {
    await ensureTables();
    const token = clean(req.get('x-lead-token'), 200);
    if (!token) return res.json({ verified: false });
    const { rows } = await pool.query(
      `SELECT id, name, company, email, phone, city, region, country FROM lead_captures WHERE lead_token_hash = $1 LIMIT 1`,
      [hash(token)]
    );
    if (!rows[0]) return res.json({ verified: false });
    await pool.query('UPDATE lead_captures SET last_seen_at = now() WHERE id = $1', [rows[0].id]);
    res.set('Cache-Control', 'no-store');
    res.json({ verified: true, lead: rows[0] });
  } catch (err) {
    console.error('[lead/status]', err);
    res.status(500).json({ verified: false, error: 'Status lead tidak tersedia.' });
  }
});

router.post('/request-otp', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origin tidak diizinkan.' });
    await ensureTables();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (clean(body.website, 200)) return res.status(200).json({ ok: true });

    const name = clean(body.name, 120), company = clean(body.company, 160);
    const email = clean(body.email, 180).toLowerCase(), phone = normalizePhone(body.phone);
    const sessionId = clean(body.session_id, 120), consent = body.consent === true;
    const marketingConsent = body.marketing_consent === true;

    if (!name || !company || !email || !phone || !consent)
      return res.status(400).json({ ok: false, error: 'Nama, perusahaan, email, telepon, dan persetujuan pemrosesan data wajib diisi.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'Format email tidak valid.' });
    if (!PHONE_RE.test(phone)) return res.status(400).json({ ok: false, error: 'Nomor telepon tidak valid. Gunakan format internasional, contoh +628123456789.' });

    const ip = requestIp(req);
    const recent = await pool.query(
      `SELECT COUNT(*)::int AS count FROM lead_email_otps WHERE (email = $1 OR request_ip = $2) AND created_at > now() - interval '15 minutes'`,
      [email, ip]
    );
    if (recent.rows[0].count >= 3) return res.status(429).json({ ok: false, error: 'Terlalu banyak permintaan kode. Coba lagi dalam beberapa menit.' });

    const otp = String(crypto.randomInt(100000, 1000000));
    await pool.query(
      `INSERT INTO lead_email_otps (email, otp_hash, expires_at, request_ip) VALUES ($1, $2, now() + interval '10 minutes', $3)`,
      [email, hash(otp), ip]
    );

    const from = clean(process.env.MAIL_FROM || process.env.RESEND_FROM, 254);
    if (!from || !EMAIL_RE.test(from)) return res.status(503).json({ ok: false, error: 'Email verifikasi sedang dikonfigurasi.' });

    await transporter.sendMail({
      from, to: email, subject: 'Kode verifikasi AIL LABS',
      text: `Kode verifikasi AIL LABS Anda: ${otp}\n\nKode berlaku 10 menit. Jangan bagikan kode ini kepada siapa pun.`,
    });
    res.status(201).json({ ok: true, message: 'Kode verifikasi telah dikirim ke email Anda.', expires_in: 600 });
  } catch (err) {
    console.error('[lead/request-otp]', err);
    res.status(502).json({ ok: false, error: 'Kode verifikasi belum dapat dikirim. Silakan coba lagi.' });
  }
});

router.post('/verify-otp', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origin tidak diizinkan.' });
    await ensureTables();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = clean(body.name, 120), company = clean(body.company, 160);
    const email = clean(body.email, 180).toLowerCase(), phone = normalizePhone(body.phone);
    const sessionId = clean(body.session_id, 120), otp = clean(body.otp, 12);
    const consent = body.consent === true, marketingConsent = body.marketing_consent === true;

    if (!name || !company || !email || !phone || !otp || !consent)
      return res.status(400).json({ ok: false, error: 'Data verifikasi belum lengkap.' });
    if (!EMAIL_RE.test(email) || !PHONE_RE.test(phone) || !/^\d{6}$/.test(otp))
      return res.status(400).json({ ok: false, error: 'Data verifikasi tidak valid.' });

    const { rows } = await pool.query(
      `SELECT * FROM lead_email_otps WHERE email = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    const challenge = rows[0];
    if (!challenge) return res.status(400).json({ ok: false, error: 'Kode tidak ditemukan atau sudah kedaluwarsa.' });
    if (challenge.attempts >= MAX_ATTEMPTS) return res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan kode.' });

    if (hash(otp) !== challenge.otp_hash) {
      await pool.query('UPDATE lead_email_otps SET attempts = attempts + 1 WHERE id = $1', [challenge.id]);
      return res.status(400).json({ ok: false, error: 'Kode verifikasi salah.' });
    }
    await pool.query('UPDATE lead_email_otps SET consumed_at = now() WHERE id = $1', [challenge.id]);

    const token = crypto.randomBytes(32).toString('hex');
    const ip = requestIp(req);
    const country = clean(req.get('cf-ipcountry'), 20), region = clean(req.get('cf-region'), 120);
    const city = clean(req.get('cf-ipcity'), 120), userAgent = clean(req.get('user-agent'), 500);
    const referrer = clean(req.get('referer'), 1000);
    let firstPage = '/';
    if (sessionId) {
      const session = await pool.query('SELECT page_visited FROM visitors WHERE session_id = $1 LIMIT 1', [sessionId]);
      if (session.rows[0]) firstPage = clean(session.rows[0].page_visited || '/', 500);
    }

    const result = await pool.query(
      `INSERT INTO lead_captures
       (session_id,name,company,phone,email,email_verified_at,consent_at,marketing_consent,lead_token_hash,ip_address,country,region,city,user_agent,first_page,referrer)
       VALUES ($1,$2,$3,$4,$5,now(),now(),$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id,name,company,email,phone,city,region,country`,
      [sessionId || null,name,company,phone,email,marketingConsent,hash(token),ip,country||null,region||null,city||null,userAgent,firstPage,referrer||null]
    );
    res.status(201).json({ ok: true, verified: true, token, lead: result.rows[0] });
  } catch (err) {
    console.error('[lead/verify-otp]', err);
    res.status(500).json({ ok: false, error: 'Verifikasi belum dapat diselesaikan.' });
  }
});

router.get('/admin', requireAdmin, async (req, res) => {
  try {
    await ensureTables();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { rows } = await pool.query(
      `SELECT id,created_at,last_seen_at,name,company,email,phone,country,region,city,first_page,referrer,marketing_consent
       FROM lead_captures ORDER BY created_at DESC LIMIT $1`, [limit]
    );
    res.json({ count: rows.length, leads: rows });
  } catch (err) {
    console.error('[lead/admin]', err);
    res.status(500).json({ error: 'Gagal mengambil lead.' });
  }
});
module.exports = router;