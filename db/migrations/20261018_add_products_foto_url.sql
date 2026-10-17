-- Safe, additive migration: preserves all existing product records.
ALTER TABLE products ADD COLUMN IF NOT EXISTS foto_url TEXT;
