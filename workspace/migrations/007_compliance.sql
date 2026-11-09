BEGIN;

CREATE TABLE IF NOT EXISTS compliance_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  subject_type TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  doc_type TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'belum',

  due_on DATE,
  received_on DATE,
  expires_on DATE,

  file_url TEXT,
  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT compliance_subject_type_check
    CHECK (subject_type IN ('supplier', 'produk', 'klinik')),

  CONSTRAINT compliance_doc_type_check
    CHECK (doc_type IN (
      'coa_same_batch',
      'msds_sds',
      'inci',
      'iso_22716_gmpc',
      'halal',
      'loa_bpom',
      'cfs',
      'tropical_stability_40c_75rh_3m',
      'hs_code'
    )),

  CONSTRAINT compliance_status_check
    CHECK (status IN (
      'belum',
      'diminta',
      'diterima',
      'diverifikasi',
      'ditolak',
      'kedaluwarsa'
    )),

  CONSTRAINT compliance_verified_received_check
    CHECK (status <> 'diverifikasi' OR received_on IS NOT NULL),

  CONSTRAINT compliance_expiry_date_check
    CHECK (
      received_on IS NULL
      OR expires_on IS NULL
      OR expires_on >= received_on
    ),

  CONSTRAINT compliance_file_url_check
    CHECK (
      file_url IS NULL
      OR file_url ~ '^https://[^[:space:]]+$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  compliance_subject_document_unique_idx
  ON compliance_items (
    subject_type,
    subject_ref,
    doc_type
  );

CREATE INDEX IF NOT EXISTS
  compliance_status_idx
  ON compliance_items (status);

CREATE INDEX IF NOT EXISTS
  compliance_subject_idx
  ON compliance_items (subject_type, subject_ref);

CREATE INDEX IF NOT EXISTS
  compliance_due_on_idx
  ON compliance_items (due_on)
  WHERE due_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  compliance_expires_on_idx
  ON compliance_items (expires_on)
  WHERE expires_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  compliance_updated_at_idx
  ON compliance_items (updated_at DESC);

COMMIT;
