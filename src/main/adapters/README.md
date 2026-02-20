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
- Recommended env: `WHATSAPP_APP_SECRET` (validates `x-hub-signature-256`)
- Webhook path: `/whatsapp/webhook`
- Port: `webhookPort` in config

## Webhook Security
- Optional env: `OVERLAY_WEBHOOK_TOKEN`
  - Sent as `X-Overlay-Webhook-Token` or `Authorization: Bearer <token>`
- Optional env: `OVERLAY_WEBHOOK_ALLOW_REMOTE=1`
  - Enables binding to `0.0.0.0`; default is local-only loopback
- Optional env: `OVERLAY_WEBHOOK_RATE_LIMIT_WINDOW_MS` (default `60000`)
- Optional env: `OVERLAY_WEBHOOK_RATE_LIMIT_MAX` (default `120`)
- Note: `/whatsapp/webhook` is exempt from `OVERLAY_WEBHOOK_TOKEN` and relies on Meta verify/signature checks.
- If remote webhook mode is requested, `WHATSAPP_APP_SECRET` is required.

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
