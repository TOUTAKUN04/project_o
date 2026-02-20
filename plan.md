# Project O Master Plan (Friday Upgrade)

## Goal
Build Project O into a full Windows AI control system where:
- The overlay UI is only one interface.
- A background agent runtime can execute tasks across the OS.
- The agent can plan, act, verify, and recover.
- Safety, auditability, and control are built in.

## Product Direction
- Primary platform: Windows desktop.
- Primary runtime: local-first (Ollama), with optional cloud fallback later.
- Control model: explicit user approvals + policy engine (not blind autonomy).
- Architecture model: daemon + tool runners + interfaces (overlay, adapters, API).

## What Is Necessary

## 1) Core Runtime Split
- `Overlay UI` (chat, approvals, status, task monitor).
- `Core Daemon` (session manager, planner/executor, scheduler, policy engine).
- `Tool Runner Layer` (filesystem, app/window control, browser, automation tools).
- `IPC/API Gateway` between UI and daemon.

## 2) Agent Brain Upgrade
- Add planner/executor/verifier loop:
  - Planner: breaks goals into steps.
  - Executor: runs tools.
  - Verifier: checks outcomes and retries/fixes.
- Add structured tool-call protocol (JSON schema per tool).
- Add task queue with resumable runs.

## 3) Windows Control Capability
- Window focus/switch/minimize/maximize/close.
- App lifecycle: launch, detect running, attach to process.
- Input automation (typed text, key combos, click targets) with strict scope controls.
- Browser automation module for web workflows.

## 4) Data + Memory
- Short-term conversation state per task.
- Long-term memory with retention and deletion controls.
- Workspace index/RAG for project-aware coding behavior.
- Full audit trail of actions and decisions.

## 5) Safety + Policy
- Permission profiles: `chat`, `edit`, `control`, `automation`.
- Approval modes: once / timed / session.
- Policy checks before every tool call.
- Denylist and dangerous-action guardrails.
- Replayable logs for incident review.

## 6) Reliability + Ops
- Health checks for all providers/tools.
- Timeouts, retries, circuit breakers.
- Queue persistence (resume after restart).
- Crash-safe recovery and graceful fallback behavior.

## 7) Interfaces
- Overlay UI (current app).
- Optional adapters (Telegram/Discord/Slack/WhatsApp).
- Local API for future desktop/mobile clients.

## Target Architecture
1. User request enters Overlay or adapter.
2. Gateway normalizes event.
3. Daemon loads session + policy + memory.
4. Planner creates execution graph.
5. Executor calls tools through policy gate.
6. Verifier validates results and triggers retries if needed.
7. Response + audit written to DB and streamed to UI.

## Build Plan (One by One)

## Phase 0: Foundation Lock (Current Sprint)
- Freeze IPC contracts.
- Add automated tests for critical modules (`files`, `webhook`, `permissions`, `appcontrol`).
- Add migration-safe config handling and schema versioning.
- Output: stable baseline and test harness.

## Phase 1: Daemon Extraction
- Create `core-daemon` module/process.
- Move orchestration out of `src/main/main.js`.
- Keep overlay as client UI only.
- Output: daemon handles tasks; UI is transport/presentation.

## Phase 2: Tool Registry and Execution Graph
- Introduce central tool registry with schemas and capabilities.
- Implement planner/executor/verifier loop.
- Add task queue + persistent state machine.
- Output: multi-step task execution with verification.

## Phase 3: Windows Automation Pack
- Expand app/window control APIs.
- Add guarded input automation primitives.
- Add browser automation service.
- Output: reliable OS-level workflow automation.

## Phase 4: Memory + RAG + Skills
- Add project indexer and retrieval pipeline.
- Add memory policy UI (retention, purge, export).
- Add skill/plugin loading with permission declarations.
- Output: context-aware assistant with controlled extensibility.

## Phase 5: Multi-Channel + Scheduling
- Promote adapters from optional hooks to first-class channels.
- Add scheduler for recurring jobs.
- Add webhook/API triggers for automation flows.
- Output: “always-on” assistant across channels.

## Phase 6: Productization
- Installer polish, autoupdate strategy, diagnostics panel.
- Performance tuning and observability dashboard.
- Security review + threat model + release checklist.
- Output: production-ready release candidate.

## Immediate Execution Order (Start Here)
1. Implement config schema/version migration (`v1`).
2. Add test suite + CI for security-critical modules.
3. Extract daemon skeleton and move orchestration handlers.
4. Add tool registry and typed tool contracts.
5. Implement planner/executor/verifier for 3 tools first:
   - `files`
   - `apps`
   - `capture`

## Progress Log
- [x] 2026-02-19: Added persistent task queue baseline (SQLite task tables + task engine + task IPC + preload bridge + API docs).
- [x] 2026-02-19: Added simulated-feelings tone controls + explicit AI self-update lock (master-gated timed unlock + task enforcement).

## Definition of Done (Per Phase)
- All phase features behind stable APIs.
- Test coverage for critical paths.
- No regression in security controls.
- Updated docs (`README.md`, `api.md`, `problems.md`).
- Manual smoke checklist passes.

## Risks to Manage
- Over-automation without approval controls.
- Main-process blocking and UI lag.
- Adapter/webhook security drift.
- Prompt/tool mismatch causing unsafe actions.

## Rule for This Project
Every new capability must include:
1. policy check,
2. audit log,
3. timeout + retry behavior,
4. tests,
5. UI visibility for user control.
