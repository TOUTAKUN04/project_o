const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_ARG_COUNT = 64;
const MAX_ARG_CHARS = 8192;
const MAX_OUTPUT_CHARS = 24000;

function splitCommandLine(command) {
  const text = typeof command === 'string' ? command.trim() : '';
  if (!text) return [];
  const tokens = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const quoted = match[1] ?? match[2];
    if (typeof quoted === 'string') {
      tokens.push(quoted.replace(/\\(["'\\])/g, '$1'));
    } else {
      tokens.push(match[0]);
    }
  }
  if (!tokens.length && text) tokens.push(text);
  return tokens;
}

function parseCommand(command) {
  const parts = splitCommandLine(command);
  if (!parts.length) return null;
  return {
    executable: String(parts[0] || '').trim(),
    args: parts.slice(1).map((item) => String(item)),
  };
}

function hasPathControlChars(value) {
  return /[\u0000-\u001f\u007f]/.test(String(value || ''));
}

function resolveExistingFile(candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) return null;
    return fs.realpathSync.native(candidate);
  } catch {
    return null;
  }
}

function resolveExecutablePath(executable) {
  const raw = String(executable || '').trim();
  if (!raw || hasPathControlChars(raw)) return null;
  const unquoted = raw.startsWith('"') && raw.endsWith('"') && raw.length > 1 ? raw.slice(1, -1) : raw;
  if (!unquoted) return null;

  if (path.isAbsolute(unquoted)) {
    return resolveExistingFile(path.normalize(unquoted));
  }

  // Relative paths are ambiguous and easy to hijack. Only bare command names are allowed.
  if (unquoted.includes('/') || unquoted.includes('\\')) return null;

  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!pathEntries.length) return null;

  const isWin = process.platform === 'win32';
  const hasExt = !!path.extname(unquoted);
  const extList = isWin
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
    : [''];
  const candidates = isWin
    ? (hasExt ? [unquoted] : extList.map((ext) => `${unquoted}${ext.toLowerCase()}`))
    : [unquoted];

  for (const dir of pathEntries) {
    for (const token of candidates) {
      const resolved = resolveExistingFile(path.join(dir, token));
      if (resolved) return resolved;
    }
  }

  return null;
}

function parseTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) return fallback;
  return parsed;
}

function hasControlChars(value) {
  return /[\u0000\r\n]/.test(String(value || ''));
}

function truncateOutput(text) {
  if (typeof text !== 'string') return { text: '', truncated: false };
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]`, truncated: true };
}

function runCommand({ executable, args = [], cwd, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const bin = typeof executable === 'string' ? executable.trim() : '';
    const argv = Array.isArray(args) ? args.map((item) => String(item || '')) : [];
    const commandCwd = typeof cwd === 'string' ? cwd.trim() : '';
    const timeout = parseTimeoutMs(timeoutMs, DEFAULT_TIMEOUT_MS);

    if (!bin) return resolve({ ok: false, reason: 'empty_command' });
    if (!path.isAbsolute(bin)) return resolve({ ok: false, reason: 'invalid_executable' });
    if (!commandCwd || !path.isAbsolute(commandCwd)) return resolve({ ok: false, reason: 'invalid_cwd' });
    if (hasControlChars(bin) || hasControlChars(commandCwd)) {
      return resolve({ ok: false, reason: 'invalid_command' });
    }
    if (argv.length > MAX_ARG_COUNT) return resolve({ ok: false, reason: 'command_too_long' });
    if (argv.some((item) => hasControlChars(item))) return resolve({ ok: false, reason: 'invalid_command' });
    if (argv.reduce((sum, item) => sum + item.length, 0) > MAX_ARG_CHARS) {
      return resolve({ ok: false, reason: 'command_too_long' });
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let outputTruncated = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    let child;
    try {
      child = spawn(bin, argv, {
        cwd: commandCwd,
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      log('error', 'runCommand spawn threw', { error: String(error), executable: bin });
      return finish({ ok: false, reason: 'spawn_failed' });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore kill failure
      }
      setTimeout(() => {
        if (!settled) {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore forced kill failure
          }
        }
      }, 300);
    }, timeout);

    child.once('error', (error) => {
      clearTimeout(timer);
      log('error', 'runCommand failed', { error: String(error), executable: bin });
      finish({ ok: false, reason: 'spawn_failed' });
    });

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (settled || typeof chunk !== 'string' || !chunk) return;
        stdout += chunk;
        if (stdout.length > MAX_OUTPUT_CHARS) {
          outputTruncated = true;
          stdout = stdout.slice(0, MAX_OUTPUT_CHARS);
        }
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        if (settled || typeof chunk !== 'string' || !chunk) return;
        stderr += chunk;
        if (stderr.length > MAX_OUTPUT_CHARS) {
          outputTruncated = true;
          stderr = stderr.slice(0, MAX_OUTPUT_CHARS);
        }
      });
    }

    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const out = truncateOutput(stdout);
      const err = truncateOutput(stderr);
      const truncated = outputTruncated || out.truncated || err.truncated;

      if (timedOut) {
        finish({
          ok: false,
          reason: 'timeout',
          exitCode: Number.isFinite(code) ? code : null,
          signal: signal || null,
          stdout: out.text,
          stderr: err.text,
          outputTruncated: truncated,
        });
        return;
      }

      const exitCode = Number.isFinite(code) ? code : null;
      if (exitCode !== 0) {
        finish({
          ok: false,
          reason: 'command_failed',
          exitCode,
          signal: signal || null,
          stdout: out.text,
          stderr: err.text,
          outputTruncated: truncated,
        });
        return;
      }

      finish({
        ok: true,
        exitCode,
        signal: signal || null,
        stdout: out.text,
        stderr: err.text,
        outputTruncated: truncated,
      });
    });

    return undefined;
  });
}

module.exports = {
  runCommand,
  parseTimeoutMs,
  parseCommand,
  resolveExecutablePath,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
};
