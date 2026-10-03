const axios = require('axios');

const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
const FONNTE_URL = 'https://api.fonnte.com/send';

async function sendWhatsAppBroadcast(targets, message, imageUrl = null) {
  if (!FONNTE_TOKEN) {
    throw new Error('FONNTE_TOKEN belum di-set di environment variables');
  }
  if (!targets || targets.length === 0) {
    return { success: false, message: 'Tidak ada target nomor WA' };
  }

  const payload = {
    target: targets.join(','),
    message,
    countryCode: '62',
  };
  if (imageUrl) payload.url = imageUrl;

  try {
    const response = await axios.post(FONNTE_URL, payload, {
      headers: { Authorization: FONNTE_TOKEN },
    });
    return response.data;
  } catch (err) {
    console.error('Fonnte broadcast error:', err.response?.data || err.message);
    throw err;
  }
}

function normalizePhoneNumber(phone) {
  if (!phone) return null;
  let clean = phone.replace(/[\s\-()]/g, '');
  if (clean.startsWith('+62')) clean = clean.slice(1);
  else if (clean.startsWith('0')) clean = '62' + clean.slice(1);
  else if (!clean.startsWith('62')) clean = '62' + clean;
  return clean;
}

async function broadcastInChunks(targets, message, imageUrl = null, chunkSize = 100, delayMs = 2000) {
  const results = [];
  for (let i = 0; i < targets.length; i += chunkSize) {
    const chunk = targets.slice(i, i + chunkSize);
    const result = await sendWhatsAppBroadcast(chunk, message, imageUrl);
    results.push(result);
    if (i + chunkSize < targets.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

module.exports = { sendWhatsAppBroadcast, normalizePhoneNumber, broadcastInChunks };	

