require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieSession = require('cookie-session');
const path = require('path');
const compression = require('compression');
const pool = require('./db/pool');

const app = express();
const isCloudflareWorker = typeof WebSocketPair !== 'undefined';
const sessionSecret = process.env.ADMIN_SESSION_SECRET;

app.set('trust proxy', 1);

// Security headers without introducing a new runtime dependency.
// CSP remains compatible with the current CDN/inline React catalog.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://connect.facebook.net https://www.paypal.com",
    "connect-src 'self' https://*.paypal.com https://accounts.google.com https://www.google-analytics.com",
    "frame-src 'self' https://*.paypal.com https://accounts.google.com",
  ].join('; '));
  if (isCloudflareWorker || process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Server + database health check. Never returns credentials or secret values.
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1 AS ok');
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, service: 'ail-labs-api', database: 'ok', uptime: process.uptime() });
  } catch (err) {
    console.error('[health] database check failed:', err.message);
    res.set('Cache-Control', 'no-store');
    res.status(503).json({ ok: false, service: 'ail-labs-api', database: 'error' });
  }
});

// BUGFIX: `origin: true` me-reflect origin APAPUN sambil tetap mengizinkan
// cookie (credentials: true) — terlalu longgar untuk endpoint yang pakai
// session admin. Karena frontend & API selalu satu origin (disajikan dari
// domain Render/Netlify yang sama), origin luar seharusnya tidak perlu
// diizinkan sama sekali. ALLOWED_ORIGIN opsional untuk kasus dev/preview
// terpisah (isi di .env kalau memang butuh, pisahkan dengan koma).
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  credentials: true,
}));
if (!isCloudflareWorker) app.use(compression());
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); }
}));
const passport = require('passport');
app.use(passport.initialize());
if (sessionSecret) {
  app.use(cookieSession({
    name: 'ail_session',
    secret: sessionSecret,
    maxAge: 24 * 60 * 60 * 1000, // 24 jam
    httpOnly: true,
    sameSite: 'lax',
    secure: isCloudflareWorker || process.env.NODE_ENV === 'production',
    overwrite: true,
  }));
} else {
  // Keep the public site available, but do not pretend admin sessions are healthy.
  if (process.env.NODE_ENV === 'production' || isCloudflareWorker) {
    console.error('[auth] ADMIN_SESSION_SECRET is missing in production; admin sessions are disabled.');
  }
  app.use((req, res, next) => {
    req.session = {};
    next();
  });
}

app.use(require('./middleware/attachCustomer'));

// ---------- API routes ----------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/quotation', require('./routes/quotation'));
app.use('/api/payment-confirmation', require('./routes/payment-confirmation'));
app.use('/api/paypal', require('./routes/paypal'));
app.use('/api/promo', require('./routes/promo'));
app.use('/api/visitors', require('./routes/visitors'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/customer/auth', require('./routes/customerAuth'));
app.use('/api/broadcast', require('./routes/broadcast'));
app.use('/api/whatsapp', require('./routes/whatsapp-webhook'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/procurement-ai', require('./routes/procurement-ai'));
app.use('/api/admin', require('./routes/promoKategori'));

// ---------- File statis (katalog publik + panel admin) ----------
if (typeof __dirname !== 'undefined') {
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: true }));

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin/index.html'));
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
  });
}

module.exports = app;
