const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');

const DEFAULT_PROMO = {
  active: false,
  badge: 'Promo Spesial',
  title: 'Judul Promo Ail Labs',
  subtitle: 'Deskripsi singkat promo — ganti sesuai kebutuhan',
  discount: '30%-50%',
  note: 'S&K berlaku. Chat admin untuk info lebih lanjut.',
  whatsapp_number: '6287817391521',
  whatsapp_message: 'Halo Ail Labs, saya mau tanya soal promo',
  reappear_hours: 24,
};

// GET /api/settings/promo-popup - ambil setting popup promo (publik, dipakai katalog)
router.get('/promo-popup', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'promo_popup'");
    res.json(rows[0] ? rows[0].value : DEFAULT_PROMO);
  } catch (err) {
    console.error(err);
    // Kalau tabel/baris belum ada, tetap balas default supaya popup di katalog tidak error
    res.json(DEFAULT_PROMO);
  }
});

// PUT /api/settings/promo-popup - ubah setting popup promo (admin)
router.put('/promo-popup', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const value = {
    active: !!body.active,
    badge: (body.badge ?? DEFAULT_PROMO.badge).toString(),
    title: (body.title ?? DEFAULT_PROMO.title).toString(),
    subtitle: (body.subtitle ?? DEFAULT_PROMO.subtitle).toString(),
    discount: (body.discount ?? DEFAULT_PROMO.discount).toString(),
    note: (body.note ?? DEFAULT_PROMO.note).toString(),
    whatsapp_number: (body.whatsapp_number ?? DEFAULT_PROMO.whatsapp_number).toString(),
    whatsapp_message: (body.whatsapp_message ?? DEFAULT_PROMO.whatsapp_message).toString(),
    reappear_hours: Number(body.reappear_hours ?? DEFAULT_PROMO.reappear_hours) || 0,
  };
  try {
    const { rows } = await pool.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('promo_popup', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()
       RETURNING value`,
      [JSON.stringify(value)]
    );
    res.json(rows[0].value);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan pengaturan promo.' });
  }
});

module.exports = router;
