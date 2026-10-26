-- AIL LABS WhatsApp agent: log percakapan + status serah-terima ke admin.
-- Additive & idempotent. Kode (lib/wa-conversation.js) juga membuat tabel ini sendiri
-- saat pertama dipakai; file ini hanya salinan untuk dijalankan manual bila diinginkan.
CREATE TABLE IF NOT EXISTS wa_messages (
  id BIGSERIAL PRIMARY KEY,
  wa_message_id TEXT UNIQUE,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_phone_created ON wa_messages(phone, created_at DESC);
CREATE TABLE IF NOT EXISTS wa_conversations (
  phone TEXT PRIMARY KEY,
  handoff BOOLEAN NOT NULL DEFAULT false,
  handoff_at TIMESTAMPTZ,
  handoff_reason TEXT,
  handoff_summary TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
