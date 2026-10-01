#!/usr/bin/env bash
# Self-host React, ReactDOM, dan Motion supaya index.html lepas dari CDN.
# Jalankan ini SEKALI dari root repo (folder yang punya /vendor), pakai koneksi
# internet (Termux/laptop) — bukan di sandbox Claude.
#
# Pola: sama seperti /vendor/babel.min.js yang sudah ada — download sekali,
# commit ke repo, serve sebagai static file.

set -euo pipefail
mkdir -p vendor

echo "→ Mengunduh React 19.0.0 (ESM)..."
curl -fsSL "https://cdn.jsdelivr.net/npm/react@19.0.0/+esm" -o vendor/react.esm.js

echo "→ Mengunduh ReactDOM 19.0.0 (ESM, base — dependency internal ReactDOM client)..."
curl -fsSL "https://cdn.jsdelivr.net/npm/react-dom@19.0.0/+esm" -o vendor/react-dom.esm.js

echo "→ Mengunduh ReactDOM 19.0.0 client (ESM)..."
curl -fsSL "https://cdn.jsdelivr.net/npm/react-dom@19.0.0/client/+esm" -o vendor/react-dom-client.esm.js

echo "→ Mengunduh Motion 11 base (ESM, dependency internal motion/react)..."
curl -fsSL "https://cdn.jsdelivr.net/npm/motion@11/+esm" -o vendor/motion.esm.js

echo "→ Mengunduh Motion 11 untuk React (ESM)..."
curl -fsSL "https://cdn.jsdelivr.net/npm/motion@11/react/+esm" -o vendor/motion-react.esm.js

echo "→ Menambal referensi CDN DI DALAM file yang baru diunduh (supaya benar-benar putus, bukan cuma di index.html)..."
# Urutan penting: pola yang lebih spesifik (/client, /react) ditambal duluan,
# baru pola generik (bare package), supaya tidak salah tangkap.
for f in vendor/react-dom-client.esm.js vendor/motion-react.esm.js vendor/react-dom.esm.js vendor/motion.esm.js; do
  [ -f "$f" ] || continue
  sed -i -E \
    -e 's#https://cdn\.jsdelivr\.net/npm/react-dom@[^"'"'"']*/client/\+esm#/vendor/react-dom-client.esm.js#g' \
    -e 's#https://cdn\.jsdelivr\.net/npm/motion@[^"'"'"']*/react/\+esm#/vendor/motion-react.esm.js#g' \
    -e 's#https://cdn\.jsdelivr\.net/npm/react-dom@[^"'"'"']*/\+esm#/vendor/react-dom.esm.js#g' \
    -e 's#https://cdn\.jsdelivr\.net/npm/react@[^"'"'"']*/\+esm#/vendor/react.esm.js#g' \
    -e 's#https://cdn\.jsdelivr\.net/npm/motion@[^"'"'"']*/\+esm#/vendor/motion.esm.js#g' \
    "$f"
done

echo "→ Verifikasi: cari sisa referensi ke jsdelivr di dalam vendor/*.js (harus kosong)..."
if grep -rl "cdn.jsdelivr.net" vendor/*.js 2>/dev/null; then
  echo "⚠️  Masih ada referensi CDN di file di atas — cek manual, mungkin ada subpath lain yang belum ditambal."
else
  echo "✓ Bersih, tidak ada referensi cdn.jsdelivr.net tersisa di vendor/*.js"
fi

echo ""
echo "Selesai. File di ./vendor/:"
ls -la vendor/*.esm.js
echo ""
echo "Langkah selanjutnya:"
echo "1. Ganti index.html kamu dengan index.html yang sudah saya edit (lihat pesan chat)."
echo "2. git add vendor/*.esm.js index.html && git commit -m 'self-host react/react-dom/motion, putus CDN'"
echo "3. Deploy, lalu buka DevTools > Network di browser, pastikan tidak ada request ke cdn.jsdelivr.net."
