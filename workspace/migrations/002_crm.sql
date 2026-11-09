-- ============================================================
-- AIL LABS CRM
-- Migration: 002_crm.sql
-- PostgreSQL 15+
-- Idempotent initial CRM schema
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. UPDATED_AT TRIGGER FUNCTION
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 2. CLINICS
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clinics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT NOT NULL,
    city TEXT NOT NULL,
    province TEXT NOT NULL,
    address TEXT,

    stage TEXT NOT NULL DEFAULT 'lead'
        CHECK (
            stage IN (
                'lead',
                'contacted',
                'catalog_sent',
                'negotiating',
                'ordered',
                'active',
                'inactive'
            )
        ),

    interest SMALLINT
        CHECK (interest BETWEEN 1 AND 3),

    pic_name TEXT,
    pic_role TEXT,

    phone TEXT,
    email TEXT,

    doctors_count INTEGER NOT NULL DEFAULT 0
        CHECK (doctors_count >= 0),

    services TEXT[] NOT NULL DEFAULT '{}',
    hours TEXT,

    next_followup_at TIMESTAMPTZ,
    next_followup_reason TEXT,

    last_contact_at TIMESTAMPTZ,

    interactions_count INTEGER NOT NULL DEFAULT 0
        CHECK (interactions_count >= 0),

    orders_count INTEGER NOT NULL DEFAULT 0
        CHECK (orders_count >= 0),

    notes TEXT,

    archived BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Technical metadata for automatic update tracking.
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE clinics IS
'Master data klinik AIL LABS CRM. Menyimpan identitas, lokasi, pipeline, PIC, minat, layanan, tindak lanjut, dan ringkasan aktivitas. Tidak menyimpan data harga.';

COMMENT ON COLUMN clinics.stage IS
'Tahap pipeline: lead, contacted, catalog_sent, negotiating, ordered, active, inactive.';

COMMENT ON COLUMN clinics.interest IS
'Skor minat klinik: 1 sampai 3 atau NULL jika belum dinilai.';

COMMENT ON COLUMN clinics.services IS
'Daftar layanan klinik dalam bentuk array teks.';

COMMENT ON COLUMN clinics.updated_at IS
'Waktu perubahan terakhir, dikelola otomatis oleh trigger.';

-- ------------------------------------------------------------
-- 3. CLINIC CONTACTS
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clinic_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    clinic_id UUID NOT NULL
        REFERENCES clinics(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    role TEXT,

    phone TEXT,
    email TEXT,

    preferred_channel TEXT
        CHECK (
            preferred_channel IN (
                'whatsapp',
                'email',
                'phone'
            )
        ),

    is_primary BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE clinic_contacts IS
'Kontak individu yang terkait dengan klinik. preferred_channel hanya menunjukkan preferensi komunikasi dan tidak mengirim pesan otomatis.';

-- ------------------------------------------------------------
-- 4. CLINIC ACTIVITIES
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clinic_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    clinic_id UUID NOT NULL
        REFERENCES clinics(id) ON DELETE CASCADE,

    type TEXT NOT NULL
        CHECK (
            type IN (
                'note',
                'call',
                'whatsapp',
                'email',
                'catalog',
                'order',
                'stage_change'
            )
        ),

    summary TEXT NOT NULL,
    detail TEXT,

    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE clinic_activities IS
'Riwayat aktivitas CRM. Tipe aktivitas mencatat kejadian, bukan menjalankan pengiriman WhatsApp atau email.';

-- ------------------------------------------------------------
-- 5. CLINIC FOLLOW-UPS
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clinic_followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    clinic_id UUID NOT NULL
        REFERENCES clinics(id) ON DELETE CASCADE,

    scheduled_at TIMESTAMPTZ NOT NULL,
    reason TEXT,

    completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE clinic_followups IS
'Jadwal tindak lanjut klinik, termasuk status penyelesaian dan waktu penyelesaian.';

-- ------------------------------------------------------------
-- 6. CLINIC TAGS
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clinic_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    clinic_id UUID NOT NULL
        REFERENCES clinics(id) ON DELETE CASCADE,

    name TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT clinic_tags_unique_name
        UNIQUE (clinic_id, name)
);

COMMENT ON TABLE clinic_tags IS
'Label kategorisasi klinik. Setiap nama tag unik dalam satu klinik.';

-- ------------------------------------------------------------
-- 7. INDEXES
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_clinics_stage
    ON clinics (stage);

CREATE INDEX IF NOT EXISTS idx_clinics_province
    ON clinics (province);

CREATE INDEX IF NOT EXISTS idx_clinics_next_followup_at
    ON clinics (next_followup_at);

CREATE INDEX IF NOT EXISTS idx_clinics_archived
    ON clinics (archived);

CREATE INDEX IF NOT EXISTS idx_clinic_contacts_clinic_id
    ON clinic_contacts (clinic_id);

CREATE INDEX IF NOT EXISTS idx_clinic_activities_clinic_id
    ON clinic_activities (clinic_id);

CREATE INDEX IF NOT EXISTS idx_clinic_activities_occurred_at
    ON clinic_activities (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinic_followups_clinic_id
    ON clinic_followups (clinic_id);

CREATE INDEX IF NOT EXISTS idx_clinic_followups_scheduled_at
    ON clinic_followups (scheduled_at);

CREATE INDEX IF NOT EXISTS idx_clinic_followups_pending
    ON clinic_followups (scheduled_at)
    WHERE completed = FALSE;

CREATE INDEX IF NOT EXISTS idx_clinic_tags_clinic_id
    ON clinic_tags (clinic_id);

-- ------------------------------------------------------------
-- 8. UPDATED_AT TRIGGERS
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_clinics_updated_at
    ON clinics;

CREATE TRIGGER trg_clinics_updated_at
BEFORE UPDATE ON clinics
FOR EACH ROW
EXECUTE FUNCTION crm_set_updated_at();


DROP TRIGGER IF EXISTS trg_clinic_contacts_updated_at
    ON clinic_contacts;

CREATE TRIGGER trg_clinic_contacts_updated_at
BEFORE UPDATE ON clinic_contacts
FOR EACH ROW
EXECUTE FUNCTION crm_set_updated_at();


DROP TRIGGER IF EXISTS trg_clinic_followups_updated_at
    ON clinic_followups;

CREATE TRIGGER trg_clinic_followups_updated_at
BEFORE UPDATE ON clinic_followups
FOR EACH ROW
EXECUTE FUNCTION crm_set_updated_at();

-- ------------------------------------------------------------
-- 9. ADDITIONAL TABLE COMMENTS
-- ------------------------------------------------------------

COMMENT ON COLUMN clinic_contacts.preferred_channel IS
'Preferensi kanal komunikasi: whatsapp, email, phone. Bukan izin pengiriman otomatis.';

COMMENT ON COLUMN clinic_activities.type IS
'Jenis aktivitas: note, call, whatsapp, email, catalog, order, stage_change.';

COMMENT ON COLUMN clinic_followups.completed IS
'TRUE jika tindak lanjut telah diselesaikan.';

COMMENT ON COLUMN clinic_tags.name IS
'Nama tag klinik.';

COMMIT;

-- ============================================================
-- END OF MIGRATION 002
-- ============================================================
