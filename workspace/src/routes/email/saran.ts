import { Hono } from "hono";
import type { AppEnv } from "../../lib/http";
import { ok, fail } from "../../lib/http";
import { getSql } from "../../lib/db";
import { assertNoQuery, parseBigintId } from "./shared";

export const saranRoutes = new Hono<AppEnv>();

export type Flag = { kode: string; label: string; berat: "tinggi" | "sedang" };

const RULES: { kode: string; label: string; berat: Flag["berat"]; re: RegExp }[] = [
  { kode: "tt_muka", label: "Minta pembayaran / T/T di muka", berat: "tinggi",
    re: /(100\s*%|full|advance|prepa(y|id)|deposit|proforma invoice|pro forma).{0,60}(pay|payment|t\/t|tt|wire|transfer)|(pay|payment|t\/t|wire|transfer).{0,60}(before|in advance|prior to (shipment|shipping))/i },
  { kode: "sampel_bayar", label: "Sampel tidak gratis / minta biaya sampel", berat: "tinggi",
    re: /(sample|samples).{0,50}(charge|fee|cost|paid|pay for|not free|is not free)|(charge|fee).{0,30}sample/i },
  { kode: "ongkir_bayar", label: "Minta kami tanggung ongkir / kurir", berat: "tinggi",
    re: /(freight|shipping|courier|postage|delivery).{0,50}(at your cost|buyer|you (need|have) to pay|customer'?s? account|collect|your account)|(account|fedex|dhl|ups) (number|no\.?|account)/i },
  { kode: "bea_cukai", label: "Bea masuk / pajak impor dibebankan ke kami", berat: "tinggi",
    re: /(duty|duties|customs|import tax|vat|clearance).{0,60}(buyer|you|your side|consignee|receiver)|(buyer|you|consignee).{0,40}(pay|responsible).{0,40}(duty|duties|customs|tax)/i },
  { kode: "biaya_dokumen", label: "Biaya dokumen (COA/MSDS/legal)", berat: "sedang",
    re: /(coa|msds|document|certificate|legali[sz]ation|registration).{0,40}(fee|charge|cost)/i },
  { kode: "harga_nego", label: "Menyebut harga / MOQ / penawaran", berat: "sedang",
    re: /\b(usd|us\$|\$|eur|€|rmb|cny)\s?[0-9]|moq|minimum order|price list|quotation/i },
];

export function deteksi(text: string): Flag[] {
  const t = text.replace(/\s+/g, " ");
  return RULES.filter((r) => r.re.test(t)).map(({ kode, label, berat }) => ({ kode, label, berat }));
}

const SIGN = "Best regards,\nAlexa\nAssistant to Mr. Ryan Ady Putra, Director\nPT Fudhail Aesthetic Labs (AIL LABS) | Indonesia";

export function susunBalasan(nama: string, flags: Flag[]): { jenis: string; teks: string } {
  const k = new Set(flags.map((f) => f.kode));
  const hi = `Dear ${nama || "Sir/Madam"},\n\nThank you for your message and for your time.\n\n`;
  let jenis = "umum";
  const bagian: string[] = [];
  if (k.has("tt_muka")) {
    jenis = "tolak_muka";
    bagian.push("Please note that AIL LABS does not make payments in advance (including 100% T/T) for first orders or evaluation. Our policy is to start with free evaluation samples, delivered to Indonesia at the supplier's cost.");
  }
  if (k.has("sampel_bayar") || k.has("ongkir_bayar") || k.has("bea_cukai")) {
    if (jenis === "umum") jenis = "sampel_ddp";
    bagian.push("For evaluation samples, we kindly ask for: (1) samples free of charge, (2) shipping to Indonesia arranged and paid by your side, preferably DDP (Delivered Duty Paid), so that no sample, courier, or import duty charges are borne by us.");
  }
  if (k.has("biaya_dokumen")) {
    bagian.push("Regarding documents, could you please provide the COA, MSDS, and registration/certificate documents at no charge, as part of the evaluation package?");
  }
  if (!bagian.length) {
    bagian.push("We would appreciate it if you could share the product specification, available certificates (COA/MSDS), and confirm that evaluation samples can be provided free of charge with delivery to Indonesia arranged by your side (DDP preferred).");
  }
  const tutup = "If these terms are acceptable, please let us know the next step. If not, we fully understand and would be glad to stay in touch for future opportunities.\n\n";
  return { jenis, teks: hi + bagian.join("\n\n") + "\n\n" + tutup + SIGN };
}

saranRoutes.get("/threads/:threadId/saran-balasan", async (c) => {
  assertNoQuery(c);
  const threadId = parseBigintId(c.req.param("threadId"), "threadId");
  const sql = getSql(c.env);
  const t = await sql`SELECT id FROM email_threads WHERE id = ${threadId}::bigint`;
  if (!t.length) return fail(c, 404, "not_found", "Percakapan tidak ditemukan");
  const m = await sql`SELECT from_email, subject, body_text, direction FROM email_messages
    WHERE thread_id = ${threadId}::bigint ORDER BY COALESCE(received_at, sent_at) DESC NULLS LAST, id DESC LIMIT 1`;
  if (!m.length) return fail(c, 404, "not_found", "Belum ada pesan");
  const last: any = m[0];
  const perlu = last.direction === "inbound";
  const body = String(last.body_text ?? "").slice(0, 6000);
  const flags = deteksi(body);
  const lokal = String(last.from_email ?? "").split("@")[0].replace(/[._-]+/g, " ").trim();
  const nama = lokal && lokal.length < 30 ? lokal.replace(/\b\w/g, (x: string) => x.toUpperCase()) : "";
  const s = susunBalasan(nama, flags);
  return ok(c, {
    perluBalasan: perlu, flags, jenis: s.jenis, saran: s.teks,
    catatan: "Draf saran berbasis aturan Golden Rule. Periksa sebelum minta persetujuan; tidak terkirim otomatis.",
  });
});
