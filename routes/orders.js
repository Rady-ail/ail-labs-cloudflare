const express = require('express');
const multer = require('multer');
const router = express.Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');
const { transporter } = require('../db/mailer');
const { notifyNewOrder } = require('../services/zapierNotifyService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB, cukup untuk PDF struk
});

// POST /api/orders - catat pesanan baru (dipanggil otomatis saat checkout WA, publik)
// BUGFIX (harga): tiap item dicocokkan ke tabel `products`, harga & total dihitung
// ulang di server, item yang produknya tidak ditemukan/nonaktif ditolak.
// BUGFIX (akses): checkout sekarang wajib login Google DAN status akun 'approved'
// (req.customer ditempel oleh middleware/attachCustomer.js). Sebelumnya endpoint ini
// terbuka untuk siapa saja, termasuk pelanggan yang belum di-approve admin.
// Order juga sekarang menyimpan customer_id supaya admin tahu pesanan itu dari
// akun pelanggan mana persisnya (kolom ditambahkan lewat migrasi terpisah).
router.post('/', async (req, res) => {
  if (!req.customer || req.customer.status !== 'approved') {
    return res.status(403).json({ error: 'Akun Anda belum disetujui admin. Checkout hanya untuk pelanggan yang sudah approved.' });
  }
  const { customer_name, note, items } = req.body || {};
  if (!customer_name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Data pesanan tidak lengkap.' });
  }
  try {
    const names = items.map(it => (it && it.name ? String(it.name) : '')).filter(Boolean);
    if (names.length !== items.length) {
      return res.status(400).json({ error: 'Ada item pesanan tanpa nama produk.' });
    }

    const { rows: products } = await pool.query(
      'SELECT name, kemasan, harga FROM products WHERE name = ANY($1) AND aktif = true',
      [names]
    );
    const byName = new Map(products.map(p => [p.name, p]));

    let total = 0;
    const verifiedItems = [];
    for (const it of items) {
      const p = byName.get(it.name);
      if (!p) {
        return res.status(400).json({ error: `Produk "${it.name}" tidak ditemukan atau sudah nonaktif.` });
      }
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      const harga = Number(p.harga);
      total += harga * qty;
      verifiedItems.push({ cat: it.cat, name: p.name, kemasan: p.kemasan, harga, qty });
    }

    const { rows } = await pool.query(
      `INSERT INTO orders (customer_id, customer_name, note, items, total) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.customer.id, customer_name, note || '', JSON.stringify(verifiedItems), total]
    );
    notifyNewOrder(rows[0]); // fire-and-forget, tidak menunda respons ke customer
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mencatat pesanan.' });
  }
});

// GET /api/orders - daftar semua pesanan masuk (admin)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil pesanan.' });
  }
});

// POST /api/orders/send-receipt - kirim salinan PDF struk ke email admin
// (dipanggil otomatis dari index.html setelah "Kirim ke WhatsApp" diklik, publik)
router.post('/send-receipt', upload.single('file'), async (req, res) => {
  try {
    const { invoice } = req.body || {};
    const recipient = String(process.env.ADMIN_EMAIL || '').trim();
    if (!recipient || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(recipient)) {
      return res.status(503).json({ error: 'Penerima struk belum dikonfigurasi.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'File PDF tidak ditemukan.' });
    }
    if (req.file.mimetype !== 'application/pdf' || req.file.buffer.slice(0, 5).toString('ascii') !== '%PDF-') {
      return res.status(400).json({ error: 'File harus berupa PDF yang valid.' });
    }
    const safeInvoice = String(invoice || 'AIL LABS').replace(/[\\r\\n]/g, '').slice(0, 80);
    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: recipient,
      subject: `Struk Pesanan Baru - ${safeInvoice}`,
      text: `Terlampir struk pesanan ${safeInvoice} dari katalog AIL LABS.`,
      attachments: [{
        filename: `Struk-${safeInvoice.replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`,
        content: req.file.buffer,
        contentType: 'application/pdf',
      }],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Gagal mengirim email struk:', err);
    res.status(500).json({ error: 'Gagal mengirim email struk.' });
  }
});

// PUT /api/orders/:id/status - ubah status pesanan (admin)
router.put('/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['baru', 'diproses', 'selesai', 'batal'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
  try {
    const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengubah status.' });
  }
});

module.exports = router;
