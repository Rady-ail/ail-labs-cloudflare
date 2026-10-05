const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { normalizePhoneNumber, broadcastInChunks } = require('../services/fonnteService');
const { requireAdmin } = require('./authMiddleware');

router.post('/api/admin/promo', requireAdmin, async (req, res) => {
  try {
    const { title, description, discount, imageUrl } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'title dan description wajib diisi' });
    }

    const { rows: customers } = await pool.query(
   `SELECT phone FROM customers WHERE status = 'approved' AND phone IS NOT NULL AND phone != ''`
    );

    const targets = customers
      .map((c) => normalizePhoneNumber(c.phone))
      .filter(Boolean);

    if (targets.length === 0) {
      return res.json({ success: true, sent: 0, message: 'Tidak ada customer dengan nomor WA aktif' });
    }

    const message =
      `🌿 *Promo Baru dari AIL Labs!*\n\n` +
      `${title}\n${description}\n` +
      (discount ? `Diskon: ${discount}\n\n` : '\n') +
      `Chat admin untuk info lebih lanjut: https://wa.me/6287817391521`;

    const results = await broadcastInChunks(targets, message, imageUrl || null);

    res.json({ success: true, sent: targets.length, results });
  } catch (err) {
    console.error('Error broadcast promo:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
