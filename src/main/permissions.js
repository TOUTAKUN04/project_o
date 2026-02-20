const PERMISSION_TTL_MIN_MS = 60 * 1000;
const PERMISSION_TTL_MAX_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERMISSION_TTL_MS = 15 * 60 * 1000;
const SESSION_UNTIL_MS = Number.MAX_SAFE_INTEGER;

let sessionEditAllowedUntil = 0;
let sessionControlAllowedUntil = 0;

function parsePermissionTtl(value, fallbackMs) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallbackMs;
  if (parsed < PERMISSION_TTL_MIN_MS || parsed > PERMISSION_TTL_MAX_MS) return fallbackMs;
  return parsed;
}

const EDIT_PERMISSION_TTL_MS = parsePermissionTtl(
  process.env.OVERLAY_EDIT_PERMISSION_TTL_MS,
  DEFAULT_PERMISSION_TTL_MS,
);
const CONTROL_PERMISSION_TTL_MS = parsePermissionTtl(
  process.env.OVERLAY_CONTROL_PERMISSION_TTL_MS,
  DEFAULT_PERMISSION_TTL_MS,
);

function nowMs() {
  return Date.now();
}

function isAllowed(untilMs) {
  return Number.isFinite(untilMs) && untilMs > nowMs();
}

function grantTemporary(ttlMs) {
  return nowMs() + ttlMs;
}

async function ensureEditPermission({ dialog, browserWindow }) {
  if (isAllowed(sessionEditAllowedUntil)) return true;

  const result = await dialog.showMessageBox(browserWindow, {
    type: 'warning',
    buttons: ['Allow 15m', 'Allow Session', 'Deny'],
    defaultId: 0,
    cancelId: 2,
    title: 'Allow code edits for this session?',
    message: 'The assistant is requesting permission to edit files in this session.',
    detail: 'Allow 15m grants temporary access. You can revoke at any time from the UI.',
  });

  if (result.response === 0) {
    sessionEditAllowedUntil = grantTemporary(EDIT_PERMISSION_TTL_MS);
    return true;
  }
  if (result.response === 1) {
    sessionEditAllowedUntil = SESSION_UNTIL_MS;
    return true;
  }
  return false;
}

async function ensureControlPermission({ dialog, browserWindow }) {
  if (isAllowed(sessionControlAllowedUntil)) return true;

  const result = await dialog.showMessageBox(browserWindow, {
    type: 'warning',
    buttons: ['Allow 15m', 'Allow Session', 'Deny'],
    defaultId: 0,
    cancelId: 2,
    title: 'Allow command execution for this session?',
    message: 'The assistant is requesting permission to run commands in this session.',
    detail: 'Allow 15m grants temporary access. You can revoke at any time from the UI.',
  });

  if (result.response === 0) {
    sessionControlAllowedUntil = grantTemporary(CONTROL_PERMISSION_TTL_MS);
    return true;
  }
  if (result.response === 1) {
    sessionControlAllowedUntil = SESSION_UNTIL_MS;
    return true;
  }
  return false;
}

function getSessionPermission() {
  return isAllowed(sessionEditAllowedUntil);
}

function getSessionControlPermission() {
  return isAllowed(sessionControlAllowedUntil);
}

function revokeEditPermission() {
  sessionEditAllowedUntil = 0;
  return false;
}

function revokeControlPermission() {
  sessionControlAllowedUntil = 0;
  return false;
}

module.exports = {
  ensureEditPermission,
  getSessionPermission,
  ensureControlPermission,
  getSessionControlPermission,
  revokeEditPermission,
  revokeControlPermission,
};
