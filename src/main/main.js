const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  initDb,
  addMemory,
  addMemoryVector,
  getRecentMemories,
  searchMemories,
  createTask,
  listTasks,
  getTaskById,
  claimNextQueuedTask,
  updateTaskStatus,
  updateTaskStepStatus,
  cancelPendingTaskSteps,
  addTaskEvent,
  listTaskEvents,
} = require('./db');
const { streamChat, embedText, checkHealth, normalizeProvider } = require('./ollama');
const {
  ensureEditPermission,
  getSessionPermission,
  ensureControlPermission,
  getSessionControlPermission,
  revokeEditPermission,
  revokeControlPermission,
} = require('./permissions');
const { initConfig, getConfig, updateConfig, toPublicConfig } = require('./config');
const { openFile, saveFile, createFile, isPathAllowed } = require('./files');
const { captureScreen } = require('./capture');
const {
  beginMasterChallenge,
  verifyMasterChallenge,
  lockMasterAccess,
  getMasterStatus,
  ensureMasterAccess,
  isMasterUnlocked,
} = require('./masterguard');
const { log } = require('./logger');
const { createBus } = require('./bus');
const { createAdapters } = require('./adapters');
const { validateToolCall } = require('./tools');
const { prepareChatMessages } = require('./prompt');
const { createTaskEngine } = require('./tasks');
const {
  getSelfUpdateStatus,
  ensureSelfUpdateAccess,
  unlockSelfUpdate,
  lockSelfUpdate,
} = require('./selfupdate');
const { runEditWorkflow, runVerificationChecks } = require('./workflow');
const { runCommand, parseTimeoutMs, parseCommand, resolveExecutablePath } = require('./systemrun');
const { searchWeb } = require('./websearch');
const { gitStatus, gitLog, gitDiff, gitCommit } = require('./gittools');
const { createFeelingsEngine } = require('./feelings');

let mainWindow;
let tray;
let config;
let popupTimer = null;
const bus = createBus({ maxQueue: 500, logger: log });
let adapters;
let adapterSubscription = null;
let taskEngine = null;
const DEFAULT_HOTKEY = 'CommandOrControl+Shift+O';
const BACKGROUND_LAUNCH_FLAGS = new Set(['--background', '--hidden']);
const FOREGROUND_LAUNCH_FLAGS = new Set(['--show', '--foreground']);
const MAX_COMMAND_INPUT_LENGTH = 4096;
const CHAT_CACHE_TTL_MS = (() => {
  const parsed = Number.parseInt(String(process.env.OVERLAY_CHAT_CACHE_TTL_MS || ''), 10);
  return Number.isFinite(parsed) && parsed >= 1000 && parsed <= 900000 ? parsed : 120000;
})();
const CHAT_CACHE_MAX_ENTRIES = (() => {
  const parsed = Number.parseInt(String(process.env.OVERLAY_CHAT_CACHE_MAX || ''), 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 512 ? parsed : 80;
})();
let isQuitting = false;
let forceShowOnReady = false;
const chatResponseCache = new Map();
let feelingsEngine = createFeelingsEngine({ decayMinutes: 45 });

function audit(event, details = {}) {
  log('info', `audit:${event}`, details);
}

function buildChatCacheKey({ provider, baseUrl, model, messages }) {
  const payload = JSON.stringify({
    provider: String(provider || ''),
    baseUrl: String(baseUrl || ''),
    model: String(model || ''),
    messages: Array.isArray(messages) ? messages : [],
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function pruneChatCache(now = Date.now()) {
  for (const [key, value] of chatResponseCache.entries()) {
    if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) {
      chatResponseCache.delete(key);
    }
  }
  if (chatResponseCache.size <= CHAT_CACHE_MAX_ENTRIES) return;
  const entries = Array.from(chatResponseCache.entries());
  entries.sort((a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0));
  const overflow = chatResponseCache.size - CHAT_CACHE_MAX_ENTRIES;
  for (let index = 0; index < overflow; index += 1) {
    const key = entries[index]?.[0];
    if (key) chatResponseCache.delete(key);
  }
}

function getCachedChatResponse(cacheKey) {
  if (!cacheKey) return null;
  pruneChatCache();
  const entry = chatResponseCache.get(cacheKey);
  if (!entry) return null;
  if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now()) {
    chatResponseCache.delete(cacheKey);
    return null;
  }
  return { content: entry.content, model: entry.model };
}

function setCachedChatResponse(cacheKey, response) {
  const content = typeof response?.content === 'string' ? response.content : '';
  if (!cacheKey || !content) return;
  const model = typeof response?.model === 'string' ? response.model : '';
  const now = Date.now();
  chatResponseCache.set(cacheKey, {
    content,
    model,
    createdAt: now,
    expiresAt: now + CHAT_CACHE_TTL_MS,
  });
  pruneChatCache(now);
}

function clearChatCache() {
  chatResponseCache.clear();
}

function getFeelingsState() {
  if (!config || config.simulatedFeelings === false) return null;
  return feelingsEngine.snapshot();
}

function isTrustedIpcSender(evt) {
  const frameUrl = String(evt?.senderFrame?.url || '');
  const senderUrl = String(evt?.sender?.getURL?.() || '');
  const url = frameUrl || senderUrl;
  return url.startsWith('file://');
}

function rejectUntrustedIpc(channel) {
  log('warn', 'Blocked IPC request from untrusted sender', { channel });
  return { ok: false, reason: 'untrusted_sender' };
}

function rejectMasterLocked(channel) {
  audit('master.locked', { channel });
  return { ok: false, reason: 'master_locked' };
}

function rejectSelfUpdateLocked(channel) {
  audit('selfupdate.locked', { channel });
  return { ok: false, reason: 'self_update_locked' };
}

function isMasterOverrideActive() {
  return !!config && isMasterUnlocked(config);
}

function getEffectiveAllowedRoots() {
  return isMasterOverrideActive() ? '*' : config?.allowedRoots;
}

function hasEditPermissionForAction() {
  return isMasterOverrideActive() || getSessionPermission();
}

function hasControlPermissionForAction() {
  return isMasterOverrideActive() || getSessionControlPermission();
}

async function ensureEditPermissionForAction() {
  if (isMasterOverrideActive()) return true;
  return ensureEditPermission({ dialog, browserWindow: mainWindow });
}

async function ensureControlPermissionForAction() {
  if (isMasterOverrideActive()) return true;
  return ensureControlPermission({ dialog, browserWindow: mainWindow });
}

function getLlmRuntimeConfig() {
  const provider = normalizeProvider(config?.llmProvider);
  if (provider === 'openai' || provider === 'gemini') {
    return {
      provider,
      baseUrl: config?.apiBaseUrl,
      apiKey: config?.apiKey,
    };
  }
  return {
    provider: 'ollama',
    baseUrl: config?.ollamaUrl,
    apiKey: '',
  };
}

process.on('uncaughtException', (error) => {
  log('error', 'uncaughtException', { error: String(error) });
});

process.on('unhandledRejection', (error) => {
  log('error', 'unhandledRejection', { error: String(error) });
});

function hasLaunchFlag(args, flags) {
  if (!Array.isArray(args) || !args.length) return false;
  return args.some((arg) => flags.has(String(arg || '').trim().toLowerCase()));
}

function shouldLaunchInBackground(argv = process.argv, options = {}) {
  const includeLoginHint = options.includeLoginHint !== false;
  const defaultBackground = options.defaultBackground === true;
  const args = Array.isArray(argv) ? argv.slice(1) : [];
  if (hasLaunchFlag(args, FOREGROUND_LAUNCH_FLAGS)) return false;
  if (hasLaunchFlag(args, BACKGROUND_LAUNCH_FLAGS)) return true;
  if (includeLoginHint) {
    try {
      const login = app.getLoginItemSettings();
      if (login?.wasOpenedAtLogin || login?.wasOpenedAsHidden) return true;
    } catch {
      // ignore login-item read failures
    }
  }
  return defaultBackground;
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

function hideMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  }
}

function createWindow({ showOnReady = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    icon: path.join(__dirname, 'icon.png'),
    resizable: true,
    frame: true,
    show: false,
    transparent: true,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    title: 'Olivia',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!String(url || '').startsWith('file://')) {
      event.preventDefault();
      log('warn', 'Blocked renderer navigation', { url });
    }
  });
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || !showOnReady) return;
    showMainWindow();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideMainWindow();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    hideMainWindow();
  } else {
    showMainWindow();
  }
}

