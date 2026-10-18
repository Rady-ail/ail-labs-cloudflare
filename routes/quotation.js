const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { transporter } = require('../db/mailer');
const { requireAdmin } = require('./authMiddleware');

const LIMITS = {
  name: 120,
  company: 160,
  position: 120,
  whatsapp: 40,
  email: 180,
  nib: 40,
  customer: 60,
  product: 500,
  qty: 80,
  notes: 3000,
};
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_VALUES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'];
const NOTIFICATION_VALUES = ['pending', 'sent', 'failed', 'not_configured'];
const originAllowlist = new Set(
  String(process.env.ALLOWED_ORIGIN || 'https://ail-aesthetic-labs.my.id')
    .split(',')
    .map(v => v.trim().replace(/\/$/, ''))
    .filter(Boolean)
);
let tableReady = false;

function clean(value, max) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
function sameOrigin(req) {
  const origin = clean(req.get('origin'), 300).replace(/\/$/, '');
  if (!origin) return true;
  return originAllowlist.has(origin);
}
async function ensureTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rfq_requests (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      position TEXT NOT NULL DEFAULT '',
      whatsapp TEXT NOT NULL,
      email TEXT NOT NULL,
      nib TEXT NOT NULL DEFAULT '',
      customer_category TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      qty TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'New'
        CHECK (status IN ('New','Contacted','Qualified','Proposal','Won','Lost')),
      notification_status TEXT NOT NULL DEFAULT 'not_configured'
        CHECK (notification_status IN ('pending','sent','failed','not_configured'))
    );
    CREATE INDEX IF NOT EXISTS idx_rfq_requests_created_at ON rfq_requests(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rfq_requests_status ON rfq_requests(status);
  `);
  tableReady = true;
}

// Admin-only: view quotation requests submitted by the public form.
router.get('/admin', requireAdmin, async (req, res) => {
  try {
    await ensureTable();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const { rows } = await pool.query(
      `SELECT id, created_at, updated_at, name, company, position, whatsapp, email,
              nib, customer_category, product, qty, notes, status, notification_status
       FROM rfq_requests
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.set('Cache-Control', 'no-store');
    res.json({ count: rows.length, requests: rows });
  } catch (err) {
    console.error('[quotation/admin]', err);
    res.status(500).json({ error: 'Gagal memuat request quotation.' });
  }
});

router.patch('/admin/:id/status', requireAdmin, async (req, res) => {
  try {
    await ensureTable();
    const id = Number.parseInt(req.params.id, 10);
    const status = clean(req.body?.status, 30);
    if (!id || !STATUS_VALUES.includes(status)) {
      return res.status(400).json({ error: 'Status quotation tidak valid.' });
    }
    const { rows } = await pool.query(
      'UPDATE rfq_requests SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, status, updated_at',
      [status, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Request quotation tidak ditemukan.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[quotation/admin/status]', err);
    res.status(500).json({ error: 'Gagal memperbarui status quotation.' });
  }
});

router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!sameOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Origin tidak diizinkan.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  // Honeypot: bots receive a generic success response without creating a record.
  if (clean(body.website, 200)) return res.status(200).json({ ok: true });

  const data = {};
  for (const [key, max] of Object.entries(LIMITS)) data[key] = clean(body[key], max);
  if (!data.name || !data.company || !data.whatsapp || !data.email) {
    return res.status(400).json({ ok: false, error: 'Lengkapi nama, perusahaan, WhatsApp, dan email.' });
  }
  if (!emailRe.test(data.email)) {
    return res.status(400).json({ ok: false, error: 'Format email tidak valid.' });
  }

  try {
    await ensureTable();
    const { rows } = await pool.query(
      `INSERT INTO rfq_requests
        (name, company, position, whatsapp, email, nib, customer_category, product, qty, notes, notification_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
       RETURNING id`,
      [data.name, data.company, data.position, data.whatsapp, data.email, data.nib,
       data.customer, data.product, data.qty, data.notes]
    );
    const id = rows[0].id;
    const recipient = clean(process.env.ADMIN_EMAIL, 254);
    const from = clean(process.env.MAIL_FROM, 254);
    let notificationSent = false;
    let notificationStatus = 'not_configured';

    if (process.env.RESEND_API_KEY && recipient && emailRe.test(recipient) && from) {
      try {
        const subjectCompany = data.company.replace(/[\r\n]/g, ' ').slice(0, 120);
        const text = [
          'REQUEST QUOTATION — AIL LABS',
          '',
          `Request ID: ${id}`,
          `Name: ${data.name}`,
          `Company: ${data.company}`,
          `Position: ${data.position || '-'}`,
          `WhatsApp: ${data.whatsapp}`,
          `Email: ${data.email}`,
          `Company NIB: ${data.nib || '-'}`,
          `Customer Category: ${data.customer || '-'}`,
          `Product / Service: ${data.product || '-'}`,
          `Quantity: ${data.qty || '-'}`,
          '',
          'Notes:',
          data.notes || '-',
          '',
          'Source: AIL LABS website quotation form',
        ].join('\n');
        await transporter.sendMail({
          from,
          to: recipient,
          replyTo: data.email,
          subject: `Request Quotation #${id} — ${subjectCompany}`,
          text,
        });
        notificationSent = true;
        notificationStatus = 'sent';
      } catch (error) {
        notificationStatus = 'failed';
        console.error('[quotation/notify]', error?.message || error);
      }
    }
    await pool.query(
      'UPDATE rfq_requests SET notification_status = $1, updated_at = now() WHERE id = $2',
      [notificationStatus, id]
    );
    return res.status(201).json({
      ok: true,
      id,
      recorded: true,
      notificationSent,
      message: notificationSent
        ? 'Request quotation berhasil tercatat dan notifikasi email telah dikirim.'
        : 'Request quotation berhasil tercatat. Notifikasi email belum aktif; tim AIL LABS dapat meninjau request di panel Admin.',
    });
  } catch (err) {
    console.error('[quotation/submit]', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Request belum dapat dicatat. Silakan coba lagi.' });
  }
});

module.exports = router;
