// routes/broadcast.js
// Endpoint KHUSUS ADMIN untuk broadcast WhatsApp ke pelanggan via WhatsApp Cloud API,
// menarik data dari tabel gabungan `pelanggan_broadcast`
// (isi dari kontak_customer + pelanggan_klinik + customers, sudah terklasifikasi per kategori).
// Mount di app.js: app.use('/api/broadcast', require('./routes/broadcast'));
//
// Perlu environment variable WHATSAPP_TOKEN & WHATSAPP_PHONE_NUMBER_ID di Railway
// (lihat lib/whatsapp.js). Fungsi normalisasi nomor & sapaan personal ada di
// utils/broadcastHelpers.js supaya bisa dipakai bareng oleh jobs/broadcastScheduler.js
// (pengiriman terjadwal harian).

const router = require('express').Router();
const pool = require('../db/pool');
const { requireAdmin } = require('./authMiddleware');
const {
  normalisasiNoHp,
  tentukanSapaan,
  personalisasiPesan,
  kirimSatuPesan,
} = require('../utils/broadcastHelpers');

router.use(requireAdmin);

// GET /api/broadcast/kategori -> daftar kategori pelanggan + total + berapa yang punya no HP valid
router.get('/kategori', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT kategori,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE no_hp IS NOT NULL AND no_hp <> '') AS ada_no_hp
       FROM pelanggan_broadcast
       GROUP BY kategori
       ORDER BY total DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Gagal mengambil daftar kategori broadcast:', err);
    res.status(500).json({ error: 'Gagal mengambil daftar kategori' });
  }
});

// GET /api/broadcast/pelanggan?kategori=Apotek -> daftar pelanggan (opsional filter kategori)
// hanya yang punya no HP, karena inilah yang bisa dikirimi broadcast.
router.get('/pelanggan', async (req, res) => {
  try {
    const { kategori } = req.query;
    const { rows } = kategori
      ? await pool.query(
          `SELECT id, nama, no_hp, alamat, kategori, sumber_tabel
           FROM pelanggan_broadcast
           WHERE kategori = $1 AND no_hp IS NOT NULL AND no_hp <> ''
           ORDER BY nama`,
          [kategori]
        )
      : await pool.query(
          `SELECT id, nama, no_hp, alamat, kategori, sumber_tabel
           FROM pelanggan_broadcast
           WHERE no_hp IS NOT NULL AND no_hp <> ''
           ORDER BY kategori, nama`
        );
    res.json(rows);
  } catch (err) {
    console.error('Gagal mengambil daftar pelanggan broadcast:', err);
    res.status(500).json({ error: 'Gagal mengambil daftar pelanggan' });
  }
});

// GET /api/broadcast/kontak?kategori=&search= -> daftar SEMUA kontak untuk halaman kelola kontak
// (beda dari /pelanggan yang khusus untuk target kirim broadcast dan cuma ambil yang punya no HP valid)
router.get('/kontak', async (req, res) => {
  try {
    const { kategori, search } = req.query;
    const params = [];
    let query = `SELECT id, nama, no_hp, alamat, kategori, sumber_tabel, created_at
                 FROM pelanggan_broadcast WHERE 1=1`;
    if (kategori) {
      params.push(kategori);
      query += ` AND kategori = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND nama ILIKE $${params.length}`;
    }
    query += ` ORDER BY kategori, nama`;
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Gagal mengambil daftar kontak:', err);
    res.status(500).json({ error: 'Gagal mengambil daftar kontak' });
  }
});

