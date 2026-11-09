import { test, expect } from "vitest";
import { app } from "../src/index";

const secretBytes = new Uint8Array(32).map((_, index) => index + 1);
const secret = `whsec_${btoa(String.fromCharCode(...secretBytes))}`;
const env: any = {
  DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
  API_TOKEN: "webhook-test-token",
  EMAIL_SEND_MODE: "dry-run",
  RESEND_API_KEY: "",
  RESEND_WEBHOOK_SECRET: secret,
};

async function signedHeaders(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const id = `msg_${crypto.randomUUID()}`;
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  ));
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${btoa(String.fromCharCode(...signature))}`,
    "Content-Type": "application/json",
  };
}

test("Resend webhook returns 503 when its signing secret is not configured", async () => {
  const response = await app.request("/api/webhooks/resend", {
    method: "POST",
    body: "{}",
  }, { ...env, RESEND_WEBHOOK_SECRET: "" });
  expect(response.status).toBe(503);
});

test("Resend webhook rejects a stale Svix timestamp", async () => {
  const body = JSON.stringify({ type: "email.unknown", data: {} });
  const timestamp = String(Math.floor(Date.now() / 1000) - 301);
  const headers = await signedHeaders(body, timestamp);
  const response = await app.request("/api/webhooks/resend", {
    method: "POST",
    headers,
    body,
  }, env);
  expect(response.status).toBe(401);
});

test("Resend webhook rejects an invalid signature", async () => {
  const body = JSON.stringify({ type: "email.unknown", data: {} });
  const headers = await signedHeaders(body);
  headers["svix-signature"] = "v1,ZmFrZQ==";
  const response = await app.request("/api/webhooks/resend", {
    method: "POST",
    headers,
    body,
  }, env);
  expect(response.status).toBe(401);
});

test("Resend webhook enforces the raw-body size limit", async () => {
  const body = "x".repeat(1_048_577);
  const response = await app.request("/api/webhooks/resend", {
    method: "POST",
    body,
  }, env);
  expect(response.status).toBe(413);
});

test("Resend webhook accepts a correctly signed event envelope", async () => {
  const body = JSON.stringify({ type: "email.unknown", data: {} });
  const headers = await signedHeaders(body);
  const response = await app.request("/api/webhooks/resend", {
    method: "POST",
    headers,
    body,
  }, env);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ received: true });
});
