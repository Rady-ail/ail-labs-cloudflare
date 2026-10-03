const axios = require('axios');

const ZAPIER_ORDER_WEBHOOK_URL = process.env.ZAPIER_ORDER_WEBHOOK_URL;

/**
 * Kirim notifikasi order baru ke webhook Zapier (Catch Hook).
 * Zap di sisi Zapier: Trigger "Webhooks by Zapier" -> Action "WhatsApp Business: Send Template/Freeform Message".
 * Fungsi ini SENGAJA tidak melempar error ke pemanggil (fire-and-forget) supaya
 * kegagalan notifikasi WA tidak pernah menggagalkan proses checkout/order.
 */
async function notifyNewOrder(order) {
  if (!ZAPIER_ORDER_WEBHOOK_URL) {
    console.warn('[zapier-notify] ZAPIER_ORDER_WEBHOOK_URL belum di-set, notifikasi dilewati');
    return;
  }

  const payload = {
    order_id: order.id,
    customer_name: order.customer_name || '-',
    total: order.total,
    payment_method: order.payment_method || '-',
    payment_status: order.payment_status || '-',
    created_at: order.created_at || new Date().toISOString(),
  };

  try {
    await axios.post(ZAPIER_ORDER_WEBHOOK_URL, payload, { timeout: 8000 });
  } catch (err) {
    // Tidak dilempar ulang: notifikasi WA gagal tidak boleh menggagalkan order.
    console.error('[zapier-notify] Gagal kirim notifikasi order ke Zapier:', err.response?.data || err.message);
  }
}

module.exports = { notifyNewOrder };
