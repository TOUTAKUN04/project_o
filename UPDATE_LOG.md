# Update Log

## 2026-02-20 - Major Assistant Upgrade

### Added
- Multi-provider chat runtime support across Ollama, OpenAI-compatible APIs, and Gemini endpoints.
- Web search integration (`/search`) with in-app result rendering.
- Git tools (`/git status`, `/git log`, `/git diff`, `/git commit`) through IPC handlers.
- Command runner integration with timeout and output summarization.
- Auto tool mode that can trigger tools from natural language intents.
- Simulated feelings engine with runtime mood state, tone, expressiveness, and decay settings.
- Mic improvements:
  - Wake-word mode with alias handling.
  - Push-to-talk mode.
  - Tunable speech rate and improved voice selection.
- AI workflow modules for file-edit planning, review, and verification flow.
- New security/control modules:
  - Master lock challenge flow.
  - Timed self-update unlock guard.
- New icons and packaging updates (`icon.ico`, `icon.png`).
- Chat waiting indicator: animated `Thinking...` state until first streamed response chunk.

### Changed
- UI layout refreshed (same core color direction retained) with clearer sections for tools, chat, and settings.
- Settings panel reorganized into grouped sections with improved readability.
- Prompt policy updated so assistant responses align with app tooling and do not fall back to generic "no web access/cutoff" claims.
- Natural-language web intent parsing expanded to handle conversational phrasing, not only strict command syntax.

### Removed
- Deprecated app control module (`src/main/appcontrol.js`).

### Notes
- Default local model remains `freehuntx/qwen3-coder:14b` for practical performance on mid-range hardware.
- For best reliability on difficult tasks, use cloud fallback models when needed.
