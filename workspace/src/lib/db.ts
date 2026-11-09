import { neon } from "@neondatabase/serverless";
import type { Env } from "../env";

export function getSql(env: Env) {
  return neon(env.DATABASE_URL);
}
