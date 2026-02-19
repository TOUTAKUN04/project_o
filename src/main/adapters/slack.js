const { createAdapterContext } = require('./adapter-base');

function createSlackAdapter({ bus, log, config } = {}) {
  const appToken = process.env.SLACK_APP_TOKEN || '';
  const botToken = process.env.SLACK_BOT_TOKEN || '';
  const enabled = !!config?.adapters?.slack && !!appToken && !!botToken;
  const ctx = createAdapterContext({ name: 'slack', bus, log, enabled });

  let socket = null;
  let web = null;

  async function start() {
    if (!enabled) {
      if (config?.adapters?.slack && (!appToken || !botToken)) {
        ctx.warn('disabled (missing SLACK_APP_TOKEN or SLACK_BOT_TOKEN)');
      }
      return;
    }
    try {
      const { SocketModeClient } = require('@slack/socket-mode');
      const { WebClient } = require('@slack/web-api');
      socket = new SocketModeClient({ appToken });
      web = new WebClient(botToken);

      socket.on('message', async ({ envelope_id, payload }) => {
        try {
          await socket.ack(envelope_id);
        } catch {
          // ignore
        }

        if (!payload || payload.type !== 'events_api') return;
        const event = payload.event;
        if (!event || event.type !== 'message') return;
        if (event.subtype || event.bot_id) return;
        ctx.publish({
          userId: String(event.user || ''),
          channelId: String(event.channel || ''),
          text: event.text || '',
          metadata: {
            ts: event.ts,
            threadTs: event.thread_ts,
          },
        });
      });

      socket.on('error', (error) => ctx.error('socket error', { error: String(error) }));

      await socket.start();
      ctx.info('started');
    } catch (error) {
      ctx.error('start failed', { error: String(error) });
    }
  }

  async function stop() {
    try {
      if (socket) await socket.disconnect();
      socket = null;
    } catch (error) {
      ctx.error('stop failed', { error: String(error) });
    }
  }

  async function sendMessage({ channelId, text }) {
    if (!enabled || !web) return { ok: false, reason: 'disabled' };
    if (!channelId) return { ok: false, reason: 'missing_channel' };
    try {
      await web.chat.postMessage({ channel: channelId, text });
      return { ok: true };
    } catch (error) {
      ctx.error('send failed', { error: String(error) });
      return { ok: false, reason: 'send_failed' };
    }
  }

  return {
    name: 'slack',
    enabled,
    start,
    stop,
    sendMessage,
  };
}

module.exports = { createSlackAdapter };