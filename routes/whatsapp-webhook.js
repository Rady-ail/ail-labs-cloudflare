// routes/whatsapp-webhook.js
const crypto = require('crypto');
// Nampung pesan masuk dari customer via WhatsApp Cloud API dan membalas lewat agent katalog
// (harga cuma muncul kalau nomor pengirim terdaftar & statusnya approved).
// Percakapan dicatat (lib/wa-conversation.js): pesan ganda dari Meta dilewati, agent
// mengingat konteks, dan saat diteruskan ke admin bot berhenti membalas sampai admin selesai.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { sendWhatsApp } = require('../lib/whatsapp');
const { answerWithAgent } = require('../lib/catalog-agent');
const conv = require('../lib/wa-conversation');
const { transporter } = require('../db/mailer');
const { requireAdmin } = require('./authMiddleware');

const MAX_HASIL = 5;
const MAX_MESSAGES_PER_DELIVERY = 10;

// Admin-only connection health. Never exposes token values.
router.get('/status', requireAdmin, async (req, res) => {
  const configured = Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  res.set('Cache-Control', 'no-store');
  res.json({
    configured,
    agent_configured: Boolean(process.env.ANTHROPIC_API_KEY),
    provider: 'Meta WhatsApp Cloud API',
    graph_version: process.env.WHATSAPP_GRAPH_VERSION || 'v25.0',
    international_numbers: true,
    note: configured
      ? 'WhatsApp Cloud API siap digunakan. Pesan marketing tetap mengikuti template/opt-in dan tarif Meta.'
      : 'WHATSAPP_TOKEN atau WHATSAPP_PHONE_NUMBER_ID belum dikonfigurasi.'
  });
});

// Admin: percakapan yang sedang diteruskan ke admin (bot diam untuk nomor-nomor ini).
router.get('/handoffs', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ handoffs: await conv.listHandoffs(), auto_resume_hours: conv.HANDOFF_HOURS });
  } catch (err) {
    console.error('[WA] Gagal ambil daftar handoff:', err.message);
    res.status(500).json({ error: 'Gagal mengambil daftar serah-terima.' });
  }
});

// Admin: aktifkan lagi bot untuk satu nomor (nomor format internasional, mis. 62812xxxxxxx).
router.post('/handoffs/:phone/resume', requireAdmin, async (req, res) => {
  const phone = String(req.params.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'Nomor tidak valid.' });
  try {
    res.json({ resumed: await conv.resumeBot(phone) });
  } catch (err) {
    console.error('[WA] Gagal resume bot:', err.message);
    res.status(500).json({ error: 'Gagal mengaktifkan kembali bot.' });
  }
});

// Normalisasi nomor: WA kirim format internasional (mis. 62812xxxxxxx),
// sedangkan di tabel customers kemungkinan tersimpan format lokal (0812xxxxxxx).
// Sesuaikan fungsi ini kalau format di DB kamu ternyata beda.
function normalisasiNomor(nomorWA) {
  if (nomorWA.startsWith('62')) {
    return '0' + nomorWA.slice(2);
  }
  return nomorWA;
}

// Permintaan eksplisit bicara dengan manusia -> langsung diteruskan tanpa menunggu model.
const MINTA_ADMIN = /\b(admin|cs|operator|human|manusia|petugas|customer service)\b/i;

// Catat serah-terima dan kabari admin lewat email. Kegagalan email tidak membatalkan serah-terima.
async function teruskanKeAdmin(nomorWA, { reason, summary }) {
  await conv.setHandoff(nomorWA, reason, summary);
  const to = process.env.ADMIN_EMAIL;
  if (!to || !process.env.RESEND_API_KEY) return;
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || 'AIL LABS <info@ail-aesthetic-labs.my.id>',
      to,
      subject: 'WhatsApp: customer menunggu admin (' + (reason || 'tanpa alasan') + ')',
      text: [
        'Percakapan WhatsApp diteruskan ke admin. Bot berhenti membalas nomor ini selama ' + conv.HANDOFF_HOURS + ' jam.',
        '',
        'Nomor: +' + nomorWA,
        'Alasan: ' + (reason || '-'),
        'Ringkasan: ' + (summary || '-'),
        '',
        'Balas langsung dari WhatsApp Business. Untuk mengaktifkan bot lagi sebelum waktunya: POST /api/whatsapp/handoffs/' + nomorWA + '/resume (login admin).'
      ].join('\n')
    });
  } catch (err) {
    console.error('[WA] Email notifikasi handoff gagal:', err.message);
  }
}

async function kirimDanCatat(nomorWA, teks) {
  await sendWhatsApp(nomorWA, teks);
  try { await conv.recordOutbound(nomorWA, teks); } catch (e) { /* log gagal tidak boleh menghalangi balasan */ }
}

