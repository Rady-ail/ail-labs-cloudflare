const express = require('express');
const router = express.Router();
const { transporter } = require('../db/mailer');

const PAYMENT_EMAIL = 'info@ail-aesthetic-labs.my.id';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value, max = 200) {
  return String(value == null ? '' : value)
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

router.post('/confirm', async (req, res) => {
  const body = req.body || {};
  const customerName = cleanText(body.customer_name || 'Pelanggan AIL LABS', 120);
  const customerEmail = cleanText(body.customer_email, 160);
  const note = cleanText(body.note, 500);

  if (customerEmail && !EMAIL_PATTERN.test(customerEmail)) {
    return res.status(400).json({ error: 'Format email pelanggan tidak valid.' });
  }

  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: PAYMENT_EMAIL,
      replyTo: customerEmail || undefined,
      subject: 'Konfirmasi Pembayaran — AIL LABS',
      text: [
        'Konfirmasi pembayaran baru dari katalog AIL LABS.',
        '',
        `Nama: ${customerName}`,
        customerEmail ? `Email pelanggan: ${customerEmail}` : '',
        note ? `Catatan: ${note}` : '',
        '',
        'Mohon cek pembayaran dan proses pesanan terkait.',
      ].filter(Boolean).join('\n'),
      html: `<h2>Konfirmasi Pembayaran — AIL LABS</h2>
<p>Konfirmasi pembayaran baru dari katalog AIL LABS.</p>
<p><strong>Nama:</strong> ${escapeHtml(customerName)}</p>
${customerEmail ? `<p><strong>Email pelanggan:</strong> ${escapeHtml(customerEmail)}</p>` : ''}
${note ? `<p><strong>Catatan:</strong> ${escapeHtml(note)}</p>` : ''}
<p>Mohon cek pembayaran dan proses pesanan terkait.</p>`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Gagal mengirim konfirmasi pembayaran:', err);
    return res.status(500).json({ error: 'Gagal mengirim konfirmasi pembayaran.' });
  }
});

module.exports = router;
