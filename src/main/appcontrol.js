const { spawn } = require('child_process');
const { log } = require('./logger');

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
  if (!tokens.length && text) {
    tokens.push(text);
  }
  return tokens;
}

function parseLaunchCommand(command) {
  const parts = splitCommandLine(command);
  if (!parts.length) return null;
  return {
    executable: parts[0],
    args: parts.slice(1),
  };
}

function launchApp(command) {
  return new Promise((resolve) => {
    const parsed = typeof command === 'string' ? parseLaunchCommand(command) : command;
    if (!parsed || !parsed.executable) {
      resolve({ ok: false, reason: 'empty_command' });
      return;
    }
    try {
      const child = spawn(parsed.executable, parsed.args || [], {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const timeout = setTimeout(() => {
        finish({ ok: false, reason: 'spawn_timeout' });
      }, 2000);

      child.once('error', (error) => {
        clearTimeout(timeout);
        log('error', 'launchApp failed', { error: String(error) });
        finish({ ok: false, reason: 'spawn_failed' });
      });

      child.once('spawn', () => {
        clearTimeout(timeout);
        child.unref();
        finish({ ok: true });
      });
    } catch (error) {
      log('error', 'launchApp failed', { error: String(error) });
      resolve({ ok: false, reason: 'spawn_failed' });
    }
  });
}

function focusApp(appName) {
  return new Promise((resolve) => {
    if (!appName || !appName.trim()) {
      resolve({ ok: false, reason: 'empty_app' });
      return;
    }
    const script = '$w = New-Object -ComObject WScript.Shell; if ($w.AppActivate($args[0])) { exit 0 } else { exit 3 }';
    try {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
        appName,
      ], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const timeout = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        finish({ ok: false, reason: 'focus_timeout' });
      }, 5000);

      child.once('error', (error) => {
        clearTimeout(timeout);
        log('error', 'focusApp failed', { error: String(error) });
        finish({ ok: false, reason: 'spawn_failed' });
      });

      child.once('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          finish({ ok: true });
          return;
        }
        if (code === 3) {
          finish({ ok: false, reason: 'window_not_found' });
          return;
        }
        finish({ ok: false, reason: 'focus_failed' });
      });
    } catch (error) {
      log('error', 'focusApp failed', { error: String(error) });
      resolve({ ok: false, reason: 'spawn_failed' });
    }
  });
}

module.exports = { launchApp, focusApp, parseLaunchCommand };
