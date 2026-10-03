// db/mailer.js
// Kirim email pakai Resend (HTTP API) — dipakai karena Railway memblokir
// koneksi SMTP langsung di plan Free/Trial/Hobby.
// Dokumentasi: https://resend.com/docs/api-reference/emails/send-email
//
// Butuh environment variable RESEND_API_KEY (dari dashboard Resend).
// Interface sendMail() dibuat mirip Nodemailer supaya routes/orders.js
// tidak perlu diubah sama sekali.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendMail({ from, to, subject, text, html, attachments }) {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY belum diset di environment variables.');
  }

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
  };
  if (html) payload.html = html;

  if (attachments && attachments.length) {
    payload.attachments = attachments.map(att => ({
      filename: att.filename,
      content: Buffer.isBuffer(att.content)
        ? att.content.toString('base64')
        : att.content,
    }));
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend API error (${res.status}): ${errBody}`);
  }

  return res.json();
}

module.exports = { transporter: { sendMail } };
