// Jalankan: node test/rate-limit.test.js  (tanpa jaringan, tanpa dependensi)
'use strict';
const assert = require('assert');
const { createRateLimiter } = require('../lib/rate-limit.js');

function run(limiter, ip, now) {
  const res = {
    code: null, body: null, headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let passed = false;
  // X-Forwarded-For sengaja diacak: harus diabaikan, hanya CF-Connecting-IP yang dipakai.
  const req = { headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': String(Math.random()) } };
  limiter(req, res, () => { passed = true; }, now);
  return { passed, res };
}

// Batas per IP: 3 lolos, ke-4 ditolak 429 + Retry-After
const limiter = createRateLimiter({ windowMs: 1000, max: 3, message: 'Terlalu banyak.' });
for (let i = 0; i < 3; i++) assert.ok(run(limiter, '1.1.1.1', 0).passed, 'permintaan ke-' + (i + 1) + ' harus lolos');
const blocked = run(limiter, '1.1.1.1', 100);
assert.strictEqual(blocked.passed, false);
assert.strictEqual(blocked.res.code, 429);
assert.deepStrictEqual(blocked.res.body, { error: 'Terlalu banyak.' });
assert.ok(Number(blocked.res.headers['Retry-After']) >= 1, 'Retry-After harus ada');

// IP lain tidak terpengaruh
assert.ok(run(limiter, '2.2.2.2', 100).passed);

// Jendela habis -> boleh lagi
assert.ok(run(limiter, '1.1.1.1', 1500).passed);

// X-Forwarded-For palsu tidak boleh menghindari batas
const l2 = createRateLimiter({ windowMs: 1000, max: 1 });
assert.ok(run(l2, '3.3.3.3', 0).passed);
assert.strictEqual(run(l2, '3.3.3.3', 10).passed, false);

// Memori dibersihkan: entri kedaluwarsa dibuang saat peta penuh
const l3 = createRateLimiter({ windowMs: 1000, max: 1, maxEntries: 5 });
for (let i = 0; i < 5; i++) run(l3, '10.0.0.' + i, 0);
assert.strictEqual(l3.size(), 5);
run(l3, '10.0.1.1', 5000);
assert.strictEqual(l3.size(), 1, 'entri kedaluwarsa harus dibuang');

// Batas keras: semua entri masih aktif, ukuran peta tetap tidak melebihi maxEntries
const l4 = createRateLimiter({ windowMs: 1000, max: 1, maxEntries: 3 });
run(l4, '10.0.0.1', 0);
run(l4, '10.0.0.2', 1);
run(l4, '10.0.0.3', 2);
run(l4, '10.0.0.4', 3);
assert.strictEqual(l4.size(), 3, 'peta tidak boleh melebihi maxEntries');
assert.strictEqual(run(l4, '10.0.0.3', 5).passed, false, 'entri aktif tetap dilacak');

console.log('rate-limit.test.js: OK');
