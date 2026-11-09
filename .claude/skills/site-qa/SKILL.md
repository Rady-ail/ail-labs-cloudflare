---
name: site-qa
description: Gunakan setelah mengubah halaman publik AIL LABS (public/*.html, CSS, JS) untuk membuktikan halaman benar-benar tampil: build audit, sajikan public/ secara lokal, jalankan smoke test Playwright (desktop + ponsel), lalu laporkan bukti. Bukan untuk menguji produksi tanpa izin.
---

# Site QA — bukti sebelum klaim selesai

Diadaptasi dari pola `webapp-testing` (anthropics/skills, Apache-2.0): uji statis lewat server lokal,
tunggu `networkidle`, tangkap console error, screenshot. Lihat `LICENSE.txt` di folder ini.

## Langkah
1. `npm run build` — audit integritas statis harus PASS.
2. Sajikan halaman statis: `python3 -m http.server 8788 --directory public` (background).
   Untuk API (`/api/products`) pakai `npx wrangler dev` dan arahkan `BASE_URL` ke port-nya.
3. `node .claude/skills/site-qa/smoke.js http://127.0.0.1:8788` — memakai Playwright yang sudah
   terpasang di lingkungan (bukan dependency repo; jangan `npm install playwright`).
4. Laporkan hasil apa adanya: halaman, status HTTP, console error, overflow horizontal, path screenshot.

## Aturan
- Jalankan terhadap localhost. Menguji domain produksi hanya jika user meminta.
- Error `fetch /api/...` saat hanya `http.server` berjalan = keterbatasan setup, sebutkan, jangan disembunyikan.
- Screenshot untuk dilihat orang: deviceScaleFactor 2; untuk pengecekan sendiri: 1.
