-- Migrasi: kategori pelanggan + template promo per kategori
-- Aman dijalankan berkali-kali

ALTER TABLE customers ADD COLUMN IF NOT EXISTS kategori TEXT NOT NULL DEFAULT 'lainnya';

CREATE TABLE IF NOT EXISTS promo_templates (
  id          SERIAL PRIMARY KEY,
  kategori    TEXT NOT NULL,
  judul       TEXT NOT NULL,
  pesan       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_broadcasts (
  id            SERIAL PRIMARY KEY,
  kategori      TEXT[] NOT NULL,
  judul         TEXT,
  pesan         TEXT NOT NULL,
  total_target  INTEGER NOT NULL,
  hasil         JSONB,
  sent_by       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
