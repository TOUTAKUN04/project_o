const { createAdapterContext } = require('./adapter-base');

function createDiscordAdapter({ bus, log, config } = {}) {
  const token = process.env.DISCORD_BOT_TOKEN || '';
  const enabled = !!config?.adapters?.discord && !!token;
  const ctx = createAdapterContext({ name: 'discord', bus, log, enabled });

  let client = null;

  async function start() {
    if (!enabled) {
      if (config?.adapters?.discord && !token) ctx.warn('disabled (missing DISCORD_BOT_TOKEN)');
      return;
    }
    try {
      const { Client, GatewayIntentBits, Partials } = require('discord.js');
      client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel],
      });

      client.on('messageCreate', (message) => {
        if (!message || message.author?.bot) return;
        ctx.publish({
          userId: String(message.author?.id || ''),
          channelId: String(message.channel?.id || ''),
          text: message.content || '',
          metadata: {
            guildId: message.guildId,
            messageId: message.id,
          },
        });
      });

      client.on('error', (error) => {
        ctx.error('client error', { error: String(error) });
      });

      await client.login(token);
      ctx.info('started');
    } catch (error) {
      ctx.error('start failed', { error: String(error) });
    }
  }

  async function stop() {
    try {
      if (client) {
        await client.destroy();
        client = null;
      }
    } catch (error) {
      ctx.error('stop failed', { error: String(error) });
    }
  }

  async function sendMessage({ channelId, text }) {
    if (!enabled || !client) return { ok: false, reason: 'disabled' };
    if (!channelId) return { ok: false, reason: 'missing_channel' };
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.send) return { ok: false, reason: 'invalid_channel' };
      await channel.send(text);
      return { ok: true };
    } catch (error) {
      ctx.error('send failed', { error: String(error) });
      return { ok: false, reason: 'send_failed' };
    }
  }

  return {
    name: 'discord',
    enabled,
    start,
    stop,
    sendMessage,
  };
}

module.exports = { createDiscordAdapter };