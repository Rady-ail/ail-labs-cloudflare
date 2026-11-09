import { describe, test, expect } from "vitest";
import { app } from "../src/index";
import { getDb } from "./pgmock";
const env: any = { API_TOKEN: "tok", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run" };
const H = { Authorization: "Bearer tok" };
const call = (p: string) => app.request(p, { headers: H }, env);
describe("aktivitas (audit_log) hanya-baca", () => {
  test("daftar, filter, summary, validasi, auth", async () => {
    const db = await getDb();
    await db.exec(`INSERT INTO audit_log (actor,action,resource_type,resource_id,ok) VALUES
      ('owner','katalog.order.status','catalog_order','a',true),('owner','katalog.product.price','catalog_product','b',false),('access','crm.clinic.update','clinic','c',true);`);
    let j: any = await (await call("/api/aktivitas")).json(); expect(j.data.length).toBeGreaterThanOrEqual(3);
    j = await (await call("/api/aktivitas?ok=false")).json(); expect(j.data.every((r: any) => r.ok === false)).toBe(true);
    j = await (await call("/api/aktivitas?q=katalog.")).json(); expect(j.data.length).toBeGreaterThanOrEqual(2); expect(j.data.every((r: any) => r.action.startsWith("katalog."))).toBe(true);
    j = await (await call("/api/aktivitas?q=%25")).json(); expect(j.data.length).toBe(0);
    j = await (await call("/api/aktivitas/summary")).json(); expect(j.data.last_24h.total).toBeGreaterThanOrEqual(3); expect(j.data.last_24h.failed).toBeGreaterThanOrEqual(1); expect(j.data.last_event_at).toBeTruthy();
    expect((await call("/api/aktivitas?ok=x")).status).toBe(400);
    expect((await call("/api/aktivitas?foo=1")).status).toBe(400);
    expect((await app.request("/api/aktivitas", {}, env)).status).toBe(401);
    expect((await app.request("/api/aktivitas", { method: "POST", headers: H }, env)).status).toBeGreaterThanOrEqual(400);
  });
});
