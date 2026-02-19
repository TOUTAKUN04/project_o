# Project O Overlay

Project O Overlay is a Windows desktop assistant built on Electron and Ollama.
It supports local chat, controlled file operations, optional app control, and adapter-based message integrations.

## Core Features
- Local-first AI chat with Ollama
- Permission-gated file create/save operations
- Allowed-roots restrictions for file access
- Optional app control with allowlist checks
- Local SQLite memory store
- Optional adapters (Telegram, Discord, Slack, WhatsApp)

## Requirements
- Windows
- Node.js 18+
- Ollama running at `http://localhost:11434`
- Model available in Ollama (default: `qwen-coder`)

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
- Local config: `%AppData%\\overlay\\config.json`
- Local database: `%AppData%\\overlay\\memories.db`
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

## Security
Security reporting and handling policy is defined in `SECURITY.md`.

## License and Usage
This project is proprietary and released under the `LICENSE` file in this repository.

No permission is granted to use, copy, modify, distribute, or create derivative works without prior written approval from the copyright owner.