function createTray() {
  const trayIconPath = process.platform === 'win32'
    ? path.join(__dirname, 'icon.ico')
    : path.join(__dirname, 'tray.png');
  tray = new Tray(trayIconPath);
  const menu = Menu.buildFromTemplate([
    { label: 'Open Olivia', click: () => showMainWindow() },
    { label: 'Hide Olivia', click: () => hideMainWindow() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip('Olivia Assistant');
  tray.setContextMenu(menu);
  tray.on('click', () => toggleWindow());
  tray.on('double-click', () => showMainWindow());
}

function setupAutoStart() {
  const openAtLogin = !!config.startup;
  const options = { openAtLogin };
  if (openAtLogin && app.isPackaged) {
    options.args = ['--background'];
  }
  app.setLoginItemSettings(options);
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

function hasToolControlChars(value) {
  return /[\u0000\r\n]/.test(String(value || ''));
}

function getDefaultCommandCwd() {
  const roots = Array.isArray(config?.allowedRoots) ? config.allowedRoots : [];
  if (roots.length > 0) {
    const candidate = String(roots[0] || '').trim();
    if (candidate) return candidate;
  }
  return process.cwd();
}

function isDirectoryPath(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveWorkingDirectory(rawInput) {
  const rawCwd = typeof rawInput === 'string' ? rawInput.trim() : '';
  const cwd = path.resolve(rawCwd || getDefaultCommandCwd());
  if (!path.isAbsolute(cwd)) return { ok: false, reason: 'invalid_path' };
  if (!isDirectoryPath(cwd)) return { ok: false, reason: 'invalid_cwd' };
  if (!isPathAllowed(cwd, getEffectiveAllowedRoots())) return { ok: false, reason: 'path_not_allowed' };
  return { ok: true, cwd };
}

function buildCommandPreview(executablePath, args) {
  const base = path.basename(String(executablePath || '').trim() || 'command');
  const tail = Array.isArray(args) && args.length ? ` ${args.join(' ')}` : '';
  const raw = `${base}${tail}`;
  if (raw.length <= 180) return raw;
  return `${raw.slice(0, 177)}...`;
}

function resolveCommandRequest(input) {
  const payload = input && typeof input === 'object' ? input : {};
  const validation = validateToolCall('system:run', payload);
  if (!validation.ok) return { ok: false, reason: validation.reason };

  const command = typeof payload.command === 'string' ? payload.command.trim() : '';
  if (!command || command.length > MAX_COMMAND_INPUT_LENGTH || hasToolControlChars(command)) {
    return { ok: false, reason: 'invalid_command' };
  }

  const parsed = parseCommand(command);
  if (!parsed || !parsed.executable) return { ok: false, reason: 'invalid_command' };
  if ((parsed.args || []).some((arg) => hasToolControlChars(arg))) {
    return { ok: false, reason: 'invalid_command' };
  }

  const resolvedExecutable = resolveExecutablePath(parsed.executable);
  if (!resolvedExecutable) return { ok: false, reason: 'executable_not_found' };

  const cwdResult = resolveWorkingDirectory(payload.cwd);
  if (!cwdResult.ok) return { ok: false, reason: cwdResult.reason };

  const timeoutMs = parseTimeoutMs(payload.timeoutMs, config.commandTimeoutMs);
  return {
    ok: true,
    command,
    executable: resolvedExecutable,
    args: parsed.args || [],
    cwd: cwdResult.cwd,
    timeoutMs,
  };
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
    const runtime = getLlmRuntimeConfig();
    const vector = await embedText({
      provider: runtime.provider,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      model: config.embeddingModel || config.model,
      prompt: memory.content,
    });
    addMemoryVector({ memoryId: id, vector });
  } catch (error) {
    log('warn', 'Embedding failed', { error: String(error) });
  }
  return { ok: true, id };
}

function createTaskHandlers() {
  const requireMasterUnlocked = () => {
    const master = ensureMasterAccess(config);
    if (!master.ok) return { ok: false, reason: 'master_locked' };
    return { ok: true };
  };

  const requireSelfUpdateUnlocked = () => {
    if (isMasterOverrideActive()) return { ok: true };
    const access = ensureSelfUpdateAccess(config);
    if (!access.ok) return { ok: false, reason: access.reason || 'self_update_locked' };
    return { ok: true };
  };

  const handleFileSave = async (input, context) => {
    const master = requireMasterUnlocked();
    if (!master.ok) return master;
    const selfUpdate = requireSelfUpdateUnlocked();
    if (!selfUpdate.ok) return selfUpdate;
    if (!hasEditPermissionForAction()) return { ok: false, reason: 'permission_denied' };

    const payload = input && typeof input === 'object' ? input : {};
    const validation = validateToolCall('files:save', payload);
    if (!validation.ok) return { ok: false, reason: validation.reason };

    const result = await saveFile({
      filePath: payload.path,
      content: payload.content || '',
      allowedRoots: getEffectiveAllowedRoots(),
    });
    if (!result.ok) return { ok: false, reason: result.reason || 'write_failed' };

    audit('task.file.save', {
      taskId: context?.taskId || null,
      stepIndex: context?.stepIndex ?? null,
      path: payload.path || null,
      ok: true,
    });
    bus.publish({ type: 'file:saved', payload: { name: path.basename(payload.path || '') } });
    return { ok: true, path: payload.path };
  };

  const handleFileCreate = async (input, context) => {
    const master = requireMasterUnlocked();
    if (!master.ok) return master;
    const selfUpdate = requireSelfUpdateUnlocked();
    if (!selfUpdate.ok) return selfUpdate;
    if (!hasEditPermissionForAction()) return { ok: false, reason: 'permission_denied' };

    const payload = input && typeof input === 'object' ? input : {};
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
      allowedRoots: getEffectiveAllowedRoots(),
    });
    if (!result.ok) return { ok: false, reason: result.reason || 'write_failed' };

    audit('task.file.create', {
      taskId: context?.taskId || null,
      stepIndex: context?.stepIndex ?? null,
      path: result.path || fullPath,
      ok: true,
    });
    bus.publish({ type: 'file:created', payload: { name: path.basename(result.path || fullPath) } });
    return { ok: true, path: result.path || fullPath };
  };

  const handleCapture = async (input, context) => {
    const master = requireMasterUnlocked();
    if (!master.ok) return master;
    if (!hasEditPermissionForAction()) return { ok: false, reason: 'permission_denied' };

    const validation = validateToolCall('capture:screen', input && typeof input === 'object' ? input : {});
    if (!validation.ok) return { ok: false, reason: validation.reason };

    const result = await captureScreen();
    if (!result.ok) return { ok: false, reason: result.reason || 'capture_failed' };

    audit('task.capture.screen', {
      taskId: context?.taskId || null,
      stepIndex: context?.stepIndex ?? null,
      path: result.path || null,
      ok: true,
    });
    bus.publish({ type: 'screen:capture', payload: { path: result.path } });
    return { ok: true, path: result.path };
  };

  const handleSystemRun = async (input, context) => {
    const master = requireMasterUnlocked();
    if (!master.ok) return master;
    const selfUpdate = requireSelfUpdateUnlocked();
    if (!selfUpdate.ok) return selfUpdate;
    if (!hasControlPermissionForAction()) return { ok: false, reason: 'permission_denied' };

    const resolved = resolveCommandRequest(input);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };

    const result = await runCommand({
      executable: resolved.executable,
      args: resolved.args,
      cwd: resolved.cwd,
      timeoutMs: resolved.timeoutMs,
    });

    audit('task.system.run', {
      taskId: context?.taskId || null,
      stepIndex: context?.stepIndex ?? null,
      command: buildCommandPreview(resolved.executable, resolved.args),
      cwd: resolved.cwd,
      timeoutMs: resolved.timeoutMs,
      ok: result.ok,
      reason: result.reason || null,
      exitCode: Number.isFinite(result.exitCode) ? result.exitCode : null,
    });
    bus.publish({
      type: 'system:run',
      payload: {
        command: buildCommandPreview(resolved.executable, resolved.args),
        ok: result.ok,
      },
    });
    return result;
  };

  const unsupportedInteractive = async () => ({ ok: false, reason: 'interactive_tool_not_supported' });

  return {
    'files:open': unsupportedInteractive,
    'files.open': unsupportedInteractive,
    'files:save': handleFileSave,
    'files.save': handleFileSave,
    'files:create': handleFileCreate,
    'files.create': handleFileCreate,
    'capture:screen': handleCapture,
    'capture.screen': handleCapture,
    'system:run': handleSystemRun,
    'system.run': handleSystemRun,
  };
}

function parseStepIndex(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseTaskLimit(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 200);
}

async function handleAdapterIncoming(event) {
  if (!config.adaptersAutoReply) return;
  const payload = event?.payload || {};
  const adapterName = payload.adapter;
  const adapter = adapters?.get(adapterName);
  if (!adapter || !adapter.sendMessage) return;
  if (!payload.text) return;

  try {
    const runtime = getLlmRuntimeConfig();
    const messages = prepareChatMessages({
      rawMessages: [{ role: 'user', content: payload.text }],
      config,
      context: { channel: adapterName || 'adapter' },
    });
    const response = await streamChat({
      provider: runtime.provider,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const openHidden = shouldLaunchInBackground(commandLine, {
      includeLoginHint: false,
      defaultBackground: false,
    });
    if (!app.isReady()) {
      if (!openHidden) forceShowOnReady = true;
      return;
    }
    if (!mainWindow) {
      createWindow({ showOnReady: !openHidden });
      return;
    }
    if (!openHidden) showMainWindow();
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  initDb();
  config = initConfig();
  feelingsEngine.configure({ decayMinutes: config.feelingsDecayMinutes });
  adapters = createAdapters({ bus, log, config });
  taskEngine = createTaskEngine({
    db: {
      createTask,
      listTasks,
      getTaskById,
      claimNextQueuedTask,
      updateTaskStatus,
      updateTaskStepStatus,
      cancelPendingTaskSteps,
      addTaskEvent,
      listTaskEvents,
    },
    handlers: createTaskHandlers(),
    bus,
    logger: log,
  });
  const openHidden = shouldLaunchInBackground(process.argv, {
    defaultBackground: app.isPackaged,
  });
  const showOnReady = !openHidden || forceShowOnReady;
  forceShowOnReady = false;
  createWindow({ showOnReady });
  createTray();
  setupAutoStart();
  registerShortcuts();
  setupPopupMode();
  bus.start();
  adapters.start();
  adapterSubscription = bus.subscribe('adapter:incoming', handleAdapterIncoming);
  taskEngine.kick();

  app.on('activate', () => {
    if (!mainWindow) {
      createWindow({ showOnReady: true });
      return;
    }
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep app active in tray until explicit quit.
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearPopupTimer();
  bus.stop();
  if (adapters) adapters.stop();
  if (adapterSubscription) adapterSubscription();
});

ipcMain.handle('config:get', (evt) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('config:get');
  return toPublicConfig(getConfig());
});

ipcMain.handle('config:set', (evt, patch) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('config:set');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('config:set');
  const { config: next, warnings } = updateConfig(patch || {});
  config = next;
  feelingsEngine.configure({ decayMinutes: config.feelingsDecayMinutes });
  clearChatCache();
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
  audit('config.updated', {
    warnings: warnings?.length || 0,
    webhookPort: config.webhookPort,
    adapterFlags: config.adapters,
  });
  return { ...toPublicConfig(config), _warnings: warnings };
});

ipcMain.handle('projects:trust', async (evt) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('projects:trust');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('projects:trust');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, reason: 'canceled' };
  }
  const root = path.resolve(result.filePaths[0]);
  const { config: next, warnings } = addAllowedRoot(root);
  bus.publish({ type: 'project:trusted', payload: { root } });
  audit('project.trusted', { root });
  return { ok: true, root, config: toPublicConfig(next), warnings };
});

