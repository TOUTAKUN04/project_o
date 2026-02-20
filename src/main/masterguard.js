const crypto = require('crypto');

let unlockedUntilMs = 0;
let challengePending = false;
let challengeIssuedAtMs = 0;

function normalize(value) {
  return String(value || '').trim();
}

function nowMs() {
  return Date.now();
}

function sha256(text) {
  return crypto.createHash('sha256').update(normalize(text), 'utf8').digest('hex');
}

function isMasterUnlocked(config) {
  if (!config?.masterGuardEnabled) return true;
  return unlockedUntilMs > nowMs();
}

function getMasterStatus(config) {
  const unlocked = isMasterUnlocked(config);
  const remainingMs = unlocked ? Math.max(0, unlockedUntilMs - nowMs()) : 0;
  return {
    enabled: !!config?.masterGuardEnabled,
    unlocked,
    pending: challengePending,
    remainingMs,
  };
}

function beginMasterChallenge({ phrase, config }) {
  if (!config?.masterGuardEnabled) {
    return { ok: true, bypassed: true, status: getMasterStatus(config) };
  }
  const expectedHash = normalize(config.masterCodeHash).toLowerCase();
  if (expectedHash) {
    const incomingHash = sha256(phrase).toLowerCase();
    if (incomingHash !== expectedHash) return { ok: false, reason: 'invalid_code' };
  } else {
    const expected = normalize(config.masterCode).toLowerCase();
    const incoming = normalize(phrase).toLowerCase();
    if (!expected || incoming !== expected) return { ok: false, reason: 'invalid_code' };
  }

  challengePending = true;
  challengeIssuedAtMs = nowMs();
  return {
    ok: true,
    question: normalize(config.masterQuestion) || 'Security check: answer the master question.',
    status: getMasterStatus(config),
  };
}

function verifyMasterChallenge({ answer, config }) {
  if (!config?.masterGuardEnabled) {
    return { ok: true, bypassed: true, status: getMasterStatus(config) };
  }
  if (!challengePending) return { ok: false, reason: 'no_pending_challenge' };

  const timeoutSec = Number.parseInt(String(config.masterChallengeTimeoutSec || 120), 10);
  const timeoutMs = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : 120000;
  if ((nowMs() - challengeIssuedAtMs) > timeoutMs) {
    challengePending = false;
    challengeIssuedAtMs = 0;
    return { ok: false, reason: 'challenge_expired' };
  }

  const expectedHash = normalize(config.masterAnswerHash).toLowerCase();
  const incomingHash = sha256(answer).toLowerCase();
  if (!expectedHash || incomingHash !== expectedHash) {
    challengePending = false;
    challengeIssuedAtMs = 0;
    return { ok: false, reason: 'invalid_answer' };
  }

  const unlockMinutes = Number.parseInt(String(config.masterUnlockMinutes || 30), 10);
  const ttlMs = Number.isFinite(unlockMinutes) && unlockMinutes > 0 ? unlockMinutes * 60 * 1000 : 30 * 60 * 1000;
  unlockedUntilMs = nowMs() + ttlMs;
  challengePending = false;
  challengeIssuedAtMs = 0;

  return { ok: true, status: getMasterStatus(config) };
}

function lockMasterAccess(config) {
  unlockedUntilMs = 0;
  challengePending = false;
  challengeIssuedAtMs = 0;
  return getMasterStatus(config);
}

function ensureMasterAccess(config) {
  if (isMasterUnlocked(config)) return { ok: true };
  return { ok: false, reason: 'master_locked' };
}

module.exports = {
  beginMasterChallenge,
  verifyMasterChallenge,
  lockMasterAccess,
  getMasterStatus,
  ensureMasterAccess,
  isMasterUnlocked,
};
