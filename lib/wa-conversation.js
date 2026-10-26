// lib/wa-conversation.js
// Penyimpanan percakapan WhatsApp untuk agent katalog:
//  - dedupe pesan masuk (Meta bisa mengirim ulang webhook yang sama),
//  - riwayat singkat agar agent paham konteks ("yang tadi", "harganya?"),
//  - status serah-terima ke admin (selama aktif, bot diam dan admin membalas manual).
//
// Tabel dibuat sendiri (idempotent) saat pertama dipakai, jadi tidak perlu migrasi manual.
// Salinan SQL-nya ada di db/whatsapp_agent.sql.
// Semua fungsi aman dipanggil walau tabel/DB bermasalah: pemanggil cukup menangkap error
// dan agent tetap berjalan tanpa memori (stateless).

const pool = require('../db/pool');

const HISTORY_LIMIT = 8;          // pesan terakhir yang dikirim ke model
const HISTORY_WINDOW_HOURS = 24;  // riwayat lebih tua dari ini diabaikan
const HANDOFF_HOURS = 12;         // bot diam selama ini setelah serah-terima, lalu aktif lagi
const RETENTION_DAYS = 30;        // log pesan dihapus setelah ini
const MAX_BODY_CHARS = 600;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS wa_messages (
     id BIGSERIAL PRIMARY KEY,
     wa_message_id TEXT UNIQUE,
     phone TEXT NOT NULL,
     direction TEXT NOT NULL CHECK (direction IN ('in','out')),
     body TEXT NOT NULL DEFAULT '',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_wa_messages_phone_created ON wa_messages(phone, created_at DESC)',
  `CREATE TABLE IF NOT EXISTS wa_conversations (
     phone TEXT PRIMARY KEY,
     handoff BOOLEAN NOT NULL DEFAULT false,
     handoff_at TIMESTAMPTZ,
     handoff_reason TEXT,
     handoff_summary TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`
];

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const sql of SCHEMA) await pool.query(sql);
      await pool.query(`DELETE FROM wa_messages WHERE created_at < now() - interval '${RETENTION_DAYS} days'`);
    })().catch((err) => {
      schemaReady = null; // coba lagi di permintaan berikutnya
      throw err;
    });
  }
  return schemaReady;
}

const clip = (s) => String(s == null ? '' : s).slice(0, MAX_BODY_CHARS);

// true = pesan baru (lanjut diproses); false = sudah pernah diterima (lewati).
async function claimInbound(waMessageId, phone, body) {
  await ensureSchema();
  const { rows } = await pool.query(
    `INSERT INTO wa_messages (wa_message_id, phone, direction, body)
     VALUES ($1, $2, 'in', $3)
     ON CONFLICT (wa_message_id) DO NOTHING
     RETURNING id`,
    [waMessageId || null, phone, clip(body)]
  );
  return rows.length > 0;
}

async function recordOutbound(phone, body) {
  await ensureSchema();
  await pool.query(
    `INSERT INTO wa_messages (phone, direction, body) VALUES ($1, 'out', $2)`,
    [phone, clip(body)]
  );
}

// Susun riwayat jadi format messages Claude: bergantian user/assistant, diawali user.
function toMessages(rows) {
  const out = [];
  for (const r of rows) {
    const role = r.direction === 'in' ? 'user' : 'assistant';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += '\n' + r.body;
    else out.push({ role, content: r.body });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function getHistory(phone) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT direction, body FROM (
       SELECT direction, body, created_at FROM wa_messages
        WHERE phone = $1 AND created_at > now() - interval '${HISTORY_WINDOW_HOURS} hours'
        ORDER BY created_at DESC, id DESC LIMIT $2
     ) t ORDER BY created_at ASC`,
    [phone, HISTORY_LIMIT]
  );
  return toMessages(rows);
}

async function isHandoffActive(phone) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT 1 FROM wa_conversations
      WHERE phone = $1 AND handoff = true
        AND handoff_at > now() - interval '${HANDOFF_HOURS} hours'`,
    [phone]
  );
  return rows.length > 0;
}

async function setHandoff(phone, reason, summary) {
  await ensureSchema();
  await pool.query(
    `INSERT INTO wa_conversations (phone, handoff, handoff_at, handoff_reason, handoff_summary, updated_at)
     VALUES ($1, true, now(), $2, $3, now())
     ON CONFLICT (phone) DO UPDATE
       SET handoff = true, handoff_at = now(), handoff_reason = $2, handoff_summary = $3, updated_at = now()`,
    [phone, clip(reason), clip(summary)]
  );
}

async function resumeBot(phone) {
  await ensureSchema();
  const { rows } = await pool.query(
    `UPDATE wa_conversations SET handoff = false, updated_at = now()
      WHERE phone = $1 AND handoff = true RETURNING phone`,
    [phone]
  );
  return rows.length > 0;
}

async function listHandoffs() {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT phone, handoff_at, handoff_reason, handoff_summary
       FROM wa_conversations
      WHERE handoff = true AND handoff_at > now() - interval '${HANDOFF_HOURS} hours'
      ORDER BY handoff_at DESC LIMIT 50`
  );
  return rows;
}

module.exports = {
  claimInbound, recordOutbound, getHistory, isHandoffActive,
  setHandoff, resumeBot, listHandoffs, toMessages, HANDOFF_HOURS
};
