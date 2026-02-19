# Adapters

These adapters connect the Gateway Core to external messaging platforms.
They are disabled by default and require environment variables.

## Telegram
- Env: `TELEGRAM_BOT_TOKEN`
- Polls via Bot API (`getUpdates`).

## Discord
- Env: `DISCORD_BOT_TOKEN`
- Uses Discord Gateway via `discord.js`.

## Slack
- Env: `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`
- Uses Socket Mode.

## WhatsApp (Cloud API)
- Env: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`
- Webhook path: `/whatsapp/webhook`
- Port: `webhookPort` in config

## Enable
In `%AppData%\overlay\config.json`:
```json
{
  "adapters": {
    "telegram": true,
    "discord": true,
    "slack": true,
    "whatsapp": true
  }
}
```

Optional:
- `adaptersAutoReply` to enable auto-replies from the LLM.