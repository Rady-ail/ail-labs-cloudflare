import { test, expect } from "vitest";
import { neon } from "@neondatabase/serverless";
import { app } from "../src/index";

const runtime = (globalThis as any).process?.env ?? {};
const databaseUrl = runtime.DATABASE_URL as string | undefined;
const sql = databaseUrl ? neon(databaseUrl) : null;
const integration = test.skipIf(!sql);
const env: any = {
  DATABASE_URL: databaseUrl ?? "postgres://unused:unused@127.0.0.1:1/unused",
  API_TOKEN: runtime.API_TOKEN ?? "email-test-token",
  EMAIL_SEND_MODE: "dry-run",
  RESEND_API_KEY: "",
  RESEND_WEBHOOK_SECRET: "",
};
const headers = { Authorization: `Bearer ${env.API_TOKEN}`, "Content-Type": "application/json" };
const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);

integration("draft -> approval -> idempotent schedule -> cancel, all events recorded", async () => {
  const marker = `email-draft-test-${crypto.randomUUID()}`;
  const threadRows = await sql!`INSERT INTO email_threads (subject, folder) VALUES (${marker}, 'inbox') RETURNING id::text AS id`;
  const threadId = String(threadRows[0].id);
  let draftId = "";
  try {
    const create = await request("/api/email/drafts", {
      method: "POST", headers,
      body: JSON.stringify({
        threadId, subject: marker, to: ["clinic@example.test"], cc: [], bcc: [],
        bodyText: "Draft test body; never sent.",
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as any;
    draftId = String(created.data.id);
    expect(created.data.status).toBe("draft");
    expect(created.data.threadId).toBe(threadId);

    const requestApproval = await request(`/api/email/drafts/${draftId}/request-approval`, {
      method: "POST", headers, body: JSON.stringify({ comment: "Review requested" }),
    });
    expect(requestApproval.status).toBe(200);
    expect((await requestApproval.json() as any).data.status).toBe("needs_ok");

    const thread = await sql!`SELECT needs_approval FROM email_threads WHERE id = ${threadId}`;
    expect(thread[0].needs_approval).toBe(true);

    const approvalBody = JSON.stringify({ approvalDecision: "approve", idempotencyKey: `test-${crypto.randomUUID()}` });
    const approve = await request(`/api/email/drafts/${draftId}/approve`, {
      method: "POST", headers, body: approvalBody,
    });
    expect(approve.status).toBe(200);
    const first = (await approve.json() as any).data;
    expect(first).toMatchObject({ draftId, status: "scheduled" });
    expect(typeof first.jobId).toBe("string");

    const retry = await request(`/api/email/drafts/${draftId}/approve`, {
      method: "POST", headers, body: approvalBody,
    });
    expect(retry.status).toBe(200);
    expect((await retry.json() as any).data.jobId).toBe(first.jobId);

    const cancel = await request(`/api/email/drafts/${draftId}/cancel`, {
      method: "POST", headers, body: JSON.stringify({ reason: "Operator cancelled test job" }),
    });
    expect(cancel.status).toBe(200);
    expect((await cancel.json() as any).data.status).toBe("cancelled");

    const cancelAgain = await request(`/api/email/drafts/${draftId}/cancel`, {
      method: "POST", headers, body: JSON.stringify({ reason: "Second attempt" }),
    });
    expect(cancelAgain.status).toBe(409);
    expect((await cancelAgain.json() as any).error.code).toBe("STATE_CONFLICT");

    const events = await sql!`SELECT event_type FROM email_events
      WHERE draft_id = ${draftId} ORDER BY id`;
    const types = events.map((row: any) => row.event_type);
    expect(types).toEqual(expect.arrayContaining([
      "draft_created", "approval_requested", "draft_approved", "send_job_created", "send_job_cancelled",
    ]));
  } finally {
    if (draftId) await sql!`DELETE FROM email_events WHERE draft_id = ${draftId}`;
    await sql!`DELETE FROM email_events WHERE thread_id = ${threadId}`;
    if (draftId) await sql!`DELETE FROM email_drafts WHERE id = ${draftId}`;
    await sql!`DELETE FROM email_threads WHERE id = ${threadId}`;
  }
});

test("draft validation returns 400 for unknown fields and 422 for invalid recipients", async () => {
  const unknown = await request("/api/email/drafts", {
    method: "POST", headers,
    body: JSON.stringify({ subject: "x", to: [], cc: [], bcc: [], bodyText: "", extra: true }),
  });
  expect(unknown.status).toBe(400);
  expect((await unknown.json() as any).error.code).toBe("BAD_REQUEST");

  const invalid = await request("/api/email/drafts", {
    method: "POST", headers,
    body: JSON.stringify({ subject: "x", to: ["not-an-email"], cc: [], bcc: [], bodyText: "" }),
  });
  expect(invalid.status).toBe(422);
  expect((await invalid.json() as any).error.code).toBe("INVALID_EMAIL_INPUT");
});
