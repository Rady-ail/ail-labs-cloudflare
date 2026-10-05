const API = 'https://api.resend.com';
const ZOHO_TO = 'rady@ail-aesthetic-labs.my.id';
const FROM = 'AIL LABS Inbound <inbox@ail-aesthetic-labs.my.id>';

function base64ToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify(request, raw, secret) {
  if (!secret) return false;
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signatures = request.headers.get('svix-signature');
  if (!id || !timestamp || !signatures) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const key = await crypto.subtle.importKey('raw', base64ToBytes(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new TextEncoder().encode(id + '.' + timestamp + '.' + new TextDecoder().decode(raw));
  const signature = await crypto.subtle.sign('HMAC', key, signed);
  const expected = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return signatures.split(' ').some(v => timingSafeEqual(v.replace(/^v1,/, ''), expected));
}

async function resend(path, key, options = {}) {
  if (!key) throw new Error('RESEND_API_KEY is not configured');
  const r = await fetch(API + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + key, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const text = await r.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (!r.ok) throw new Error('Resend API ' + r.status + ': ' + (body?.message || text));
  return body;
}

export async function handleResendInbound(request, env) {
  const raw = await request.arrayBuffer();
  if (!(await verify(request, raw, env.RESEND_WEBHOOK_SECRET))) return new Response('Invalid webhook signature', { status: 401 });
  let event;
  try { event = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response('Invalid JSON', { status: 400 }); }
  if (event?.type !== 'email.received') return Response.json({ ok: true, ignored: true });
  const emailId = event?.data?.email_id;
  if (!emailId) return Response.json({ ok: false, error: 'Missing email_id' }, { status: 400 });

  try {
    const received = (await resend('/emails/receiving/' + encodeURIComponent(emailId), env.RESEND_API_KEY))?.data ?? {};
    const listed = await resend('/emails/receiving/' + encodeURIComponent(emailId) + '/attachments', env.RESEND_API_KEY);
    const attachments = (listed?.data || []).filter(a => a?.download_url).map(a => ({ filename: a.filename || 'attachment', url: a.download_url, content_type: a.content_type }));
    const payload = {
      from: FROM,
      to: [env.ZOHO_FORWARD_TO || ZOHO_TO],
      reply_to: received.from ? [received.from] : undefined,
      subject: received.subject || event.data.subject || '(no subject)',
      text: received.text || '',
      html: received.html || undefined,
      attachments,
      headers: { 'X-AIL-Original-Message-ID': received.message_id || event.data.message_id || emailId, 'X-AIL-Resend-Received-ID': emailId },
    };
    const sent = await resend('/emails', env.RESEND_API_KEY, { method: 'POST', headers: { 'Idempotency-Key': 'ail-labs-inbound-' + emailId }, body: JSON.stringify(payload) });
    return Response.json({ ok: true, receivedEmailId: emailId, forwardedEmailId: sent?.id || sent?.data?.id || null });
  } catch (error) {
    console.error('[resend-inbound]', error?.message || error);
    return Response.json({ ok: false, error: error?.message || 'Forwarding failed' }, { status: 500 });
  }
}
