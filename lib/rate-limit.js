'use strict';
// Rate limit per IP di memori (pola yang sama dengan routes/auth.js), tanpa dependensi.
// Catatan: di Cloudflare Workers tiap isolate punya peta sendiri, jadi ini batas
// "usaha terbaik". Untuk batas global, tambahkan aturan Rate Limiting di Cloudflare WAF.

function createRateLimiter({ windowMs, max, message = 'Terlalu banyak permintaan. Coba lagi nanti.', maxEntries = 5000 }) {
  const hits = new Map();

  function clientIp(req) {
    const forwarded = req.headers && req.headers['x-forwarded-for'];
    return String(forwarded || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
  }

  function prune(now) {
    for (const [ip, entry] of hits) {
      if (now - entry.startedAt >= windowMs) hits.delete(ip);
    }
  }

  function limiter(req, res, next, now = Date.now()) {
    if (hits.size >= maxEntries) prune(now);
    const ip = clientIp(req);
    const entry = hits.get(ip);
    if (!entry || now - entry.startedAt >= windowMs) {
      hits.set(ip, { startedAt: now, count: 1 });
      return next();
    }
    if (entry.count >= max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((windowMs - (now - entry.startedAt)) / 1000))));
      return res.status(429).json({ error: message });
    }
    entry.count += 1;
    return next();
  }

  limiter.size = () => hits.size;
  return limiter;
}

module.exports = { createRateLimiter };
