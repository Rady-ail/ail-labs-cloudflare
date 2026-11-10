-- Paket & bea: jumlah bea/pajak yang ditagih kurir dan keputusan Rady (tidak ada pembayaran otomatis).
ALTER TABLE supplier_samples ADD COLUMN IF NOT EXISTS duty_amount_idr BIGINT CHECK (duty_amount_idr IS NULL OR duty_amount_idr >= 0);
ALTER TABLE supplier_samples ADD COLUMN IF NOT EXISTS duty_decision TEXT NOT NULL DEFAULT 'tidak_ada'
  CHECK (duty_decision IN ('tidak_ada','belum','tidak_bayar','bayar_disetujui','dibayar'));
