import type { Sql } from "./db";

export interface AuditInput {
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  ok: boolean;
}

export async function audit(sql: Sql, input: AuditInput): Promise<void> {
  await sql.query(
    "INSERT INTO public.audit_log (actor, action, resource_type, resource_id, request_id, ok) VALUES ($1, $2, $3, $4, $5, $6)",
    [input.actor, input.action, input.resourceType, input.resourceId, input.requestId, input.ok],
  );
}
