import { neon } from "@neondatabase/serverless";
import type { Env } from "../env";

export type Sql = ReturnType<typeof neon>;

export function getSql(env: Pick<Env, "DATABASE_URL">): Sql {
  return neon(env.DATABASE_URL);
}

export type TransactionQueries = Parameters<Sql["transaction"]>[0];

export function tx(sql: Sql, queries: TransactionQueries) {
  return sql.transaction(queries);
}
