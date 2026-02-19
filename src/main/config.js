const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getDefaultConfig() {
  const docs = app.getPath('documents');
  const cwd = process.cwd();
  const allowedRoots = [docs, cwd].filter(Boolean);
  return {
    assistantName: 'Project O',
    assistantStyle: 'codex',
    personaPrompt: '',
    model: 'qwen-coder',
    embeddingModel: 'qwen-coder',
    ollamaUrl: 'http://localhost:11434',
    allowRemoteOllama: false,
    hotkey: 'CommandOrControl+Shift+O',
    startup: true,
    popupMode: 'hotkey',
    allowedRoots,
    appAllowlist: [],
    webhookPort: 3210,
    adaptersAutoReply: false,
    adapters: {
      local: false,
      telegram: false,
      discord: false,
      slack: false,
      whatsapp: false,
    },
  };
}

let configCache = null;

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  return value.split(/[;\n]/g).map((item) => item.trim()).filter(Boolean);
}

function normalizeRoots(value, warnings) {
  const items = parseList(value);
  const roots = [];
  items.forEach((root) => {
    if (!path.isAbsolute(root)) {
      warnings.push(`Ignoring non-absolute root: ${root}`);
      return;
    }
    const normalized = path.resolve(root);
    if (!fs.existsSync(normalized)) {
      warnings.push(`Root does not exist: ${normalized}`);
      return;
    }
    roots.push(normalized);
  });
  return Array.from(new Set(roots));
}

function normalizeAllowlist(value) {
  const items = parseList(value);
  const cleaned = items.map((item) => item.toLowerCase());
  return Array.from(new Set(cleaned));
}

function sanitizeUrl(url, allowRemote, warnings, fallback) {
  if (typeof url !== 'string' || !url.trim()) {
    warnings.push('Ollama URL empty; using default.');
    return fallback;
  }
  try {
    const parsed = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      warnings.push('Ollama URL must be http(s); using default.');
      return fallback;
    }
    if (!allowRemote) {
      const host = parsed.hostname.toLowerCase();
      if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
        warnings.push('Remote Ollama blocked; using default.');
        return fallback;
      }
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    warnings.push('Invalid Ollama URL; using default.');
    return fallback;
  }
}

function sanitizeConfig(input) {
  const defaults = getDefaultConfig();
  const warnings = [];
  const next = { ...defaults, ...(input || {}) };

  next.assistantName = typeof next.assistantName === 'string' && next.assistantName.trim()
    ? next.assistantName.trim().slice(0, 60)
    : defaults.assistantName;
  next.assistantStyle = next.assistantStyle === 'codex' ? 'codex' : defaults.assistantStyle;
  next.personaPrompt = typeof next.personaPrompt === 'string' ? next.personaPrompt.trim() : '';
  if (next.personaPrompt.length > 2000) {
    warnings.push('Persona prompt too long; truncated.');
    next.personaPrompt = next.personaPrompt.slice(0, 2000);
  }

  next.model = typeof next.model === 'string' && next.model.trim() ? next.model.trim() : defaults.model;
  next.embeddingModel = typeof next.embeddingModel === 'string' && next.embeddingModel.trim()
    ? next.embeddingModel.trim()
    : next.model;
  next.allowRemoteOllama = !!next.allowRemoteOllama;
  next.ollamaUrl = sanitizeUrl(next.ollamaUrl, next.allowRemoteOllama, warnings, defaults.ollamaUrl);

  next.hotkey = typeof next.hotkey === 'string' && next.hotkey.trim() ? next.hotkey.trim() : defaults.hotkey;
  next.startup = !!next.startup;
  next.popupMode = next.popupMode === 'hotkey+timer' ? 'hotkey+timer' : 'hotkey';

  const roots = normalizeRoots(next.allowedRoots, warnings);
  next.allowedRoots = roots.length ? roots : defaults.allowedRoots;
  if (!roots.length) warnings.push('Allowed roots empty; using defaults.');

  next.appAllowlist = normalizeAllowlist(next.appAllowlist);
  const port = Number.parseInt(next.webhookPort, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    warnings.push('Invalid webhook port; using default.');
    next.webhookPort = defaults.webhookPort;
  } else {
    next.webhookPort = port;
  }
  next.adaptersAutoReply = !!next.adaptersAutoReply;
  if (next.adapters && typeof next.adapters === 'object') {
    next.adapters = {
      local: !!next.adapters.local,
      telegram: !!next.adapters.telegram,
      discord: !!next.adapters.discord,
      slack: !!next.adapters.slack,
      whatsapp: !!next.adapters.whatsapp,
    };
  } else {
    next.adapters = { ...defaults.adapters };
  }

  return { config: next, warnings };
}

function initConfig() {
  if (configCache) return configCache;
  const filePath = getConfigPath();
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { config } = sanitizeConfig(JSON.parse(raw));
      configCache = config;
      return configCache;
    } catch {
      const { config } = sanitizeConfig({});
      configCache = config;
      return configCache;
    }
  }
  const { config } = sanitizeConfig({});
  configCache = config;
  fs.writeFileSync(filePath, JSON.stringify(configCache, null, 2), 'utf8');
  return configCache;
}

function getConfig() {
  if (!configCache) return initConfig();
  return configCache;
}

function updateConfig(patch) {
  const { config, warnings } = sanitizeConfig({ ...getConfig(), ...(patch || {}) });
  configCache = config;
  fs.writeFileSync(getConfigPath(), JSON.stringify(configCache, null, 2), 'utf8');
  return { config, warnings };
}

module.exports = { initConfig, getConfig, updateConfig, getDefaultConfig };
