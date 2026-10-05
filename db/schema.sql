-- =========================================================
-- Skema database AIL LABS Katalog (PostgreSQL)
-- Jalankan file ini sekali di database kamu (Supabase/Neon/dll)
-- =========================================================

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id            SERIAL PRIMARY KEY,
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kandungan     TEXT NOT NULL DEFAULT '',
  kemasan       TEXT NOT NULL DEFAULT '',
  harga         INTEGER NOT NULL DEFAULT 0,
  aktif         BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products USING gin (to_tsvector('simple', name || ' ' || kandungan));

CREATE TABLE IF NOT EXISTS orders (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER,
  customer_name   TEXT NOT NULL,
  note            TEXT DEFAULT '',
  items           JSONB NOT NULL,
  total           INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'baru', -- baru | diproses | selesai | batal
  payment_method  TEXT,
  payment_status  TEXT,
  paypal_order_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Produksi Neon terverifikasi: orders sudah memiliki customer_id,
-- payment_method, payment_status, dan paypal_order_id. ADD COLUMN di bawah
-- menjaga database lama tetap utuh bila schema.sql dijalankan ulang.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_order_id TEXT;

CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Tabel tambahan: pelacakan pengunjung & analytics
-- =========================================================

CREATE TABLE IF NOT EXISTS visitors (
  id              SERIAL PRIMARY KEY,
  session_id      TEXT UNIQUE NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  page_visited    TEXT DEFAULT '/',
  referrer        TEXT,
  entry_time      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity   TIMESTAMPTZ NOT NULL DEFAULT now(),
  exit_time       TIMESTAMPTZ,
  duration_ms     INTEGER DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_visitors_session ON visitors(session_id);
CREATE INDEX IF NOT EXISTS idx_visitors_active ON visitors(is_active);
CREATE INDEX IF NOT EXISTS idx_visitors_entry_time ON visitors(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_visitors_last_activity ON visitors(last_activity DESC);

CREATE TABLE IF NOT EXISTS page_views (
  id              SERIAL PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES visitors(session_id) ON DELETE CASCADE,
  page_path       TEXT NOT NULL,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms     INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pageviews_session ON page_views(session_id);
CREATE INDEX IF NOT EXISTS idx_pageviews_timestamp ON page_views(timestamp DESC);

CREATE TABLE IF NOT EXISTS user_events (
  id              SERIAL PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES visitors(session_id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL, -- 'view_product', 'add_to_cart', 'checkout_start', 'purchase', dll
  event_data      JSONB,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_events_session ON user_events(session_id);
CREATE INDEX IF NOT EXISTS idx_user_events_type ON user_events(event_type);
CREATE INDEX IF NOT EXISTS idx_user_events_timestamp ON user_events(timestamp DESC);

-- =========================================================
-- Tabel tambahan: pengaturan umum (dipakai untuk toggle & isi popup promo)
-- =========================================================

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nilai default popup promo (bisa diubah lewat tab "Promo" di admin panel)
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

-- Catatan: tabel daily_analytics, hourly_stats, product_analytics,
-- conversion_funnel, export_logs, system_logs dari schema-upgrade.sql
-- yang diupload TIDAK disertakan di sini karena tidak ada satu pun
-- route/endpoint yang menulis ke tabel-tabel tersebut (semua endpoint
-- analytics.js menghitung langsung dari visitors/page_views/user_events/
-- orders secara real-time). Tabel kosong yang tidak pernah diisi hanya
-- menambah kerumitan skema tanpa manfaat. Bisa ditambahkan nanti kalau
-- memang mau precompute/agregat harian untuk performa.


-- =========================================================
-- PRODUKSI NEON — inventory/schema compatibility record
-- =========================================================
-- Terverifikasi dari database produksi (2026-10-06): tabel berikut sudah ada
-- dan TIDAK boleh dihapus/recreate:
-- customers
-- pelanggan_broadcast
-- broadcast_campaigns
-- broadcast_antrian
-- broadcast_jadwal
-- broadcast_jadwal_antrean
-- promos
-- promo_broadcasts
-- kontak_customer
-- pelanggan_klinik
--
-- customers juga terverifikasi memiliki customer_type.
-- Definisi kolom lengkap tabel-tabel tersebut sengaja tidak ditebak di sini;
-- gunakan schema dump produksi sebagai sumber kebenaran sebelum menambah
-- CREATE TABLE baru untuk tabel tersebut.
--
-- Index yang aman/idempotent untuk query admin/order:
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_paypal_order_id ON orders(paypal_order_id) WHERE paypal_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_category_sort
  ON products(category_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_page_views_session_timestamp
  ON page_views(session_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_session_timestamp
  ON user_events(session_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_type_timestamp
  ON user_events(event_type, timestamp DESC);

-- =========================================================
-- INTEGRITY — tahap 2
-- =========================================================
-- Constraint memakai NOT VALID agar data legacy yang belum diaudit tidak
-- diblokir saat schema diterapkan. Constraint tetap berlaku untuk INSERT/UPDATE
-- baru. VALIDATE CONSTRAINT dilakukan setelah audit data produksi.
DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_harga_nonnegative'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_harga_nonnegative CHECK (harga >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_total_nonnegative'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_total_nonnegative CHECK (total >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_allowed'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_status_allowed
      CHECK (status IN ('baru', 'diproses', 'selesai', 'batal')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visitors_duration_nonnegative'
  ) THEN
    ALTER TABLE visitors
      ADD CONSTRAINT visitors_duration_nonnegative CHECK (duration_ms >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'page_views_duration_nonnegative'
  ) THEN
    ALTER TABLE page_views
      ADD CONSTRAINT page_views_duration_nonnegative CHECK (duration_ms >= 0) NOT VALID;
  END IF;
END $;

-- Catatan tahap 2:
-- Constraint ini sengaja belum VALIDATE. Audit produksi harus lebih dulu mencari
-- baris legacy yang melanggar aturan, lalu baris tersebut dibersihkan/diperbaiki
-- sebelum VALIDATE CONSTRAINT dijalankan.
-- Foreign key orders.customer_id -> customers(id) ditunda ke tahap 3 sampai
-- definisi produksi customers diverifikasi penuh.

-- Catatan indeks tahap 1:
-- Semua perubahan di atas bersifat additive dan idempotent.
-- Tidak mengubah data, tidak menambah foreign key baru, dan tidak mengasumsikan
-- struktur tabel produksi yang belum diverifikasi. Constraint/data cleanup
-- dilakukan pada tahap berikutnya setelah audit data produksi.
