// jobs/broadcastScheduler.js
// Scheduler broadcast WhatsApp harian: tiap hari jam 08:00 WITA, ambil `per_hari`
// kontak SECARA ACAK dari sisa antrian tiap campaign yang masih berstatus 'berjalan',
// kirim personal satu-per-satu (jeda sesuai campaign, default 60 detik), lalu tandai
// campaign 'selesai' begitu tidak ada lagi kontak 'pending' di antriannya.
//
// Cara pakai: panggil sekali saat app start, di app.js:
//   require('./jobs/broadcastScheduler')();
//
// Perlu package node-cron: npm install node-cron --save
// (pakai --no-bin-links kalau folder project ada di shared storage Android/Termux
// dan npm install biasa gagal EPERM karena symlink .bin)

const cron = require('node-cron');
const pool = require('../db/pool');
const { tentukanSapaan, personalisasiPesan, kirimSatuPesan } = require('../utils/broadcastHelpers');

async function prosesSatuCampaign(campaign) {
  const { rows: antrian } = await pool.query(
    `SELECT id, nama, no_hp, kategori FROM broadcast_antrian
     WHERE campaign_id = $1 AND status = 'pending'
     ORDER BY RANDOM()
     LIMIT $2`,
    [campaign.id, campaign.per_hari]
  );

  if (!antrian.length) {
    // Tidak ada sisa antrian pending -> campaign dianggap selesai
    await pool.query(
      `UPDATE broadcast_campaigns SET status = 'selesai', selesai_at = now() WHERE id = $1`,
      [campaign.id]
    );
    console.log(`[broadcast-jadwal] Campaign #${campaign.id} selesai — semua kontak sudah diproses.`);
    return;
  }

  console.log(`[broadcast-jadwal] Campaign #${campaign.id}: mengirim ${antrian.length} kontak hari ini...`);

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

    await new Promise((r) => setTimeout(r, (campaign.jeda_detik || 60) * 1000));
  }
}

function mulaiScheduler() {
  // '0 8 * * *' = menit 0, jam 8, tiap hari — dengan timezone eksplisit Asia/Makassar (WITA)
  // supaya tidak terpengaruh timezone server Railway yang biasanya UTC.
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('[broadcast-jadwal] Menjalankan pengiriman harian...');
      try {
        const { rows: campaigns } = await pool.query(
          `SELECT id, pesan, per_hari, jeda_detik FROM broadcast_campaigns WHERE status = 'berjalan'`
        );
        for (const c of campaigns) {
          await prosesSatuCampaign(c);
        }
        console.log('[broadcast-jadwal] Selesai untuk hari ini.');
      } catch (err) {
        console.error('[broadcast-jadwal] Error menjalankan scheduler:', err);
      }
    },
    { timezone: 'Asia/Makassar' }
  );
  console.log('[broadcast-jadwal] Scheduler aktif — jalan tiap hari jam 08:00 WITA');
}

module.exports = mulaiScheduler;
