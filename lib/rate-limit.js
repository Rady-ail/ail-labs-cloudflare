'use strict';
// Rate limit per IP di memori, tanpa dependensi.
// IP klien diambil dari CF-Connecting-IP (diisi Cloudflare, tidak bisa dipalsukan klien).
// Catatan: di Cloudflare Workers tiap isolate punya peta sendiri, jadi ini batas
// "usaha terbaik". Untuk batas global, tambahkan aturan Rate Limiting di Cloudflare WAF.

function createRateLimiter({ windowMs, max, message = 'Terlalu banyak permintaan. Coba lagi nanti.', maxEntries = 5000 }) {
  // Urutan penyisipan Map = urutan startedAt (entri selalu dihapus lalu disisipkan ulang).
  const hits = new Map();

  function clientIp(req) {
    const h = req.headers || {};
    return String(h['cf-connecting-ip'] || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
  }

  function prune(now) {
    for (const [ip, entry] of hits) {
      if (now - entry.startedAt >= windowMs) hits.delete(ip);
      else break;
    }
  }

  function limiter(req, res, next, now = Date.now()) {
    const ip = clientIp(req);
    const entry = hits.get(ip);
    if (!entry || now - entry.startedAt >= windowMs) {
      hits.delete(ip);
      if (hits.size >= maxEntries) {
        prune(now);
        // Batas keras: kalau masih penuh, buang entri tertua agar memori tidak membesar.
        if (hits.size >= maxEntries) hits.delete(hits.keys().next().value);
      }
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
