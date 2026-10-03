// routes/customers.js
// Endpoint KHUSUS ADMIN untuk kelola pelanggan yang login via Google.
// Mount di app.js: app.use('/api/customers', require('./routes/customers'));

const router = require('express').Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');
const { transporter } = require('../db/mailer');

router.use(requireAdmin);

// Kirim notifikasi email ke pelanggan saat status akunnya berubah.
// Dibuat "fire and forget" (tidak di-await sebelum respons ke admin) supaya
// kalau pengiriman email gagal/lambat, aksi approve/reject/block tetap sukses
// tersimpan di database — cuma dicatat di log server.
function notifyCustomer(customer, { subject, text }) {
  if (!customer || !customer.email) return;
  transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: customer.email,
    subject,
    text,
  }).catch(err => console.error('Gagal mengirim email notifikasi pelanggan:', err));
}

// GET /api/customers?status=pending  → daftar pelanggan (filter opsional by status)
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const { rows } = status
      ? await pool.query('SELECT * FROM customers WHERE status = $1 ORDER BY created_at DESC', [status])
      : await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil daftar pelanggan' });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE customers SET status = 'approved', approved_at = NOW(), approved_by = $2
       WHERE id = $1 RETURNING *`,
      [req.params.id, req.session.username || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
    notifyCustomer(rows[0], {
      subject: 'Akun Anda telah disetujui - AIL LABS',
      text: `Halo ${rows[0].name || ''},\n\nAkun Anda di katalog AIL LABS (${rows[0].clinic_name || ''}) telah disetujui admin. Anda sekarang bisa melihat harga produk dan melakukan checkout.\n\nTerima kasih.`,
    });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal approve pelanggan' });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE customers SET status = 'rejected' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
    notifyCustomer(rows[0], {
      subject: 'Update status akun Anda - AIL LABS',
      text: `Halo ${rows[0].name || ''},\n\nMohon maaf, pendaftaran akun Anda di katalog AIL LABS belum bisa kami setujui saat ini. Silakan hubungi kami lewat WhatsApp jika ada pertanyaan.\n\nTerima kasih.`,
    });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal reject pelanggan' });
  }
});

router.post('/:id/block', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE customers SET status = 'blocked' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
    notifyCustomer(rows[0], {
      subject: 'Akun Anda diblokir - AIL LABS',
      text: `Halo ${rows[0].name || ''},\n\nAkun Anda di katalog AIL LABS telah diblokir oleh admin. Jika Anda merasa ini keliru, silakan hubungi kami lewat WhatsApp.\n\nTerima kasih.`,
    });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal block pelanggan' });

  }
});

module.exports = router;
