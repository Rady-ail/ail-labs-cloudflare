BEGIN;

CREATE TABLE IF NOT EXISTS catalog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  group_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id INTEGER UNIQUE,
  category_id UUID REFERENCES catalog_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  kandungan TEXT,
  kemasan TEXT,
  manfaat TEXT,
  harga INTEGER CHECK (harga IS NULL OR harga >= 0),
  harga_asli INTEGER CHECK (harga_asli IS NULL OR harga_asli >= 0),
  aktif BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  foto_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_products_category_idx ON catalog_products (category_id);

CREATE TABLE IF NOT EXISTS catalog_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id INTEGER UNIQUE,
  customer_name TEXT,
  note TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'baru',
  payment_method TEXT,
  payment_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_orders_status_check CHECK (status IN ('baru','diproses','dikirim','selesai','batal'))
);
CREATE INDEX IF NOT EXISTS catalog_orders_status_idx ON catalog_orders (status, created_at DESC);

COMMIT;
