# Olivia IPC API

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
| `feelings:get` | Read runtime simulated mood state | none | `{ ok, state }` |
| `web:search` | Web search (DuckDuckGo) | `{ query, limit?, timeoutMs? }` | `{ ok, results[], reason? }` |
| `master:status` | Master access status | none | `{ enabled, unlocked, pending, remainingMs }` |
| `master:begin` | Start master challenge | phrase string | `{ ok, question?, reason? }` |
| `master:verify` | Verify challenge answer | answer string | `{ ok, reason? }` |
| `master:lock` | Re-lock master access | none | `{ ok, status }` |
| `selfupdate:status` | AI code-update lock status | none | `{ enabled, unlocked, remainingMs, unlockMinutes }` |
| `selfupdate:unlock` | Unlock AI code updates (timed) | `{ minutes? }` | `{ ok, status?, reason? }` |
| `selfupdate:lock` | Re-lock AI code updates | none | `{ ok, status }` |
| `permissions:edit:get` | Edit permission state | none | boolean |
| `permissions:edit:request` | Request edit permission | none | boolean |
| `permissions:edit:revoke` | Revoke edit permission | none | boolean |
| `permissions:control:get` | Command execution permission state | none | boolean |
| `permissions:control:request` | Request command execution permission | none | boolean |
| `permissions:control:revoke` | Revoke command execution permission | none | boolean |
| `files:open` | Open file | none | `{ ok, path, content }` |
| `files:save` | Save file | `{ path, content }` | `{ ok, reason? }` |
| `files:create` | Create file | `{ root, relativePath, content }` | `{ ok, path?, reason? }` |
| `capture:screen` | Screenshot capture | none | `{ ok, path?, reason? }` |
| `system:run` | Run command | `{ command, cwd?, timeoutMs? }` | `{ ok, exitCode?, stdout?, stderr?, reason? }` |
| `git:status` | Git status in repo | `{ cwd?, timeoutMs? }` | `{ ok, cwd?, output?, reason? }` |
| `git:log` | Git log in repo | `{ cwd?, limit?, timeoutMs? }` | `{ ok, cwd?, output?, reason? }` |
| `git:diff` | Git diff in repo | `{ cwd?, ref?, timeoutMs? }` | `{ ok, cwd?, output?, truncated?, reason? }` |
| `git:commit` | Git add+commit | `{ cwd?, message, timeoutMs? }` | `{ ok, cwd?, output?, reason? }` |
| `tasks:create` | Enqueue a persistent task | `{ title?, goal?, steps?, metadata? }` or goal string | `{ ok, taskId?, reason? }` |
| `tasks:list` | List recent tasks | optional limit number | task summary array |
| `tasks:get` | Get one task with steps | task id string | task object or `null` |
| `tasks:events` | Get task audit/events | `(taskId, limit?)` | task event array |
| `tasks:approve-step` | Approve paused step | `{ taskId, stepIndex }` | `{ ok, reason? }` |
| `tasks:cancel` | Cancel queued/running task | task id string | `{ ok, reason? }` |
| `ollama:health` | Active provider health check | none | `{ ok, error? }` |
| `ollama:chat` | Provider-backed chat completion | `{ messages }` | `{ content?, model?, cached?, error? }` |

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
  "assistantName": "Olivia",
  "assistantStyle": "codex",
  "personaPrompt": "",
  "simulatedFeelings": true,
  "feelingsTone": "balanced",
  "feelingsExpressiveness": "subtle|balanced|expressive",
  "feelingsDecayMinutes": 45,
  "llmProvider": "ollama|openai|gemini",
  "model": "qwen-coder",
  "embeddingModel": "qwen-coder",
  "ollamaUrl": "http://localhost:11434",
  "apiBaseUrl": "https://api.openai.com/v1 | https://generativelanguage.googleapis.com/v1beta",
  "apiKey": "sk-...",
  "allowRemoteOllama": false,
  "autoToolMode": true,
  "micMode": "wake|push",
  "speechRate": 1.08,
  "hotkey": "CommandOrControl+Shift+O",
  "startup": true,
  "popupMode": "hotkey",
  "allowedRoots": ["C:\\Users\\..."],
  "commandTimeoutMs": 120000,
  "masterGuardEnabled": true,
  "masterQuestion": "Whats context in it?",
  "masterUnlockMinutes": 30,
  "masterChallengeTimeoutSec": 120,
  "selfUpdateGuardEnabled": true,
  "selfUpdateUnlockMinutes": 10,
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

Notes:
- `config:get`/`config:set` responses do not include `masterCodeHash` or `masterAnswerHash`.
- When master access is unlocked, root restrictions and extra edit/control prompts are bypassed.

### Task
```json
{
  "id": "uuid",
  "title": "Task",
  "goal": "High level objective",
  "status": "queued|running|waiting_approval|completed|failed|canceled",
  "metadata": {},
  "errorText": null,
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "startedAt": "ISO|null",
  "completedAt": "ISO|null",
  "steps": [
    {
      "taskId": "uuid",
      "stepIndex": 0,
      "name": "Step 1",
      "stepType": "note|tool",
      "toolName": "files:save",
      "input": {},
      "requiresApproval": false,
      "status": "pending|running|waiting_approval|completed|failed|skipped|canceled",
      "output": {},
      "errorText": null,
      "createdAt": "ISO",
      "updatedAt": "ISO"
    }
  ]
}
```

### Task Event
```json
{
  "id": 1,
  "taskId": "uuid",
  "level": "info|warn|error",
  "message": "task_queued",
  "payload": {},
  "createdAt": "ISO"
}
```