ipcMain.handle('memories:recent', (evt) => {
  if (!isTrustedIpcSender(evt)) return [];
  return getRecentMemories(20);
});

ipcMain.handle('memories:add', async (evt, memory) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('memories:add');
  const result = await addMemoryWithEmbedding(memory || {});
  if (result.ok) {
    bus.publish({ type: 'memory:added', payload: { role: memory?.role } });
    return { ok: true };
  }
  return { ok: false, reason: result.reason || 'memory_add_failed' };
});

ipcMain.handle('memories:search', async (evt, query) => {
  if (!isTrustedIpcSender(evt)) return [];
  if (!query || !query.trim()) return [];
  try {
    const runtime = getLlmRuntimeConfig();
    const vector = await embedText({
      provider: runtime.provider,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      model: config.embeddingModel || config.model,
      prompt: query,
    });
    return searchMemories(vector, 5);
  } catch (error) {
    log('warn', 'Memory search failed', { error: String(error) });
    return [];
  }
});

ipcMain.handle('feelings:get', (evt) => {
  if (!isTrustedIpcSender(evt)) return { ok: false, reason: 'untrusted_sender', state: null };
  return { ok: true, state: getFeelingsState() };
});

ipcMain.handle('web:search', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('web:search');
  const data = payload && typeof payload === 'object' ? payload : {};
  const query = typeof data.query === 'string' ? data.query : '';
  const limitRaw = Number.parseInt(String(data.limit || ''), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 10) : 5;

  const result = await searchWeb({
    query,
    limit,
    timeoutMs: parseTimeoutMs(data.timeoutMs, 12000),
  });

  audit('web.search', {
    ok: result.ok,
    query: query.trim().slice(0, 160),
    count: Array.isArray(result.results) ? result.results.length : 0,
    reason: result.reason || null,
  });
  return result;
});

