// Pembatas laju sederhana per IP untuk endpoint publik yang mengirim email atau
// menyimpan data. Disimpan di memori, jadi di Cloudflare Workers berlaku per
// instance: cukup untuk meredam penyalahgunaan, bukan pengganti aturan WAF.
const { clientIp } = require('./clientIp');

function rateLimit({ windowMs = 10 * 60 * 1000, max = 20, message = 'Terlalu banyak permintaan. Coba lagi nanti.' } = {}) {
  const hits = new Map();
  return function limiter(req, res, next) {
    const now = Date.now();
    if (hits.size > 5000) {
      for (const [key, entry] of hits) if (now - entry.startedAt >= windowMs) hits.delete(key);
    }
    const ip = clientIp(req);
    const entry = hits.get(ip);
    if (!entry || now - entry.startedAt >= windowMs) {
      hits.set(ip, { startedAt: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((windowMs - (now - entry.startedAt)) / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
}

module.exports = { rateLimit };
