// lib/whatsapp.js
// Kirim pesan WhatsApp lewat WhatsApp Cloud API resmi (Meta).
//
// Env var yang dibutuhkan di Railway:
//   WHATSAPP_TOKEN            -> Permanent Access Token dari Meta App
//   WHATSAPP_PHONE_NUMBER_ID  -> Phone Number ID dari WABA
//
// Kalau env var belum di-set, fungsi ini otomatis jatuh ke mode
// stub (cuma log doang, tidak error) supaya deploy tidak crash
// selama proses setup Meta App masih berjalan.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v25.0';

async function sendWhatsApp(to, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.log(`[STUB WA] Belum ada token/phone number ID. Pesan ke ${to}: "${message}"`);
    return { success: false, stub: true, reason: 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID belum di-set' };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        }),
      }
    );

    const data = await res.json();
    if (!res.ok) {
      console.error('[WA] Gagal kirim:', JSON.stringify(data));
      return { success: false, error: data };
    }
    return { success: true, data };
  } catch (err) {
    console.error('[WA] Error kirim pesan:', err);
    return { success: false, error: err.message };
  }
}

async function sendWhatsAppTemplate(to, templateName, languageCode, parameters = []) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { success: false, reason: 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID belum di-set' };
  if (!templateName) return { success: false, reason: 'WHATSAPP_OTP_TEMPLATE_NAME belum di-set' };
  try {
    const components = parameters.length ? [{
      type: 'body',
      parameters: parameters.map(value => ({ type: 'text', text: String(value) })),
    }] : [];
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode || 'en_US' },
            ...(components.length ? { components } : {}),
          },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error('[WA TEMPLATE] Gagal kirim:', JSON.stringify(data));
      return { success: false, error: data };
    }
    return { success: true, data };
  } catch (err) {
    console.error('[WA TEMPLATE] Error kirim:', err);
    return { success: false, error: err.message };
  }
}

module.exports = { sendWhatsApp, sendWhatsAppTemplate };
