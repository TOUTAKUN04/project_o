const crypto = require('crypto');
const { createAdapterContext } = require('./adapter-base');

function extractMessages(body) {
  const entries = body?.entry || [];
  const messages = [];
  for (const entry of entries) {
    const changes = entry?.changes || [];
    for (const change of changes) {
      const value = change?.value;
      const incoming = value?.messages || [];
      for (const msg of incoming) {
        if (msg?.type === 'text') {
          messages.push({
            from: msg.from,
            text: msg.text?.body || '',
            id: msg.id,
            metadata: value?.metadata,
          });
        }
      }
    }
  }
  return messages;
}

function isValidMetaSignature({ body, signatureHeader, appSecret }) {
  if (!appSecret) return true;
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(body || '', 'utf8').digest('hex')}`;
  const incoming = signatureHeader.trim();
  if (incoming.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(incoming), Buffer.from(expected));
  } catch {
    return false;
  }
}

function createWhatsAppAdapter({ bus, log, config, webhook } = {}) {
  const token = process.env.WHATSAPP_TOKEN || '';
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || '';
  const appSecret = process.env.WHATSAPP_APP_SECRET || '';
  const remoteWebhookRequested = process.env.OVERLAY_WEBHOOK_ALLOW_REMOTE === '1';
  const hasCoreConfig = !!config?.adapters?.whatsapp && !!token && !!phoneId && !!verifyToken && !!webhook;
  const enabled = hasCoreConfig && (!remoteWebhookRequested || !!appSecret);
  const ctx = createAdapterContext({ name: 'whatsapp', bus, log, enabled });

  function registerWebhook() {
    if (!webhook) return;
    webhook.register('GET', '/whatsapp/webhook', async ({ url, res }) => {
      const mode = url.searchParams.get('hub.mode');
      const tokenParam = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && tokenParam === verifyToken) {
        res.statusCode = 200;
        res.end(challenge || '');
        return;
      }
      res.statusCode = 403;
      res.end('forbidden');
    });

    webhook.register('POST', '/whatsapp/webhook', async ({ req, body, res }) => {
      try {
        const signatureHeader = req?.headers?.['x-hub-signature-256'];
        if (!isValidMetaSignature({ body, signatureHeader, appSecret })) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }

        const payload = JSON.parse(body || '{}');
        const msgs = extractMessages(payload);
        msgs.forEach((msg) => {
          ctx.publish({
            userId: String(msg.from || ''),
            channelId: String(phoneId),
            text: msg.text || '',
            metadata: {
              messageId: msg.id,
              phoneNumberId: msg.metadata?.phone_number_id,
            },
          });
        });
        res.statusCode = 200;
        res.end('ok');
      } catch (error) {
        ctx.error('webhook parse failed', { error: String(error) });
        res.statusCode = 400;
        res.end('bad request');
      }
    });
  }

  async function start() {
    if (!enabled) {
      if (config?.adapters?.whatsapp && (!token || !phoneId || !verifyToken)) {
        ctx.warn('disabled (missing WHATSAPP_TOKEN/PHONE_NUMBER_ID/VERIFY_TOKEN)');
      } else if (config?.adapters?.whatsapp && remoteWebhookRequested && !appSecret) {
        ctx.warn('disabled (remote webhook requires WHATSAPP_APP_SECRET)');
      }
      return;
    }
    if (!appSecret) {
      ctx.warn('running without WHATSAPP_APP_SECRET; signature verification disabled');
    }
    registerWebhook();
    ctx.info('started');
  }

  async function stop() {
    ctx.info('stopped');
  }

  async function sendMessage({ channelId, text, to }) {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (!to) return { ok: false, reason: 'missing_recipient' };
    const targetId = channelId || phoneId;
    try {
      const res = await fetch(`https://graph.facebook.com/v18.0/${targetId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      });
      if (!res.ok) return { ok: false, reason: `http_${res.status}` };
      return { ok: true };
    } catch (error) {
      ctx.error('send failed', { error: String(error) });
      return { ok: false, reason: 'send_failed' };
    }
  }

  return {
    name: 'whatsapp',
    enabled,
    start,
    stop,
    sendMessage,
  };
}

module.exports = { createWhatsAppAdapter };
