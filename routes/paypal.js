const express = require('express');
const router = express.Router();
const paypal = require('@paypal/checkout-server-sdk');
const pool = require('../db/pool');
const { notifyNewOrder } = require('../services/zapierNotifyService');

function client() {
  const env = process.env.PAYPAL_MODE === 'live'
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
  return new paypal.core.PayPalHttpClient(env);
}

// GET /api/paypal/config
// Info publik untuk inisialisasi PayPal JS SDK di frontend (client-id PayPal
// memang didesain untuk dipakai di sisi browser, beda dengan CLIENT_SECRET
// yang tetap hanya dipakai di server dan tidak pernah dikirim ke frontend).
router.get('/config', (req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID) {
    return res.status(503).json({ error: 'PayPal belum dikonfigurasi di server.' });
  }
  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID,
    currency: 'USD',
  });
});

// Hitung ulang total IDR di server (sama seperti routes/orders.js) lalu convert ke USD.
async function verifyAndConvert(items) {
  const names = (items || []).map(it => (it && it.name ? String(it.name) : '')).filter(Boolean);
  const { rows: products } = await pool.query(
    'SELECT name, kemasan, harga FROM products WHERE name = ANY($1) AND aktif = true',
    [names]
  );
  const byName = new Map(products.map(p => [p.name, p]));

  let totalIDR = 0;
  const verifiedItems = [];
  for (const it of (items || [])) {
    const p = byName.get(it.name);
    if (!p) throw new Error(`Produk "${it.name}" tidak ditemukan atau nonaktif.`);
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const harga = Number(p.harga);
    totalIDR += harga * qty;
    verifiedItems.push({ cat: it.cat, name: p.name, kemasan: p.kemasan, harga, qty });
  }
  const rate = Number(process.env.PAYPAL_USD_RATE || 15800);
  const totalUSD = (totalIDR / rate).toFixed(2);
  return { totalIDR, totalUSD, verifiedItems };
}

// POST /api/paypal/create-order
router.post('/create-order', async (req, res) => {
  if (!req.customer || req.customer.status !== 'approved') {
    return res.status(403).json({ error: 'Akun belum disetujui admin.' });
  }
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Keranjang kosong.' });
    }
    const { totalUSD } = await verifyAndConvert(items);

    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: totalUSD } }],
    });
    const order = await client().execute(request);
    res.json({ id: order.result.id, totalUSD });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Gagal membuat order PayPal.' });
  }
});

// POST /api/paypal/capture-order/:orderID
router.post('/capture-order/:orderID', async (req, res) => {
  if (!req.customer || req.customer.status !== 'approved') {
    return res.status(403).json({ error: 'Akun belum disetujui admin.' });
  }
  try {
    const { customer_name, note, items } = req.body || {};
    const { totalIDR, verifiedItems } = await verifyAndConvert(items);

    const request = new paypal.orders.OrdersCaptureRequest(req.params.orderID);
    const capture = await client().execute(request);

    if (capture.result.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Pembayaran belum selesai.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO orders (customer_id, customer_name, note, items, total, status, payment_method, payment_status, paypal_order_id)
       VALUES ($1,$2,$3,$4,$5,'diproses','paypal','paid',$6) RETURNING *`,
      [req.customer.id, customer_name, note || '', JSON.stringify(verifiedItems), totalIDR, req.params.orderID]
    );
    notifyNewOrder(rows[0]); // fire-and-forget, tidak menunda respons ke customer
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memproses pembayaran.' });
  }
});

module.exports = router;
