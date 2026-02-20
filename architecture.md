# Olivia Architecture

This document maps the multi-channel assistant diagram to a concrete module list and data-flow spec.

## Modules

### Input Adapters
Telegram, Discord, Slack, WhatsApp, Local Olivia UI, Cron.
- Responsibility: normalize incoming messages into a common event shape.

### Gateway Core (Daemon / Orchestrator)
Components: Message Router, Session Manager, Policy Engine, Scheduler, WebSocket API.
- Responsibility: auth, rate-limit, route, attach session context, enforce permissions.

### PI Agent (Reasoning Engine)
- Responsibility: build prompts, choose tools, interpret results, return responses.
- Must be stateless; all state comes from Gateway.

### LLM Providers
OpenAI-compatible APIs / Gemini / Ollama.
- Responsibility: chat + embeddings.

### Tool Access Layer
File system, command execution, browser, APIs.
- Responsibility: execute tools only after policy checks.

### Workspace (On-Disk State)
`agents.md`, `identity.md`, `tools.md`, `memory/`, `history/`, SQLite.
- Responsibility: persistent memory, project context, audit trail.

### Observability
Local logs, metrics, traces, error capture.

## Canonical Data Flow
1. Input Adapter receives a message/event.
2. Adapter normalizes it into `{ userId, channel, text, metadata, timestamp }`.
3. Gateway Core authenticates + rate-limits.
4. Session Manager loads session state + memory snapshot.
5. Policy Engine decides which tools are allowed.
6. PI Agent builds the prompt + tool plan.
7. LLM Provider returns reasoning or a tool call.
8. Tool Access executes only allowed tools; logs actions.
9. PI Agent receives tool result and composes the final answer.
10. Gateway Core stores memory/history + responds to user.

## Mapping to Current Overlay App
- Gateway Core -> `overlay/src/main/main.js`
- Session Manager -> `overlay/src/main/db.js`
- Policy Engine -> `overlay/src/main/config.js` + root policies + `permissions.js`
- PI Agent -> `overlay/src/main/ollama.js` (Ollama/API provider adapter) + prompt logic in renderer
- Runtime Feelings Engine -> `overlay/src/main/feelings.js` + prompt integration in `overlay/src/main/prompt.js`
- Tool Access -> `overlay/src/main/files.js`, `overlay/src/main/capture.js`, `overlay/src/main/systemrun.js`, `overlay/src/main/websearch.js`, `overlay/src/main/gittools.js`
- Event Bus (internal) -> `overlay/src/main/bus.js`
- Adapter Stubs -> `overlay/src/main/adapters/`
- Workspace -> `%AppData%/overlay` + Allowed Roots
- Observability -> `overlay/src/main/logger.js`

## Minimal Event Shape
```json
{ "userId": "u123", "channel": "overlay", "text": "...", "metadata": {}, "timestamp": "ISO" }
```

## Minimal Tool Result Shape
```json
{ "ok": true, "data": "...", "error": null }
```

## Notes
- The PI Agent should never call tools directly; all tool access must pass through Gateway policy checks.
- The Gateway is the right place to enforce root policies, permissions, and auditing.
- For scale, add a queue/event bus between inputs and Gateway Core.
