const { desktopCapturer, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { log } = require('./logger');

const CAPTURE_RETENTION_DAYS = Number.parseInt(process.env.OVERLAY_CAPTURE_RETENTION_DAYS || '14', 10);

function cleanupOldCaptures(baseDir, retentionDays) {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 14;
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^capture-\d+\.png$/i.test(entry.name)) continue;
      const full = path.join(baseDir, entry.name);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {
        // ignore per-file cleanup failure
      }
    }
  } catch {
    // ignore cleanup failure
  }
}

async function captureScreen() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    });

    if (!sources.length) {
      return { ok: false, reason: 'no_sources' };
    }

    const screen = sources[0];
    const png = screen.thumbnail.toPNG();
    const userData = app.getPath('userData');
    cleanupOldCaptures(userData, CAPTURE_RETENTION_DAYS);
    const filePath = path.join(userData, `capture-${Date.now()}.png`);
    fs.writeFileSync(filePath, png);

    return { ok: true, path: filePath };
  } catch (error) {
    log('error', 'captureScreen failed', { error: String(error) });
    return { ok: false, reason: 'capture_failed' };
  }
}

module.exports = { captureScreen };
