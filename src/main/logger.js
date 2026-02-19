const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getLogPath() {
  let base = process.cwd();
  try {
    if (app && app.isReady()) {
      base = app.getPath('userData');
    }
  } catch {
    // Fallback to cwd if app isn't ready.
  }
  const dir = path.join(base, 'logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  return path.join(dir, 'overlay.log');
}

function formatLine(level, message, meta) {
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level}] ${message}`;
  if (meta) {
    try {
      line += ` ${JSON.stringify(meta)}`;
    } catch {
      line += ' {"meta":"[unserializable]"}';
    }
  }
  return line + '\n';
}

function log(level, message, meta) {
  try {
    fs.appendFileSync(getLogPath(), formatLine(level, message, meta), 'utf8');
  } catch {
    // ignore log failures
  }
}

module.exports = {
  log,
};