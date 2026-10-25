// IP klien yang tidak bisa dipalsukan dari luar.
// Di Cloudflare, cf-connecting-ip diisi oleh Cloudflare sendiri. X-Forwarded-For
// justru bisa dikarang klien (nilai pertamanya dipercaya apa adanya), sehingga
// tidak aman dipakai untuk rate limit maupun pencatatan IP.
function clientIp(req) {
  const cf = req.headers && req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim().slice(0, 100);
  return String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').trim().slice(0, 100);
}

module.exports = { clientIp };
