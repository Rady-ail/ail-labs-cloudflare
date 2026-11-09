import { describe, test, expect } from "vitest";
import { app } from "../src/index";
import { getDb } from "./pgmock";
const env: any = { API_TOKEN: "tok", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run" };
const H = { Authorization: "Bearer tok", "Content-Type": "application/json" };
const call = (p: string, init: any = {}) => app.request(p, { headers: H, ...init }, env);
let pid = "", oid = "";
describe("katalog pada Postgres nyata (pglite)", () => {
  test("seed + list + filter + summary", async () => {
    const db = await getDb();
    await db.exec(`INSERT INTO catalog_categories (legacy_id,name,group_name,sort_order) VALUES (1,'Infus','Obat',1),(2,'Injeksi','Obat',2);
      INSERT INTO catalog_products (legacy_id,category_id,name,kandungan,harga,aktif) SELECT 10,id,'Infus NS 100 ml','NaCl 0,9%',5000,true FROM catalog_categories WHERE legacy_id=1;
      INSERT INTO catalog_products (legacy_id,category_id,name,aktif) SELECT 11,id,'Trilac 40',false FROM catalog_categories WHERE legacy_id=2;
      INSERT INTO catalog_orders (legacy_id,customer_name,items,total) VALUES (1,'Klinik A','[{"name":"x","qty":1}]',5000);`);
    let j: any = await (await call("/api/katalog/products")).json(); expect(j.data.length).toBe(2); pid = j.data.find((x: any) => x.legacy_id === 10).id;
    expect(j.meta.total).toBe(2);
    j = await (await call("/api/katalog/products?aktif=true")).json(); expect(j.data.length).toBe(1);
    j = await (await call("/api/katalog/products?q=100%25")).json(); expect(j.data.length).toBe(0);
    j = await (await call("/api/katalog/products?q=nacl")).json(); expect(j.data.length).toBe(1);
    j = await (await call("/api/katalog/categories")).json(); expect(j.data[0].product_count).toBe(1);
    j = await (await call("/api/katalog/summary")).json(); expect(j.data.products).toEqual({ total: 2, active: 1, without_price: 1 });
    expect(j.data.orders_by_status).toEqual([{ status: "baru", total: 1 }]);
  });
  test("ubah produk; harga hanya owner", async () => {
    let r = await call(`/api/katalog/products/${pid}`, { method: "PATCH", body: JSON.stringify({ manfaat: "Rehidrasi", aktif: false }) }); expect(r.status).toBe(200);
    r = await call(`/api/katalog/products/${pid}`, { method: "PATCH", body: JSON.stringify({ harga: 6000 }) }); expect(r.status).toBe(200);
    r = await app.request(`/api/katalog/products/${pid}`, { method: "PATCH", body: JSON.stringify({ harga: 1 }), headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": "x" } }, env); expect([401, 403]).toContain(r.status);
    r = await call(`/api/katalog/products/${pid}`, { method: "PATCH", body: JSON.stringify({ harga: -1 }) }); expect(r.status).toBe(422);
    r = await call(`/api/katalog/products/${pid}`, { method: "PATCH", body: JSON.stringify({ foo: 1 }) }); expect(r.status).toBe(400);
    r = await call(`/api/katalog/products/${crypto.randomUUID()}`, { method: "PATCH", body: JSON.stringify({ aktif: true }) }); expect([404, 400]).toContain(r.status);
    const j: any = await (await call("/api/katalog/products?q=infus")).json(); expect(j.data[0].harga).toBe(6000); expect(j.data[0].manfaat).toBe("Rehidrasi");
  });
  test("pesanan: daftar dan ubah status", async () => {
    let j: any = await (await call("/api/katalog/orders")).json(); expect(j.data.length).toBe(1); oid = j.data[0].id;
    let r = await call(`/api/katalog/orders/${oid}`, { method: "PATCH", body: JSON.stringify({ status: "diproses" }) }); expect(r.status).toBe(200);
    r = await call(`/api/katalog/orders/${oid}`, { method: "PATCH", body: JSON.stringify({ status: "lunas" }) }); expect(r.status).toBe(422);
    j = await (await call("/api/katalog/orders?status=diproses")).json(); expect(j.data.length).toBe(1);
  });
});