ipcMain.handle('master:status', (evt) => {
  if (!isTrustedIpcSender(evt)) return { enabled: false, unlocked: false, pending: false, remainingMs: 0 };
  return getMasterStatus(config);
});

ipcMain.handle('master:begin', (evt, phrase) => {
  if (!isTrustedIpcSender(evt)) return { ok: false, reason: 'untrusted_sender' };
  const result = beginMasterChallenge({ phrase, config });
  audit('master.begin', { ok: result.ok, reason: result.reason || null });
  return result;
});

ipcMain.handle('master:verify', (evt, answer) => {
  if (!isTrustedIpcSender(evt)) return { ok: false, reason: 'untrusted_sender' };
  const result = verifyMasterChallenge({ answer, config });
  audit('master.verify', { ok: result.ok, reason: result.reason || null });
  return result;
});

ipcMain.handle('master:lock', (evt) => {
  if (!isTrustedIpcSender(evt)) return { ok: false, reason: 'untrusted_sender' };
  const status = lockMasterAccess(config);
  lockSelfUpdate(config);
  audit('master.lock', { ok: true });
  return { ok: true, status };
});

ipcMain.handle('selfupdate:status', (evt) => {
  if (!isTrustedIpcSender(evt)) return { enabled: true, unlocked: false, remainingMs: 0, unlockMinutes: 10 };
  return getSelfUpdateStatus(config);
});

