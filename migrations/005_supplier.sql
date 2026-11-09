BEGIN;

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT,
  contact TEXT,
  channel TEXT,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  terms TEXT,
  note TEXT,
  last_activity_on DATE,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT suppliers_category_check CHECK (
    category IN (
      'skincare_oem',
      'raw_material',
      'device_microneedling',
      'filler',
      'alkes',
      'aesthetic_wholesale',
      'kosmetik_brand',
      'led_device',
      'suplemen',
      'other'
    )
  ),

  CONSTRAINT suppliers_status_check CHECK (
    status IN (
      'kandidat',
      'menunggu_balasan',
      'sampel_berjalan',
      'menunggu_dokumen',
      'menunggu_izin',
      'menunggu_pembayaran',
      'hold',
      'ditolak_supplier',
      'ditutup'
    )
  )
);

CREATE TABLE IF NOT EXISTS supplier_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL
    REFERENCES suppliers(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'diminta',
  awb TEXT,
  courier TEXT,
  eta DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT supplier_samples_state_check CHECK (
    state IN (
      'diminta',
      'disepakati',
      'dikirim',
      'diterima',
      'diuji',
      'ditolak'
    )
  )
);

CREATE INDEX IF NOT EXISTS suppliers_status_idx
  ON suppliers(status);

CREATE INDEX IF NOT EXISTS suppliers_category_idx
  ON suppliers(category);

CREATE INDEX IF NOT EXISTS supplier_samples_supplier_state_idx
  ON supplier_samples(supplier_id, state);

COMMIT;
