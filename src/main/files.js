const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

function normalizeForCompare(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
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

function isPathAllowed(filePath, allowedRoots) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return false;
  const targetResolved = resolvePathForPolicy(filePath);
  if (!targetResolved) return false;
  const target = normalizeForCompare(path.resolve(targetResolved));

  return allowedRoots.some((root) => {
    const rootResolved = resolvePathForPolicy(root);
    if (!rootResolved) return false;
    const normalizedRoot = normalizeForCompare(path.resolve(rootResolved));
    return target === normalizedRoot || target.startsWith(normalizedRoot + path.sep);
  });
}

async function openFile({ dialog, browserWindow, allowedRoots }) {
  try {
    const result = await dialog.showOpenDialog(browserWindow, {
      properties: ['openFile'],
      defaultPath: Array.isArray(allowedRoots) && allowedRoots.length ? allowedRoots[0] : undefined,
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, reason: 'canceled' };
    }

    const filePath = result.filePaths[0];
    if (!isPathAllowed(filePath, allowedRoots)) {
      return { ok: false, reason: 'path_not_allowed' };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, path: filePath, content };
  } catch (error) {
    log('error', 'openFile failed', { error: String(error) });
    return { ok: false, reason: 'read_failed' };
  }
}

async function saveFile({ filePath, content, allowedRoots }) {
  try {
    if (!isPathAllowed(filePath, allowedRoots)) {
      return { ok: false, reason: 'path_not_allowed' };
    }
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  } catch (error) {
    log('error', 'saveFile failed', { error: String(error) });
    return { ok: false, reason: 'write_failed' };
  }
}

async function createFile({ filePath, content, allowedRoots }) {
  try {
    if (!isPathAllowed(filePath, allowedRoots)) {
      return { ok: false, reason: 'path_not_allowed' };
    }
    if (fs.existsSync(filePath)) {
      return { ok: false, reason: 'exists' };
    }
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content || '', 'utf8');
    return { ok: true, path: filePath };
  } catch (error) {
    log('error', 'createFile failed', { error: String(error) });
    return { ok: false, reason: 'write_failed' };
  }
}

module.exports = { openFile, saveFile, createFile, isPathAllowed };