// POST /api/broadcast/kontak -> tambah kontak baru secara manual dari admin panel
// (mis. dokter estetika baru). Kategori bebas teks, jadi kategori baru langsung
// otomatis muncul di daftar kategori broadcast begitu kontak ini tersimpan.
router.post('/kontak', async (req, res) => {
  try {
    const { nama, no_hp, alamat, kategori } = req.body;
    if (!nama || !String(nama).trim()) {
      return res.status(400).json({ error: 'Nama wajib diisi' });
    }
    if (!kategori || !String(kategori).trim()) {
      return res.status(400).json({ error: 'Kategori wajib diisi' });
    }
    const { rows } = await pool.query(
      `INSERT INTO pelanggan_broadcast (nama, no_hp, alamat, kategori, sumber_tabel)
       VALUES ($1, $2, $3, $4, 'manual')
       RETURNING id, nama, no_hp, alamat, kategori, sumber_tabel, created_at`,
      [
        String(nama).trim(),
        no_hp ? String(no_hp).trim() : null,
        alamat ? String(alamat).trim() : null,
        String(kategori).trim(),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Gagal menambah kontak:', err);
    res.status(500).json({ error: 'Gagal menambah kontak' });
  }
});

// PUT /api/broadcast/kontak/:id -> ubah kontak yang sudah ada
router.put('/kontak/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, no_hp, alamat, kategori } = req.body;
    if (!nama || !String(nama).trim()) {
      return res.status(400).json({ error: 'Nama wajib diisi' });
    }
    if (!kategori || !String(kategori).trim()) {
      return res.status(400).json({ error: 'Kategori wajib diisi' });
    }
    const { rows } = await pool.query(
      `UPDATE pelanggan_broadcast
       SET nama=$1, no_hp=$2, alamat=$3, kategori=$4
       WHERE id=$5
       RETURNING id, nama, no_hp, alamat, kategori, sumber_tabel, created_at`,
      [
        String(nama).trim(),
        no_hp ? String(no_hp).trim() : null,
        alamat ? String(alamat).trim() : null,
        String(kategori).trim(),
        id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kontak tidak ditemukan' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Gagal mengubah kontak:', err);
    res.status(500).json({ error: 'Gagal mengubah kontak' });
  }
});

// DELETE /api/broadcast/kontak/:id -> hapus kontak
router.delete('/kontak/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query(`DELETE FROM pelanggan_broadcast WHERE id=$1`, [id]);
    if (!rowCount) return res.status(404).json({ error: 'Kontak tidak ditemukan' });
    res.json({ success: true });
  } catch (err) {
    console.error('Gagal menghapus kontak:', err);
    res.status(500).json({ error: 'Gagal menghapus kontak' });
  }
});

// Ambil daftar kontak valid (sudah dinormalisasi no HP-nya) untuk kategori/ids tertentu.
// Dipakai bareng oleh /send (kirim sekarang) dan /jadwal (kirim terjadwal).
async function ambilKontakValid({ kategori, ids }) {
  let query = `SELECT id, nama, no_hp, kategori FROM pelanggan_broadcast WHERE no_hp IS NOT NULL AND no_hp <> ''`;
  const params = [];

  if (Array.isArray(ids) && ids.length) {
    params.push(ids);
    query += ` AND id = ANY($${params.length})`;
  } else if (Array.isArray(kategori) && kategori.length) {
    params.push(kategori);
    query += ` AND kategori = ANY($${params.length})`;
  } else {
    return { error: 'Pilih kategori atau daftar pelanggan tujuan terlebih dahulu' };
  }

  const { rows: penerima } = await pool.query(query, params);

  const kontakValid = [];
  const dilewati = [];
  for (const p of penerima) {
    const n = normalisasiNoHp(p.no_hp);
    if (n) kontakValid.push({ ...p, no_hp: n });
    else dilewati.push({ id: p.id, nama: p.nama, no_hp: p.no_hp });
  }
  return { kontakValid, dilewati };
}

