const { createLocalAdapter } = require('./local');
const { createTelegramAdapter } = require('./telegram');
const { createDiscordAdapter } = require('./discord');
const { createSlackAdapter } = require('./slack');
const { createWhatsAppAdapter } = require('./whatsapp');
const { createWebhookServer } = require('../webhook');

function createAdapters({ bus, log, config }) {
  const needsWebhook = !!config?.adapters?.whatsapp;
  const remoteWebhookRequested = process.env.OVERLAY_WEBHOOK_ALLOW_REMOTE === '1';
  const hasWhatsAppSecret = !!String(process.env.WHATSAPP_APP_SECRET || '').trim();
  const allowRemoteWebhook = remoteWebhookRequested && hasWhatsAppSecret;
  const webhookHost = allowRemoteWebhook ? '0.0.0.0' : '127.0.0.1';
  const webhookToken = String(process.env.OVERLAY_WEBHOOK_TOKEN || '').trim();
  const rateLimitWindowMs = Number.parseInt(process.env.OVERLAY_WEBHOOK_RATE_LIMIT_WINDOW_MS || '60000', 10);
  const rateLimitMax = Number.parseInt(process.env.OVERLAY_WEBHOOK_RATE_LIMIT_MAX || '120', 10);
  const webhookServer = needsWebhook
    ? createWebhookServer({
      port: config.webhookPort,
      host: webhookHost,
      requireLocal: !allowRemoteWebhook,
      authToken: webhookToken,
      authExemptPaths: ['/whatsapp/webhook'],
      rateLimitWindowMs: Number.isFinite(rateLimitWindowMs) && rateLimitWindowMs > 0 ? rateLimitWindowMs : 60000,
      maxRequestsPerWindow: Number.isFinite(rateLimitMax) && rateLimitMax > 0 ? rateLimitMax : 120,
      log,
    })
    : null;
  const whatsappAdapter = createWhatsAppAdapter({ bus, log, config, webhook: webhookServer });
  const webhookEnabled = !!(webhookServer && whatsappAdapter.enabled);

  const adapters = [
    createLocalAdapter({ bus, log, config }),
    createTelegramAdapter({ bus, log, config }),
    createDiscordAdapter({ bus, log, config }),
    createSlackAdapter({ bus, log, config }),
    whatsappAdapter,
  ];

  const map = new Map(adapters.map((adapter) => [adapter.name, adapter]));

  function start() {
    if (needsWebhook && remoteWebhookRequested && !hasWhatsAppSecret) {
      log('error', 'Remote webhook requested but WHATSAPP_APP_SECRET is missing; forcing local-only mode');
    }
    if (needsWebhook && !allowRemoteWebhook && !webhookToken) {
      log('warn', 'Webhook is local-only without auth token (set OVERLAY_WEBHOOK_TOKEN for stricter protection)');
    }
    if (needsWebhook && allowRemoteWebhook && !webhookToken) {
      log('warn', 'Remote webhook enabled without OVERLAY_WEBHOOK_TOKEN');
    }
    if (webhookEnabled) webhookServer.start();
    adapters.forEach((adapter) => adapter.start && adapter.start());
  }

  function stop() {
    adapters.forEach((adapter) => adapter.stop && adapter.stop());
    if (webhookEnabled) webhookServer.stop();
  }

  function get(name) {
    return map.get(name);
  }

  return {
    adapters,
    start,
    stop,
    get,
  };
}

module.exports = { createAdapters };
