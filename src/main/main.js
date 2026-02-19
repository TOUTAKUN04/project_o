const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog } = require('electron');
const path = require('path');
const { initDb, addMemory, addMemoryVector, getRecentMemories, searchMemories } = require('./db');
const { streamChat, embedText, checkHealth } = require('./ollama');
const {
  ensureEditPermission,
  getSessionPermission,
  ensureControlPermission,
  getSessionControlPermission,
} = require('./permissions');
const { initConfig, getConfig, updateConfig } = require('./config');
const { openFile, saveFile, createFile } = require('./files');
const { captureScreen } = require('./capture');
const { launchApp, focusApp, parseLaunchCommand } = require('./appcontrol');
const { log } = require('./logger');
const { createBus } = require('./bus');
const { createAdapters } = require('./adapters');
const { validateToolCall } = require('./tools');
const { prepareChatMessages } = require('./prompt');

let mainWindow;
let tray;
let config;
let popupTimer = null;
const bus = createBus({ maxQueue: 500, logger: log });
let adapters;
let adapterSubscription = null;
const DEFAULT_HOTKEY = 'CommandOrControl+Shift+O';

process.on('uncaughtException', (error) => {
  log('error', 'uncaughtException', { error: String(error) });
});

process.on('unhandledRejection', (error) => {
  log('error', 'unhandledRejection', { error: String(error) });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    resizable: true,
    frame: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f3f3',
    title: 'Project O',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'tray.png'));
  const menu = Menu.buildFromTemplate([
    { label: 'Show/Hide', click: () => toggleWindow() },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('Overlay Assistant');
  tray.setContextMenu(menu);
  tray.on('click', () => toggleWindow());
}

function setupAutoStart() {
  app.setLoginItemSettings({
    openAtLogin: !!config.startup,
  });
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const desired = typeof config?.hotkey === 'string' ? config.hotkey.trim() : '';

  const tryRegister = (hotkey) => {
    try {
      return globalShortcut.register(hotkey, () => toggleWindow());
    } catch (error) {
      log('warn', 'Hotkey registration failed', { hotkey, error: String(error) });
      return false;
    }
  };

  if (desired && tryRegister(desired)) return;

  if (desired && desired !== DEFAULT_HOTKEY) {
    const fallback = tryRegister(DEFAULT_HOTKEY);
    if (fallback) {
      log('warn', 'Invalid hotkey; using default fallback', {
        requested: desired,
        fallback: DEFAULT_HOTKEY,
      });
      return;
    }
  }

  log('error', 'No global shortcut registered', { requested: desired || null });
}

function clearPopupTimer() {
  if (popupTimer) {
    clearInterval(popupTimer);
    popupTimer = null;
  }
}

function setupPopupMode() {
  clearPopupTimer();
  if (config.popupMode === 'hotkey+timer') {
    popupTimer = setInterval(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    }, 1000 * 60 * 15);
  }
}

function normalizeAppToken(input) {
  const raw = String(input || '').trim();
  if (!raw) return { full: '', base: '' };
  const unquoted = raw.startsWith('"') && raw.endsWith('"') && raw.length > 1 ? raw.slice(1, -1) : raw;
  const lower = unquoted.toLowerCase();
  const base = path.basename(lower);
  return {
    full: lower,
    base,
    stem: base.endsWith('.exe') ? base.slice(0, -4) : base,
  };
}

function isAppAllowed(appId, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;
  const target = normalizeAppToken(appId);
  if (!target.full) return false;
  return allowlist.some((entry) => {
    const item = normalizeAppToken(entry);
    if (!item.full) return false;
    return item.full === target.full || item.base === target.base || item.stem === target.stem;
  });
}

function addAllowedRoot(rootPath) {
  const existing = Array.isArray(config.allowedRoots) ? config.allowedRoots : [];
  const merged = Array.from(new Set([...existing, rootPath]));
  const { config: next, warnings } = updateConfig({ allowedRoots: merged });
  config = next;
  if (warnings && warnings.length) {
    log('warn', 'Config warnings', { warnings });
  }
  return { config: next, warnings };
}

async function confirmAction({ title, message, detail }) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Allow', 'Deny'],
    defaultId: 0,
    cancelId: 1,
    title,
    message,
    detail,
  });
  return result.response === 0;
}

