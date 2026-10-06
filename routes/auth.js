const express = require('express');
const router = express.Router();

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return String(forwarded || req.ip || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function loginRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { startedAt: now, failures: 0 });
    return next();
  }
  if (entry.failures >= LOGIN_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((LOGIN_WINDOW_MS - (now - entry.startedAt)) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Terlalu banyak percobaan login. Coba lagi nanti.' });
  }
  next();
}

function logLoginAttempt({ success, username, req }) {
  const ip = getClientIp(req);
  const time = new Date().toISOString();
  console.log(`[auth] ${success ? 'LOGIN SUKSES' : 'LOGIN GAGAL'} - user="${username || ''}" ip=${ip} time=${time}`);
}

router.post('/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    console.error('[auth] ADMIN_USERNAME/ADMIN_PASSWORD are not configured.');
    return res.status(503).json({ error: 'Login admin belum dikonfigurasi.' });
  }

  if (username === validUser && password === validPass) {
    req.session.isAdmin = true;
    req.session.username = username;
    loginAttempts.delete(getClientIp(req));
    logLoginAttempt({ success: true, username, req });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, username });
  }

  const ip = getClientIp(req);
  const entry = loginAttempts.get(ip);
  if (entry) entry.failures += 1;
  logLoginAttempt({ success: false, username, req });
  return res.status(401).json({ error: 'Username atau password salah.' });
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.session && req.session.isAdmin) {
    return res.json({ loggedIn: true, username: req.session.username });
  }
  res.json({ loggedIn: false });
});

module.exports = router;
