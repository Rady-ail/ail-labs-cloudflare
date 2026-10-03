const express = require('express');
const router = express.Router();

// Kirim ke console — di Railway ini otomatis masuk ke Deploy Logs, jadi
// percobaan login mencurigakan (banyak gagal, IP aneh, dll) bisa dipantau
// lewat `railway logs` atau dashboard tanpa perlu tabel database baru.
function logLoginAttempt({ success, username, req }) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const time = new Date().toISOString();
  console.log(`[auth] ${success ? 'LOGIN SUKSES' : 'LOGIN GAGAL'} - user="${username || ''}" ip=${ip} time=${time}`);
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const validUser = process.env.ADMIN_USERNAME || 'admin';
  const validPass = process.env.ADMIN_PASSWORD || 'admin';

  if (username === validUser && password === validPass) {
    req.session.isAdmin = true;
    req.session.username = username;
    logLoginAttempt({ success: true, username, req });
    return res.json({ ok: true, username });
  }
  logLoginAttempt({ success: false, username, req });
  return res.status(401).json({ error: 'Username atau password salah.' });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ loggedIn: true, username: req.session.username });
  }
  res.json({ loggedIn: false });
});

module.exports = router;
