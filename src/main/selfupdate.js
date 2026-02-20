let unlockedUntilMs = 0;

function nowMs() {
  return Date.now();
}

function getConfiguredMinutes(config) {
  const value = Number.parseInt(String(config?.selfUpdateUnlockMinutes || ''), 10);
  if (!Number.isFinite(value)) return 10;
  if (value < 1) return 1;
  if (value > 240) return 240;
  return value;
}

function isGuardEnabled(config) {
  return config?.selfUpdateGuardEnabled !== false;
}

function getSelfUpdateStatus(config) {
  const enabled = isGuardEnabled(config);
  if (!enabled) {
    return {
      enabled: false,
      unlocked: true,
      remainingMs: 0,
      unlockMinutes: getConfiguredMinutes(config),
    };
  }
  const remainingMs = Math.max(0, unlockedUntilMs - nowMs());
  return {
    enabled: true,
    unlocked: remainingMs > 0,
    remainingMs,
    unlockMinutes: getConfiguredMinutes(config),
  };
}

function ensureSelfUpdateAccess(config) {
  const status = getSelfUpdateStatus(config);
  if (!status.enabled) return { ok: true, status };
  if (!status.unlocked) return { ok: false, reason: 'self_update_locked', status };
  return { ok: true, status };
}

function unlockSelfUpdate(config, minutes) {
  if (!isGuardEnabled(config)) return getSelfUpdateStatus(config);
  const fallback = getConfiguredMinutes(config);
  const requested = Number.parseInt(String(minutes || ''), 10);
  const safeMinutes = Number.isFinite(requested) && requested > 0 && requested <= 240
    ? requested
    : fallback;
  unlockedUntilMs = nowMs() + safeMinutes * 60 * 1000;
  return getSelfUpdateStatus(config);
}

function lockSelfUpdate(config) {
  unlockedUntilMs = 0;
  return getSelfUpdateStatus(config);
}

module.exports = {
  getSelfUpdateStatus,
  ensureSelfUpdateAccess,
  unlockSelfUpdate,
  lockSelfUpdate,
};
