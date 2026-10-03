// utils/broadcastHelpers.js
// Fungsi-fungsi bersama untuk fitur broadcast WhatsApp, dipakai oleh:
// - routes/broadcast.js (kirim SEKARANG, POST /api/broadcast/send)
// - jobs/broadcastScheduler.js (kirim TERJADWAL harian)
// Disatukan di sini supaya aturan sapaan & format nomor konsisten di kedua jalur.
//
// Pengiriman pesan sekarang lewat WhatsApp Cloud API resmi (lib/whatsapp.js),
// bukan Fonnte lagi.

const { sendWhatsApp } = require('../lib/whatsapp');

// Ubah nomor lokal (08xx / +62xx) jadi format internasional (62xx) yang
// dipakai WhatsApp Cloud API.
// Mengembalikan null kalau nomornya jelas bukan nomor HP asli (kepanjangan/kependekan),
// supaya nomor sampah tidak ikut dikirimi.
function normalisasiNoHp(noHp) {
  const digits = String(noHp || '').replace(/\D/g, '');
  if (!digits) return null;

  let hasil;
  if (digits.startsWith('0')) hasil = '62' + digits.slice(1);
  else if (digits.startsWith('62')) hasil = digits;
  else hasil = '62' + digits;

  // Nomor HP Indonesia setelah prefix 62: umumnya 9-13 digit (total 11-15 digit termasuk '62')
  if (hasil.length < 11 || hasil.length > 15) return null;

  return hasil;
}

// Tentukan sapaan personal untuk tiap kontak, supaya pesan terasa ditulis manual
// (bukan blast massal), berdasarkan aturan:
// 1. Nama sudah mengandung gelar dokter (dr/DR)   -> sebut nama kontak apa adanya
// 2. Nama sudah mengandung gelar apoteker (apt)   -> sebut nama kontak apa adanya
// 3. Kategori/nama Klinik, Rumah Sakit, atau Apotek (badan usaha) -> "Ka Pengadaan <nama>"
// 4. Selain itu, termasuk kategori berformat singkatan yang tidak dikenali -> "Kak" saja
function tentukanSapaan(nama, kategori) {
  const namaTrim = String(nama || '').trim();
  const namaLower = namaTrim.toLowerCase();
  const kategoriLower = String(kategori || '').toLowerCase();

  if (/\bdr\.?\b/i.test(namaTrim)) return namaTrim;
  if (/\bapt\.?\b/i.test(namaTrim)) return namaTrim;

  const isBadanUsaha =
    /klinik|rumah\s*sakit|\brs\b|apotek/i.test(kategoriLower) ||
    /klinik|rumah\s*sakit|\brs\b|apotek/i.test(namaLower);
  if (isBadanUsaha) return `Ka Pengadaan ${namaTrim}`;

  return 'Kak';
}

// Sisipkan sapaan ke template pesan: kalau template memuat placeholder "{sapaan}",
// ganti di situ; kalau tidak ada, sapaan otomatis ditaruh di baris pertama.
function personalisasiPesan(template, sapaan) {
  const teks = String(template || '');
  return teks.includes('{sapaan}') ? teks.replace(/\{sapaan\}/g, sapaan) : `${sapaan},\n\n${teks}`;
}

// Kirim satu pesan WA ke satu nomor lewat WhatsApp Cloud API.
// Tidak pernah throw — selalu balikin { ok, hasil, error } supaya pemanggil
// (route /send maupun scheduler harian) tidak perlu try/catch berulang.
async function kirimSatuPesan(noHp, pesan) {
  const result = await sendWhatsApp(noHp, pesan);
  if (!result.success) {
    return {
      ok: false,
      hasil: result.data || null,
      error:
        result.reason ||
        (result.error && (result.error.error?.message || JSON.stringify(result.error))) ||
        'Gagal mengirim pesan',
    };
  }
  return { ok: true, hasil: result.data, error: null };
}

module.exports = {
  normalisasiNoHp,
  tentukanSapaan,
  personalisasiPesan,
  kirimSatuPesan,
};
