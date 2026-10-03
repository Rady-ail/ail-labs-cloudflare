require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieSession = require('cookie-session');
const path = require('path');
const compression = require('compression');

const app = express();
const isCloudflareWorker = typeof WebSocketPair !== 'undefined';
const sessionSecret = process.env.SESSION_SECRET;

app.set('trust proxy', 1);

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
app.use(express.json());
const passport = require('passport');
app.use(passport.initialize());
if (sessionSecret) {
  app.use(cookieSession({
    name: 'ail_session',
    secret: sessionSecret,
    maxAge: 24 * 60 * 60 * 1000, // 24 jam
    sameSite: 'lax',
    secure: isCloudflareWorker || process.env.NODE_ENV === 'production',
  }));
} else {
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
app.use('/api/promo', require('./routes/promo'));
app.use('/api/visitors', require('./routes/visitors'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/customer/auth', require('./routes/customerAuth'));
app.use('/api/broadcast', require('./routes/broadcast'));
app.use('/api/whatsapp', require('./routes/whatsapp-webhook'));
app.use(require('./routes/promo'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/admin', require('./routes/promoKategori'));

// ---------- File statis (katalog publik + panel admin) ----------
// Catatan: di Netlify, folder public/ sudah otomatis disajikan sebagai
// situs statis (lewat pengaturan "publish" di netlify.toml), jadi baris
// ini terutama dipakai saat jalan lokal / di Render.
if (typeof __dirname !== 'undefined') {
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: true }));

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin/index.html'));
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
  });
}

if (!isCloudflareWorker) require('./jobs/broadcastScheduler')();

module.exports = app;