ipcMain.handle('selfupdate:unlock', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('selfupdate:unlock');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('selfupdate:unlock');
  const minutes = Number.parseInt(String(payload?.minutes || ''), 10);
  const requestedMinutes = Number.isFinite(minutes) && minutes > 0 && minutes <= 240
    ? minutes
    : config.selfUpdateUnlockMinutes;
  const confirmed = await confirmAction({
    title: 'Allow AI Code Updates',
    message: `Allow AI-driven code updates for ${requestedMinutes} minutes?`,
    detail: 'This allows automated task steps to create or modify files until the timer expires.',
  });
  if (!confirmed) return { ok: false, reason: 'user_denied', status: getSelfUpdateStatus(config) };
  const status = unlockSelfUpdate(config, requestedMinutes);
  audit('selfupdate.unlock', { ok: true, minutes: requestedMinutes });
  return { ok: true, status };
});

ipcMain.handle('selfupdate:lock', (evt) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('selfupdate:lock');
  const status = lockSelfUpdate(config);
  audit('selfupdate.lock', { ok: true });
  return { ok: true, status };
});

ipcMain.handle('permissions:edit:get', (evt) => {
  if (!isTrustedIpcSender(evt)) return false;
  return hasEditPermissionForAction();
});
ipcMain.handle('permissions:edit:request', async (evt) => {
  if (!isTrustedIpcSender(evt)) return false;
  const allowed = await ensureEditPermissionForAction();
  audit('permission.edit', { allowed });
  return allowed;
});
ipcMain.handle('permissions:edit:revoke', (evt) => {
  if (!isTrustedIpcSender(evt)) return false;
  const allowed = revokeEditPermission();
  audit('permission.edit', { allowed, revoked: true });
  return allowed;
});

ipcMain.handle('permissions:control:get', (evt) => {
  if (!isTrustedIpcSender(evt)) return false;
  return hasControlPermissionForAction();
});
ipcMain.handle('permissions:control:request', async (evt) => {
  if (!isTrustedIpcSender(evt)) return false;
  const allowed = await ensureControlPermissionForAction();
  audit('permission.control', { allowed });
  return allowed;
});
ipcMain.handle('permissions:control:revoke', (evt) => {
  if (!isTrustedIpcSender(evt)) return false;
  const allowed = revokeControlPermission();
  audit('permission.control', { allowed, revoked: true });
  return allowed;
});

ipcMain.handle('files:open', async (evt) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('files:open');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('files:open');
  const validation = validateToolCall('files:open', {});
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const result = await openFile({
    dialog,
    browserWindow: mainWindow,
    allowedRoots: getEffectiveAllowedRoots(),
  });
  audit('file.open', {
    ok: result.ok,
    reason: result.reason || null,
    path: result.path || null,
  });
  if (result.ok) {
    bus.publish({ type: 'file:opened', payload: { name: path.basename(result.path || '') } });
  }
  return result;
});

