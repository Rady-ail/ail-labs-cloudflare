import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ok, fail } from "../../lib/http";
import { getSql } from "../../lib/db";
import { readJsonObject } from "../../lib/body";

// Asisten AI (GPT). HANYA MEMBACA data ringkas; tidak mengirim email/WA, tidak mengubah data.
export const agentRoutes = new Hono<AppEnv>();

const ATURAN = `Kamu Alexa, asisten AI internal AIL LABS (PT Fudhail Aesthetic Labs, Indonesia).
Jawab dalam bahasa Indonesia, singkat, jawaban dulu. Balasan siap kirim ke supplier ditulis dalam bahasa Inggris di code block.
ATURAN EMAS (mutlak): sampel 100% gratis; ongkir sampel ke Indonesia ditanggung supplier (utamakan DDP); AIL LABS tidak membayar biaya sampel/kurir/bea; tidak ada T/T di muka; tidak ada pembayaran/kontrak tanpa persetujuan eksplisit Rady; maksimal 2 putaran per isu lalu HOLD; pengecualian hanya oleh Rady.
Harga produk hanya ditetapkan Rady. Jangan mengarang data: pakai KONTEKS saja, dan katakan bila tidak ada. Kamu tidak bisa mengirim apa pun; hanya menyarankan.`;

async function gpt(env: any, messages: { role: string; content: string }[], maxTokens = 700) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.OPENAI_MODEL || "gpt-4o-mini", messages, max_tokens: maxTokens, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`openai_${res.status}`);
  const j: any = await res.json();
  return String(j?.choices?.[0]?.message?.content ?? "").trim();
}

async function konteks(sql: any): Promise<string> {
  const [lap] = await sql`SELECT
    (SELECT count(*)::int FROM clinics WHERE archived = false AND stage = 'lead') AS lead,
    (SELECT count(*)::int FROM clinics WHERE archived = false AND stage = 'contacted') AS contacted,
    (SELECT count(*)::int FROM clinic_activities WHERE type = 'whatsapp' AND summary <> 'Balasan WhatsApp masuk' AND occurred_at >= now() - interval '7 days') AS wa_keluar_7h,
    (SELECT count(*)::int FROM clinic_activities WHERE type = 'whatsapp' AND summary = 'Balasan WhatsApp masuk' AND occurred_at >= now() - interval '7 days') AS wa_masuk_7h`;
  const tunggu = await sql`SELECT name, last_activity_on::text AS terakhir FROM suppliers
    WHERE archived_at IS NULL AND status = 'menunggu_balasan' AND name !~* '(liyin|yolanda)' ORDER BY last_activity_on NULLS FIRST LIMIT 25`;
  const bea = await sql`SELECT s.name, ss.awb, ss.duty_amount_idr FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id
    WHERE ss.duty_decision = 'belum' AND s.name !~* '(liyin|yolanda)' LIMIT 10`;
  const sampel = await sql`SELECT s.name, ss.state, ss.awb FROM supplier_samples ss JOIN suppliers s ON s.id = ss.supplier_id
    WHERE ss.state IN ('diminta','disepakati','dikirim','diuji') AND s.name !~* '(liyin|yolanda)' LIMIT 25`;
  return JSON.stringify({ klinik: lap, supplier_menunggu_balasan: tunggu, bea_menunggu_keputusan_rady: bea, sampel_berjalan: sampel });
}

agentRoutes.get("/status", (c) =>
  ok(c, { aktif: Boolean(c.env.OPENAI_API_KEY), model: c.env.OPENAI_MODEL || "gpt-4o-mini" }));

agentRoutes.post("/chat", async (c) => {
  if (!c.env.OPENAI_API_KEY) return fail(c, 503, "AI_BELUM_AKTIF", "OPENAI_API_KEY belum dipasang");
  const body = await readJsonObject(c);
  const pesan = typeof body.pesan === "string" ? body.pesan.trim() : "";
  if (!pesan || pesan.length > 2000) return fail(c, 422, "VALIDATION", "pesan wajib, maksimal 2000 karakter");
  const riwayat = Array.isArray(body.riwayat) ? body.riwayat.slice(-8) : [];
  const hist = riwayat
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  const sql = getSql(c.env);
  try {
    const ctx = await konteks(sql);
    const jawaban = await gpt(c.env, [
      { role: "system", content: `${ATURAN}\n\nKONTEKS (data aplikasi saat ini):\n${ctx}` },
      ...hist, { role: "user", content: pesan },
    ]);
    return ok(c, { jawaban });
  } catch {
    return fail(c, 503, "AI_GAGAL", "Asisten AI sedang tidak bisa dihubungi");
  }
});

agentRoutes.post("/poles", async (c) => {
  if (!c.env.OPENAI_API_KEY) return fail(c, 503, "AI_BELUM_AKTIF", "OPENAI_API_KEY belum dipasang");
  const body = await readJsonObject(c);
  const teks = typeof body.teks === "string" ? body.teks.trim() : "";
  const pesanSupplier = typeof body.pesanSupplier === "string" ? body.pesanSupplier.slice(0, 4000) : "";
  if (!teks || teks.length > 5000) return fail(c, 422, "VALIDATION", "teks wajib, maksimal 5000 karakter");
  try {
    const hasil = await gpt(c.env, [
      { role: "system", content: `${ATURAN}\nTugas: poles draf balasan email ke supplier menjadi bahasa Inggris profesional, hangat, ringkas. Pertahankan semua poin Aturan Emas; jangan menambah janji, harga, atau pembayaran. Pertahankan tanda tangan Alexa. Keluarkan HANYA teks email.` },
      { role: "user", content: `Pesan terakhir supplier:\n${pesanSupplier}\n\nDraf saya:\n${teks}` },
    ], 900);
    return ok(c, { teks: hasil });
  } catch {
    return fail(c, 503, "AI_GAGAL", "Asisten AI sedang tidak bisa dihubungi");
  }
});
