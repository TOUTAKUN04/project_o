const fs = require('fs');
const path = require('path');
const { runCommand, resolveExecutablePath, parseTimeoutMs } = require('./systemrun');

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_LOG_LIMIT = 20;
const MAX_LOG_LIMIT = 100;
const MAX_DIFF_CHARS = 120000;

function isDirectoryPath(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveGitExecutable() {
  return resolveExecutablePath('git') || resolveExecutablePath('git.exe');
}

function normalizeRepoCwd(cwd) {
  const raw = String(cwd || '').trim();
  const absolute = path.resolve(raw || process.cwd());
  if (!path.isAbsolute(absolute)) return null;
  if (!isDirectoryPath(absolute)) return null;
  return absolute;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LOG_LIMIT;
  return Math.min(parsed, MAX_LOG_LIMIT);
}

function normalizeRef(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^[a-zA-Z0-9_./-]+$/.test(text)) return '';
  return text;
}

function sanitizeCommitMessage(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length > 200) return text.slice(0, 200);
  return text;
}

function trimOutput(value, maxChars = MAX_DIFF_CHARS) {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n...[truncated]`, truncated: true };
}

async function runGitCommand({ cwd, args, timeoutMs }) {
  const gitExecutable = resolveGitExecutable();
  if (!gitExecutable) return { ok: false, reason: 'git_not_found' };
  const workingDir = normalizeRepoCwd(cwd);
  if (!workingDir) return { ok: false, reason: 'invalid_cwd' };

  const result = await runCommand({
    executable: gitExecutable,
    args: Array.isArray(args) ? args : [],
    cwd: workingDir,
    timeoutMs: parseTimeoutMs(timeoutMs, DEFAULT_TIMEOUT_MS),
  });
  return { cwd: workingDir, ...result };
}

async function ensureGitRepo({ cwd, timeoutMs }) {
  const check = await runGitCommand({
    cwd,
    timeoutMs,
    args: ['rev-parse', '--is-inside-work-tree'],
  });
  if (!check.ok) {
    return { ok: false, reason: check.reason || 'not_git_repo', cwd: check.cwd, stderr: check.stderr, stdout: check.stdout };
  }
  if (!/true/i.test(String(check.stdout || ''))) {
    return { ok: false, reason: 'not_git_repo', cwd: check.cwd };
  }
  return { ok: true, cwd: check.cwd };
}

async function gitStatus({ cwd, timeoutMs } = {}) {
  const repo = await ensureGitRepo({ cwd, timeoutMs });
  if (!repo.ok) return repo;
  const result = await runGitCommand({
    cwd: repo.cwd,
    timeoutMs,
    args: ['status', '--short', '--branch'],
  });
  if (!result.ok) return result;
  return {
    ok: true,
    cwd: repo.cwd,
    output: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

async function gitLog({ cwd, limit, timeoutMs } = {}) {
  const repo = await ensureGitRepo({ cwd, timeoutMs });
  if (!repo.ok) return repo;
  const safeLimit = normalizeLimit(limit);
  const result = await runGitCommand({
    cwd: repo.cwd,
    timeoutMs,
    args: ['log', '--oneline', '--decorate', `-${safeLimit}`],
  });
  if (!result.ok) return result;
  return {
    ok: true,
    cwd: repo.cwd,
    output: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

async function gitDiff({ cwd, ref, timeoutMs } = {}) {
  const repo = await ensureGitRepo({ cwd, timeoutMs });
  if (!repo.ok) return repo;
  const safeRef = normalizeRef(ref);
  const args = ['diff', '--no-color'];
  if (safeRef) args.push(safeRef);
  const result = await runGitCommand({
    cwd: repo.cwd,
    timeoutMs,
    args,
  });
  if (!result.ok) return result;
  const trimmed = trimOutput(String(result.stdout || ''), MAX_DIFF_CHARS);
  return {
    ok: true,
    cwd: repo.cwd,
    output: trimmed.text.trim(),
    truncated: trimmed.truncated,
    stderr: String(result.stderr || '').trim(),
  };
}

async function gitCommit({ cwd, message, timeoutMs } = {}) {
  const repo = await ensureGitRepo({ cwd, timeoutMs });
  if (!repo.ok) return repo;

  const commitMessage = sanitizeCommitMessage(message);
  if (!commitMessage) return { ok: false, reason: 'missing_message', cwd: repo.cwd };

  const addResult = await runGitCommand({
    cwd: repo.cwd,
    timeoutMs,
    args: ['add', '-A'],
  });
  if (!addResult.ok) return addResult;

  const commitResult = await runGitCommand({
    cwd: repo.cwd,
    timeoutMs,
    args: ['commit', '-m', commitMessage],
  });

  if (!commitResult.ok) {
    const output = `${commitResult.stderr || ''}\n${commitResult.stdout || ''}`;
    if (/nothing to commit|no changes added to commit/i.test(output)) {
      return { ok: false, reason: 'nothing_to_commit', cwd: repo.cwd };
    }
    return commitResult;
  }

  return {
    ok: true,
    cwd: repo.cwd,
    output: String(commitResult.stdout || '').trim() || String(commitResult.stderr || '').trim() || 'Commit created.',
    stderr: String(commitResult.stderr || '').trim(),
  };
}

module.exports = {
  gitStatus,
  gitLog,
  gitDiff,
  gitCommit,
};

