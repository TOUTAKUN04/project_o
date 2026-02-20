const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_MASTER_CODE_HASH = crypto.createHash('sha256')
  .update('toutakun04mainmaster122002%', 'utf8')
  .digest('hex');
const DEFAULT_MASTER_ANSWER_HASH = crypto.createHash('sha256')
  .update('210519', 'utf8')
  .digest('hex');
const DEFAULT_MASTER_QUESTION = 'Whats context in it?';
const LEGACY_MASTER_ANSWER_HASH = crypto.createHash('sha256')
  .update('projecto', 'utf8')
  .digest('hex');
const LEGACY_MASTER_QUESTION = 'Security check: what is the master answer?';
const DEFAULT_OPENAI_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function parseBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

function parseBoundedFloat(value, fallback, min, max) {
  const parsed = Number.parseFloat(String(value || ''));
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

function getDefaultConfig() {
  const docs = app.getPath('documents');
  const cwd = process.cwd();
  const allowedRoots = [docs, cwd].filter(Boolean);
  return {
    assistantName: 'Olivia',
    assistantStyle: 'codex',
    personaPrompt: '',
    simulatedFeelings: true,
    feelingsTone: 'balanced',
    feelingsExpressiveness: 'balanced',
    feelingsDecayMinutes: 45,
    llmProvider: 'ollama',
    model: 'freehuntx/qwen3-coder:14b',
    embeddingModel: 'nomic-embed-text:latest',
    ollamaUrl: 'http://localhost:11434',
    apiBaseUrl: DEFAULT_OPENAI_API_BASE,
    apiKey: '',
    allowRemoteOllama: false,
    micMode: 'wake',
    speechRate: 1.08,
    autoToolMode: true,
    hotkey: 'CommandOrControl+Shift+O',
    startup: true,
    popupMode: 'hotkey',
    allowedRoots,
    commandTimeoutMs: 120000,
    webhookPort: 3210,
    adaptersAutoReply: false,
    adapters: {
      local: false,
      telegram: false,
      discord: false,
      slack: false,
      whatsapp: false,
    },
    masterGuardEnabled: true,
    masterCodeHash: DEFAULT_MASTER_CODE_HASH,
    masterQuestion: DEFAULT_MASTER_QUESTION,
    masterAnswerHash: DEFAULT_MASTER_ANSWER_HASH,
    masterUnlockMinutes: 30,
    masterChallengeTimeoutSec: 120,
    selfUpdateGuardEnabled: true,
    selfUpdateUnlockMinutes: 10,
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

function sanitizeApiBaseUrl(url, warnings, fallback) {
  if (typeof url !== 'string' || !url.trim()) {
    warnings.push('API base URL empty; using default.');
    return fallback;
  }
  try {
    const parsed = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      warnings.push('API base URL must be http(s); using default.');
      return fallback;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    warnings.push('Invalid API base URL; using default.');
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
  next.simulatedFeelings = next.simulatedFeelings !== false;
  next.feelingsTone = ['calm', 'balanced', 'warm'].includes(String(next.feelingsTone || '').toLowerCase())
    ? String(next.feelingsTone).toLowerCase()
    : defaults.feelingsTone;
  next.feelingsExpressiveness = ['subtle', 'balanced', 'expressive']
    .includes(String(next.feelingsExpressiveness || '').toLowerCase())
    ? String(next.feelingsExpressiveness).toLowerCase()
    : defaults.feelingsExpressiveness;
  next.feelingsDecayMinutes = parseBoundedInt(
    next.feelingsDecayMinutes,
    defaults.feelingsDecayMinutes,
    5,
    240,
  );
  const providerRaw = String(next.llmProvider || '').toLowerCase();
  next.llmProvider = ['openai', 'gemini'].includes(providerRaw) ? providerRaw : 'ollama';

  next.model = typeof next.model === 'string' && next.model.trim() ? next.model.trim() : defaults.model;
  next.embeddingModel = typeof next.embeddingModel === 'string' && next.embeddingModel.trim()
    ? next.embeddingModel.trim()
    : next.model;
  next.allowRemoteOllama = !!next.allowRemoteOllama;
  const ollamaWarnings = next.llmProvider === 'ollama' ? warnings : [];
  next.ollamaUrl = sanitizeUrl(next.ollamaUrl, next.allowRemoteOllama, ollamaWarnings, defaults.ollamaUrl);
  const providerFallback = next.llmProvider === 'gemini' ? DEFAULT_GEMINI_API_BASE : DEFAULT_OPENAI_API_BASE;
  next.apiBaseUrl = sanitizeApiBaseUrl(next.apiBaseUrl, warnings, providerFallback);
  next.apiKey = typeof next.apiKey === 'string' ? next.apiKey.trim() : '';
  if ((next.llmProvider === 'openai' || next.llmProvider === 'gemini') && !next.apiKey) {
    warnings.push(`API key empty; ${next.llmProvider} mode will fail until apiKey is set.`);
  }
  next.micMode = String(next.micMode || '').toLowerCase() === 'push' ? 'push' : 'wake';
  next.speechRate = parseBoundedFloat(next.speechRate, defaults.speechRate, 0.8, 1.8);

  next.hotkey = typeof next.hotkey === 'string' && next.hotkey.trim() ? next.hotkey.trim() : defaults.hotkey;
  next.autoToolMode = next.autoToolMode !== false;
  next.startup = !!next.startup;
  next.popupMode = next.popupMode === 'hotkey+timer' ? 'hotkey+timer' : 'hotkey';

  const roots = normalizeRoots(next.allowedRoots, warnings);
  next.allowedRoots = roots.length ? roots : defaults.allowedRoots;
  if (!roots.length) warnings.push('Allowed roots empty; using defaults.');

  next.commandTimeoutMs = parseBoundedInt(next.commandTimeoutMs, defaults.commandTimeoutMs, 1000, 300000);
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

  next.masterGuardEnabled = next.masterGuardEnabled !== false;
  const legacyMasterCode = typeof next.masterCode === 'string' ? next.masterCode.trim() : '';
  if (legacyMasterCode) {
    if (legacyMasterCode.toLowerCase() === 'mastercode') {
      next.masterCodeHash = defaults.masterCodeHash;
      warnings.push('Applied new default master code hash.');
    } else {
      next.masterCodeHash = crypto.createHash('sha256').update(legacyMasterCode, 'utf8').digest('hex');
      warnings.push('Converted legacy masterCode to hashed storage.');
    }
  } else if (!next.masterCodeHash) {
    next.masterCodeHash = defaults.masterCodeHash;
  }
  if (typeof next.masterCodeHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(next.masterCodeHash.trim())) {
    warnings.push('Invalid masterCodeHash; using default.');
    next.masterCodeHash = defaults.masterCodeHash;
  } else {
    next.masterCodeHash = next.masterCodeHash.trim().toLowerCase();
  }
  next.masterQuestion = typeof next.masterQuestion === 'string' && next.masterQuestion.trim()
    ? next.masterQuestion.trim().slice(0, 240)
    : defaults.masterQuestion;
  if (next.masterQuestion === LEGACY_MASTER_QUESTION) {
    next.masterQuestion = defaults.masterQuestion;
    warnings.push('Applied new default master question.');
  }
  if (typeof next.masterAnswer === 'string' && next.masterAnswer.trim()) {
    next.masterAnswerHash = crypto.createHash('sha256').update(next.masterAnswer.trim(), 'utf8').digest('hex');
    warnings.push('Converted legacy masterAnswer to hashed storage.');
  }
  if (String(next.masterAnswerHash || '').toLowerCase() === LEGACY_MASTER_ANSWER_HASH) {
    next.masterAnswerHash = defaults.masterAnswerHash;
    warnings.push('Applied new default master answer hash.');
  }
  if (typeof next.masterAnswerHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(next.masterAnswerHash.trim())) {
    warnings.push('Invalid masterAnswerHash; using default.');
    next.masterAnswerHash = defaults.masterAnswerHash;
  } else {
    next.masterAnswerHash = next.masterAnswerHash.trim().toLowerCase();
  }
  next.masterUnlockMinutes = parseBoundedInt(next.masterUnlockMinutes, defaults.masterUnlockMinutes, 1, 480);
  next.masterChallengeTimeoutSec = parseBoundedInt(
    next.masterChallengeTimeoutSec,
    defaults.masterChallengeTimeoutSec,
    30,
    600,
  );
  next.selfUpdateGuardEnabled = next.selfUpdateGuardEnabled !== false;
  next.selfUpdateUnlockMinutes = parseBoundedInt(
    next.selfUpdateUnlockMinutes,
    defaults.selfUpdateUnlockMinutes,
    1,
    240,
  );
  delete next.appAllowlist;
  delete next.commandAllowlist;
  delete next.masterCode;
  delete next.masterAnswer;

  return { config: next, warnings };
}

function initConfig() {
  if (configCache) return configCache;
  const filePath = getConfigPath();
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
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

function toPublicConfig(input) {
  const cfg = input ? { ...input } : { ...getConfig() };
  delete cfg.masterAnswerHash;
  delete cfg.masterCodeHash;
  delete cfg.masterCode;
  delete cfg.masterAnswer;
  return cfg;
}

module.exports = { initConfig, getConfig, updateConfig, getDefaultConfig, toPublicConfig };
