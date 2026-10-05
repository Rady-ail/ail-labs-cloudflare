# CGI Visual — Status Pengerjaan (branch `feat/cgi-visual`)

Dihentikan atas permintaan (kuota). Tahap 0–5 sudah di-commit sebelum ada perubahan rencana; Tahap 6 ditutup dengan hasil uji yang sudah ada. Tahap baru tidak dimulai.

## Tahap selesai
| Tahap | Status | Commit |
|---|---|---|
| 0 Audit + baseline | selesai | (catatan di bawah) |
| 1 Fondasi: tier, reduced-motion, poster, lazy canvas + fallback WebGL | selesai | daeeb6e |
| 2 Hero 3D vial prosedural (three + R3F + drei) | selesai | 415890a |
| 3 Latar sinematik + reveal | selesai | 3abcf0c |
| 4 Kartu produk: tilt ≤6°, specular, tanpa backdrop-filter | selesai | 7922c40, d69dbee |
| 5 `_headers` cache/MIME | selesai | 987ba66 |
| Media hero (poster WebP + loop WebM/MP4 dari render scene) | selesai | fb30716 |
| 6 Review diri + uji penerimaan | sebagian (lihat "Perlu dicek") | — |

## Audit (Tahap 0)
- Tanpa bundler: `public/index.html` = JSX inline + Babel runtime (`/vendor/babel.min.js`), React 19 ESM dari jsDelivr, tanpa router, CSS di `public/styles/*.css` + inline. Data: `fetch('/api/products')`; harga `null` dari server bila status ≠ approved.
- Deploy: Cloudflare Worker + static assets (`wrangler.jsonc`, `src/worker.js`), CI `.github/workflows/deploy.yml` (`npm ci` → `wrangler deploy`, yang menjalankan `build.command`).

## Ukuran bundle
- Baseline (sebelum): tidak ada JS hasil build; total transfer halaman ±2.103 KiB (Lighthouse). Lighthouse mobile baseline: Perf 28–30, A11y 100, LCP 10,7–12,2 s, CLS 0,243–0,244, TBT 680–760 ms (penyebab utama: Babel runtime + Meta Pixel).
- Sesudah: `public/cgi/cgi-core.js` 5,1 KiB raw / **2,5 KB gzip** (anggaran 60 KB). Chunk 3D lazy `public/cgi/chunks/hero3d-*.js` 693 KiB raw / **192,9 KB gzip** (anggaran ~200 KB). Media: poster 8 KB, webm 178 KB, mp4 275 KB (anggaran 3 MB).
- Lighthouse mobile sesudah (2 run, mock lokal): Perf 33–45, A11y 100, LCP 4,1–7,7 s, CLS 0,30, TBT 1.010–1.070 ms.

## Keputusan yang diambil
- Build CGI terpisah dengan esbuild (`npm run build` → `public/cgi/`), lalu di-import dinamis dari App. Halaman tetap jalan dengan poster bila modul gagal dimuat.
- `three` dikunci di 0.182.0 (di 0.186 muncul warning deprecated `THREE.Clock` dari R3F 9.8).
- Post-processing (Bloom/DOF) tidak dipakai karena memakan anggaran chunk; diganti halo + vignette pada latar scene.
- Shell hero statis sebelum React dimuat (LCP = poster). WebGL tidak tersedia → video loop; tier rendah/reduced-motion → poster.
- Tier diturunkan otomatis bila renderer software (SwiftShader). Override uji: `?cgi-tier=low|medium|high`.
- Virtualisasi list tidak dibuat; dipakai `content-visibility: auto` pada `.row` (lebih sederhana).
- Motion tetap satu-satunya library animasi DOM; efek baru memakai CSS + IntersectionObserver.

## Bukti uji yang sudah ada
- `npm run build` + `npm run lint`: lolos.
- Lebar 360/390/768 (tier sedang) dan 1280/1440 (tier tinggi): `canvas:ready`, overflowX 0.
- Tier rendah → poster; WebGL mati → poster (tier otomatis) / video (tier dipaksa tinggi); reduced-motion → poster.
- Alur bisnis baseline vs sesudah (guest, incomplete, pending, rejected, blocked, approved: harga, modal, tambah keranjang, checkout WhatsApp): output **identik**, kecuali nomor invoice acak.
- `wrangler dev`: HTML `no-cache`, chunk `immutable`, poster `image/webp`.
- Console: tidak ada error/warning baru dari kode CGI (404/401 berasal dari mock lokal; warning Babel sudah ada sejak baseline).

## Perlu dicek / sisa tugas
1. **CLS naik dari 0,244 ke 0,30.** Shift yang sudah ada sejak baseline (header bertambah ±31 px saat React mount) kini menggeser area hero yang lebih tinggi. Shell `#cgiShell` belum persis sama dengan hero asli (`.cert-row` tidak ada, tinggi header beda 2 px). Perbaikan: samakan geometri shell dengan header/hero asli.
2. **TBT naik ±300 ms dan anggaran Lighthouse ≥80 / LCP <2,5 s belum tercapai.** Penyebab utamanya Babel runtime yang sudah ada sejak baseline. Memindahkannya ke prebuild adalah refactor di luar scope.
3. Uji scroll 300 produk dengan CPU throttle 4x belum selesai (mock N=300 + `scrollperf` disiapkan, tetapi tidak sempat dijalankan).
4. Uji di HP Android sungguhan (gyro, termal, FPS) belum dilakukan.
5. `wrangler dev` lokal butuh `--compatibility-date=2026-05-03` (binary lokal lebih lama). Konfigurasi produksi tidak diubah.
6. Belum ada PR dan blueprint environment belum di-update (Node 20 + `npm ci`).

## Mengganti poster/video hero dengan render asli
Timpa file di `public/cgi/media/` dengan nama yang sama: `hero-poster.webp` (±2:1, misalnya 1200×600, <100 KB), `hero-loop.webm` (VP9) dan `hero-loop.mp4` (H.264, `+faststart`), tanpa audio, total <3 MB. Untuk mengganti nama atau menghapus video, ubah `components/cgi/media.js` (isi `null` untuk mematikan video), lalu jalankan `npm run build`. Poster juga dirujuk di `public/index.html` (preload, shell, hero).
