const { createAdapterContext } = require('./adapter-base');

function createTelegramAdapter({ bus, log, config } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const enabled = !!config?.adapters?.telegram && !!token;
  const ctx = createAdapterContext({ name: 'telegram', bus, log, enabled });
  const pollIntervalMs = Number.parseInt(process.env.TELEGRAM_POLL_INTERVAL_MS || '3000', 10);

  let timer = null;
  let offset = 0;
  let inFlight = false;

  async function poll() {
    if (inFlight) return;
    inFlight = true;
    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=20&offset=${offset}`;
      const res = await fetch(url);
      if (!res.ok) {
        ctx.warn('poll failed', { status: res.status });
        return;
      }
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.result)) return;
      for (const update of data.result) {
        offset = Math.max(offset, update.update_id + 1);
        const message = update.message || update.edited_message;
        if (!message || !message.text) continue;
        ctx.publish({
          userId: String(message.from?.id || ''),
          channelId: String(message.chat?.id || ''),
          text: message.text,
          metadata: {
            chatType: message.chat?.type,
            messageId: message.message_id,
          },
        });
      }
    } catch (error) {
      ctx.error('poll exception', { error: String(error) });
    } finally {
      inFlight = false;
    }
  }

  async function start() {
    if (!enabled) {
      if (config?.adapters?.telegram && !token) ctx.warn('disabled (missing TELEGRAM_BOT_TOKEN)');
      return;
    }
    ctx.info('started');
    await poll();
    timer = setInterval(poll, Number.isFinite(pollIntervalMs) ? pollIntervalMs : 3000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    ctx.info('stopped');
  }

  async function sendMessage({ channelId, text }) {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (!channelId) return { ok: false, reason: 'missing_channel' };
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: channelId, text }),
      });
      if (!res.ok) return { ok: false, reason: `http_${res.status}` };
      return { ok: true };
    } catch (error) {
      ctx.error('send failed', { error: String(error) });
      return { ok: false, reason: 'send_failed' };
    }
  }

  return {
    name: 'telegram',
    enabled,
    start,
    stop,
    sendMessage,
  };
}

module.exports = { createTelegramAdapter };