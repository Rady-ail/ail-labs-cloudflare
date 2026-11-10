import type { getSql } from "./db";

type Sql = ReturnType<typeof getSql>;

export async function writeAudit(
  sql: Sql,
  entry: {
    actor: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    requestId?: string | null;
    ok: boolean;
  },
): Promise<void> {
  await sql`INSERT INTO audit_log
    (actor, action, resource_type, resource_id, request_id, ok)
    VALUES
    (${entry.actor}, ${entry.action}, ${entry.resourceType}, ${entry.resourceId ?? null}, ${entry.requestId ?? null}, ${entry.ok})`;
}
