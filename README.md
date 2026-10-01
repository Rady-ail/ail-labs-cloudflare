# CLAUDE.md — ail-labs-katalog

Panduan perilaku untuk Claude saat mengerjakan repo ini. Digabung dari prinsip umum coding-agent (terinspirasi observasi Andrej Karpathy soal kesalahan umum LLM saat coding) + catatan khusus penggunaan library **Motion (motion.dev)** di proyek ini.

**Catatan:** panduan ini condong ke hati-hati daripada cepat. Untuk perubahan sepele, gunakan penilaian wajar.

## 1. Pikir dulu sebelum menulis kode

Jangan menebak diam-diam, jangan sembunyikan kebingungan, dan sampaikan trade-off secara terbuka.

- Nyatakan asumsi secara eksplisit sebelum mulai. Kalau ragu, tanya dulu.
- Kalau permintaan bisa ditafsirkan lebih dari satu cara, tawarkan opsinya — jangan pilih sendiri diam-diam.
- Kalau ada cara yang lebih sederhana, katakan itu, dan boleh membantah pendekatan yang diminta kalau memang beralasan.
- Kalau ada yang tidak jelas, berhenti sebentar, sebutkan apa yang membingungkan, lalu tanya.

## 2. Sesederhana mungkin

Kode seminimal mungkin yang menyelesaikan masalah — tidak lebih.

- Jangan menambah fitur di luar yang diminta.
- Jangan membuat abstraksi untuk kode yang cuma dipakai sekali.
- Jangan menambah "fleksibilitas"/"konfigurasi" yang tidak diminta.
- Jangan menangani skenario error yang mustahil terjadi.
- Kalau hasilnya 200 baris padahal bisa 50, tulis ulang lebih ringkas.

## 3. Perubahan yang presisi (surgical)

Sentuh hanya bagian yang benar-benar perlu diubah; rapikan hanya kekacauan yang kamu buat sendiri.

- Jangan "membenahi" kode, komentar, atau format di sekitarnya yang tidak diminta.
- Jangan refactor sesuatu yang belum rusak.
- Ikuti gaya kode yang sudah ada, meskipun kamu pribadi akan menulis dengan cara lain.
- Kalau nemu dead code yang tidak terkait, laporkan saja — jangan langsung dihapus.
- Kalau perubahanmu bikin sesuatu jadi tidak terpakai (import/variabel/fungsi), hapus yang itu saja.

Uji sederhana: setiap baris yang diubah harus bisa ditelusuri langsung ke permintaan pengguna.

## 4. Eksekusi berbasis kriteria sukses

Ubah setiap tugas menjadi kriteria yang bisa diverifikasi, lalu iterasi sampai terpenuhi.

- "Tambah validasi" → "Tulis test untuk input tidak valid, lalu buat sampai lolos."
- "Perbaiki bug" → "Tulis test yang mereproduksi bug-nya, lalu buat sampai lolos."
- "Refactor X" → "Pastikan test lolos sebelum dan sesudah perubahan."

Untuk tugas multi-langkah, nyatakan rencana singkat sebelum eksekusi:
```
1. [Langkah] → verifikasi: [pengecekan]
2. [Langkah] → verifikasi: [pengecekan]
```

---

## 5. Pakai Motion (motion.dev) di proyek ini