ipcMain.handle('files:save', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('files:save');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('files:save');
  const allowed = await ensureEditPermissionForAction();
  if (!allowed) return { ok: false, reason: 'permission_denied' };
  const validation = validateToolCall('files:save', payload);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const result = await saveFile({
    filePath: payload.path,
    content: payload.content || '',
    allowedRoots: getEffectiveAllowedRoots(),
  });
  audit('file.save', {
    ok: result.ok,
    reason: result.reason || null,
    path: payload.path || null,
  });
  if (result.ok) {
    bus.publish({ type: 'file:saved', payload: { name: path.basename(payload.path || '') } });
  }
  return result;
});

ipcMain.handle('files:create', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('files:create');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('files:create');
  const allowed = await ensureEditPermissionForAction();
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
    allowedRoots: getEffectiveAllowedRoots(),
  });
  audit('file.create', {
    ok: result.ok,
    reason: result.reason || null,
    path: fullPath,
  });
  if (result.ok) {
    bus.publish({ type: 'file:created', payload: { name: path.basename(fullPath) } });
  }
  return result;
});

ipcMain.handle('workflow:edit', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('workflow:edit');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('workflow:edit');
  if (!isMasterOverrideActive()) {
    const selfUpdate = ensureSelfUpdateAccess(config);
    if (!selfUpdate.ok) return rejectSelfUpdateLocked('workflow:edit');
  }
  if (!hasEditPermissionForAction()) return { ok: false, reason: 'permission_denied' };

  const data = payload && typeof payload === 'object' ? payload : {};
  const filePath = typeof data.path === 'string' ? data.path.trim() : '';
  const content = typeof data.content === 'string' ? data.content : '';
  const instruction = typeof data.instruction === 'string' ? data.instruction.trim() : '';

  if (!path.isAbsolute(filePath)) return { ok: false, reason: 'invalid_path' };
  if (!isPathAllowed(filePath, getEffectiveAllowedRoots())) return { ok: false, reason: 'path_not_allowed' };
  if (!instruction) return { ok: false, reason: 'missing_instruction' };

  try {
    const runtime = getLlmRuntimeConfig();
    const result = await runEditWorkflow({
      provider: runtime.provider,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      model: config.model,
      filePath,
      currentContent: content,
      instruction,
    });
    audit('workflow.edit', {
      ok: result.ok,
      reason: result.reason || null,
      path: filePath,
    });
    if (config.simulatedFeelings !== false) {
      feelingsEngine.observeOutcome({ ok: result.ok, source: 'workflow_edit' });
    }
    return result;
  } catch (error) {
    if (config.simulatedFeelings !== false) {
      feelingsEngine.observeOutcome({ ok: false, source: 'workflow_edit' });
    }
    log('error', 'workflow:edit failed', { error: String(error) });
    return { ok: false, reason: 'workflow_failed' };
  }
});

ipcMain.handle('workflow:verify', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('workflow:verify');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('workflow:verify');
  if (!hasEditPermissionForAction()) return { ok: false, reason: 'permission_denied' };

  const data = payload && typeof payload === 'object' ? payload : {};
  const filePath = typeof data.path === 'string' ? data.path.trim() : '';
  if (!path.isAbsolute(filePath)) return { ok: false, reason: 'invalid_path' };
  if (!isPathAllowed(filePath, getEffectiveAllowedRoots())) return { ok: false, reason: 'path_not_allowed' };

  const timeoutMsRaw = Number.parseInt(String(data.timeoutMs || ''), 10);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw >= 15000 && timeoutMsRaw <= 300000
    ? timeoutMsRaw
    : 120000;
  const result = await runVerificationChecks({
    filePath,
    allowedRoots: getEffectiveAllowedRoots(),
    timeoutMs,
  });
  audit('workflow.verify', {
    ok: result.ok,
    reason: result.reason || null,
    path: filePath,
    scripts: Array.isArray(result.scripts) ? result.scripts.length : 0,
  });
  if (config.simulatedFeelings !== false) {
    feelingsEngine.observeOutcome({ ok: result.ok, source: 'workflow_verify' });
  }
  return result;
});

ipcMain.handle('capture:screen', async (evt) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('capture:screen');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('capture:screen');
  const allowed = await ensureEditPermissionForAction();
  if (!allowed) return { ok: false, reason: 'permission_denied' };
  const validation = validateToolCall('capture:screen', {});
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const result = await captureScreen();
  if (result.ok) {
    bus.publish({ type: 'screen:capture', payload: { path: result.path } });
  }
  return result;
});

ipcMain.handle('system:run', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('system:run');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('system:run');
  const allowed = await ensureControlPermissionForAction();
  if (!allowed) {
    audit('system.run', { ok: false, reason: 'permission_denied' });
    return { ok: false, reason: 'permission_denied' };
  }

  const resolved = resolveCommandRequest(payload);
  if (!resolved.ok) {
    audit('system.run', { ok: false, reason: resolved.reason || 'invalid_command' });
    return { ok: false, reason: resolved.reason || 'invalid_command' };
  }

  const commandPreview = buildCommandPreview(resolved.executable, resolved.args);
  if (!isMasterOverrideActive()) {
    const confirmed = await confirmAction({
      title: 'Confirm Command Run',
      message: `Run command: ${commandPreview}?`,
      detail: `Working directory: ${resolved.cwd}\nTimeout: ${resolved.timeoutMs} ms`,
    });
    if (!confirmed) {
      audit('system.run', { ok: false, reason: 'user_denied', command: commandPreview });
      return { ok: false, reason: 'user_denied' };
    }
  }

  const result = await runCommand({
    executable: resolved.executable,
    args: resolved.args,
    cwd: resolved.cwd,
    timeoutMs: resolved.timeoutMs,
  });
  audit('system.run', {
    ok: result.ok,
    reason: result.reason || null,
    command: commandPreview,
    cwd: resolved.cwd,
    timeoutMs: resolved.timeoutMs,
    exitCode: Number.isFinite(result.exitCode) ? result.exitCode : null,
  });
  bus.publish({
    type: 'system:run',
    payload: {
      command: commandPreview,
      ok: result.ok,
      exitCode: Number.isFinite(result.exitCode) ? result.exitCode : null,
    },
  });
  if (config.simulatedFeelings !== false) {
    feelingsEngine.observeOutcome({ ok: result.ok, source: 'system_run' });
  }
  return result;
});