// Balasan cadangan (tanpa AI): pencarian kata kunci sederhana di katalog.
async function balasanCadangan(teks, bolehLihatHarga) {
  const { rows: produk } = await pool.query(
    `SELECT name, kemasan, harga FROM products
     WHERE aktif = true AND (name ILIKE $1 OR kandungan ILIKE $1)
     ORDER BY sort_order ASC LIMIT $2`,
    [`%${teks}%`, MAX_HASIL]
  );

  if (produk.length === 0) {
    return `Maaf, produk "${teks}" tidak ditemukan di katalog kami. Coba kata kunci lain, atau ketik nama bahan/kandungan yang dicari ya.`;
  }
  const daftar = produk
    .map((p) => {
      const hargaTampil = bolehLihatHarga
        ? `Rp${Number(p.harga).toLocaleString('id-ID')}`
        : 'Login/daftar dulu di web untuk lihat harga';
      return `• ${p.name} (${p.kemasan}) — ${hargaTampil}`;
    })
    .join('\n');
  let balasan = `Berikut produk yang cocok dengan "${teks}":\n\n${daftar}`;
  if (!bolehLihatHarga) {
    balasan += `\n\nUntuk lihat harga & checkout, daftar dulu ya di katalog web kami.`;
  }
  return balasan;
}

async function prosesPesan(pesan) {
  const nomorWA = pesan.from; // format: 62812xxxxxxx
  if (!nomorWA) return;
  const adalahTeks = pesan.type === 'text' && pesan.text && typeof pesan.text.body === 'string';
  const teks = adalahTeks ? pesan.text.body.trim() : '';
  if (adalahTeks && !teks) return;

  // Dedupe + log. Kalau DB log bermasalah, agent tetap jalan tanpa memori/dedupe.
  let memoriAktif = true;
  try {
    const baru = await conv.claimInbound(pesan.id, nomorWA, adalahTeks ? teks : `[${pesan.type || 'pesan'}]`);
    if (!baru) return; // kiriman ulang dari Meta
    if (await conv.isHandoffActive(nomorWA)) return; // admin sedang menangani
  } catch (err) {
    memoriAktif = false;
    console.error('[WA] Penyimpanan percakapan tidak tersedia, lanjut tanpa memori:', err.message);
  }

  if (!adalahTeks) {
    await kirimDanCatat(nomorWA, 'Terima kasih. Saat ini saya hanya dapat membaca pesan teks. Silakan tulis kebutuhan produk Anda, atau lanjutkan dengan admin kami melalui Request Quotation di https://ail-aesthetic-labs.my.id/contact.');
    return;
  }

  if (MINTA_ADMIN.test(teks) && memoriAktif) {
    await teruskanKeAdmin(nomorWA, { reason: 'minta bicara dengan admin', summary: teks.slice(0, 300) });
    await kirimDanCatat(nomorWA, 'Baik, percakapan ini saya teruskan ke tim admin AIL LABS. Mereka akan melanjutkan lewat WhatsApp ini. Terima kasih.');
    return;
  }

  // Cek status customer berdasarkan nomor
  const { rows: customerRows } = await pool.query(
    'SELECT status FROM customers WHERE phone = $1 LIMIT 1',
    [normalisasiNomor(nomorWA)]
  );
  const bolehLihatHarga = customerRows[0]?.status === 'approved';

  // Agent AI katalog (Claude): jawab cerdas hanya seputar produk katalog.
  // Kalau ANTHROPIC_API_KEY belum diset / API gagal -> jatuh ke pencarian kata kunci.
  let history = null;
  if (memoriAktif) {
    try { history = await conv.getHistory(nomorWA); } catch (e) { history = null; }
  }
  const jawabanAgent = await answerWithAgent({
    teks,
    nomor: nomorWA,
    priceVisible: bolehLihatHarga,
    history,
    onHandoff: memoriAktif ? (info) => teruskanKeAdmin(nomorWA, info) : undefined
  });
  if (jawabanAgent) {
    await kirimDanCatat(nomorWA, jawabanAgent);
    return;
  }

  await kirimDanCatat(nomorWA, await balasanCadangan(teks, bolehLihatHarga));
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

  // Proses SEBELUM membalas 200: di Cloudflare Workers pekerjaan yang masih berjalan
  // setelah respons terkirim bisa dihentikan, sehingga balasan agent tidak akan terkirim.
  // Kalau Meta mengirim ulang karena lambat, pesan yang sama dilewati lewat dedupe.
  try {
    const pesanMasuk = [];
    for (const entry of req.body.entry || []) {
      for (const change of entry.changes || []) {
        for (const m of (change.value && change.value.messages) || []) pesanMasuk.push(m);
      }
    }
    for (const pesan of pesanMasuk.slice(0, MAX_MESSAGES_PER_DELIVERY)) {
      try {
        await prosesPesan(pesan);
      } catch (err) {
        console.error('[WA Webhook] Error memproses pesan:', err);
      }
    }
  } catch (err) {
    console.error('[WA Webhook] Error:', err);
  }
  res.sendStatus(200);
});

module.exports = router;
