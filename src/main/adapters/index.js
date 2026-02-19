const { createLocalAdapter } = require('./local');
const { createTelegramAdapter } = require('./telegram');
const { createDiscordAdapter } = require('./discord');
const { createSlackAdapter } = require('./slack');
const { createWhatsAppAdapter } = require('./whatsapp');
const { createWebhookServer } = require('../webhook');

function createAdapters({ bus, log, config }) {
  const needsWebhook = !!config?.adapters?.whatsapp;
  const webhookServer = needsWebhook ? createWebhookServer({ port: config.webhookPort, log }) : null;
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