ipcMain.handle('git:status', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('git:status');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('git:status');
  const allowed = await ensureControlPermissionForAction();
  if (!allowed) return { ok: false, reason: 'permission_denied' };

  const data = payload && typeof payload === 'object' ? payload : {};
  const cwdResult = resolveWorkingDirectory(data.cwd);
  if (!cwdResult.ok) return { ok: false, reason: cwdResult.reason };

  const result = await gitStatus({
    cwd: cwdResult.cwd,
    timeoutMs: parseTimeoutMs(data.timeoutMs, config.commandTimeoutMs),
  });

  audit('git.status', {
    ok: result.ok,
    cwd: cwdResult.cwd,
    reason: result.reason || null,
  });
  return result;
});

ipcMain.handle('git:log', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('git:log');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('git:log');
  const allowed = await ensureControlPermissionForAction();
  if (!allowed) return { ok: false, reason: 'permission_denied' };

  const data = payload && typeof payload === 'object' ? payload : {};
  const cwdResult = resolveWorkingDirectory(data.cwd);
  if (!cwdResult.ok) return { ok: false, reason: cwdResult.reason };
  const limitRaw = Number.parseInt(String(data.limit || ''), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;

  const result = await gitLog({
    cwd: cwdResult.cwd,
    limit,
    timeoutMs: parseTimeoutMs(data.timeoutMs, config.commandTimeoutMs),
  });

  audit('git.log', {
    ok: result.ok,
    cwd: cwdResult.cwd,
    limit,
    reason: result.reason || null,
  });
  return result;
});

ipcMain.handle('git:diff', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('git:diff');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('git:diff');
  const allowed = await ensureControlPermissionForAction();
  if (!allowed) return { ok: false, reason: 'permission_denied' };

  const data = payload && typeof payload === 'object' ? payload : {};
  const cwdResult = resolveWorkingDirectory(data.cwd);
  if (!cwdResult.ok) return { ok: false, reason: cwdResult.reason };

  const result = await gitDiff({
    cwd: cwdResult.cwd,
    ref: typeof data.ref === 'string' ? data.ref : '',
    timeoutMs: parseTimeoutMs(data.timeoutMs, config.commandTimeoutMs),
  });

  audit('git.diff', {
    ok: result.ok,
    cwd: cwdResult.cwd,
    reason: result.reason || null,
  });
  return result;
});

ipcMain.handle('git:commit', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('git:commit');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('git:commit');
  const allowed = await ensureControlPermissionForAction();
  if (!allowed) return { ok: false, reason: 'permission_denied' };

  const data = payload && typeof payload === 'object' ? payload : {};
  const cwdResult = resolveWorkingDirectory(data.cwd);
  if (!cwdResult.ok) return { ok: false, reason: cwdResult.reason };

  const message = typeof data.message === 'string' ? data.message.trim() : '';
  if (!message) return { ok: false, reason: 'missing_message' };

  if (!isMasterOverrideActive()) {
    const confirmed = await confirmAction({
      title: 'Confirm Git Commit',
      message: `Create commit in ${cwdResult.cwd}?`,
      detail: `Message: ${message.slice(0, 160)}`,
    });
    if (!confirmed) return { ok: false, reason: 'user_denied' };
  }

  const result = await gitCommit({
    cwd: cwdResult.cwd,
    message,
    timeoutMs: parseTimeoutMs(data.timeoutMs, config.commandTimeoutMs),
  });

  audit('git.commit', {
    ok: result.ok,
    cwd: cwdResult.cwd,
    reason: result.reason || null,
  });
  return result;
});

ipcMain.handle('tasks:create', (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('tasks:create');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('tasks:create');
  if (!taskEngine) return { ok: false, reason: 'task_engine_unavailable' };

  const data = typeof payload === 'string'
    ? { goal: payload }
    : (payload && typeof payload === 'object' ? payload : {});
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const hasCodeMutation = steps.some((step) => {
    if (!step || step.stepType !== 'tool') return false;
    const tool = String(step.toolName || '').toLowerCase();
    return tool === 'files:save'
      || tool === 'files.save'
      || tool === 'files:create'
      || tool === 'files.create'
      || tool === 'system:run'
      || tool === 'system.run';
  });
  if (hasCodeMutation) {
    if (!isMasterOverrideActive()) {
      const selfUpdate = ensureSelfUpdateAccess(config);
      if (!selfUpdate.ok) return rejectSelfUpdateLocked('tasks:create');
    }
  }
  const result = taskEngine.enqueue({
    title: data.title,
    goal: data.goal,
    steps: data.steps,
    metadata: data.metadata,
  });
  audit('task.create', {
    ok: result.ok,
    reason: result.reason || null,
    taskId: result.taskId || null,
  });
  return result;
});

