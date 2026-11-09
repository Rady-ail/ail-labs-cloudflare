import { Hono } from "hono";
import type { AppEnv } from "../lib/http";
import { getSql } from "../lib/db";

const health = new Hono<AppEnv>();

health.get("/", async (c) => {
  try {
    await getSql(c.env).query("SELECT 1 AS ok");
    return c.json({ ok: true, db: true, time: new Date().toISOString() }, 200);
  } catch {
    return c.json({ ok: false, db: false, time: new Date().toISOString() }, 503);
  }
});

export default health;
