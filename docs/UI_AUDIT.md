# AIL LABS Customer UI Audit (P0)

Tanggal audit: 2026-10-03
Branch: `ui/b2b-rebuild`
Baseline commit: `b8ce9e8` (`Replace catalog UI emoji icons`)

## Ringkasan

Audit dibatasi ke katalog pelanggan dan konfigurasi deployment yang melayaninya. Belum ada perubahan UI, klaim, autentikasi, checkout, pembayaran, API, atau database.

| Area | Temuan |
| --- | --- |
| Stack | Node.js 24 di container; Express 4, React 19 JSX, Babel Standalone, PostgreSQL via Neon serverless. Cloudflare Worker dan Netlify juga dikonfigurasi. |
| UI pelanggan | Satu dokumen utama `public/index.html`; sekitar 1.000 baris dengan CSS dan JSX inline. Event interaksi memakai prop React `onClick`, bukan atribut HTML inline. |
| Boot React | `public/vendor/babel.min.js` dipakai, tetapi React/ReactDOM diimpor dari jsDelivr melalui `<script type="text/babel" data-type="module">`; bukan dari `public/vendor`. Asumsi bahwa entry React adalah non-module tidak sesuai implementasi saat ini. |
| Motion | Motion dimuat dinamis dari jsDelivr di hook lokal dan UI memiliki fallback statis jika CDN gagal. Belum ada `window.motionXxx`; tidak ditemukan efek tilt/parallax produk. |
| Styling | CSS campuran inline dan `/styles/glassmorphism-enhanced.css`; override inline membangun latar gelap dan glassmorphism. Terdapat token lama, nilai warna hardcoded, serta breakpoint utama 768px dan 380px. |
| Font/icon | Montserrat dan Fraunces dari Google Fonts, dengan system fallback; ikon berupa SVG inline satu set lokal. |
| Data dan akun | `GET /api/products` mengirim kelompok kategori dengan item array lama `[nama, kandungan, kemasan, harga]`; server mengirim harga `null` kecuali status `approved`. Status akun mengikuti `incomplete → pending → approved/rejected/blocked`. |
| Session | `cookie-session` dipakai bila `SESSION_SECRET` tersedia. Tanpa secret aplikasi lokal memasang session kosong; autentikasi Google juga butuh konfigurasi environment. |
| Deployment | Custom domain Cloudflare Worker `https://ail-aesthetic-labs.my.id`; konfigurasi Netlify dan entry Express/Node tersedia. Static assets di-cache satu hari oleh Express. |

## Baseline yang Dijalankan

- `node -c server.js`: lulus.
- `npm start`: server berjalan di port 3000.
- Lokal: `/` dan `/vendor/babel.min.js` memberi HTTP 200; `/api/products` memberi HTTP 500 karena `DATABASE_URL` tidak tersedia di container. Nilai environment tidak dicetak.
- Produksi: HTTPS root, `/api/products`, `/images/logo.png`, dan `/vendor/babel.min.js` memberi HTTP 200. Root mengikuti HTTPS dan menyajikan title `ail labs — Katalog` serta favicon. Tidak ditemukan meta description atau Open Graph pada HTML produksi.
- Environment lokal: `DATABASE_URL`, `SESSION_SECRET`, kredensial Google, dan kredensial PayPal tidak tersedia. Login, database-backed flows, dan checkout tidak dapat diregresikan secara lokal.
- Tidak tersedia Chromium/Firefox, Playwright/Puppeteer, Lighthouse, atau axe di environment ini. Karena itu audit ini tidak mengklaim hasil console/network browser, screenshot, pengukuran overflow di viewport target, Lighthouse, axe, FPS, long task, atau CLS/INP. Verifikasi tersebut masih wajib sebelum rilis.

## Jalur dan Perilaku yang Ditemukan

