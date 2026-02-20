# Olivia

Olivia is a Windows desktop assistant built on Electron with pluggable LLM providers.
It supports local/API chat, controlled file operations, and adapter-based message integrations.

## Core Features
- Local-first AI chat with Ollama
- OpenAI-compatible API provider option
- Native Gemini API provider option
- Permission-gated file create/save operations (15m/session grants with revoke)
- Allowed-roots restrictions for file access
- Guarded command runner with timeout + confirmation prompts
- Built-in web search panel and slash command (`/search ...`)
- Built-in git panel and slash commands (`/git status|log|diff|commit ...`)
- Auto Tool Mode: normal chat can trigger search/git/command/file intents
  - Risky intents (`run command`, `git commit`, file write/create/save) request explicit confirmation first.
- Conversation window trimming + short-lived chat response cache
- Voice controls with wake-word mode and push-to-talk mode
- Runtime simulated mood engine with decay and expressiveness controls
- Local SQLite memory store
- Optional adapters (Telegram, Discord, Slack, WhatsApp)

## Requirements
- Windows
- Node.js 18+
- Either:
  - Ollama running at `http://localhost:11434`, or
  - OpenAI-compatible API base URL + API key, or
  - Gemini API base URL + API key (`https://generativelanguage.googleapis.com/v1beta`)

## Quick Start
1. Install dependencies.
```powershell
npm install
```
2. Run the app.
```powershell
npm start
```

## Configuration
- Local config: `%AppData%\\olivia\\config.json`
- Local database: `%AppData%\\olivia\\memories.db`
- `llmProvider`: `ollama`, `openai`, or `gemini`
- `apiBaseUrl`: API base URL for `openai` or `gemini` mode
- `apiKey`: API key for `openai` or `gemini` mode
- `simulatedFeelings`: enable/disable simulated mood behavior
- `feelingsTone`: `calm`, `balanced`, `warm`
- `feelingsExpressiveness`: `subtle`, `balanced`, `expressive`
- `feelingsDecayMinutes`: mood decay window (`5` to `240`)
- `autoToolMode`: enable automatic tool intent handling from plain chat
- `micMode`: `wake` or `push`
- `speechRate`: voice playback speed (`0.8` to `1.8`)
- Main docs:
  - `architecture.md`
  - `architecture.mmd`
  - `api.md`
  - `src/main/adapters/README.md`

## Adapter Environment Variables
- `TELEGRAM_BOT_TOKEN`
- `DISCORD_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `SLACK_BOT_TOKEN`
- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET` (recommended for Meta signature checks)

## Webhook Security (Important)
- `OVERLAY_WEBHOOK_TOKEN`: shared secret required by webhook server (`X-Overlay-Webhook-Token` or `Authorization: Bearer ...`)
- `OVERLAY_WEBHOOK_ALLOW_REMOTE=1`: allows remote network access to the webhook server (disabled by default)
- `OVERLAY_WEBHOOK_RATE_LIMIT_WINDOW_MS`: webhook rate-limit window (default `60000`)
- `OVERLAY_WEBHOOK_RATE_LIMIT_MAX`: max requests per window per source/path (default `120`)

By default, webhook traffic is restricted to local loopback addresses for safety.
`/whatsapp/webhook` is exempt from `OVERLAY_WEBHOOK_TOKEN` because it uses Meta verify/signature validation.
If remote webhook mode is requested, `WHATSAPP_APP_SECRET` is required.

## Runtime Safety Tunables
- `OVERLAY_EDIT_PERMISSION_TTL_MS` (default `900000`)
- `OVERLAY_CONTROL_PERMISSION_TTL_MS` (default `900000`)
- `OVERLAY_OLLAMA_CHAT_CONNECT_TIMEOUT_MS` (default `30000`)
- `OVERLAY_OLLAMA_CHAT_INACTIVITY_TIMEOUT_MS` (default `45000`)
- `OVERLAY_OLLAMA_CHAT_RETRIES` (default `1`)
- `OVERLAY_CHAT_CACHE_TTL_MS` (default `120000`)
- `OVERLAY_CHAT_CACHE_MAX` (default `80`)
- `OVERLAY_OLLAMA_EMBED_TIMEOUT_MS` (default `15000`)
- `OVERLAY_OLLAMA_EMBED_RETRIES` (default `1`)
- `OVERLAY_MAX_MEMORY_VECTOR_SCAN` (default `2000`)
- `OVERLAY_MEMORY_RETENTION_MAX` (default `5000`)
- `OVERLAY_CAPTURE_RETENTION_DAYS` (default `14`)

## Master Access Gate
- By default, system-level actions are locked (`settings`, `file access`, `capture`, `command execution`).
- In chat, type your master code to trigger a challenge question.
- Only after a correct answer are system actions unlocked for a limited time.
- In chat, type `lockmaster` to lock access immediately.
- While unlocked, master override mode is active: root restrictions and extra edit/control prompts are bypassed.

Config fields in `%AppData%\\olivia\\config.json`:
- `masterGuardEnabled` (default `true`)
- `masterCodeHash` (sha256 hash of the expected master code)
- `masterQuestion`
- `masterAnswerHash` (sha256 of the expected answer)
- `masterUnlockMinutes` (default `30`)
- `masterChallengeTimeoutSec` (default `120`)

Default bootstrap security values are prefilled.
Change `masterCodeHash`, `masterQuestion`, and `masterAnswerHash` for your own setup.

## Security
Security reporting and handling policy is defined in `SECURITY.md`.

## License and Usage
This project is proprietary and released under the `LICENSE` file in this repository.

No permission is granted to use, copy, modify, distribute, or create derivative works without prior written approval from the copyright owner.
