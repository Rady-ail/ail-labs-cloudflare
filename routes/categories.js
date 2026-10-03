const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');

// GET /api/categories - daftar kategori (publik)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categories ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil kategori.' });
  }
});

// POST /api/categories - tambah kategori (admin)
router.post('/', requireAdmin, async (req, res) => {
  const { name, sort_order } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama kategori wajib diisi.' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO categories (name, sort_order) VALUES ($1, $2) RETURNING *',
      [name.trim(), sort_order || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Kategori sudah ada.' });
    console.error(err);
    res.status(500).json({ error: 'Gagal menambah kategori.' });
  }
});

// PUT /api/categories/:id - ubah kategori (admin)
router.put('/:id', requireAdmin, async (req, res) => {
  const { name, sort_order } = req.body || {};
  try {
    const { rows } = await pool.query(
      'UPDATE categories SET name = COALESCE($1, name), sort_order = COALESCE($2, sort_order) WHERE id = $3 RETURNING *',
      [name ? name.trim() : null, sort_order, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengubah kategori.' });
  }
});

// DELETE /api/categories/:id - hapus kategori (admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus kategori. Pastikan tidak ada produk yang masih memakai kategori ini.' });
  }
});

module.exports = router;
