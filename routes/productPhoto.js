const express = require('express');
const multer = require('multer');
const { randomUUID } = require('node:crypto');
const { requireAdmin } = require('./authMiddleware');
const router = express.Router();
const MAX_BYTES = 4 * 1024 * 1024;
const KEY_RE = /^products\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/i;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 1 } });
const extByMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
function bucketFor(req) { return req.app?.locals?.productImagesBucket || null; }
function actualMime(buffer) {
  const hex = buffer.subarray(0, 12).toString('hex');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}
function parseUpload(req, res, next) {
  upload.single('file')(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Foto terlalu besar. Maksimum 4 MB.' });
    return res.status(400).json({ error: 'Pilih satu file gambar JPEG, PNG, WebP, atau GIF.' });
  });
}
router.post('/photo-upload', requireAdmin, parseUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pilih foto produk terlebih dahulu.' });
  const mime = actualMime(req.file.buffer);
  if (!mime || mime !== String(req.file.mimetype || '').toLowerCase()) return res.status(400).json({ error: 'Isi file tidak cocok dengan format gambar.' });
  const bucket = bucketFor(req);
  if (!bucket) return res.status(503).json({ error: 'Penyimpanan foto belum aktif. R2 binding PRODUCT_IMAGES belum dikonfigurasi.' });
  const key = 'products/' + randomUUID() + '.' + extByMime[mime];
  try {
    await bucket.put(key, req.file.buffer, { httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { source: 'ail-labs-admin', uploadedAt: new Date().toISOString() } });
    const stored = await bucket.head(key);
    if (!stored || stored.size !== req.file.size) return res.status(502).json({ error: 'Verifikasi foto gagal. Foto lama tidak diubah.' });
    return res.status(201).json({ url: '/api/products/photo/' + key, key, size: stored.size, contentType: mime });
  } catch (err) {
    console.error('[product-photo-upload] storage error:', err && err.message ? err.message : 'unknown');
    return res.status(502).json({ error: 'Foto gagal diunggah atau diverifikasi. Foto lama tidak diubah.' });
  }
});
router.get('/photo/*', async (req, res) => {
  const key = req.params[0] || '';
  if (!KEY_RE.test(key)) return res.status(404).json({ error: 'Foto tidak ditemukan.' });
  const bucket = bucketFor(req);
  if (!bucket) return res.status(503).json({ error: 'Penyimpanan foto belum aktif.' });
  try {
    const object = await bucket.get(key);
    if (!object) return res.status(404).json({ error: 'Foto tidak ditemukan.' });
    res.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    if (object.httpEtag) res.set('ETag', object.httpEtag);
    return res.status(200).send(Buffer.from(await object.arrayBuffer()));
  } catch (err) {
    console.error('[product-photo-read] storage error:', err && err.message ? err.message : 'unknown');
    return res.status(502).json({ error: 'Foto tidak dapat dimuat saat ini.' });
  }
});
module.exports = router;
