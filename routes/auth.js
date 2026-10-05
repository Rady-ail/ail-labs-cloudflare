const express = require('express');
const router = express.Router();

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
function loginRateLimit(req, res, next){
  const forwarded = req.headers['x-forwarded-for'];
  const ip = String(forwarded || req.ip || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if(!entry || now - entry.startedAt >= LOGIN_WINDOW_MS){
    loginAttempts.set(ip, { startedAt: now, failures: 0 });
    return next();
  }
  if(entry.failures >= LOGIN_MAX_ATTEMPTS){
    const retryAfter = Math.ceil((LOGIN_WINDOW_MS - (now - entry.startedAt)) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Terlalu banyak percobaan login. Coba lagi nanti.' });
  }
  next();
}

// Kirim ke console — di Railway ini otomatis masuk ke Deploy Logs, jadi
// percobaan login mencurigakan (banyak gagal, IP aneh, dll) bisa dipantau
// lewat `railway logs` atau dashboard tanpa perlu tabel database baru.
function logLoginAttempt({ success, username, req }) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const time = new Date().toISOString();
  console.log(`[auth] ${success ? 'LOGIN SUKSES' : 'LOGIN GAGAL'} - user="${username || ''}" ip=${ip} time=${time}`);
}

// POST /api/auth/login
router.post('/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    return res.status(503).json({ error: 'Login admin belum dikonfigurasi.' });
  }

  if (username === validUser && password === validPass) {
    req.session.isAdmin = true;
    req.session.username = username;
    logLoginAttempt({ success: true, username, req });
    return res.json({ ok: true, username });
  }
  const forwarded = req.headers['x-forwarded-for'];
  const ip = String(forwarded || req.ip || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const entry = loginAttempts.get(ip);
  if(entry) entry.failures += 1;
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
