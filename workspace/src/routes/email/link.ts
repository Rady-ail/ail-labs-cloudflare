import { getSql } from "../../lib/db";

type Sql = ReturnType<typeof getSql>;

const FREE_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "yahoo.co.id", "hotmail.com", "outlook.com", "live.com", "qq.com", "163.com",
  "126.com", "icloud.com", "proton.me", "protonmail.com", "naver.com", "hanmail.net", "msn.com",
]);

// Ambil kalimat pembuka balasan (sebelum kutipan pesan lama).
export function replyHead(body: string): string {
  const text = String(body ?? "").replace(/\r/g, "").trim();
  const cut = text.search(/\n\s*(>|on .{5,80} wrote:|pada .{5,80} menulis:|dari:|from:|-----original)/i);
  return (cut > 0 ? text.slice(0, cut) : text).trim().slice(0, 300);
}

export function isStopReply(body: string): boolean {
  const head = replyHead(body).toLowerCase();
  return /^(stop|berhenti|unsubscribe|jangan\s+(kirim|hubungi))\b/.test(head)
    || /^(mohon\s+)?(hentikan|jangan)\s+(kirim|email|hubungi)/.test(head);
}

// Hubungkan satu pesan masuk ke klinik / supplier. Aman dipanggil berulang (idempoten).
export async function linkInbound(sql: Sql, messageId: string): Promise<"clinic" | "supplier" | "none" | "skip"> {
  const rows = await sql`SELECT id::text AS id, thread_id::text AS thread_id, lower(from_email) AS from_email,
      body_text, received_at, metadata FROM email_messages WHERE id = ${messageId}::bigint AND direction = 'inbound'`;
  const m = rows[0] as Record<string, any> | undefined;
  if (!m) return "skip";
  if (m.metadata && m.metadata.linked) return "skip";
  const from = String(m.from_email);
  if (from.endsWith("@inbox.ail-aesthetic-labs.my.id")) {
    await sql`UPDATE email_messages SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ linked: true, link_kind: "skip" })}::jsonb WHERE id = ${messageId}::bigint`;
    return "skip";
  }
  const when = new Date(m.received_at).toISOString();
  const stop = isStopReply(m.body_text ?? "");

  let kind: "clinic" | "supplier" | "none" = "none";
  let link: Record<string, unknown> | null = null;

  const clinics = await sql`SELECT c.id::text AS id, c.name FROM clinics c
    WHERE c.archived IS NOT TRUE AND (lower(c.email) = ${from}
      OR EXISTS (SELECT 1 FROM clinic_contacts k WHERE k.clinic_id = c.id AND lower(k.email) = ${from}))
    ORDER BY c.created_at LIMIT 1`;
  if (clinics.length) {
    const c = clinics[0] as Record<string, any>;
    await sql`UPDATE clinics SET
        last_contact_at = GREATEST(COALESCE(last_contact_at, ${when}::timestamptz), ${when}::timestamptz),
        interactions_count = interactions_count + 1,
        stage = CASE WHEN ${stop} AND stage IN ('lead', 'contacted') THEN 'inactive'
                     WHEN stage = 'lead' THEN 'contacted' ELSE stage END,
        notes = CASE WHEN ${stop} THEN COALESCE(notes || E'\n', '') || 'Membalas STOP ' || ${when.slice(0, 10)}::text ELSE notes END,
        updated_at = now()
      WHERE id = ${c.id}::uuid`;
    if (stop) {
      await sql`INSERT INTO email_suppressions (email, reason, source)
        SELECT ${from}, 'unsubscribe', 'balasan_stop'
        WHERE NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE lower(s.email) = ${from})`;
    }
    kind = "clinic";
    link = { kind, id: c.id, name: c.name, stop };
  } else {
    const domain = from.split("@")[1] ?? "";
    const suppliers = await sql`SELECT s.id::text AS id, s.name FROM suppliers s
      WHERE s.archived_at IS NULL AND s.name !~* '(liyin|yolanda)'
        AND (position(${from} IN lower(COALESCE(s.channel, ''))) > 0
          OR (${!FREE_DOMAINS.has(domain) && domain.length > 3}
              AND position(${domain} IN lower(COALESCE(s.channel, '') || ' ' || COALESCE(s.contact, ''))) > 0))
      ORDER BY s.created_at LIMIT 1`;
    if (suppliers.length) {
      const s = suppliers[0] as Record<string, any>;
      await sql`UPDATE suppliers SET last_activity_on = GREATEST(COALESCE(last_activity_on, ${when.slice(0, 10)}::date), ${when.slice(0, 10)}::date),
          updated_at = now() WHERE id = ${s.id}::uuid`;
      kind = "supplier";
      link = { kind, id: s.id, name: s.name };
    }
  }

  if (link && m.thread_id) {
    await sql`UPDATE email_threads SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ link })}::jsonb
      WHERE id = ${m.thread_id}::bigint`;
  }
  await sql`UPDATE email_messages SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ linked: true, link_kind: kind })}::jsonb
    WHERE id = ${messageId}::bigint`;
  return kind;
}