// POST /api/broadcast/send
// body: { kategori?: string[], ids?: number[], message: string, delay?: string }
// Kirim pesan PERSONAL (sapaan beda tiap kontak, lihat tentukanSapaan) SEKARANG JUGA
// ke seluruh pelanggan pada kategori (atau id) yang dipilih, satu-per-satu via WhatsApp Cloud API.
//
// Kenapa tidak dikirim sekaligus lewat satu request?
// Karena tiap kontak butuh sapaan berbeda ("Ka Pengadaan ...", "Kak", atau nama apa
// adanya untuk dr/apt) supaya terasa personal, bukan blast. Tulis "{sapaan}" di mana
// saja pada isi pesan untuk menyisipkan sapaan tsb; kalau admin tidak menulis
// placeholder itu, sapaan otomatis ditambahkan di baris pertama.
//
// Progres pengiriman dicatat ke tabel broadcast_campaigns/broadcast_antrian yang sama
// dengan broadcast terjadwal (dibedakan lewat kolom `tipe`='langsung'), supaya bisa
// dipantau dari daftar & log yang sama di GET /jadwal dan GET /jadwal/:id/log —
// bukan cuma nongol di log server seperti versi sebelumnya.
//
// Untuk broadcast besar (ratusan kontak) yang mau dicicil tiap hari, pakai
// POST /api/broadcast/jadwal sebagai gantinya — lihat di bawah.
router.post('/send', async (req, res) => {
  try {
    const { kategori, ids, message, delay, confirm_opt_in } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }
    if (confirm_opt_in !== true) {
      return res.status(400).json({ error: 'Konfirmasi opt-in wajib. Pastikan setiap penerima telah memberi izin menerima pesan WhatsApp AIL LABS.' });
    }

    const { kontakValid, dilewati, error } = await ambilKontakValid({ kategori, ids });
    if (error) return res.status(400).json({ error });
    if (!kontakValid.length) {
      return res.status(404).json({ error: 'Tidak ada pelanggan dengan nomor HP valid pada kategori/tujuan ini' });
    }

    // Jeda antar pesan (detik) — dibuat cukup lama (default 100 dtk) supaya pengiriman
    // terlihat manusiawi/bertahap, bukan blast massal dalam sekejap.
    const jedaInput = Number(delay) > 0 ? Number(delay) : 100;
    const jedaDetik = Math.max(10, Math.min(jedaInput, 3600));

    // Catat campaign 'langsung' + seluruh antrian kontak ke DB dulu (status 'pending'),
    // supaya progres bisa dipantau real-time walau baru mulai kirim.
    const client = await pool.connect();
    let campaignId;
    try {
      await client.query('BEGIN');
      const { rows: campaignRows } = await client.query(
        `INSERT INTO broadcast_campaigns (pesan, per_hari, jeda_detik, status, tipe)
         VALUES ($1, $2, $3, 'berjalan', 'langsung') RETURNING id`,
        [String(message), kontakValid.length, jedaDetik]
      );
      campaignId = campaignRows[0].id;
      for (const k of kontakValid) {
        await client.query(
          `INSERT INTO broadcast_antrian (campaign_id, kontak_id, nama, no_hp, kategori, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [campaignId, k.id, k.nama, k.no_hp, k.kategori]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Kirim satu-per-satu DI BACKGROUND (tidak di-await di sini). Kalau di-await,
    // request dari admin panel akan menggantung selama total durasi pengiriman
    // (jumlah kontak x jeda detik), yang bisa bermenit-menit bahkan berjam-jam.
    (async () => {
      const { rows: antrian } = await pool.query(
        `SELECT id, nama, no_hp, kategori FROM broadcast_antrian WHERE campaign_id = $1 ORDER BY id`,
        [campaignId]
      );
      for (const kontak of antrian) {
        const sapaan = tentukanSapaan(kontak.nama, kontak.kategori);
        const pesanPersonal = personalisasiPesan(message, sapaan);
        const { ok, hasil, error: errKirim } = await kirimSatuPesan(kontak.no_hp, pesanPersonal);
        if (ok) {
          await pool.query(
            `UPDATE broadcast_antrian SET status = 'terkirim', terkirim_at = now() WHERE id = $1`,
            [kontak.id]
          );
          console.log(`Broadcast terkirim ke ${kontak.nama} (${kontak.no_hp})`);
        } else {
          await pool.query(
            `UPDATE broadcast_antrian SET status = 'gagal', error = $2 WHERE id = $1`,
            [kontak.id, errKirim || 'Gagal tidak diketahui']
          );
          console.error(`Broadcast gagal ke ${kontak.nama} (${kontak.no_hp}):`, errKirim, hasil);
        }
        await new Promise((r) => setTimeout(r, jedaDetik * 1000));
      }
      await pool.query(
        `UPDATE broadcast_campaigns SET status = 'selesai', selesai_at = now() WHERE id = $1`,
        [campaignId]
      );
      console.log(`Broadcast selesai diproses: ${antrian.length} pesan personal.`);
    })();

    res.json({
      status: 'diproses',
      campaign_id: campaignId,
      jumlah_penerima: kontakValid.length,
      jeda_detik: jedaDetik,
      estimasi_durasi_menit: Math.round((kontakValid.length * jedaDetik) / 60),
      dilewati_no_hp_tidak_valid: dilewati,
      catatan:
        'Pesan dikirim satu per satu secara personal di background sesuai jeda; progres & status tiap kontak bisa dipantau di daftar Broadcast Terjadwal Harian.',
    });
  } catch (err) {
    console.error('Gagal memulai broadcast:', err);
    res.status(500).json({ error: 'Gagal memulai broadcast' });
  }
});


// ================== BROADCAST TERJADWAL HARIAN ==================
// Perlu tabel broadcast_campaigns & broadcast_antrian (lihat migrations/create_broadcast_jadwal.sql)
// dan scheduler jobs/broadcastScheduler.js yang dijalankan sekali saat app start.

// POST /api/broadcast/jadwal
// body: { kategori?: string[], ids?: number[], message: string, per_hari?: number, jeda_detik?: number }
// SATU KLIK: simpan seluruh kontak yang cocok (bisa ratusan) ke antrian database.
// Scheduler otomatis mengirim `per_hari` kontak (default 10) SECARA ACAK tiap hari
// jam 08:00 WITA, sampai antrian habis, lalu campaign ditandai selesai.
router.post('/jadwal', async (req, res) => {
  try {
    const { kategori, ids, message, per_hari, jeda_detik, confirm_opt_in } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }
    if (confirm_opt_in !== true) {
      return res.status(400).json({ error: 'Konfirmasi opt-in wajib. Pastikan setiap penerima telah memberi izin menerima pesan WhatsApp AIL LABS.' });
    }

    const { kontakValid, dilewati, error } = await ambilKontakValid({ kategori, ids });
    if (error) return res.status(400).json({ error });
    if (!kontakValid.length) {
      return res.status(404).json({ error: 'Tidak ada pelanggan dengan nomor HP valid pada kategori/tujuan ini' });
    }

    const perHariFinal = Number(per_hari) > 0 ? Number(per_hari) : 40;
    const jedaInput = Number(jeda_detik) > 0 ? Number(jeda_detik) : 60;
    const jedaFinal = Math.max(30, Math.min(jedaInput, 3600));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: campaignRows } = await client.query(
        `INSERT INTO broadcast_campaigns (pesan, per_hari, jeda_detik, status, tipe)
         VALUES ($1, $2, $3, 'berjalan', 'terjadwal') RETURNING id`,
        [String(message), perHariFinal, jedaFinal]
      );
      const campaignId = campaignRows[0].id;

      for (const k of kontakValid) {
        await client.query(
          `INSERT INTO broadcast_antrian (campaign_id, kontak_id, nama, no_hp, kategori, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [campaignId, k.id, k.nama, k.no_hp, k.kategori]
        );
      }
      await client.query('COMMIT');

      res.status(201).json({
        campaign_id: campaignId,
        jumlah_kontak: kontakValid.length,
        per_hari: perHariFinal,
        estimasi_hari: Math.ceil(kontakValid.length / perHariFinal),
        jadwal_kirim: 'Setiap hari jam 08:00 WITA, kontak diacak ulang tiap harinya',
        dilewati_no_hp_tidak_valid: dilewati,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Gagal membuat jadwal broadcast:', err);
    res.status(500).json({ error: 'Gagal membuat jadwal broadcast' });
  }
});

// GET /api/broadcast/jadwal -> daftar semua campaign (terjadwal harian MAUPUN kirim
// langsung, dibedakan lewat kolom `tipe`) + ringkasan progres pengiriman tiap campaign
router.get('/jadwal', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.pesan, c.per_hari, c.jeda_detik, c.status, c.tipe, c.dibuat_at, c.selesai_at,
              COUNT(a.id) AS total_kontak,
              COUNT(a.id) FILTER (WHERE a.status = 'terkirim') AS sudah_terkirim,
              COUNT(a.id) FILTER (WHERE a.status = 'gagal') AS gagal,
              COUNT(a.id) FILTER (WHERE a.status = 'pending') AS sisa
       FROM broadcast_campaigns c
       LEFT JOIN broadcast_antrian a ON a.campaign_id = c.id
       GROUP BY c.id
       ORDER BY c.dibuat_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Gagal mengambil daftar jadwal broadcast:', err);
    res.status(500).json({ error: 'Gagal mengambil daftar jadwal broadcast' });
  }
});

// GET /api/broadcast/jadwal/:id/log -> daftar detail per kontak untuk satu campaign
// (nama, no HP, status terkirim/gagal/pending, waktu terkirim, pesan error kalau gagal)
// dipakai untuk indikator pemantauan pengiriman di admin panel.
router.get('/jadwal/:id/log', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id, nama, no_hp, kategori, status, terkirim_at, error
       FROM broadcast_antrian
       WHERE campaign_id = $1
       ORDER BY
         CASE status WHEN 'gagal' THEN 0 WHEN 'terkirim' THEN 1 ELSE 2 END,
         terkirim_at DESC NULLS LAST,
         nama`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Gagal mengambil log pengiriman broadcast:', err);
    res.status(500).json({ error: 'Gagal mengambil log pengiriman broadcast' });
  }
});

// POST /api/broadcast/jadwal/:id/batalkan -> hentikan campaign (sisa kontak pending tidak akan dikirim lagi)
router.post('/jadwal/:id/batalkan', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE broadcast_campaigns SET status = 'dibatalkan' WHERE id = $1 AND status = 'berjalan' RETURNING id`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Jadwal tidak ditemukan atau sudah tidak berjalan' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Gagal membatalkan jadwal broadcast:', err);
    res.status(500).json({ error: 'Gagal membatalkan jadwal broadcast' });
  }
});

module.exports = router;
