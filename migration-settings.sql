-- =========================================================
-- Migrasi: tabel settings untuk popup promo (Ail Labs)
-- Jalankan SEKALI di database Railway kamu yang sudah ada.
-- Aman dijalankan berkali-kali (tidak akan menghapus/menimpa data).
-- =========================================================

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES (
  'promo_popup',
  '{
    "active": false,
    "badge": "Promo Spesial",
    "title": "Judul Promo Ail Labs",
    "subtitle": "Deskripsi singkat promo — ganti sesuai kebutuhan",
    "discount": "30%-50%",
    "note": "S&K berlaku. Chat admin untuk info lebih lanjut.",
    "whatsapp_number": "6287817391521",
    "whatsapp_message": "Halo Ail Labs, saya mau tanya soal promo",
    "reappear_hours": 24
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;
