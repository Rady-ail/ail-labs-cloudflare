import { neon } from "@neondatabase/serverless";
import type { Env } from "../env";

export function getSql(env: Env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(env.DATABASE_URL);
}
