const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const MAX_OPEN_FILE_BYTES = 2 * 1024 * 1024;

function normalizeForCompare(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function containsNullByte(value) {
  return String(value || '').includes('\0');
}

function isSafeAbsolutePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return false;
  if (containsNullByte(filePath)) return false;
  return path.isAbsolute(filePath);
}

function resolveRealPathSafe(targetPath) {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return null;
  }
}

function resolvePathForPolicy(filePath) {
  const absolute = path.resolve(filePath);
  const direct = resolveRealPathSafe(absolute);
  if (direct) return direct;

  // For new files, resolve the nearest existing parent to prevent symlink/junction escapes.
  let cursor = absolute;
  const tail = [];
  while (true) {
    if (fs.existsSync(cursor)) {
      const realBase = resolveRealPathSafe(cursor);
      if (!realBase) return null;
      return path.resolve(realBase, ...tail.reverse());
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    tail.push(path.basename(cursor));
    cursor = parent;
  }
}

function isBypassAllowedRoots(allowedRoots) {
  if (allowedRoots === '*') return true;
  if (!Array.isArray(allowedRoots) || !allowedRoots.length) return false;
  return allowedRoots.some((root) => String(root || '').trim() === '*');
}

function resolveAllowedPath(filePath, allowedRoots) {
  if (!isSafeAbsolutePath(filePath)) return null;
  const targetResolved = resolvePathForPolicy(filePath);
  if (!targetResolved) return null;
  if (isBypassAllowedRoots(allowedRoots)) return targetResolved;
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return null;
  const target = normalizeForCompare(path.resolve(targetResolved));

  const allowed = allowedRoots.some((root) => {
    const rootResolved = resolvePathForPolicy(root);
    if (!rootResolved) return false;
    const normalizedRoot = normalizeForCompare(path.resolve(rootResolved));
    return target === normalizedRoot || target.startsWith(normalizedRoot + path.sep);
  });
  return allowed ? targetResolved : null;
}

function isPathAllowed(filePath, allowedRoots) {
  return !!resolveAllowedPath(filePath, allowedRoots);
}

function writeFileAtomic(targetPath, content) {
  const dir = path.dirname(targetPath);
  const tempPath = path.join(dir, `.overlay-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  const text = typeof content === 'string' ? content : String(content || '');
  try {
    fs.writeFileSync(tempPath, text, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, targetPath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

async function openFile({ dialog, browserWindow, allowedRoots }) {
  try {
    const defaultPath = Array.isArray(allowedRoots) && allowedRoots.length && path.isAbsolute(String(allowedRoots[0] || ''))
      ? allowedRoots[0]
      : undefined;
    const result = await dialog.showOpenDialog(browserWindow, {
      properties: ['openFile'],
      defaultPath,
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, reason: 'canceled' };
    }

    const filePath = result.filePaths[0];
    const safePath = resolveAllowedPath(filePath, allowedRoots);
    if (!safePath) {
      return { ok: false, reason: 'path_not_allowed' };
    }
    const stat = fs.statSync(safePath);
    if (!stat.isFile()) return { ok: false, reason: 'invalid_path' };
    if (stat.size > MAX_OPEN_FILE_BYTES) return { ok: false, reason: 'file_too_large' };
    const raw = fs.readFileSync(safePath);
    if (raw.includes(0)) {
      return { ok: false, reason: 'binary_not_supported' };
    }
    const content = raw.toString('utf8');
    return { ok: true, path: safePath, content };
  } catch (error) {
    log('error', 'openFile failed', { error: String(error) });
    return { ok: false, reason: 'read_failed' };
  }
}

async function saveFile({ filePath, content, allowedRoots }) {
  try {
    if (!isSafeAbsolutePath(filePath)) {
      return { ok: false, reason: 'invalid_path' };
    }
    const safePath = resolveAllowedPath(filePath, allowedRoots);
    if (!safePath) {
      return { ok: false, reason: 'path_not_allowed' };
    }
    if (fs.existsSync(safePath)) {
      const stat = fs.lstatSync(safePath);
      if (stat.isSymbolicLink()) return { ok: false, reason: 'symlink_not_allowed' };
      if (!stat.isFile()) return { ok: false, reason: 'invalid_path' };
    }
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    writeFileAtomic(safePath, content);
    return { ok: true };
  } catch (error) {
    log('error', 'saveFile failed', { error: String(error) });
    return { ok: false, reason: 'write_failed' };
  }
}

async function createFile({ filePath, content, allowedRoots }) {
  try {
    if (!isSafeAbsolutePath(filePath)) {
      return { ok: false, reason: 'invalid_path' };
    }
    const safePath = resolveAllowedPath(filePath, allowedRoots);
    if (!safePath) {
      return { ok: false, reason: 'path_not_allowed' };
    }
    if (fs.existsSync(safePath)) {
      return { ok: false, reason: 'exists' };
    }
    const dir = path.dirname(safePath);
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(safePath, content || '');
    return { ok: true, path: safePath };
  } catch (error) {
    log('error', 'createFile failed', { error: String(error) });
    return { ok: false, reason: 'write_failed' };
  }
}

module.exports = { openFile, saveFile, createFile, isPathAllowed, resolveAllowedPath };
