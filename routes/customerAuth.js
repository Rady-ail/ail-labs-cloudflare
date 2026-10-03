// routes/customerAuth.js
// Auth Google KHUSUS PELANGGAN — sengaja dipisah dari routes/auth.js (admin)
// dan dipasang di prefix /api/customer/auth supaya tidak bentrok dengan
// route login admin yang sudah ada.
//
// Alur status akun pelanggan:
//   incomplete -> pending -> approved / rejected / blocked
//   - incomplete : baru pertama kali login Google, belum isi profil
//   - pending    : sudah isi nama klinik & WA, menunggu di-approve admin
//   - approved   : bisa lihat harga, checkout, wishlist
//   - rejected / blocked : ditolak / diblokir admin

const router = require('express').Router();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const pool = require('../db/pool'); // TODO: sesuaikan dengan modul koneksi Neon yang sudah ada di project ini

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
if (googleConfigured) {
  passport.use('google-customer', new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      const photo = profile.photos?.[0]?.value;

      let { rows } = await pool.query(
        'SELECT * FROM customers WHERE google_id = $1',
        [profile.id]
      );
      let customer = rows[0];

      if (!customer) {
        const insert = await pool.query(
          `INSERT INTO customers (google_id, email, name, photo_url, status)
           VALUES ($1, $2, $3, $4, 'incomplete')
           RETURNING *`,
          [profile.id, email, profile.displayName, photo]
        );
        customer = insert.rows[0];
      }

      done(null, customer);
    } catch (err) {
      done(err);
    }
  }));
}

function requireGoogleConfiguration(req, res, next) {
  if (!googleConfigured) {
    return res.status(503).json({ error: 'Login Google belum dikonfigurasi' });
  }
  next();
}

// Mulai OAuth — dipanggil dari tombol "Lanjutkan dengan Google"
router.get('/google', requireGoogleConfiguration, passport.authenticate('google-customer', {
  scope: ['profile', 'email'],
  session: false, // sesi disimpan manual lewat cookie-session, bukan passport session
}));

// Callback dari Google
router.get('/google/callback',
  requireGoogleConfiguration,
  passport.authenticate('google-customer', { session: false, failureRedirect: '/' }),
  (req, res) => {
    req.session.customerId = req.user.id;
    res.redirect('/');
  }
);

// Dipanggil frontend saat load halaman untuk cek status login
router.get('/me', async (req, res) => {
  if (!req.session.customerId) {
    return res.status(401).json({ error: 'Belum login' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, photo_url, phone, clinic_name, status
       FROM customers WHERE id = $1`,
      [req.session.customerId]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Akun tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data akun' });
  }
});

// Form "lengkapi profil" (nama klinik/apotek + WA) — wajib sebelum status jadi pending
router.post('/complete-profile', async (req, res) => {
  if (!req.session.customerId) {
    return res.status(401).json({ error: 'Belum login' });
  }
  const { clinic_name, phone } = req.body;
  if (!clinic_name || !phone) {
    return res.status(400).json({ error: 'Nama klinik/apotek dan nomor WhatsApp wajib diisi' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE customers
       SET clinic_name = $1, phone = $2, status = 'pending'
       WHERE id = $3
       RETURNING id, name, email, photo_url, phone, clinic_name, status`,
      [clinic_name, phone, req.session.customerId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan profil' });
  }
});

router.post('/logout', (req, res) => {
  req.session.customerId = null;
  res.json({ ok: true });
});

module.exports = router;
