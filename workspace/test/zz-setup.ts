import { vi } from "vitest";
vi.mock("@neondatabase/serverless", async () => { const m = await import("./pgmock"); const sql = m.makeNeon(); return { neon: () => sql }; });
