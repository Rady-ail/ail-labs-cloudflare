import { describe, test, expect } from "vitest";
import { app } from "../src/index";
const env: any = { API_TOKEN: "kata-sandi-benar-123", DATABASE_URL: "postgres://x", DEV: "0", EMAIL_SEND_MODE: "dry-run" };
const call = (tok: string, ip: string) => app.request("/api/pengingat", { headers: { Authorization: `Bearer ${tok}`, "CF-Connecting-IP": ip } }, env);

describe("batas percobaan masuk gagal", () => {
  test("10 salah -> 429, termasuk kata sandi benar dari IP yang sama; IP lain tidak terpengaruh", async () => {
    for (let i = 0; i < 10; i++) expect((await call("salah-" + i, "9.9.9.9")).status).toBe(401);
    expect((await call("salah-x", "9.9.9.9")).status).toBe(429);
    expect((await call("kata-sandi-benar-123", "9.9.9.9")).status).toBe(429);
    expect((await call("kata-sandi-benar-123", "8.8.8.8")).status).not.toBe(401);
  });
});