- `app.js` memasang `attachCustomer`, route customer auth/products/orders/PayPal, lalu static `public/`; `/admin` juga disajikan oleh proses yang sama dan berada di luar scope perubahan.
- `routes/products.js` memakai Neon, cache terpisah guest/approved, dan menyaring harga server-side. Request lokal gagal hanya karena database URL tidak disetel; endpoint produksi merespons.
- Pencarian saat ini filter lokal kategori, nama, dan kandungan. Tidak ada debounce, pencarian brand/keywords API, state loading/error dengan retry, atau shortcut kategori untuk hasil kosong yang ditemukan.
- Gagal memuat katalog ditangkap lalu katalog di-set kosong; UI tidak membedakan kegagalan API dari katalog kosong dan tidak menyediakan retry.
- Pembelian/keranjang dan PayPal tersedia untuk pelanggan approved; WhatsApp menangani pemesanan dan konfirmasi pembayaran. Tidak ditemukan form RFQ terstruktur atau endpoint penyimpanan RFQ.
- Pembayaran menampilkan BCA, pemilik rekening, nomor rekening, tombol salin, dan konfirmasi via WhatsApp. Data ini tidak diubah. Verifikasi kepemilikan/keabsahan rekening tidak dapat dilakukan dari source.
- Kontak menampilkan nama perusahaan dan email. Disclaimer formal, alamat, dan nomor WhatsApp pelanggan yang terpisah tidak ditemukan sebagai bagian identitas perusahaan; nomor WhatsApp hardcoded ada di script, sehingga konfigurasi perusahaan belum terpusat.
- Elemen dengan harga di kartu menampilkan CTA generik berdasar ada/tidaknya `currentUser`; modal pembelian dibatasi ke `approved`. Status incomplete/pending/rejected/blocked belum diberi presentasi terpisah secara konsisten.
- CSS eksternal memuat aturan `prefers-reduced-motion`; belum diverifikasi perilaku seluruh transisi inline/React terhadap reduced motion. Tidak ada hasil ukur aksesibilitas keyboard/modal.
- Inventaris image mencakup aset produk besar dan dua berkas gambar berukuran 0 byte. Rasio/dimensi, kecocokan URL produk, serta dampaknya pada CLS belum diuji di browser.

## Audit Klaim Trust

Status di bawah menilai bagaimana klaim dipresentasikan pada UI dan apakah bukti pengait ke produk/perusahaan tersedia di repo. Audit ini bukan pemeriksaan legal atau sertifikasi eksternal.

| Klaim yang tampil/tersirat | Status | Dasar |
| --- | --- | --- |
| Badge `GMP`, `BPOM`, `CE`, `ISO 22716`, `FDA` di hero | MISLEADING | Ditampilkan sebagai satu set badge generik tanpa nama produk/manufaktur, nomor registrasi, dokumen, atau hubungan ke data katalog. Tidak dapat diperlakukan sebagai bukti sertifikasi portofolio. |
| “bahan baku bersertifikat internasional” | MISLEADING | Klaim menyeluruh pada hero, tanpa bukti atau pemetaan sertifikat di data produk. |
| “B2B Aesthetic Distributor Partner” | UNVERIFIED | Tampil sebagai positioning; tidak ditemukan bukti status distributor/otorisasi di UI atau file yang diaudit. |
| “B2B Private Label Manufacturing” | UNVERIFIED | Tampil sebagai layanan; fasilitas/kapasitas/otorisasi tidak dibuktikan oleh UI atau file yang diaudit. |
| PT Fudhail Aesthetic Laboratories, email, dan rekening perusahaan | UNVERIFIED | Nilai statis tersedia di UI, tetapi identitas legal dan penerima rekening tidak diverifikasi terhadap sumber resmi. Copy pembayaran menyebut rekening “resmi” perusahaan. |
| Klaim jumlah praktisi/dokter/klinik, lisensi PBF/importir, dan cakupan wilayah | Tidak ditemukan | Tidak ditemukan klaim angka, lisensi, atau coverage tersebut pada customer UI yang diperiksa. |

Tidak ada klaim yang dihapus atau direword pada P0. Perubahan klaim memerlukan konfirmasi owner per klaim sebelum P4.

## Risiko dan Gerbang Sebelum Implementasi Berikutnya

1. Minta owner memvalidasi klaim sertifikasi per produk/manufaktur dan copy identitas/rekening sebelum mengubahnya; jangan menampilkan badge generik sebagai bukti perusahaan.
2. Minta data perusahaan yang disetujui untuk satu konfigurasi identitas. Informasi pembayaran tetap konfigurasi/section terpisah dan tidak boleh diubah tanpa persetujuan.
3. RFQ yang disimpan memerlukan rancangan tabel/endpoint dan persetujuan migrasi terlebih dahulu. Jangan membuat migration atau mengumpulkan PII sebelum disetujui.
4. Siapkan konfigurasi lokal non-produksi yang sah untuk menguji DB, customer status, Google OAuth, PayPal, receipt, dan alur admin. Jangan menyalin atau mengekspos secret produksi.
5. Sediakan browser automation di environment atau jalankan pengukuran pada environment yang memilikinya untuk menutup seluruh viewport, screenshot, network/console, aksesibilitas, dan performa yang diminta.

## Keputusan Owner yang Masih Terbuka

- Apakah Fraunces dipertahankan hanya untuk display atau seluruhnya memakai Montserrat.
- Copy/legal identity dan klaim yang disetujui, termasuk apakah section Corporate/Disclaimer perlu ditampilkan.
- Data perusahaan yang boleh dipusatkan dan nomor WhatsApp yang disetujui.
- Apakah RFQ wajib disimpan; jika ya, persetujuan skema/endpoint diperlukan sebelum implementasi.
- Environment aman untuk regression Google login, role/status, database, PayPal, dan receipt.