-- Agenda manual (Zoom, kunjungan, tenggat). Event turunan (ETA sampel, follow-up klinik) dihitung saat dibaca.
CREATE TABLE IF NOT EXISTS agenda (
  id BIGSERIAL PRIMARY KEY,
  judul TEXT NOT NULL CHECK (char_length(judul) BETWEEN 1 AND 200),
  mulai TIMESTAMPTZ NOT NULL,
  jenis TEXT NOT NULL DEFAULT 'lainnya' CHECK (jenis IN ('zoom','kunjungan','tenggat','lainnya')),
  catatan TEXT CHECK (catatan IS NULL OR char_length(catatan) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agenda_mulai_idx ON agenda (mulai);