async function addMemoryWithEmbedding(memory) {
  const id = addMemory(memory);
  if (!id) return { ok: false, reason: 'db_insert_failed' };
  try {
    const vector = await embedText({
      baseUrl: config.ollamaUrl,
      model: config.embeddingModel || config.model,
      prompt: memory.content,
    });
    addMemoryVector({ memoryId: id, vector });
  } catch (error) {
    log('warn', 'Embedding failed', { error: String(error) });
  }
  return { ok: true, id };
}

async function handleAdapterIncoming(event) {
  if (!config.adaptersAutoReply) return;
  const payload = event?.payload || {};
  const adapterName = payload.adapter;
  const adapter = adapters?.get(adapterName);
  if (!adapter || !adapter.sendMessage) return;
  if (!payload.text) return;

  try {
    const messages = prepareChatMessages({
      rawMessages: [{ role: 'user', content: payload.text }],
      config,
      context: { channel: adapterName || 'adapter' },
    });
    const response = await streamChat({
      baseUrl: config.ollamaUrl,
      model: config.model,
      messages,
      onChunk: () => {},
    });
    if (response?.content) {
      await adapter.sendMessage({
        channelId: payload.channelId,
        text: response.content,
        to: payload.userId,
      });
    }
  } catch (error) {
    log('warn', 'adapter auto-reply failed', { error: String(error) });
  }
}

app.whenReady().then(() => {
  initDb();
  config = initConfig();
  adapters = createAdapters({ bus, log, config });
  createWindow();
  createTray();
  setupAutoStart();
  registerShortcuts();
  setupPopupMode();
  bus.start();
  adapters.start();
  adapterSubscription = bus.subscribe('adapter:incoming', handleAdapterIncoming);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearPopupTimer();
  bus.stop();
  if (adapters) adapters.stop();
  if (adapterSubscription) adapterSubscription();
});

ipcMain.handle('config:get', () => getConfig());

ipcMain.handle('config:set', (_evt, patch) => {
  const { config: next, warnings } = updateConfig(patch || {});
  config = next;
  if (adapters) adapters.stop();
  adapters = createAdapters({ bus, log, config });
  adapters.start();
  setupAutoStart();
  registerShortcuts();
  setupPopupMode();
  bus.publish({ type: 'config:updated', payload: { hasWarnings: !!(warnings && warnings.length) } });
  if (warnings && warnings.length) {
    log('warn', 'Config warnings', { warnings });
  }
  return { ...config, _warnings: warnings };
});

ipcMain.handle('projects:trust', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, reason: 'canceled' };
  }
  const root = path.resolve(result.filePaths[0]);
  const { config: next, warnings } = addAllowedRoot(root);
  bus.publish({ type: 'project:trusted', payload: { root } });
  return { ok: true, root, config: next, warnings };
});

ipcMain.handle('memories:recent', () => getRecentMemories(20));

ipcMain.handle('memories:add', async (_evt, memory) => {
  const result = await addMemoryWithEmbedding(memory || {});
  if (result.ok) {
    bus.publish({ type: 'memory:added', payload: { role: memory?.role } });
    return { ok: true };
  }
  return { ok: false, reason: result.reason || 'memory_add_failed' };
});

ipcMain.handle('memories:search', async (_evt, query) => {
  if (!query || !query.trim()) return [];
  try {
    const vector = await embedText({
      baseUrl: config.ollamaUrl,
      model: config.embeddingModel || config.model,
      prompt: query,
    });
    return searchMemories(vector, 5);
  } catch (error) {
    log('warn', 'Memory search failed', { error: String(error) });
    return [];
  }
});

ipcMain.handle('permissions:edit:get', () => getSessionPermission());
ipcMain.handle('permissions:edit:request', async () => {
  return ensureEditPermission({ dialog, browserWindow: mainWindow });
});

ipcMain.handle('permissions:control:get', () => getSessionControlPermission());
ipcMain.handle('permissions:control:request', async () => {
  return ensureControlPermission({ dialog, browserWindow: mainWindow });
});

ipcMain.handle('files:open', async () => {
  const validation = validateToolCall('files:open', {});
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const result = await openFile({ dialog, browserWindow: mainWindow, allowedRoots: config.allowedRoots });
  if (result.ok) {
    bus.publish({ type: 'file:opened', payload: { name: path.basename(result.path || '') } });
  }
  return result;
});

ipcMain.handle('files:save', async (_evt, payload) => {
  const allowed = await ensureEditPermission({ dialog, browserWindow: mainWindow });
  if (!allowed) return { ok: false, reason: 'permission_denied' };
  const validation = validateToolCall('files:save', payload);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const result = await saveFile({
    filePath: payload.path,
    content: payload.content || '',
    allowedRoots: config.allowedRoots,
  });
  if (result.ok) {
    bus.publish({ type: 'file:saved', payload: { name: path.basename(payload.path || '') } });
  }
  return result;
});

