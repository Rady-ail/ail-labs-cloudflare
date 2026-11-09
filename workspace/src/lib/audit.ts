import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<any, any>;

export async function audit(
  sql: Sql,
  e: {
    actor: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    requestId?: string | null;
    ok: boolean;
  },
): Promise<void> {
  try {
    await sql`INSERT INTO audit_log
      (actor, action, resource_type, resource_id, request_id, ok)
      VALUES
      (${e.actor}, ${e.action}, ${e.resourceType}, ${e.resourceId ?? null}, ${e.requestId ?? null}, ${e.ok})`;
  } catch {
    // Audit failures must never interrupt the primary operation.
  }
}
