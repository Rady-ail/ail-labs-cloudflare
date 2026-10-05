// routes/whatsapp-webhook.js
const crypto = require('crypto');
// Nampung pesan masuk dari customer via WhatsApp Cloud API,
// cari produk yang cocok di katalog, balas dengan info/harga
// (harga cuma muncul kalau nomor pengirim terdaftar & statusnya approved).

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { sendWhatsApp } = require('../lib/whatsapp');

const MAX_HASIL = 5;

// Normalisasi nomor: WA kirim format internasional (mis. 62812xxxxxxx),
// sedangkan di tabel customers kemungkinan tersimpan format lokal (0812xxxxxxx).
// Sesuaikan fungsi ini kalau format di DB kamu ternyata beda.
function normalisasiNomor(nomorWA) {
  if (nomorWA.startsWith('62')) {
    return '0' + nomorWA.slice(2);
  }
  return nomorWA;
}

// 1) Verifikasi webhook (dipanggil sekali oleh Meta saat setup)
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 2) Terima pesan masuk
router.post('/webhook', async (req, res) => {
  const signature = req.get('X-Hub-Signature-256') || '';
  const secret = process.env.WHATSAPP_APP_SECRET;
  if(!secret || !req.rawBody || !signature.startsWith('sha256=')){
    return res.sendStatus(403);
  }
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const provided = signature.slice(7);
  const expectedHex = expected.slice(7);
  if(provided.length !== expectedHex.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expectedHex))){
    return res.sendStatus(403);
  }

  // Selalu balas 200 duluan supaya Meta tidak retry berkali-kali,
  // proses baru dijalankan setelahnya.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const pesanMasuk = change?.messages?.[0];
    if (!pesanMasuk || pesanMasuk.type !== 'text') return;

    const nomorWA = pesanMasuk.from; // format: 62812xxxxxxx
    const teks = pesanMasuk.text.body.trim();
    const nomorLokal = normalisasiNomor(nomorWA);

    // Cek status customer berdasarkan nomor
    const { rows: customerRows } = await pool.query(
      'SELECT status FROM customers WHERE phone = $1 LIMIT 1',
      [nomorLokal]
    );
    const statusCustomer = customerRows[0]?.status || null;
    const bolehLihatHarga = statusCustomer === 'approved';

    // Cari produk yang cocok
    const { rows: produk } = await pool.query(
      `SELECT name, kemasan, harga FROM products
       WHERE aktif = true AND (name ILIKE $1 OR kandungan ILIKE $1)
       ORDER BY sort_order ASC LIMIT $2`,
      [`%${teks}%`, MAX_HASIL]
    );

    let balasan;
    if (produk.length === 0) {
      balasan = `Maaf, produk "${teks}" tidak ditemukan di katalog kami. Coba kata kunci lain, atau ketik nama bahan/kandungan yang dicari ya.`;
    } else {
      const daftar = produk
        .map((p) => {
          const hargaTampil = bolehLihatHarga
            ? `Rp${Number(p.harga).toLocaleString('id-ID')}`
            : 'Login/daftar dulu di web untuk lihat harga';
          return `• ${p.name} (${p.kemasan}) — ${hargaTampil}`;
        })
        .join('\n');

      balasan = `Berikut produk yang cocok dengan "${teks}":\n\n${daftar}`;
      if (!bolehLihatHarga) {
        balasan += `\n\nUntuk lihat harga & checkout, daftar dulu ya di katalog web kami.`;
      }
    }

    await sendWhatsApp(nomorWA, balasan);
  } catch (err) {
    console.error('[WA Webhook] Error:', err);
  }
});

module.exports = router;
