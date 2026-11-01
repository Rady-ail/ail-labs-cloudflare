#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  Script Update Foto Produk — AIL Labs
#  Jalankan di Termux, di dalam folder repo ~/ail-labs-katalog
# ============================================================

set -e  # kalau ada error, script langsung berhenti (biar ketahuan)

echo "=== 1. Masuk ke folder repo ==="
cd ~/ail-labs-katalog || { echo "GAGAL: folder ~/ail-labs-katalog tidak ditemukan"; exit 1; }

echo ""
echo "=== 2. Copy file dari Download ke repo ==="
cp ~/storage/downloads/mockups_flat.zip . 2>/dev/null || echo "  (mockups_flat.zip sudah ada di sini / dilewati)"
cp ~/storage/downloads/id_slug_mapping.json . 2>/dev/null || echo "  (id_slug_mapping.json sudah ada di sini / dilewati)"
cp ~/storage/downloads/update_foto_url.js . 2>/dev/null || echo "  (update_foto_url.js sudah ada di sini / dilewati)"

echo ""
echo "=== 3. Ekstrak foto ke public/images/products ==="
mkdir -p public/images/products
unzip -oq mockups_flat.zip -d public/images/products
JUMLAH_FOTO=$(ls public/images/products | wc -l)
echo "  Jumlah foto sekarang: $JUMLAH_FOTO"

if [ "$JUMLAH_FOTO" -lt 99 ]; then
  echo "  PERINGATAN: jumlah foto kurang dari 99. Cek ulang isi zip-nya."
fi

echo ""
echo "=== 4. Commit & push foto ==="
git add public/images/products
git commit -m "feat: tambah foto produk (99 file)" || echo "  (tidak ada perubahan foto untuk di-commit)"
git push origin main

echo ""
echo "=== 5. Install library pg (kalau belum ada) ==="
npm install pg --silent

echo ""
echo "=== 6. Update database ==="
echo "  Masukkan DATABASE_URL (connection string database kamu):"
read -r -p "  DATABASE_URL: " DB_URL

if [ -z "$DB_URL" ]; then
  echo "GAGAL: DATABASE_URL tidak boleh kosong."
  exit 1
fi

DATABASE_URL="$DB_URL" node update_foto_url.js

echo ""
echo "=== 7. Commit script & mapping ==="
git add id_slug_mapping.json update_foto_url.js
git commit -m "chore: script & mapping update foto produk" || echo "  (tidak ada perubahan untuk di-commit)"
git push origin main

echo ""
echo "============================================================"
echo " SELESAI! Cek situs kamu, foto produk harusnya sudah muncul."
echo "============================================================"
