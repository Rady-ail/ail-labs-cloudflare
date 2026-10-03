// routes/promoKategori.js
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');
const { normalizePhoneNumber, broadcastInChunks } = require('../services/fonnteService');

const KATEGORI_VALID = ['klinik', 'dokter', 'rs', 'apotek', 'lainnya'];

router.use(requireAdmin);

// Daftar pelanggan approved + kategori (untuk tabel admin)
router.get('/customers-kategori', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, clinic_name, phone, kategori
       FROM customers
       WHERE status = 'approved' AND phone IS NOT NULL AND phone != ''
       ORDER BY clinic_name NULLS LAST, name`
    );
    res.json(rows);
  } catch (err) {
    console.error('Gagal ambil customers-kategori:', err);
    res.status(500).json({ error: 'Gagal mengambil daftar pelanggan' });
  }
});

// Ubah kategori satu pelanggan
router.post('/customers/:id/kategori', async (req, res) => {
  const { kategori } = req.body;
  if (!KATEGORI_VALID.includes(kategori)) {
    return res.status(400).json({ error: 'Kategori tidak valid' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE customers SET kategori = $1 WHERE id = $2 RETURNING id, name, clinic_name, kategori`,
      [kategori, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Gagal update kategori:', err);
    res.status(500).json({ error: 'Gagal update kategori' });
  }
});

// Daftar template promo (opsional filter ?kategori=)
router.get('/promo-templates', async (req, res) => {
  const { kategori } = req.query;
  try {
    const { rows } = kategori
      ? await pool.query('SELECT * FROM promo_templates WHERE kategori = $1 ORDER BY created_at DESC', [kategori])
      : await pool.query('SELECT * FROM promo_templates ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil template' });
  }
});

// Simpan template baru
router.post('/promo-templates', async (req, res) => {
  const { kategori, judul, pesan } = req.body;
  if (!kategori || !judul || !pesan) {
    return res.status(400).json({ error: 'kategori, judul, dan pesan wajib diisi' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO promo_templates (kategori, judul, pesan) VALUES ($1,$2,$3) RETURNING *`,
      [kategori, judul, pesan]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan template' });
  }
});

// Hapus template
router.delete('/promo-templates/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM promo_templates WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus template' });
  }
});

// Preview: hitung jumlah target sebelum kirim
router.get('/promo/preview-kategori', async (req, res) => {
  const kategoriList = (req.query.kategori || '').split(',').map(s => s.trim()).filter(Boolean);
  if (kategoriList.length === 0) {
    return res.status(400).json({ error: 'Pilih minimal 1 kategori' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM customers
       WHERE status = 'approved' AND phone IS NOT NULL AND phone != '' AND kategori = ANY($1)`,
      [kategoriList]
    );
    res.json({ total: rows[0].total });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghitung target' });
  }
});

// Kirim broadcast ke kategori terpilih
router.post('/promo/broadcast-kategori', async (req, res) => {
  try {
    const { kategori, judul, pesan, imageUrl } = req.body;
    const kategoriList = Array.isArray(kategori) ? kategori : [kategori];

    if (!kategoriList.length || !pesan) {
      return res.status(400).json({ error: 'kategori dan pesan wajib diisi' });
    }
    for (const k of kategoriList) {
      if (!KATEGORI_VALID.includes(k)) {
        return res.status(400).json({ error: `Kategori tidak valid: ${k}` });
      }
    }

    const { rows: customers } = await pool.query(
      `SELECT phone FROM customers
       WHERE status = 'approved' AND phone IS NOT NULL AND phone != '' AND kategori = ANY($1)`,
      [kategoriList]
    );

    const targets = customers.map((c) => normalizePhoneNumber(c.phone)).filter(Boolean);

    if (targets.length === 0) {
      return res.json({ success: true, sent: 0, message: 'Tidak ada pelanggan aktif di kategori ini' });
    }

    const results = await broadcastInChunks(targets, pesan, imageUrl || null);

    await pool.query(
      `INSERT INTO promo_broadcasts (kategori, judul, pesan, total_target, hasil, sent_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [kategoriList, judul || null, pesan, targets.length, JSON.stringify(results), req.session.username || null]
    );

    res.json({ success: true, sent: targets.length, results });
  } catch (err) {
    console.error('Error broadcast kategori:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

