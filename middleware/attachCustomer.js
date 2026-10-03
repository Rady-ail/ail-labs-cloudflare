// middleware/attachCustomer.js
// Dipasang global di app.js SETELAH cookie-session. Membaca req.session.customerId
// (di-set oleh routes/customerAuth.js saat login Google berhasil) lalu menempelkan
// data pelanggan ke req.customer supaya route lain (misalnya routes/products.js)
// bisa cek req.customer?.status === 'approved' tanpa query ulang dari nol.
//
// req.customer bernilai null kalau: belum login, cookie tidak valid, atau akun
// sudah dihapus — jadi route lain tinggal treat null = guest, tidak perlu try/catch.

const pool = require('../db/pool'); // TODO: sesuaikan dengan modul koneksi Neon yang sudah ada

module.exports = async function attachCustomer(req, res, next) {
  if (!req.session || !req.session.customerId) {
    req.customer = null;
    return next();
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, status FROM customers WHERE id = $1',
      [req.session.customerId]
    );
    req.customer = rows[0] || null;
  } catch (err) {
    req.customer = null;
  }
  next();
};
