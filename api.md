# Overlay IPC API

This document describes the main-process IPC endpoints exposed to the renderer.

## Methods

| Channel | Purpose | Payload | Returns |
| --- | --- | --- | --- |
| `config:get` | Read config | none | config object |
| `config:set` | Update config | partial config | config object + `_warnings` |
| `projects:trust` | Add a trusted root via folder picker | none | `{ ok, root, config, warnings }` |
| `memories:recent` | Read recent memories | none | array of memories |
| `memories:add` | Persist memory + embed | `{ role, content }` | `{ ok }` |
| `memories:search` | Vector search | query string | array of matches |
| `permissions:edit:get` | Edit permission state | none | boolean |
| `permissions:edit:request` | Request edit permission | none | boolean |
| `permissions:control:get` | App control permission state | none | boolean |
| `permissions:control:request` | Request app control permission | none | boolean |
| `files:open` | Open file | none | `{ ok, path, content }` |
| `files:save` | Save file | `{ path, content }` | `{ ok, reason? }` |
| `files:create` | Create file | `{ root, relativePath, content }` | `{ ok, path?, reason? }` |
| `capture:screen` | Screenshot capture | none | `{ ok, path?, reason? }` |
| `apps:launch` | Launch app | command string | `{ ok, reason? }` |
| `apps:focus` | Focus app | app name string | `{ ok, reason? }` |
| `ollama:health` | Ollama health check | none | `{ ok, error? }` |
| `ollama:chat` | Chat completion | `{ messages }` | `{ content?, model?, error? }` |

## Internal (Main Process)

### Event Bus
The internal event bus is used to broadcast activity for adapters and telemetry.
It is not exposed to the renderer directly.

## Chunk Event

The renderer subscribes to streaming tokens via:

- Event: `ollama:chunk`
- Payload: string chunk

## Normalized Shapes

### Memory
```json
{ "role": "user|assistant", "content": "...", "created_at": "ISO" }
```

### Config Fields
```json
{
  "assistantName": "Project O",
  "assistantStyle": "codex",
  "personaPrompt": "",
  "model": "qwen-coder",
  "embeddingModel": "qwen-coder",
  "ollamaUrl": "http://localhost:11434",
  "allowRemoteOllama": false,
  "hotkey": "CommandOrControl+Shift+O",
  "startup": true,
  "popupMode": "hotkey",
  "allowedRoots": ["C:\\Users\\..."],
  "appAllowlist": ["notepad.exe"],
  "webhookPort": 3210,
  "adaptersAutoReply": false,
  "adapters": {
    "telegram": false,
    "discord": false,
    "slack": false,
    "whatsapp": false
  }
}
```