ipcMain.handle('tasks:list', (evt, limit) => {
  if (!isTrustedIpcSender(evt)) return [];
  if (!taskEngine) return [];
  const safeLimit = parseTaskLimit(limit, 50);
  return taskEngine.list(safeLimit);
});

ipcMain.handle('tasks:get', (evt, taskId) => {
  if (!isTrustedIpcSender(evt)) return null;
  if (!taskEngine) return null;
  const id = String(taskId || '').trim();
  if (!id) return null;
  return taskEngine.get(id);
});

ipcMain.handle('tasks:events', (evt, taskId, limit) => {
  if (!isTrustedIpcSender(evt)) return [];
  if (!taskEngine) return [];
  const id = String(taskId || '').trim();
  if (!id) return [];
  const safeLimit = parseTaskLimit(limit, 100);
  return taskEngine.listEvents(id, safeLimit);
});

ipcMain.handle('tasks:approve-step', (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('tasks:approve-step');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('tasks:approve-step');
  if (!taskEngine) return { ok: false, reason: 'task_engine_unavailable' };

  const data = payload && typeof payload === 'object' ? payload : {};
  const taskId = String(data.taskId || '').trim();
  const stepIndex = parseStepIndex(data.stepIndex);
  if (!taskId) return { ok: false, reason: 'missing_task_id' };
  if (stepIndex === null) return { ok: false, reason: 'invalid_step_index' };

  const result = taskEngine.approveStep(taskId, stepIndex);
  audit('task.approve_step', {
    ok: result.ok,
    reason: result.reason || null,
    taskId,
    stepIndex,
  });
  return result;
});

ipcMain.handle('tasks:cancel', (evt, taskId) => {
  if (!isTrustedIpcSender(evt)) return rejectUntrustedIpc('tasks:cancel');
  const master = ensureMasterAccess(config);
  if (!master.ok) return rejectMasterLocked('tasks:cancel');
  if (!taskEngine) return { ok: false, reason: 'task_engine_unavailable' };

  const id = String(taskId || '').trim();
  if (!id) return { ok: false, reason: 'missing_task_id' };
  const result = taskEngine.cancel(id);
  audit('task.cancel', {
    ok: result.ok,
    reason: result.reason || null,
    taskId: id,
  });
  return result;
});

ipcMain.handle('ollama:health', async () => {
  const runtime = getLlmRuntimeConfig();
  const result = await checkHealth({
    provider: runtime.provider,
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
    timeoutMs: 2000,
  });
  bus.publish({ type: 'ollama:health', payload: { ok: result.ok } });
  return result;
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:close', () => {
  hideMainWindow();
});

ipcMain.handle('ollama:chat', async (evt, payload) => {
  if (!isTrustedIpcSender(evt)) return { error: 'Untrusted sender.' };
  try {
    const runtime = getLlmRuntimeConfig();
    const rawMessages = Array.isArray(payload?.messages) ? payload.messages : [];
    const latestUserMessage = (() => {
      for (let index = rawMessages.length - 1; index >= 0; index -= 1) {
        const item = rawMessages[index];
        if (item?.role !== 'user') continue;
        if (typeof item?.content !== 'string') continue;
        const text = item.content.trim();
        if (text) return text;
      }
      return '';
    })();

    if (latestUserMessage && config.simulatedFeelings !== false) {
      feelingsEngine.observeUserText(latestUserMessage);
    }

    const rawContext = payload?.context && typeof payload.context === 'object' ? payload.context : {};
    const context = {
      ...rawContext,
      latestUserMessage: rawContext.latestUserMessage || latestUserMessage || '',
      feelingsState: getFeelingsState(),
    };

    const messages = prepareChatMessages({ rawMessages, config, context });
    const cacheKey = buildChatCacheKey({
      provider: runtime.provider,
      baseUrl: runtime.baseUrl,
      model: config.model,
      messages,
    });
    bus.publish({ type: 'chat:request', payload: { count: rawMessages.length } });

    const cached = getCachedChatResponse(cacheKey);
    if (cached) {
      evt.sender.send('ollama:chunk', cached.content);
      if (config.simulatedFeelings !== false) {
        feelingsEngine.observeOutcome({ ok: true, source: 'chat_cache' });
      }
      bus.publish({
        type: 'chat:response',
        payload: { length: cached.content.length, cached: true },
      });
      return { ...cached, cached: true };
    }

    const response = await streamChat({
      provider: runtime.provider,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      model: config.model,
      messages,
      onChunk: (chunk) => {
        evt.sender.send('ollama:chunk', chunk);
      },
    });
    if (config.simulatedFeelings !== false) {
      feelingsEngine.observeOutcome({ ok: true, source: 'chat' });
    }
    setCachedChatResponse(cacheKey, response);
    bus.publish({ type: 'chat:response', payload: { length: response?.content?.length || 0 } });
    return response;
  } catch (error) {
    if (config?.simulatedFeelings !== false) {
      feelingsEngine.observeOutcome({ ok: false, source: 'chat' });
    }
    log('error', 'provider:chat failed', { error: String(error) });
    bus.publish({ type: 'chat:error', payload: { error: String(error) } });
    return { error: 'Model provider unavailable.' };
  }
});

