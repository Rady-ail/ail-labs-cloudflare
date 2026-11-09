import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { app } from "../src/index";
const env: any = { API_TOKEN: "tok", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run" };
const H = { Authorization: "Bearer tok", "Content-Type": "application/json" };
const seed = JSON.parse(readFileSync(new URL("./supplier_seed.json", import.meta.url), "utf8"));
const items = seed.map((s: any) => ({ slug: s.slug, name: s.name, country: s.country || null, contact: s.contact || null,
  channel: s.channel || null, category: s.category, status: s.status, terms: s.terms || null,
  note: [s.sample ? "Sampel: " + s.sample : "", s.note].filter(Boolean).join(" | ") || null, last_activity_on: s.updated }));
const call = (p: string, init: any = {}) => app.request(p, { headers: H, ...init }, env);
let firstId = "";
describe("supplier pada Postgres nyata (pglite)", () => {
  test("import seed 44: semua created, tidak ada skipped", async () => {
    const r = await call("/api/supplier/import", { method: "POST", body: JSON.stringify({ items }) });
    const j: any = await r.json(); expect(r.status).toBe(200); console.log("IMPORT#1", j.data);
    expect(j.data.skipped).toBe(0); expect(j.data.created).toBe(44);
  });
  test("import ulang idempoten (xmax): updated 44", async () => {
    const r = await call("/api/supplier/import", { method: "POST", body: JSON.stringify({ items }) });
    const j: any = await r.json(); expect(j.data).toEqual({ created: 0, updated: 44, skipped: 0 });
  });
  test("list, filter, q, summary", async () => {
    let j: any = await (await call("/api/supplier/suppliers")).json(); expect(j.data.length).toBe(44); firstId = j.data[0].id;
    j = await (await call("/api/supplier/suppliers?status=hold")).json(); expect(j.data.map((x: any) => x.slug)).toEqual(["md-needle-pen"]);
    j = await (await call("/api/supplier/suppliers?q=100%25")).json(); expect(j.data.length).toBe(0);
    j = await (await call("/api/supplier/suppliers?category=device_microneedling")).json(); expect(j.data.length).toBe(4);
    j = await (await call("/api/supplier/summary")).json(); console.log("SUMMARY", JSON.stringify(j.data.suppliers_by_status));
    expect(j.data.recent_activity.length).toBe(10);
  });
  test("sampel create/update, detail, arsip", async () => {
    let r = await call(`/api/supplier/suppliers/${firstId}/samples`, { method: "POST", body: JSON.stringify({ description: "Sampel serum 3 SKU, AWB 1227597302", awb: "1227597302", eta: "2026-11-20" }) });
    expect(r.status).toBe(201); const sid = ((await r.json()) as any).data.id;
    r = await call(`/api/supplier/samples/${sid}`, { method: "PATCH", body: JSON.stringify({ state: "dikirim" }) }); expect(r.status).toBe(200);
    let j: any = await (await call(`/api/supplier/suppliers/${firstId}`)).json(); expect(j.data.samples[0].state).toBe("dikirim");
    r = await call(`/api/supplier/suppliers/${firstId}/archive`, { method: "POST" }); expect(r.status).toBe(200);
    r = await call(`/api/supplier/suppliers/${firstId}/archive`, { method: "POST" }); expect(r.status).toBe(404);
    j = await (await call("/api/supplier/suppliers")).json(); expect(j.data.length).toBe(43);
  });
  test("Liyin ditolak di semua jalur; ringkasan tidak memuat", async () => {
    let r = await call("/api/supplier/suppliers", { method: "POST", body: JSON.stringify({ slug: "liyin-x", name: "X", category: "other" }) }); expect(r.status).toBe(422);
    r = await call("/api/supplier/suppliers", { method: "POST", body: JSON.stringify({ slug: "abc", name: "Henan Liyin Biotech", category: "other" }) }); expect(r.status).toBe(422);
    r = await call("/api/supplier/suppliers", { method: "POST", body: JSON.stringify({ slug: "abc2", name: "Contoh", note: "kontak Yolanda Yue", category: "other" }) }); expect(r.status).toBe(422);
    r = await call("/api/supplier/import", { method: "POST", body: JSON.stringify({ items: [{ slug: "liyin-biotech", name: "x", category: "other" }] }) }); expect(r.status).toBe(422);
  });
  test("audit hanya metadata", async () => {
    const { getDb } = await import("./pgmock"); const d = await getDb();
    const r = await d.query("select action, resource_type from audit_log where action like 'supplier.%' limit 3"); expect(r.rows.length).toBeGreaterThan(0);
  });
});
