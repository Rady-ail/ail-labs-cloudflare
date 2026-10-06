const express = require('express');
const router = express.Router();
const { transporter } = require('../db/mailer');

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
const originAllowlist = new Set(
  String(process.env.ALLOWED_ORIGIN || 'https://ail-aesthetic-labs.my.id')
    .split(',')
    .map(v => v.trim().replace(/\/$/, ''))
    .filter(Boolean)
);

function clean(value, max) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function sameOrigin(req) {
  const origin = clean(req.get('origin'), 300).replace(/\/$/, '');
  if (!origin) return true;
  return originAllowlist.has(origin);
}

router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (!sameOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Origin tidak diizinkan.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  // Honeypot: bots should never see a different success path.
  if (clean(body.website, 200)) {
    return res.status(200).json({ ok: true });
  }

  const data = {};
  for (const [key, max] of Object.entries(LIMITS)) data[key] = clean(body[key], max);

  if (!data.name || !data.company || !data.whatsapp || !data.email) {
    return res.status(400).json({ ok: false, error: 'Lengkapi nama, perusahaan, WhatsApp, dan email.' });
  }
  if (!emailRe.test(data.email)) {
    return res.status(400).json({ ok: false, error: 'Format email tidak valid.' });
  }

  const recipient = clean(process.env.ADMIN_EMAIL, 254);
  const from = clean(process.env.MAIL_FROM, 254);
  if (!recipient || !emailRe.test(recipient) || !from) {
    console.error('[quotation] MAIL_FROM/ADMIN_EMAIL belum dikonfigurasi');
    return res.status(503).json({ ok: false, error: 'Kanal quotation sedang dikonfigurasi. Silakan coba lagi nanti.' });
  }

  const subjectCompany = data.company.replace(/[\r\n]/g, ' ').slice(0, 120);
  const subject = `Request Quotation — ${subjectCompany}`;
  const text = [
    'REQUEST QUOTATION — AIL LABS',
    '',
    `Name: ${data.name || '-'}`,
    `Company: ${data.company || '-'}`,
    `Position: ${data.position || '-'}`,
    `WhatsApp: ${data.whatsapp || '-'}`,
    `Email: ${data.email || '-'}`,
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

  try {
    const result = await transporter.sendMail({
      from,
      to: recipient,
      replyTo: data.email,
      subject,
      text,
    });

    return res.status(201).json({
      ok: true,
      message: 'Request quotation berhasil dikirim.',
      id: result?.id || null,
    });
  } catch (error) {
    console.error('[quotation] send failed:', error?.message || error);
    return res.status(502).json({ ok: false, error: 'Quotation belum dapat dikirim. Silakan coba lagi.' });
  }
});

module.exports = router;
