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

type Msg = { role: string; content: string };
type Prov = "claude" | "gpt";

async function claude(env: any, messages: Msg[], maxTokens: number) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, system, messages: rest }),
  });
  if (!res.ok) {
    let kode = "";
    try { kode = String(((await res.json()) as any)?.error?.type ?? ""); } catch { /* abaikan */ }
    throw new Error(`claude_${res.status}_${kode}`);
  }
  const j: any = await res.json();
  return String((j?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("")).trim();
}

function pilih(env: any, minta: unknown): Prov | null {
  const ada = { claude: Boolean(env.ANTHROPIC_API_KEY), gpt: Boolean(env.OPENAI_API_KEY) };
  if (minta === "claude" && ada.claude) return "claude";
  if (minta === "gpt" && ada.gpt) return "gpt";
  if (ada.claude) return "claude";
  if (ada.gpt) return "gpt";
  return null;
}

async function ai(env: any, prov: Prov, messages: Msg[], maxTokens = 700) {
  return prov === "claude" ? claude(env, messages, maxTokens) : gpt(env, messages, maxTokens);
}

async function gpt(env: any, messages: { role: string; content: string }[], maxTokens = 700) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.OPENAI_MODEL || "gpt-4o-mini", messages, max_tokens: maxTokens, temperature: 0.3 }),
  });
  if (!res.ok) {
    let kode = "";
    try { kode = String(((await res.json()) as any)?.error?.code ?? ""); } catch { /* abaikan */ }
    throw new Error(`openai_${res.status}_${kode}`);
  }
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

function alasan(e: unknown): string {
  const m = String((e as Error)?.message ?? "");
  if (m.includes("claude_401")) return "Kunci Anthropic ditolak. Buat key baru di console.anthropic.com lalu pasang ulang.";
  if (m.includes("claude_400") && m.includes("invalid_request")) return "Anthropic menolak permintaan (cek saldo/kredit di console.anthropic.com).";
  if (m.includes("claude_429")) return "Batas pemakaian Anthropic tercapai, coba lagi sebentar.";
  if (m.includes("claude_404")) return "Model Claude tidak tersedia untuk akun ini.";
  if (m.startsWith("claude_")) return "Anthropic menolak permintaan (" + m.slice(7) + ").";
  if (m.includes("openai_401")) return "Kunci OpenAI ditolak (salah/dicabut). Buat key baru lalu pasang ulang.";
  if (m.includes("openai_429")) return m.includes("insufficient_quota") ? "Saldo OpenAI habis/belum diisi. Isi saldo di platform.openai.com." : "Terlalu banyak permintaan ke OpenAI, coba lagi sebentar.";
  if (m.includes("openai_403")) return "Izin key OpenAI kurang (pakai izin Model capabilities).";
  if (m.includes("openai_404")) return "Model OpenAI tidak tersedia untuk akun ini.";
  if (m.startsWith("openai_")) return "OpenAI menolak permintaan (" + m.slice(7) + ").";
  return "Gagal membaca data aplikasi untuk asisten.";
}

agentRoutes.get("/status", (c) =>
  ok(c, {
    aktif: Boolean(c.env.OPENAI_API_KEY || c.env.ANTHROPIC_API_KEY),
    claude: Boolean(c.env.ANTHROPIC_API_KEY), gpt: Boolean(c.env.OPENAI_API_KEY),
    model: c.env.OPENAI_MODEL || "gpt-4o-mini", model_claude: c.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  }));

agentRoutes.post("/chat", async (c) => {
  const body = await readJsonObject(c);
  const prov = pilih(c.env, body.penyedia);
  if (!prov) return fail(c, 503, "AI_BELUM_AKTIF", "ANTHROPIC_API_KEY atau OPENAI_API_KEY belum dipasang");
  const pesan = typeof body.pesan === "string" ? body.pesan.trim() : "";
  if (!pesan || pesan.length > 2000) return fail(c, 422, "VALIDATION", "pesan wajib, maksimal 2000 karakter");
  const riwayat = Array.isArray(body.riwayat) ? body.riwayat.slice(-8) : [];
  const hist = riwayat
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  const sql = getSql(c.env);
  try {
    const ctx = await konteks(sql);
    const jawaban = await ai(c.env, prov, [
      { role: "system", content: `${ATURAN}\n\nKONTEKS (data aplikasi saat ini):\n${ctx}` },
      ...hist, { role: "user", content: pesan },
    ]);
    return ok(c, { jawaban, penyedia: prov });
  } catch (e) {
    return fail(c, 503, "AI_GAGAL", alasan(e));
  }
});

agentRoutes.post("/poles", async (c) => {
  const body = await readJsonObject(c);
  const prov = pilih(c.env, body.penyedia);
  if (!prov) return fail(c, 503, "AI_BELUM_AKTIF", "ANTHROPIC_API_KEY atau OPENAI_API_KEY belum dipasang");
  const teks = typeof body.teks === "string" ? body.teks.trim() : "";
  const pesanSupplier = typeof body.pesanSupplier === "string" ? body.pesanSupplier.slice(0, 4000) : "";
  if (!teks || teks.length > 5000) return fail(c, 422, "VALIDATION", "teks wajib, maksimal 5000 karakter");
  try {
    const hasil = await ai(c.env, prov, [
      { role: "system", content: `${ATURAN}\nTugas: poles draf balasan email ke supplier menjadi bahasa Inggris profesional, hangat, ringkas. Pertahankan semua poin Aturan Emas; jangan menambah janji, harga, atau pembayaran. Pertahankan tanda tangan Alexa. Keluarkan HANYA teks email.` },
      { role: "user", content: `Pesan terakhir supplier:\n${pesanSupplier}\n\nDraf saya:\n${teks}` },
    ], 900);
    return ok(c, { teks: hasil });
  } catch (e) {
    return fail(c, 503, "AI_GAGAL", alasan(e));
  }
});
