// jobs/broadcastScheduler.js
// Scheduler broadcast WhatsApp harian: tiap hari jam 08:00 WITA, ambil `per_hari`
// kontak SECARA ACAK dari sisa antrian tiap campaign yang masih berstatus 'berjalan',
// kirim personal satu-per-satu (jeda sesuai campaign, default 60 detik), lalu tandai
// campaign 'selesai' begitu tidak ada lagi kontak 'pending' di antriannya.
//
// Penjadwalan dijalankan oleh Cloudflare Workers Cron Trigger melalui
// src/worker.js; file ini hanya berisi logic yang dipanggil oleh handler scheduled.
// Jangan memanggil scheduler ini dari app startup agar broadcast tidak berjalan
// dua kali saat aplikasi dijalankan di lebih dari satu instance.

const pool = require('../db/pool');
const { tentukanSapaan, personalisasiPesan, kirimSatuPesan } = require('../utils/broadcastHelpers');

async function prosesSatuCampaign(campaign, maxContacts) {
  const { rows: sentTodayRows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM broadcast_antrian
     WHERE campaign_id = $1
       AND status = 'terkirim'
       AND (terkirim_at AT TIME ZONE 'Asia/Makassar')::date = (now() AT TIME ZONE 'Asia/Makassar')::date`,
    [campaign.id]
  );
  const sentToday = Number(sentTodayRows[0]?.count || 0);
  const remainingToday = Math.max(0, Number(campaign.per_hari || 0) - sentToday);
  if (remainingToday <= 0) return 0;

  const limit = Math.min(remainingToday, maxContacts);
  const { rows: antrian } = await pool.query(
    `SELECT id, nama, no_hp, kategori FROM broadcast_antrian
     WHERE campaign_id = $1 AND status = 'pending'
     ORDER BY RANDOM()
     LIMIT $2`,
    [campaign.id, limit]
  );

  if (!antrian.length) {
    await pool.query(
      `UPDATE broadcast_campaigns SET status = 'selesai', selesai_at = now() WHERE id = $1`,
      [campaign.id]
    );
    return 0;
  }

  for (const kontak of antrian) {
    const sapaan = tentukanSapaan(kontak.nama, kontak.kategori);
    const pesanPersonal = personalisasiPesan(campaign.pesan, sapaan);
    const { ok, hasil, error } = await kirimSatuPesan(kontak.no_hp, pesanPersonal);

    if (ok) {
      await pool.query(
        `UPDATE broadcast_antrian SET status = 'terkirim', terkirim_at = now() WHERE id = $1`,
        [kontak.id]
      );
      console.log(`[broadcast-jadwal] Terkirim ke ${kontak.nama} (${kontak.no_hp})`);
    } else {
      await pool.query(
        `UPDATE broadcast_antrian SET status = 'gagal', error = $2 WHERE id = $1`,
        [kontak.id, error || 'Gagal tidak diketahui']
      );
      console.error(`[broadcast-jadwal] Gagal ke ${kontak.nama} (${kontak.no_hp}):`, error, hasil);
    }

    if (antrian.indexOf(kontak) < antrian.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(Number(campaign.jeda_detik || 60), 60) * 1000));
    }
  }
  return antrian.length;
}

async function runScheduledBroadcasts({ maxContacts = 10 } = {}) {
  const { rows: campaigns } = await pool.query(
    `SELECT id, pesan, per_hari, jeda_detik
     FROM broadcast_campaigns
     WHERE status = 'berjalan'
     ORDER BY id`
  );
  let processed = 0;
  for (const campaign of campaigns) {
    if (processed >= maxContacts) break;
    processed += await prosesSatuCampaign(campaign, maxContacts - processed);
  }
  console.log(`[broadcast-jadwal] Cron run selesai: ${processed} kontak diproses.`);
  return { campaigns: campaigns.length, processed };
}

module.exports = { runScheduledBroadcasts };
