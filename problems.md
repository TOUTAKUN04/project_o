# Olivia Current Problems (Updated: 2026-02-19)

This file lists the **remaining** open problems after the latest hardening pass.

## Recently Resolved
- App control now blocks dangerous executables and enforces stricter input validation.
- App launch allowlist now uses absolute executable paths and resolved executable matching.
- Webhook now supports local-only mode, auth token checks, and per-source/path rate limiting.
- Remote webhook mode now requires `WHATSAPP_APP_SECRET`.
- File operations include stronger path checks and safer write behavior.
- Permission flow now supports TTL grants plus revoke actions from UI.
- Renderer hardening added: CSP in `src/renderer/index.html`, blocked external navigation/window open, and IPC sender checks.
- Ollama chat/embedding now use timeout + retry logic.
- Basic retention controls added for memories and captures.

## Open Problems

## High Priority
- **No automated security/regression tests**
  - Critical modules (`main.js`, `files.js`, `webhook.js`, `appcontrol.js`, `permissions.js`) are untested.
  - Risk: future changes can silently reintroduce path/webhook/permission vulnerabilities.
  - Next fix: add unit tests and a CI workflow for these modules.

- **Renderer attack surface is still broad by design**
  - `src/main/preload.js` intentionally exposes powerful APIs.
  - CSP + sender checks reduce risk but do not remove the impact of a renderer compromise.
  - Next fix: add per-action intent tokens/nonces and stricter capability gating.

## Medium Priority
- **Memory search still runs synchronously in main process**
  - `src/main/db.js` now caps scanning, but cosine similarity is still CPU work on the main thread.
  - Next fix: move vector search to worker thread/process or database-native index.

- **Retention controls are env-based, not user-driven**
  - Memory/capture retention exists but only via environment variables.
  - Next fix: expose retention settings in UI with clear defaults and manual purge/export actions.

- **Absolute-path allowlist migration can confuse existing users**
  - Legacy app allowlist entries (e.g., `notepad.exe`) are now ignored by config sanitization.
  - Next fix: add UI guidance/migration helper to convert existing entries.

## Low Priority
- **Main process remains monolithic**
  - `src/main/main.js` still handles many unrelated domains.
  - Next fix: split into focused IPC modules (config/files/apps/chat/security).

- **Adapter security controls are not configurable in the UI**
  - Webhook/auth/rate-limit knobs remain env-only.
  - Next fix: add adapter security section in settings with validation and warnings.

## Suggested Next Work Order
1. Add automated tests + CI for security-critical paths.
2. Implement per-action IPC intent tokens.
3. Add retention and adapter-security controls to the UI.
4. Refactor `src/main/main.js` into domain modules.
