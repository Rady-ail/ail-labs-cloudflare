const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const pool = require('../db/pool');
const photoRouter = require('../routes/productPhoto');
const productsRouter = require('../routes/products');

test('product photo upload, persistence, reload, replacement and catalog contract', async t => {
  const objects = new Map();
  const bucket = {
    async put(key, bytes, options) { objects.set(key, { bytes: Buffer.from(bytes), meta: options.httpMetadata }); return { etag: 'mock' }; },
    async head(key) { const x = objects.get(key); return x && { size: x.bytes.length, httpMetadata: x.meta }; },
    async get(key) { const x = objects.get(key); return x && { httpMetadata: x.meta, arrayBuffer: async () => x.bytes.buffer.slice(x.bytes.byteOffset, x.bytes.byteOffset + x.bytes.byteLength) }; },
  };
  const rows = [];
  let nextId = 1;
  const originalQuery = pool.query;
  pool.query = async (sql, p = []) => {
    if (sql.includes('INSERT INTO products')) {
      const row = { id: nextId++, category_id: p[0], name: p[1], kandungan: p[2], kemasan: p[3], harga: p[4], aktif: p[5], sort_order: p[6], foto_url: p[7] };
      rows.push(row); return { rows: [row] };
    }
    if (sql.includes('UPDATE products SET')) {
      const row = rows.find(x => String(x.id) === String(p[9]));
      if (!row) return { rows: [] };
      ['category_id','name','kandungan','kemasan','harga','aktif','sort_order'].forEach((k,i) => { if (p[i] !== null && p[i] !== undefined) row[k] = p[i]; });
      if (p[7]) row.foto_url = p[8];
      return { rows: [row] };
    }
    if (sql.includes('SELECT p.*, c.name AS category_name')) return { rows: rows.map(x => ({ ...x, category_name: 'Injectables' })) };
    if (sql.includes('SELECT c.id AS category_id')) return { rows: rows.filter(x => x.aktif).map(x => ({ ...x, cat: 'Injectables', cat_sort: 0 })) };
    throw new Error('Unexpected SQL in test: ' + sql.slice(0, 60));
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use((req, res, next) => { req.session = { isAdmin: true }; next(); });
  app.use(express.json({ limit: '2mb' }));
  app.locals.productImagesBucket = bucket;
  app.use('/api/products', photoRouter);
  app.use('/api/products', productsRouter);
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ error: 'request too large' });
    return next(err);
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); pool.query = originalQuery; });
  const base = 'http://127.0.0.1:' + server.address().port;
  const jpeg = n => Buffer.from([0xff,0xd8,0xff,0x00,n,0x22,0xff,0xd9]);
  async function upload(bytes) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'photo.jpg');
    const r = await fetch(base + '/api/products/photo-upload', { method: 'POST', body: form });
    return { status: r.status, data: await r.json() };
  }

  const first = await upload(jpeg(1));
  assert.equal(first.status, 201);
  const firstUrl = new URL(first.data.url, 'https://ail-aesthetic-labs.my.id').href;
  const delivered = await fetch(base + first.data.url);
  assert.equal(delivered.status, 200);
  assert.equal(delivered.headers.get('content-type'), 'image/jpeg');

  const created = await fetch(base + '/api/products', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category_id: 1, name: 'Photo test', foto_url: firstUrl }) });
  assert.equal(created.status, 201);
  const saved = await created.json();
  assert.equal(saved.foto_url, firstUrl);
  const reloaded = await (await fetch(base + '/api/products/admin')).json();
  assert.equal(reloaded[0].foto_url, firstUrl);
  const catalog = await (await fetch(base + '/api/products')).json();
  assert.equal(catalog[0].items[0][4], firstUrl);

  const second = await upload(jpeg(2));
  assert.equal(second.status, 201);
  const secondUrl = new URL(second.data.url, 'https://ail-aesthetic-labs.my.id').href;
  const changed = await fetch(base + '/api/products/' + saved.id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ foto_url: secondUrl }) });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).foto_url, secondUrl);
  assert.equal((await (await fetch(base + '/api/products/admin')).json())[0].foto_url, secondUrl);
  assert.equal((await (await fetch(base + first.data.url)).arrayBuffer()).byteLength, jpeg(1).length);

  const oversized = await upload(Buffer.alloc(4 * 1024 * 1024 + 1));
  assert.equal(oversized.status, 413);
  const bigJson = JSON.stringify({ extra: 'x'.repeat(2 * 1024 * 1024) });
  const tooLarge = await fetch(base + '/api/products', { method: 'POST', headers: { 'content-type': 'application/json' }, body: bigJson });
  assert.equal(tooLarge.status, 413);

  const catalogHtml = fs.readFileSync('public/catalog.html', 'utf8');
  assert.match(catalogHtml, /photo=i\?\.\[4\]\?\?""/);
  assert.match(catalogHtml, /img\.src=saved/);
  const migration = fs.readFileSync('db/migrations/20261018_add_products_foto_url.sql', 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS foto_url TEXT/i);
});
