-- 006: tahap SOP supplier, gerbang dokumen/pembayaran, dan penawaran landed cost tersimpan.
-- Aditif saja: tidak mengubah atau menghapus kolom/tabel yang ada. Aman dijalankan ulang.
-- Prasyarat: 004_operations.sql. Ambil backup sebelum dijalankan di produksi.

-- Tahap SOP nyata (terpisah dari kolom `status` lama agar data lama tetap utuh).
-- Baris yang sudah ada diberi 'aktif' sebagai nilai awal; ubah per supplier dari aplikasi.
ALTER TABLE workspace_suppliers
  ADD COLUMN IF NOT EXISTS sop_stage TEXT NOT NULL DEFAULT 'aktif'
  CHECK (sop_stage IN ('aktif','tertahan','berhenti','ditutup'));

-- Gerbang per supplier: satu baris per (supplier, gerbang).
-- `note` untuk sumber/keterangan (mis. "balasan email 29 Okt"); `updated_at` = tanggal status.
CREATE TABLE IF NOT EXISTS workspace_supplier_gates (
  supplier_id UUID NOT NULL REFERENCES workspace_suppliers(id) ON DELETE CASCADE,
  gate TEXT NOT NULL CHECK (gate IN ('halal','loa_bpom','cfs','coa_iso','pembayaran_aman')),
  state TEXT NOT NULL DEFAULT 'belum' CHECK (state IN ('belum','diminta','diterima','tidak_ada')),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_id, gate)
);
CREATE INDEX IF NOT EXISTS workspace_supplier_gates_state_idx
  ON workspace_supplier_gates(state, updated_at) WHERE state = 'diminta';

-- Penawaran landed cost tersimpan. `inputs` menyimpan masukan mentah; angka hasil
-- dihitung server dengan rumus yang sama dengan antarmuka.
CREATE TABLE IF NOT EXISTS workspace_landed_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES workspace_suppliers(id) ON DELETE SET NULL,
  product TEXT NOT NULL CHECK (char_length(product) BETWEEN 1 AND 160),
  inputs JSONB NOT NULL,
  total_idr DOUBLE PRECISION NOT NULL,
  unit_idr DOUBLE PRECISION NOT NULL,
  price_idr DOUBLE PRECISION,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_landed_quotes_created_idx ON workspace_landed_quotes(created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_landed_quotes_product_idx ON workspace_landed_quotes(lower(product));