ipcMain.handle('files:create', async (_evt, payload) => {
  const allowed = await ensureEditPermission({ dialog, browserWindow: mainWindow });
  if (!allowed) return { ok: false, reason: 'permission_denied' };
  const validation = validateToolCall('files:create', payload);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  if (path.isAbsolute(payload.relativePath)) return { ok: false, reason: 'invalid_path' };
  const normalized = path.normalize(payload.relativePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return { ok: false, reason: 'invalid_path' };
  }
  const fullPath = path.resolve(payload.root, normalized);
  const result = await createFile({
    filePath: fullPath,
    content: payload.content || '',
    allowedRoots: config.allowedRoots,
  });
  if (result.ok) {
    bus.publish({ type: 'file:created', payload: { name: path.basename(fullPath) } });
  }
  return result;
});

ipcMain.handle('capture:screen', async () => {
  const allowed = await ensureEditPermission({ dialog, browserWindow: mainWindow });
  if (!allowed) return { ok: false, reason: 'permission_denied' };
  const validation = validateToolCall('capture:screen', {});
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const result = await captureScreen();
  if (result.ok) {
    bus.publish({ type: 'screen:capture', payload: { path: result.path } });
  }
  return result;
});

ipcMain.handle('apps:launch', async (_evt, command) => {
  const allowed = await ensureControlPermission({ dialog, browserWindow: mainWindow });
  if (!allowed) return { ok: false, reason: 'permission_denied' };
  const validation = validateToolCall('apps:launch', { command });
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const parsed = parseLaunchCommand(command);
  if (!parsed || !parsed.executable) return { ok: false, reason: 'invalid_command' };
  if (!isAppAllowed(parsed.executable, config.appAllowlist)) {
    return { ok: false, reason: 'not_allowed' };
  }
  const confirmed = await confirmAction({
    title: 'Confirm App Launch',
    message: `Launch: ${command}?`,
    detail: 'This will start an application on your system.',
  });
  if (!confirmed) return { ok: false, reason: 'user_denied' };
  const result = await launchApp(parsed);
  if (result.ok) {
    bus.publish({ type: 'app:launched', payload: { command: parsed.executable } });
  }
  return result;
});

ipcMain.handle('apps:focus', async (_evt, appName) => {
  const allowed = await ensureControlPermission({ dialog, browserWindow: mainWindow });
  if (!allowed) return { ok: false, reason: 'permission_denied' };
  const validation = validateToolCall('apps:focus', { appName });
  if (!validation.ok) return { ok: false, reason: validation.reason };
  if (!isAppAllowed(appName, config.appAllowlist)) {
    return { ok: false, reason: 'not_allowed' };
  }
  const confirmed = await confirmAction({
    title: 'Confirm App Focus',
    message: `Focus window: ${appName}?`,
    detail: 'This will bring an app window to the foreground.',
  });
  if (!confirmed) return { ok: false, reason: 'user_denied' };
  const result = await focusApp(appName);
  if (result.ok) {
    bus.publish({ type: 'app:focused', payload: { appName } });
  }
  return result;
});

ipcMain.handle('ollama:health', async () => {
  const result = await checkHealth({ baseUrl: config.ollamaUrl, timeoutMs: 2000 });
  bus.publish({ type: 'ollama:health', payload: { ok: result.ok } });
  return result;
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:close', () => {
  app.quit();
});

ipcMain.handle('ollama:chat', async (evt, payload) => {
  try {
    const rawMessages = Array.isArray(payload?.messages) ? payload.messages : [];
    const context = payload?.context && typeof payload.context === 'object' ? payload.context : {};
    const messages = prepareChatMessages({ rawMessages, config, context });
    bus.publish({ type: 'chat:request', payload: { count: rawMessages.length } });
    const response = await streamChat({
      baseUrl: config.ollamaUrl,
      model: config.model,
      messages,
      onChunk: (chunk) => {
        evt.sender.send('ollama:chunk', chunk);
      },
    });
    bus.publish({ type: 'chat:response', payload: { length: response?.content?.length || 0 } });
    return response;
  } catch (error) {
    log('error', 'ollama:chat failed', { error: String(error) });
    bus.publish({ type: 'chat:error', payload: { error: String(error) } });
    return { error: 'Ollama unavailable.' };
  }
});
