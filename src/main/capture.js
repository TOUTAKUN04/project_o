const { desktopCapturer, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { log } = require('./logger');

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
    const filePath = path.join(app.getPath('userData'), `capture-${Date.now()}.png`);
    fs.writeFileSync(filePath, png);

    return { ok: true, path: filePath };
  } catch (error) {
    log('error', 'captureScreen failed', { error: String(error) });
    return { ok: false, reason: 'capture_failed' };
  }
}

module.exports = { captureScreen };