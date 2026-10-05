const crypto = require('crypto');

const RESEND_API_URL = 'https://api.resend.com';
const ZOHO_FORWARD_TO = process.env.ZOHO_FORWARD_TO || 'rady@ail-aesthetic-labs.my.id';
const FORWARD_FROM = process.env.RESEND_FORWARD_FROM || 'AIL LABS Inbound <inbox@ail-aesthetic-labs.my.id>';

function getHeader(req, name) {
  return req.get(name) || '';
}

function verifyResendWebhook(req) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) throw new Error('RESEND_WEBHOOK_SECRET is not configured');

  const svixId = getHeader(req, 'svix-id');
  const svixTimestamp = getHeader(req, 'svix-timestamp');
  const svixSignature = getHeader(req, 'svix-signature');
  const rawBody = req.rawBody;

  if (!svixId || !svixTimestamp || !svixSignature || !rawBody) {
    return false;
  }

  const timestamp = Number(svixTimestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return false;
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = Buffer.concat([
    Buffer.from(`${svixId}.${svixTimestamp}.`),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody),
  ]);
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  return svixSignature.split(' ').some(value => {
    const signature = value.replace(/^v1,/, '');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

async function resendRequest(path, options = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');

  const response = await fetch(`${RESEND_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

  if (!response.ok) {
    const error = new Error(`Resend API error ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function unwrapData(result) {
  return result && result.data ? result.data : result;
}

async function forwardReceivedEmail(event) {
  const emailId = event?.data?.email_id;
  if (!emailId) throw new Error('Webhook payload has no data.email_id');

  const received = unwrapData(await resendRequest(`/emails/receiving/${encodeURIComponent(emailId)}`));
  const attachmentsResult = await resendRequest(
    `/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
  );
  const attachments = Array.isArray(attachmentsResult?.data)
    ? attachmentsResult.data
    : [];

  const payload = {
    from: FORWARD_FROM,
    to: [ZOHO_FORWARD_TO],
    reply_to: received.from ? [received.from] : undefined,
    subject: received.subject || event.data.subject || '(no subject)',
    text: received.text || '',
    html: received.html || undefined,
    attachments: attachments
      .filter(att => att && att.download_url)
      .map(att => ({
        filename: att.filename || 'attachment',
        url: att.download_url,
        content_type: att.content_type || undefined,
      })),
    headers: {
      'X-AIL-Original-Message-ID': received.message_id || event.data.message_id || emailId,
      'X-AIL-Resend-Received-ID': emailId,
      'X-AIL-Forwarded-To': ZOHO_FORWARD_TO,
    },
    idempotencyKey: `ail-labs-inbound-${emailId}`,
  };

  const sent = await resendRequest('/emails', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return { receivedEmailId: emailId, forwardedEmailId: sent?.id || sent?.data?.id || null };
}

module.exports = async function resendInbound(req, res) {
  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    if (!verifyResendWebhook(req)) {
      return res.status(401).json({ ok: false, error: 'Invalid webhook signature' });
    }

    const event = req.body;
    if (event?.type !== 'email.received') {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const result = await forwardReceivedEmail(event);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[resend-inbound]', error?.message || error);
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Inbound forwarding failed',
    });
  }
};
