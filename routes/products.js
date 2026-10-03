const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');

// ---------- Cache in-memory ----------
// Data produk jarang berubah (cuma pas admin tambah/edit/hapus), tapi katalog
// bisa dibuka ratusan kali sehari. Daripada query + join + grouping ulang tiap
// request, hasilnya disimpan di memori server dan langsung dipakai lagi.
// Dipisah 2 varian karena harga cuma tampil untuk customer 'approved'.
// invalidateProductsCache() dipanggil otomatis tiap ada perubahan data (POST/PUT/DELETE)
// supaya cache tidak pernah nyimpen data basi.
let productsCache = { guest: null, approved: null };
function invalidateProductsCache() {
  productsCache = { guest: null, approved: null };
}

// GET /api/products - katalog publik, dikelompokkan per kategori (hanya produk aktif)
// BUGFIX: harga sekarang hanya dikirim ke pelanggan yang statusnya 'approved'.
// req.customer ditempel oleh middleware/attachCustomer.js (null kalau guest/belum approved).
// Guest & pelanggan pending/rejected/blocked tetap bisa lihat nama & kandungan produk,
// tapi field harga dikembalikan null supaya frontend bisa tampilkan "Login untuk lihat harga".
router.get('/', async (req, res) => {
  try {
    const priceVisible = !!(req.customer && req.customer.status === 'approved');
    const cacheKey = priceVisible ? 'approved' : 'guest';

    if (productsCache[cacheKey]) {
      return res.json(productsCache[cacheKey]);
    }

    const { rows } = await pool.query(`
      SELECT c.id AS category_id, c.name AS cat, c.sort_order AS cat_sort,
             p.id, p.name, p.kandungan, p.kemasan, p.harga, p.sort_order
      FROM categories c
      JOIN products p ON p.category_id = c.id
      WHERE p.aktif = true
      ORDER BY c.name ASC, p.sort_order ASC, p.name ASC
    `);
    // Format items sebagai array [name, kandungan, kemasan, harga] agar
    // 100% kompatibel dengan logika frontend (keranjang, wishlist, dll)
    // yang sudah ada di katalog.
    const groups = {};
    const order = [];
    rows.forEach(r => {
      if (!groups[r.cat]) { groups[r.cat] = []; order.push(r.cat); }
      groups[r.cat].push([r.name, r.kandungan, r.kemasan, priceVisible ? r.harga : null]);
    });
    const result = order.map(cat => ({ cat, items: groups[cat] }));

    productsCache[cacheKey] = result;
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil produk.' });
  }
});

// GET /api/products/admin - daftar lengkap untuk admin (termasuk nonaktif)
router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      ORDER BY c.sort_order ASC, p.sort_order ASC, p.id ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data produk.' });
  }
});

// POST /api/products - tambah produk (admin)
router.post('/', requireAdmin, async (req, res) => {
  const { category_id, name, kandungan, kemasan, harga, aktif, sort_order } = req.body || {};
  if (!category_id || !name || !name.trim()) {
    return res.status(400).json({ error: 'Kategori dan nama produk wajib diisi.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (category_id, name, kandungan, kemasan, harga, aktif, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [category_id, name.trim(), kandungan || '', kemasan || '', harga || 0, aktif !== false, sort_order || 0]
    );
    invalidateProductsCache();
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambah produk.' });
  }
});

// PUT /api/products/:id - ubah produk (admin)
router.put('/:id', requireAdmin, async (req, res) => {
  const { category_id, name, kandungan, kemasan, harga, aktif, sort_order } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE products SET
        category_id = COALESCE($1, category_id),
        name = COALESCE($2, name),
        kandungan = COALESCE($3, kandungan),
        kemasan = COALESCE($4, kemasan),
        harga = COALESCE($5, harga),
        aktif = COALESCE($6, aktif),
        sort_order = COALESCE($7, sort_order),
        updated_at = now()
       WHERE id = $8 RETURNING *`,
      [category_id, name, kandungan, kemasan, harga, aktif, sort_order, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    invalidateProductsCache();
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengubah produk.' });
  }
});

// DELETE /api/products/:id - hapus produk (admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    invalidateProductsCache();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus produk.' });
  }
});

module.exports = router;
