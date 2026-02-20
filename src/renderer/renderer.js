const chatEl = document.getElementById('chat');
const promptEl = document.getElementById('prompt');
const sendBtn = document.getElementById('send');
const permBtn = document.getElementById('permission');
const statusEl = document.getElementById('status');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const assistantTitleEl = document.getElementById('assistantTitle');
const assistantNameInput = document.getElementById('assistantNameInput');
const personaPromptInput = document.getElementById('personaPromptInput');
const feelingsEnabledInput = document.getElementById('feelingsEnabledInput');
const feelingsToneInput = document.getElementById('feelingsToneInput');
const feelingsExpressivenessInput = document.getElementById('feelingsExpressivenessInput');
const feelingsDecayInput = document.getElementById('feelingsDecayInput');
const llmProviderInput = document.getElementById('llmProviderInput');
const modelInput = document.getElementById('modelInput');
const embeddingInput = document.getElementById('embeddingInput');
const ollamaInput = document.getElementById('ollamaInput');
const apiBaseUrlInput = document.getElementById('apiBaseUrlInput');
const apiKeyInput = document.getElementById('apiKeyInput');
const allowRemoteInput = document.getElementById('allowRemoteInput');
const allowedRootsInput = document.getElementById('allowedRootsInput');
const commandTimeoutInput = document.getElementById('commandTimeoutInput');
const trustProjectBtn = document.getElementById('trustProject');
const hotkeyInput = document.getElementById('hotkeyInput');
const startupInput = document.getElementById('startupInput');
const popupInput = document.getElementById('popupInput');
const autoToolModeInput = document.getElementById('autoToolModeInput');
const micModeInput = document.getElementById('micModeInput');
const speechRateInput = document.getElementById('speechRateInput');
const selfUpdateGuardInput = document.getElementById('selfUpdateGuardInput');
const selfUpdateMinutesInput = document.getElementById('selfUpdateMinutesInput');
const saveSettingsBtn = document.getElementById('saveSettings');
const newFileBtn = document.getElementById('newFile');
const openFileBtn = document.getElementById('openFile');
const aiEditBtn = document.getElementById('aiEdit');
const runChecksBtn = document.getElementById('runChecks');
const saveFileBtn = document.getElementById('saveFile');
const captureBtn = document.getElementById('capture');
const filePathEl = document.getElementById('filePath');
const fileContentEl = document.getElementById('fileContent');
const micBtn = document.getElementById('mic');
const speakBtn = document.getElementById('speak');
const diffModal = document.getElementById('diffModal');
const diffOriginal = document.getElementById('diffOriginal');
const diffEdited = document.getElementById('diffEdited');
const confirmSaveBtn = document.getElementById('confirmSave');
const closeDiffBtn = document.getElementById('closeDiff');
const minimizeBtn = document.getElementById('minimizeBtn');
const closeBtn = document.getElementById('closeBtn');
const memoryQuery = document.getElementById('memoryQuery');
const searchMemoriesBtn = document.getElementById('searchMemories');
const memoryResults = document.getElementById('memoryResults');
const webQueryInput = document.getElementById('webQuery');
const webSearchBtn = document.getElementById('webSearchBtn');
const webResults = document.getElementById('webResults');
const gitCwdInput = document.getElementById('gitCwd');
const gitCommitMessageInput = document.getElementById('gitCommitMessage');
const gitStatusBtn = document.getElementById('gitStatusBtn');
const gitLogBtn = document.getElementById('gitLogBtn');
const gitDiffBtn = document.getElementById('gitDiffBtn');
const gitCommitBtn = document.getElementById('gitCommitBtn');
const runCommandBtn = document.getElementById('runCommand');
const shellCommandInput = document.getElementById('shellCommand');
const commandCwdInput = document.getElementById('commandCwd');

let messages = [];
let assistantBuffer = '';
let assistantMessageEl = null;
let thinkingIntervalId = null;
let thinkingMessageEl = null;
let thinkingFrameIndex = 0;
let activeFilePath = '';
let activeFileOriginal = '';
let recognition = null;
let isRecording = false;
let speakEnabled = false;
let lastOllamaOk = true;
let masterGuardEnabled = false;
let masterUnlocked = false;
let masterChallengePending = false;
let selfUpdateGuardEnabled = true;
let selfUpdateUnlocked = false;
let selfUpdateRemainingMs = 0;
let pendingAiVerification = false;
let preferredSpeechVoice = null;
let speechVoicesLoaded = false;
let micMode = 'wake';
let speechRate = 1.08;
let autoToolMode = true;
let feelingsEnabled = true;
let feelingsSnapshot = null;
let micAutoSendInFlight = false;
const WAKE_WORD_ALIASES = ['olivia', 'oilivia', 'oliva', 'alivia', 'olibia'];
const WAKE_WORD_REGEX = new RegExp(`\\b(?:${WAKE_WORD_ALIASES.join('|')})\\b`, 'i');
const WAKE_PREFIX_REGEX = new RegExp(
  `^\\s*(?:hi|hey|hello)\\s+(?:${WAKE_WORD_ALIASES.join('|')})\\b[\\s,.:;!?-]*|^\\s*(?:${WAKE_WORD_ALIASES.join('|')})\\b[\\s,.:;!?-]*`,
  'i',
);
const NOISE_WORDS = new Set(['um', 'uh', 'hmm', 'mm', 'ah', 'er', 'erm']);
const THINKING_FRAMES = ['Thinking', 'Thinking.', 'Thinking..', 'Thinking...'];

const preferredFemaleVoicePatterns = [
  /zira/i,
  /jenny/i,
  /aria/i,
  /samantha/i,
  /female/i,
  /woman/i,
  /olivia/i,
  /ava/i,
  /emma/i,
  /joanna/i,
  /karen/i,
  /hazel/i,
  /serena/i,
  /salli/i,
  /ivy/i,
  /moira/i,
];

const avoidMaleVoicePatterns = [
  /david/i,
  /mark/i,
  /james/i,
  /male/i,
  /guy/i,
  /man\b/i,
  /boy/i,
];

function applyMasterTheme() {
  const enabled = masterGuardEnabled && masterUnlocked;
  document.body.classList.toggle('master-active', enabled);
}

function normalizeProvider(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'openai' || raw === 'gemini') return raw;
  return 'ollama';
}

function normalizeMicMode(value) {
  return String(value || '').toLowerCase() === 'push' ? 'push' : 'wake';
}

function normalizeSpeechRate(value) {
  const parsed = Number.parseFloat(String(value || ''));
  if (!Number.isFinite(parsed)) return 1.08;
  if (parsed < 0.8 || parsed > 1.8) return 1.08;
  return parsed;
}

function normalizeFeelingsExpressiveness(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'subtle' || raw === 'expressive') return raw;
  return 'balanced';
}

function normalizeFeelingsDecayMinutes(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return 45;
  if (parsed < 5 || parsed > 240) return 45;
  return parsed;
}

function getSuggestedApiBaseUrl(provider) {
  if (provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta';
  return 'https://api.openai.com/v1';
}

function applyProviderDefaults(provider) {
  const selected = normalizeProvider(provider);
  if (selected === 'ollama') return;
  const suggested = getSuggestedApiBaseUrl(selected);
  const current = String(apiBaseUrlInput.value || '').trim();
  const known = new Set([
    'https://api.openai.com/v1',
    'https://generativelanguage.googleapis.com/v1beta',
  ]);
  if (!current || known.has(current)) {
    apiBaseUrlInput.value = suggested;
  }
  apiKeyInput.placeholder = selected === 'gemini' ? 'AIza...' : 'sk-...';
}

function applyMicButtonState() {
  if (micMode === 'push') {
    micBtn.textContent = isRecording ? 'Listening...' : 'Push Talk';
    micBtn.classList.toggle('active', isRecording);
    return;
  }
  micBtn.textContent = isRecording ? 'Mic On' : 'Mic Off';
  micBtn.classList.toggle('active', isRecording);
}

function formatRemainingMinutes(ms) {
  const mins = Math.ceil(Math.max(0, ms) / 60000);
  return mins > 0 ? mins : 0;
}

function renderStatus() {
  const health = lastOllamaOk ? 'Online' : 'Offline';
  const updateTag = !selfUpdateGuardEnabled
    ? 'CodeOpen'
    : (selfUpdateUnlocked ? `CodeOpen:${formatRemainingMinutes(selfUpdateRemainingMs)}m` : 'CodeLocked');
  const micTag = `${isRecording ? 'MicOn' : 'MicOff'}:${micMode}`;
  const moodTag = !feelingsEnabled
    ? 'Mood:Off'
    : `Mood:${String(feelingsSnapshot?.mood || 'neutral')}`;
  const autoTag = autoToolMode ? 'AutoTools:On' : 'AutoTools:Off';
  if (!masterGuardEnabled) {
    updateStatus(`${health} | ${moodTag} | ${autoTag} | ${updateTag} | ${micTag}`);
    return;
  }
  updateStatus(`${health} | ${masterUnlocked ? 'Unlocked' : 'Locked'} | ${moodTag} | ${autoTag} | ${updateTag} | ${micTag}`);
}

function getSpeechVoices() {
  if (!('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices();
  return Array.isArray(voices) ? voices : [];
}

function scoreSpeechVoice(voice) {
  const name = String(voice?.name || '');
  const lang = String(voice?.lang || '').toLowerCase();
  let score = 0;

  if (lang.startsWith('en-us')) score += 60;
  else if (lang.startsWith('en')) score += 40;
  if (voice?.localService) score += 5;
  if (voice?.default) score += 10;

  preferredFemaleVoicePatterns.forEach((pattern, index) => {
    if (pattern.test(name)) {
      score += 100 - index;
    }
  });
  if (avoidMaleVoicePatterns.some((pattern) => pattern.test(name))) score -= 120;
  return score;
}

function pickPreferredSpeechVoice() {
  const voices = getSpeechVoices();
  if (!voices.length) return null;

  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  voices.forEach((voice) => {
    const score = scoreSpeechVoice(voice);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  });
  return best;
}

function refreshPreferredSpeechVoice() {
  if (!('speechSynthesis' in window)) return null;
  preferredSpeechVoice = pickPreferredSpeechVoice();
  speechVoicesLoaded = true;
  return preferredSpeechVoice;
}

function ensurePreferredSpeechVoice() {
  if (!('speechSynthesis' in window)) return null;
  if (!speechVoicesLoaded || !preferredSpeechVoice) {
    return refreshPreferredSpeechVoice();
  }
  return preferredSpeechVoice;
}

function setupSpeechVoices() {
  if (!('speechSynthesis' in window)) return;
  refreshPreferredSpeechVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    refreshPreferredSpeechVoice();
  };
}

async function refreshMasterStatus() {
  try {
    const status = await window.overlay.getMasterStatus();
    masterGuardEnabled = !!status?.enabled;
    masterUnlocked = !!status?.unlocked;
    masterChallengePending = !!status?.pending;
  } catch {
    masterGuardEnabled = false;
    masterUnlocked = false;
    masterChallengePending = false;
  }
  applyMasterTheme();
  renderStatus();
}

async function refreshSelfUpdateStatus() {
  try {
    const status = await window.overlay.getSelfUpdateStatus();
    selfUpdateGuardEnabled = status?.enabled !== false;
    selfUpdateUnlocked = !!status?.unlocked;
    selfUpdateRemainingMs = Number(status?.remainingMs || 0);
  } catch {
    selfUpdateGuardEnabled = true;
    selfUpdateUnlocked = false;
    selfUpdateRemainingMs = 0;
  }
  renderStatus();
}

async function refreshFeelingsState() {
  try {
    const result = await window.overlay.getFeelings();
    feelingsSnapshot = result?.ok ? (result.state || null) : null;
  } catch {
    feelingsSnapshot = null;
  }
  renderStatus();
}

function promptMasterInstructions() {
  addMessage('assistant', 'System access is locked. Type your master code and answer the security question.');
}

async function refreshPermissionUi() {
  if (masterGuardEnabled && !masterUnlocked) {
    permBtn.disabled = true;
    permBtn.textContent = 'Master Locked';
    permBtn.classList.remove('active');
    return;
  }
  permBtn.disabled = false;
  const editAllowed = await window.overlay.getEditPermission();
  permBtn.textContent = editAllowed ? 'Revoke Edits' : 'Allow Edits';
  permBtn.classList.toggle('active', editAllowed);
}

function addMessage(role, content) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.textContent = content;
  chatEl.appendChild(el);
  chatEl.scrollTop = chatEl.scrollHeight;
  return el;
}

function stopThinkingIndicator() {
  if (thinkingIntervalId) {
    clearInterval(thinkingIntervalId);
    thinkingIntervalId = null;
  }
  thinkingFrameIndex = 0;
  if (thinkingMessageEl) {
    thinkingMessageEl.classList.remove('thinking');
  }
  thinkingMessageEl = null;
}

function startThinkingIndicator(targetEl) {
  stopThinkingIndicator();
  if (!targetEl) return;
  thinkingMessageEl = targetEl;
  thinkingMessageEl.classList.add('thinking');
  thinkingMessageEl.textContent = THINKING_FRAMES[0];
  thinkingIntervalId = setInterval(() => {
    if (!thinkingMessageEl || thinkingMessageEl !== assistantMessageEl) {
      stopThinkingIndicator();
      return;
    }
    thinkingFrameIndex = (thinkingFrameIndex + 1) % THINKING_FRAMES.length;
    thinkingMessageEl.textContent = THINKING_FRAMES[thinkingFrameIndex];
  }, 360);
}

function updateStatus(text) {
  statusEl.textContent = text;
}

function renderDiff(targetEl, originalLines, editedLines, isEditedView) {
  targetEl.innerHTML = '';
  const maxLines = Math.max(originalLines.length, editedLines.length);
  for (let i = 0; i < maxLines; i += 1) {
    const originalLine = originalLines[i] ?? '';
    const editedLine = editedLines[i] ?? '';
    const lineEl = document.createElement('div');
    lineEl.className = 'diff-line';

    const lineNumber = document.createElement('div');
    lineNumber.className = 'ln';
    lineNumber.textContent = String(i + 1);

    const code = document.createElement('div');
    code.textContent = isEditedView ? editedLine : originalLine;

    if (originalLine !== editedLine) {
      lineEl.classList.add(isEditedView ? 'added' : 'changed');
    }

    lineEl.appendChild(lineNumber);
    lineEl.appendChild(code);
    targetEl.appendChild(lineEl);
  }
}

function openDiffModal(originalText, editedText) {
  const originalLines = originalText.split('\n');
  const editedLines = editedText.split('\n');
  renderDiff(diffOriginal, originalLines, editedLines, false);
  renderDiff(diffEdited, originalLines, editedLines, true);
  diffModal.classList.add('open');
  diffModal.setAttribute('aria-hidden', 'false');
}

function closeDiffModal() {
  diffModal.classList.remove('open');
  diffModal.setAttribute('aria-hidden', 'true');
}

function renderMemoryResults(results) {
  memoryResults.innerHTML = '';
  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-item';
    empty.textContent = 'No matches.';
    memoryResults.appendChild(empty);
    return;
  }
  results.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'memory-item';
    el.textContent = `${item.role}: ${item.content}`;
    memoryResults.appendChild(el);
  });
}

function renderWebResults(results) {
  if (!webResults) return;
  webResults.innerHTML = '';
  if (!Array.isArray(results) || !results.length) {
    const empty = document.createElement('div');
    empty.className = 'memory-item';
    empty.textContent = 'No results.';
    webResults.appendChild(empty);
    return;
  }
  results.forEach((item, index) => {
    const container = document.createElement('div');
    container.className = 'memory-item';
    const title = typeof item?.title === 'string' ? item.title : `Result ${index + 1}`;
    const url = typeof item?.url === 'string' ? item.url : '';
    const snippet = typeof item?.snippet === 'string' ? item.snippet : '';
    container.textContent = `${index + 1}. ${title}${url ? `\n${url}` : ''}${snippet ? `\n${snippet}` : ''}`;
    webResults.appendChild(container);
  });
}

async function loadMemories() {
  const memories = await window.overlay.getRecentMemories();
  if (memories.length) {
    addMessage('assistant', 'Loaded recent memories.');
  }
}

async function loadConfig() {
  const cfg = await window.overlay.getConfig();
  assistantNameInput.value = cfg.assistantName || 'Olivia';
  personaPromptInput.value = cfg.personaPrompt || '';
  feelingsEnabledInput.checked = cfg.simulatedFeelings !== false;
  feelingsEnabled = feelingsEnabledInput.checked;
  feelingsToneInput.value = cfg.feelingsTone || 'balanced';
  feelingsExpressivenessInput.value = normalizeFeelingsExpressiveness(cfg.feelingsExpressiveness);
  feelingsDecayInput.value = String(normalizeFeelingsDecayMinutes(cfg.feelingsDecayMinutes));
  llmProviderInput.value = normalizeProvider(cfg.llmProvider);
  assistantTitleEl.textContent = cfg.assistantName || 'Olivia';
  modelInput.value = cfg.model || '';
  embeddingInput.value = cfg.embeddingModel || '';
  ollamaInput.value = cfg.ollamaUrl || '';
  apiBaseUrlInput.value = cfg.apiBaseUrl || 'https://api.openai.com/v1';
  apiKeyInput.value = cfg.apiKey || '';
  allowRemoteInput.checked = !!cfg.allowRemoteOllama;
  allowedRootsInput.value = Array.isArray(cfg.allowedRoots) ? cfg.allowedRoots.join('; ') : '';
  commandTimeoutInput.value = Number(cfg.commandTimeoutMs || 120000);
  hotkeyInput.value = cfg.hotkey || '';
  startupInput.checked = !!cfg.startup;
  popupInput.value = cfg.popupMode || 'hotkey';
  autoToolMode = cfg.autoToolMode !== false;
  autoToolModeInput.checked = autoToolMode;
  micMode = normalizeMicMode(cfg.micMode);
  micModeInput.value = micMode;
  speechRate = normalizeSpeechRate(cfg.speechRate);
  speechRateInput.value = speechRate.toFixed(2);
  selfUpdateGuardInput.checked = cfg.selfUpdateGuardEnabled !== false;
  selfUpdateMinutesInput.value = Number(cfg.selfUpdateUnlockMinutes || 10);
  if (recognition) recognition.continuous = micMode === 'wake';
  applyProviderDefaults(llmProviderInput.value);
  applyMicButtonState();
  await refreshFeelingsState();
}

async function saveConfig() {
  const patch = {
    assistantName: assistantNameInput.value.trim(),
    personaPrompt: personaPromptInput.value,
    simulatedFeelings: feelingsEnabledInput.checked,
    feelingsTone: feelingsToneInput.value,
    feelingsExpressiveness: normalizeFeelingsExpressiveness(feelingsExpressivenessInput.value),
    feelingsDecayMinutes: normalizeFeelingsDecayMinutes(feelingsDecayInput.value),
    llmProvider: llmProviderInput.value,
    model: modelInput.value.trim(),
    embeddingModel: embeddingInput.value.trim(),
    ollamaUrl: ollamaInput.value.trim(),
    apiBaseUrl: apiBaseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    allowRemoteOllama: allowRemoteInput.checked,
    allowedRoots: allowedRootsInput.value.trim(),
    commandTimeoutMs: Number.parseInt(commandTimeoutInput.value, 10) || 120000,
    hotkey: hotkeyInput.value.trim(),
    startup: startupInput.checked,
    popupMode: popupInput.value,
    autoToolMode: !!autoToolModeInput.checked,
    micMode: normalizeMicMode(micModeInput.value),
    speechRate: normalizeSpeechRate(speechRateInput.value),
    selfUpdateGuardEnabled: selfUpdateGuardInput.checked,
    selfUpdateUnlockMinutes: Number.parseInt(selfUpdateMinutesInput.value, 10) || 10,
  };
  const cfg = await window.overlay.setConfig(patch);
  if (!cfg || cfg.reason === 'master_locked') {
    promptMasterInstructions();
    return;
  }
  if (cfg.ok === false) {
    addMessage('assistant', `Settings update blocked: ${cfg.reason || 'failed'}`);
    return;
  }
  assistantNameInput.value = cfg.assistantName || 'Olivia';
  personaPromptInput.value = cfg.personaPrompt || '';
  feelingsEnabledInput.checked = cfg.simulatedFeelings !== false;
  feelingsEnabled = feelingsEnabledInput.checked;
  feelingsToneInput.value = cfg.feelingsTone || 'balanced';
  feelingsExpressivenessInput.value = normalizeFeelingsExpressiveness(cfg.feelingsExpressiveness);
  feelingsDecayInput.value = String(normalizeFeelingsDecayMinutes(cfg.feelingsDecayMinutes));
  llmProviderInput.value = normalizeProvider(cfg.llmProvider);
  assistantTitleEl.textContent = cfg.assistantName || 'Olivia';
  modelInput.value = cfg.model || '';
  embeddingInput.value = cfg.embeddingModel || '';
  ollamaInput.value = cfg.ollamaUrl || '';
  apiBaseUrlInput.value = cfg.apiBaseUrl || 'https://api.openai.com/v1';
  apiKeyInput.value = cfg.apiKey || '';
  allowRemoteInput.checked = !!cfg.allowRemoteOllama;
  allowedRootsInput.value = Array.isArray(cfg.allowedRoots) ? cfg.allowedRoots.join('; ') : '';
  commandTimeoutInput.value = Number(cfg.commandTimeoutMs || 120000);
  hotkeyInput.value = cfg.hotkey || '';
  startupInput.checked = !!cfg.startup;
  popupInput.value = cfg.popupMode || 'hotkey';
  autoToolMode = cfg.autoToolMode !== false;
  autoToolModeInput.checked = autoToolMode;
  micMode = normalizeMicMode(cfg.micMode);
  micModeInput.value = micMode;
  speechRate = normalizeSpeechRate(cfg.speechRate);
  speechRateInput.value = speechRate.toFixed(2);
  selfUpdateGuardInput.checked = cfg.selfUpdateGuardEnabled !== false;
  selfUpdateMinutesInput.value = Number(cfg.selfUpdateUnlockMinutes || 10);
  if (recognition) recognition.continuous = micMode === 'wake';
  applyProviderDefaults(llmProviderInput.value);
  applyMicButtonState();

  if (cfg._warnings && cfg._warnings.length) {
    addMessage('assistant', `Config warnings: ${cfg._warnings.join(' | ')}`);
  }
  await refreshFeelingsState();
  await refreshSelfUpdateStatus();
}

async function trustProject() {
  const result = await window.overlay.trustProject();
  if (result && result.reason === 'master_locked') {
    promptMasterInstructions();
    return;
  }
  if (!result.ok) return;
  const cfg = result.config || await window.overlay.getConfig();
  allowedRootsInput.value = Array.isArray(cfg.allowedRoots) ? cfg.allowedRoots.join('; ') : '';
  if (result.root) {
    addMessage('assistant', `Trusted project: ${result.root}`);
  }
  if (result.warnings && result.warnings.length) {
    addMessage('assistant', `Config warnings: ${result.warnings.join(' | ')}`);
  }
}

function speakText(text) {
  if (!speakEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text || '').slice(0, 4000));
  const voice = ensurePreferredSpeechVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || 'en-US';
  } else {
    utterance.lang = 'en-US';
  }
  utterance.rate = speechRate;
  utterance.pitch = 1.12;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function normalizeSpeechText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyNoise(transcript) {
  const normalized = normalizeSpeechText(transcript);
  if (!normalized) return true;
  const tokens = normalized.split(' ').filter(Boolean);
  if (!tokens.length) return true;
  if (tokens.length === 1 && NOISE_WORDS.has(tokens[0])) return true;
  return false;
}

function extractPushCommand(transcript) {
  const raw = String(transcript || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (isLikelyNoise(raw)) return '';
  return raw;
}

function extractWakeCommand(transcript) {
  const raw = String(transcript || '').trim();
  if (!raw) return { heard: false, command: '' };
  if (isLikelyNoise(raw)) return { heard: false, command: '' };
  const normalized = normalizeSpeechText(raw);
  if (!WAKE_WORD_REGEX.test(normalized)) return { heard: false, command: '' };
  const stripped = raw.replace(WAKE_PREFIX_REGEX, '').trim();
  if (stripped.length === raw.length) return { heard: false, command: '' };
  return { heard: true, command: stripped };
}

async function queueWakeCommand(command) {
  if (!command || micAutoSendInFlight) return;
  micAutoSendInFlight = true;
  try {
    promptEl.value = command;
    await sendPrompt();
  } finally {
    micAutoSendInFlight = false;
  }
}

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = micMode === 'wake';
  rec.onresult = (event) => {
    let latestInterim = '';
    const finalized = [];
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const phrase = String(event.results[i][0]?.transcript || '').trim();
      if (!phrase) continue;
      if (event.results[i].isFinal) {
        finalized.push(phrase);
      } else {
        latestInterim = phrase;
      }
    }
    if (latestInterim) {
      promptEl.value = latestInterim;
    }
    for (const phrase of finalized) {
      if (micMode === 'push') {
        const command = extractPushCommand(phrase);
        if (!command) continue;
        void queueWakeCommand(command);
        isRecording = false;
        try {
          rec.stop();
        } catch {
          // ignore stop failure
        }
        applyMicButtonState();
        renderStatus();
        continue;
      }

      const wake = extractWakeCommand(phrase);
      if (!wake.heard) continue;
      if (!wake.command) {
        updateStatus('Wake detected. Say a command after "Olivia".');
        continue;
      }
      void queueWakeCommand(wake.command);
    }
  };
  rec.onend = () => {
    if (isRecording && micMode === 'wake') {
      try {
        rec.start();
        return;
      } catch {
        // ignore immediate restart failure
      }
      setTimeout(() => {
        if (!isRecording) return;
        try {
          rec.start();
        } catch {
          // ignore delayed restart failure
        }
      }, 250);
      return;
    }
    isRecording = false;
    applyMicButtonState();
    renderStatus();
  };
  rec.onerror = (event) => {
    const code = String(event?.error || '');
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      isRecording = false;
      applyMicButtonState();
      addMessage('assistant', 'Mic permission denied. Allow microphone access in OS/browser settings.');
      renderStatus();
      return;
    }
    if (isRecording && micMode === 'wake') return;
    isRecording = false;
    applyMicButtonState();
    renderStatus();
  };
  return rec;
}

function ensureRecognitionReady() {
  if (!recognition) {
    recognition = initSpeechRecognition();
  }
  if (recognition) {
    recognition.continuous = micMode === 'wake';
  }
  return recognition;
}

function startMicRecording(statusText) {
  const rec = ensureRecognitionReady();
  if (!rec) {
    addMessage('assistant', 'Speech recognition not supported in this runtime.');
    return false;
  }
  if (isRecording) return true;
  isRecording = true;
  applyMicButtonState();
  if (statusText) updateStatus(statusText);
  try {
    rec.start();
    return true;
  } catch {
    isRecording = false;
    applyMicButtonState();
    addMessage('assistant', 'Mic start failed.');
    renderStatus();
    return false;
  }
}

function stopMicRecording() {
  if (!isRecording) {
    applyMicButtonState();
    renderStatus();
    return;
  }
  isRecording = false;
  applyMicButtonState();
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      // ignore stop failure
    }
  }
  renderStatus();
}

async function checkOllamaStatus() {
  const status = await window.overlay.checkOllama();
  lastOllamaOk = status && status.ok;
  renderStatus();
}

function buildChatContext(extra = {}) {
  const context = { ...extra };
  if (activeFilePath) {
    context.activeFilePath = activeFilePath;
    const preview = fileContentEl.value || '';
    if (preview) context.activeFilePreview = preview.slice(0, 4000);
  }
  return context;
}

function formatSelfUpdateReason(reason) {
  if (reason === 'master_locked') return 'Master lock is active. Unlock master first.';
  if (reason === 'user_denied') return 'Code update unlock was cancelled.';
  if (reason === 'self_update_locked') return 'Code update lock is active.';
  return 'Code update lock unchanged.';
}

function formatWorkflowReason(reason) {
  if (reason === 'master_locked') return 'Master lock is active. Unlock master first.';
  if (reason === 'self_update_locked') return 'AI code updates are locked. Type `allow code update` first.';
  if (reason === 'permission_denied') return 'Edit permission is required. Click "Allow Edits".';
  if (reason === 'path_not_allowed') return 'File path is outside Allowed Roots.';
  if (reason === 'file_too_large_for_ai') return 'File is too large for AI edit in one pass.';
  if (reason === 'missing_instruction') return 'No instruction provided.';
  return `AI workflow failed: ${reason || 'unknown_error'}`;
}

function formatVerificationReason(reason) {
  if (reason === 'master_locked') return 'Master lock is active. Unlock master first.';
  if (reason === 'permission_denied') return 'Edit permission is required to run checks.';
  if (reason === 'path_not_allowed') return 'Selected file path is outside Allowed Roots.';
  if (reason === 'project_root_not_found') return 'No package.json found above this file.';
  if (reason === 'no_supported_scripts') return 'No supported scripts found (lint/typecheck/test).';
  if (reason === 'verification_failed') return 'One or more verification checks failed.';
  return `Verification failed: ${reason || 'unknown_error'}`;
}

function formatCommandRunReason(reason) {
  if (reason === 'master_locked') return 'Master lock is active. Unlock master first.';
  if (reason === 'permission_denied') return 'Control permission is required.';
  if (reason === 'self_update_locked') return 'AI code updates are locked. Type `allow code update` first.';
  if (reason === 'user_denied') return 'Command run canceled.';
  if (reason === 'executable_not_found') return 'Command executable not found on this machine.';
  if (reason === 'path_not_allowed') return 'Working directory is outside Allowed Roots.';
  if (reason === 'invalid_cwd') return 'Working directory is invalid.';
  if (reason === 'timeout') return 'Command timed out.';
  if (reason === 'command_failed') return 'Command failed (non-zero exit).';
  return `Command failed: ${reason || 'unknown_error'}`;
}

function formatWebSearchReason(reason) {
  if (reason === 'missing_query') return 'Provide a search query.';
  if (reason === 'search_failed') return 'Web search failed.';
  if (reason && String(reason).startsWith('http_')) return `Search endpoint error: ${reason.replace('http_', 'HTTP ')}`;
  return `Web search failed: ${reason || 'unknown_error'}`;
}

function formatGitReason(reason) {
  if (reason === 'master_locked') return 'Master lock is active. Unlock master first.';
  if (reason === 'permission_denied') return 'Control permission is required.';
  if (reason === 'path_not_allowed') return 'Repository path is outside Allowed Roots.';
  if (reason === 'invalid_cwd') return 'Repository path is invalid.';
  if (reason === 'git_not_found') return 'Git executable was not found.';
  if (reason === 'not_git_repo') return 'Folder is not a git repository.';
  if (reason === 'missing_message') return 'Commit message is required.';
  if (reason === 'nothing_to_commit') return 'No staged changes to commit.';
  if (reason === 'user_denied') return 'Git action was cancelled.';
  return `Git action failed: ${reason || 'unknown_error'}`;
}

function summarizeCommandOutput(text, maxChars = 1600) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return '';
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n...[truncated]`;
}

function summarizeCheckRun(run) {
  const status = run.ok ? 'PASS' : 'FAIL';
  const secs = Number.isFinite(run.durationMs) ? (run.durationMs / 1000).toFixed(1) : '?';
  return `${status} ${run.script} (${secs}s)`;
}

function resolveGitCwd() {
  const cwd = gitCwdInput ? gitCwdInput.value.trim() : '';
  return cwd || undefined;
}

function normalizeCommand(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeIntentText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeWebQuery(value) {
  return String(value || '')
    .replace(/^[`"'([{<\s]+|[`"')\]}>.,!?;:\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isWeakWebQuery(value) {
  const normalized = normalizeWebQuery(value).toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 3) return true;
  if (/^(?:it|this|that|there|something|anything|stuff|topic|query)$/i.test(normalized)) return true;
  if (/^(?:try|try to access it|access it|now|again|please|pls|plz)$/i.test(normalized)) return true;
  return false;
}

function extractWebSearchIntent(text) {
  const raw = normalizeIntentText(text);
  if (!raw || raw.startsWith('/')) return { detected: false, query: '' };

  const direct = raw.match(/^(?:search(?:\s+the)?\s+web|web\s+search|look\s*up|lookup|google|find\s+online)\s+(.+)$/i);
  if (direct) {
    const query = normalizeWebQuery(direct[1]);
    return { detected: true, query: isWeakWebQuery(query) ? '' : query };
  }

  const hasSearchVerb = /\b(?:search|find|lookup|look\s*up|google)\b/i.test(raw);
  const hasWebCue = /\b(?:web|online|internet)\b/i.test(raw);
  if (!hasSearchVerb || !hasWebCue) return { detected: false, query: '' };
  if (/\bmemories?\b/i.test(raw)) return { detected: false, query: '' };

  const quoted = raw.match(/["']([^"']+)["']/);
  if (quoted && quoted[1]) {
    const query = normalizeWebQuery(quoted[1]);
    return { detected: true, query: isWeakWebQuery(query) ? '' : query };
  }

  const scoped = raw.match(/\b(?:for|about)\s+(.+)$/i);
  if (scoped && scoped[1]) {
    const query = normalizeWebQuery(scoped[1]);
    return { detected: true, query: isWeakWebQuery(query) ? '' : query };
  }

  const afterVerb = raw
    .replace(/^.*?\b(?:search|find|lookup|look\s*up|google)\b/i, '')
    .replace(/\b(?:on|in)\s+(?:the\s+)?(?:web|internet|online)\b/gi, ' ')
    .replace(/\b(?:please|pls|plz|can you|could you|would you|try(?: to)?|access(?: it)?|now|right now)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const query = normalizeWebQuery(afterVerb);
  return { detected: true, query: isWeakWebQuery(query) ? '' : query };
}

function askRiskApproval(message) {
  try {
    return window.confirm(message);
  } catch {
    return false;
  }
}

function normalizeRelativePathInput(value) {
  const text = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (!text) return '';
  if (text.includes('..')) return '';
  if (/^[a-zA-Z]:/.test(text) || text.startsWith('\\') || text.startsWith('/')) return '';
  return text;
}

function parseCreateFileIntent(value) {
  const raw = String(value || '').trim();
  if (!raw) return { relativePath: '', content: '' };
  const parts = raw.split(/\s+with\s+content\s+/i);
  if (parts.length > 1) {
    return {
      relativePath: parts[0].trim(),
      content: parts.slice(1).join(' with content ').trim(),
    };
  }
  return { relativePath: raw, content: '' };
}

async function createFileByIntent(relativePath, content = '') {
  const normalizedPath = normalizeRelativePathInput(relativePath);
  if (!normalizedPath) {
    addMessage('assistant', 'Invalid file path for create-file intent.');
    return true;
  }
  const cfg = await window.overlay.getConfig();
  const roots = Array.isArray(cfg.allowedRoots) ? cfg.allowedRoots : [];
  if (!roots.length) {
    addMessage('assistant', 'No Allowed Roots configured. Use Trust Project first.');
    return true;
  }
  const root = roots[0];
  const result = await window.overlay.createFile({
    root,
    relativePath: normalizedPath,
    content: String(content || ''),
  });
  if (!result || result.ok === false) {
    addMessage('assistant', `Create failed: ${result?.reason || 'unknown_error'}`);
    return true;
  }
  activeFilePath = result.path || `${root}\\${normalizedPath}`;
  activeFileOriginal = String(content || '');
  filePathEl.textContent = activeFilePath;
  fileContentEl.value = String(content || '');
  addMessage('assistant', `Created file: ${activeFilePath}`);
  return true;
}

async function runAutoCommandIntent(commandText, cwdText = '') {
  const command = String(commandText || '').trim();
  if (!command) return false;
  const approved = askRiskApproval(`Run command?\n\n${command}`);
  if (!approved) {
    addMessage('assistant', 'Command run cancelled.');
    return true;
  }
  await runCommand(command, cwdText);
  return true;
}

function extractCommitMessage(text) {
  const quoted = String(text || '').match(/["']([^"']+)["']/);
  if (quoted && quoted[1]) return quoted[1].trim();
  const direct = String(text || '').replace(/^.*?\bcommit(?:\s+changes?)?(?:\s+with\s+message)?[:\s]*/i, '').trim();
  return direct;
}

async function tryHandleAutoToolIntent(content) {
  if (!autoToolMode) return false;
  const text = normalizeIntentText(content);
  const lower = text.toLowerCase();
  if (!text || text.startsWith('/')) return false;

  const webIntent = extractWebSearchIntent(text);
  if (webIntent.detected) {
    if (!webIntent.query) {
      addMessage('assistant', 'Web search intent detected. Tell me what to search, e.g. `/search electron ipc hardening`.');
      return true;
    }
    await runWebSearch(webIntent.query);
    return true;
  }

  const memoryMatch = text.match(/^(?:search|find)\s+(?:memory|memories)\s+(?:for\s+)?(.+)$/i);
  if (memoryMatch) {
    memoryQuery.value = memoryMatch[1];
    await searchMemories();
    return true;
  }

  if (/\bgit\s+status\b/i.test(text) || /^status(?:\s+of)?\s+repo\b/i.test(text)) {
    await runGitStatus();
    return true;
  }

  if (/\bgit\s+log\b/i.test(text) || /^show\s+git\s+log\b/i.test(text)) {
    await runGitLog();
    return true;
  }

  if (/\bgit\s+diff\b/i.test(text) || /^show\s+git\s+diff\b/i.test(text)) {
    await runGitDiff();
    return true;
  }

  if (/\bcommit\b/i.test(text) && /\bgit\b/i.test(text)) {
    const message = extractCommitMessage(text);
    if (!message) {
      addMessage('assistant', 'Commit intent detected. Add a commit message, e.g. `git commit \"fix: update parser\"`.');
      return true;
    }
    const approved = askRiskApproval(`Create git commit?\n\nMessage: ${message}`);
    if (!approved) {
      addMessage('assistant', 'Git commit cancelled.');
      return true;
    }
    await runGitCommit(message);
    return true;
  }

  const runCommandMatch = text.match(/^(?:run|execute)\s+(?:command\s+)?(.+)$/i);
  if (runCommandMatch) {
    const candidate = runCommandMatch[1].trim();
    const looksLikeCommand = /^(?:npm|pnpm|yarn|node|python|pytest|git|cargo|go|mvn|gradle|make|npx|pip)\b/i.test(candidate)
      || /[|><]/.test(candidate);
    if (looksLikeCommand || lower.startsWith('run command')) {
      await runAutoCommandIntent(candidate);
      return true;
    }
  }

  const editMatch = text.match(/^(?:edit|modify|update|rewrite|refactor|change)\s+(?:the\s+)?(?:open|current|this)\s+file[:\s-]*(.+)$/i);
  if (editMatch) {
    if (!activeFilePath) {
      addMessage('assistant', 'Open a file first for edit intent.');
      return true;
    }
    const instruction = editMatch[1].trim();
    if (!instruction) {
      addMessage('assistant', 'Edit intent detected but no instruction found.');
      return true;
    }
    const approved = askRiskApproval(`Apply AI edit to open file?\n\nInstruction: ${instruction}`);
    if (!approved) {
      addMessage('assistant', 'File edit cancelled.');
      return true;
    }
    await aiEditFile(instruction);
    return true;
  }

  if (activeFilePath && /\b(?:save|write)\b.*\bfile\b/i.test(text)) {
    const approved = askRiskApproval(`Save current file?\n\n${activeFilePath}`);
    if (!approved) {
      addMessage('assistant', 'Save cancelled.');
      return true;
    }
    await saveFileConfirmed();
    return true;
  }

  const createMatch = text.match(/^create\s+file\s+(.+)$/i);
  if (createMatch) {
    const parsed = parseCreateFileIntent(createMatch[1]);
    const approved = askRiskApproval(`Create new file?\n\n${parsed.relativePath}`);
    if (!approved) {
      addMessage('assistant', 'Create file cancelled.');
      return true;
    }
    await createFileByIntent(parsed.relativePath, parsed.content);
    return true;
  }

  return false;
}

async function tryHandleSelfUpdateFlow(content) {
  const normalized = normalizeCommand(content);
  if (normalized === 'lockcodeupdate' || normalized === 'lock code update') {
    await window.overlay.lockSelfUpdate();
    await refreshSelfUpdateStatus();
    addMessage('assistant', 'AI code updates locked.');
    return true;
  }
  if (normalized === 'allowcodeupdate' || normalized === 'allow code update' || normalized === 'unlock code update') {
    const minutes = Number.parseInt(selfUpdateMinutesInput.value, 10) || 10;
    const result = await window.overlay.unlockSelfUpdate({ minutes });
    if (result?.ok) {
      addMessage('assistant', `AI code updates unlocked for ${minutes} minutes.`);
    } else {
      addMessage('assistant', formatSelfUpdateReason(result?.reason));
    }
    await refreshSelfUpdateStatus();
    return true;
  }
  return false;
}

function formatMasterReason(reason) {
  if (reason === 'challenge_expired') return 'Security question expired. Type your master code again.';
  if (reason === 'invalid_answer') return 'Wrong answer. Access remains locked.';
  if (reason === 'no_pending_challenge') return 'No security question is active. Type your master code first.';
  if (reason === 'invalid_code') return 'Invalid master code.';
  return 'Access remains locked.';
}

async function tryHandleMasterFlow(content) {
  if (!masterGuardEnabled) return false;
  const normalized = String(content || '').trim().toLowerCase();

  if (normalized === 'lockmaster') {
    await window.overlay.lockMasterAccess();
    addMessage('assistant', 'Master access locked.');
    await refreshMasterStatus();
    await refreshPermissionUi();
    return true;
  }

  if (masterChallengePending) {
    const result = await window.overlay.verifyMasterChallenge(content);
    masterChallengePending = false;
    if (result && result.ok) {
      addMessage('assistant', 'Master access unlocked. You can now use settings and file/device controls.');
    } else {
      addMessage('assistant', formatMasterReason(result?.reason));
    }
    await refreshMasterStatus();
    await refreshPermissionUi();
    return true;
  }

  const begin = await window.overlay.beginMasterChallenge(content);
  if (begin && begin.ok) {
    masterChallengePending = true;
    addMessage('assistant', begin.question || 'Security question: provide your answer.');
    await refreshMasterStatus();
    await refreshPermissionUi();
    return true;
  }

  return false;
}

async function tryHandlePowerCommands(content) {
  const text = String(content || '').trim();
  if (!text.startsWith('/')) return false;

  const searchMatch = text.match(/^\/search\s+(.+)$/i);
  if (searchMatch) {
    await runWebSearch(searchMatch[1]);
    return true;
  }

  const gitStatusMatch = text.match(/^\/git\s+status(?:\s+(.+))?$/i);
  if (gitStatusMatch) {
    await runGitStatus(gitStatusMatch[1]);
    return true;
  }

  const gitLogMatch = text.match(/^\/git\s+log(?:\s+(.+))?$/i);
  if (gitLogMatch) {
    await runGitLog(gitLogMatch[1]);
    return true;
  }

  const gitDiffMatch = text.match(/^\/git\s+diff(?:\s+(.+))?$/i);
  if (gitDiffMatch) {
    await runGitDiff(gitDiffMatch[1]);
    return true;
  }

  const gitCommitMatch = text.match(/^\/git\s+commit\s+(.+)$/i);
  if (gitCommitMatch) {
    await runGitCommit(gitCommitMatch[1]);
    return true;
  }

  addMessage('assistant', 'Unknown slash command. Try `/search ...`, `/git status`, `/git log`, `/git diff`, or `/git commit ...`.');
  return true;
}

async function sendPrompt() {
  const content = promptEl.value.trim();
  if (!content) return;
  promptEl.value = '';

  addMessage('user', content);

  const handledMaster = await tryHandleMasterFlow(content);
  if (handledMaster) return;
  const handledSelfUpdate = await tryHandleSelfUpdateFlow(content);
  if (handledSelfUpdate) return;
  const handledPowerCommand = await tryHandlePowerCommands(content);
  if (handledPowerCommand) return;
  const handledAutoTool = await tryHandleAutoToolIntent(content);
  if (handledAutoTool) return;

  messages.push({ role: 'user', content });

  assistantBuffer = '';
  assistantMessageEl = addMessage('assistant', '');
  startThinkingIndicator(assistantMessageEl);

  updateStatus('Thinking...');
  try {
    const response = await window.overlay.chat(messages, buildChatContext({ latestUserMessage: content }));
    if (response && response.error) {
      if (assistantMessageEl) {
        assistantMessageEl.textContent = response.error;
      } else {
        addMessage('assistant', response.error);
      }
      return;
    }
    if (response && response.content) {
      if (assistantMessageEl && !assistantBuffer) {
        assistantMessageEl.textContent = response.content;
      }
      messages.push({ role: 'assistant', content: response.content });
      await window.overlay.addMemory({ role: 'user', content });
      await window.overlay.addMemory({ role: 'assistant', content: response.content });
      speakText(response.content);
    }
  } catch (error) {
    if (assistantMessageEl && !assistantBuffer) {
      assistantMessageEl.textContent = 'Chat failed. Check provider connection.';
    } else {
      addMessage('assistant', 'Chat failed. Check provider connection.');
    }
  } finally {
    stopThinkingIndicator();
    await refreshFeelingsState();
    renderStatus();
  }
}

async function openFile() {
  const result = await window.overlay.openFile();
  if (!result.ok) {
    if (result.reason === 'master_locked') {
      promptMasterInstructions();
      return;
    }
    if (result.reason === 'path_not_allowed') {
      addMessage('assistant', 'File path not allowed. Add its folder to Allowed Roots.');
    }
    return;
  }
  activeFilePath = result.path;
  activeFileOriginal = result.content || '';
  filePathEl.textContent = activeFilePath;
  fileContentEl.value = activeFileOriginal;
}

async function createNewFile() {
  const cfg = await window.overlay.getConfig();
  const roots = Array.isArray(cfg.allowedRoots) ? cfg.allowedRoots : [];
  if (!roots.length) {
    addMessage('assistant', 'No Allowed Roots. Use Trust Project first.');
    return;
  }
  let root = roots[0];
  if (roots.length > 1) {
    const options = roots.map((item, index) => `${index + 1}) ${item}`).join('\n');
    const choice = prompt(`Choose a root:\n${options}`);
    const idx = Number.parseInt(choice, 10);
    if (!idx || idx < 1 || idx > roots.length) return;
    root = roots[idx - 1];
  }
  const rel = prompt('Enter relative file path (e.g. src\\main.js)');
  if (!rel) return;
  const trimmed = rel.trim();
  if (!trimmed || trimmed.includes('..') || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('\\') || trimmed.startsWith('/')) {
    addMessage('assistant', 'Invalid relative path.');
    return;
  }
  const result = await window.overlay.createFile({
    root,
    relativePath: trimmed,
    content: '',
  });
  if (!result.ok) {
    if (result.reason === 'master_locked') {
      promptMasterInstructions();
      return;
    }
    addMessage('assistant', `Create failed: ${result.reason}`);
    return;
  }
  activeFilePath = result.path || `${root}\\${trimmed}`;
  activeFileOriginal = '';
  filePathEl.textContent = activeFilePath;
  fileContentEl.value = '';
  addMessage('assistant', `Created: ${activeFilePath}`);
}

async function saveFileConfirmed() {
  if (!activeFilePath) return;
  const result = await window.overlay.saveFile({
    path: activeFilePath,
    content: fileContentEl.value,
  });
  if (!result.ok) {
    if (result.reason === 'master_locked') {
      promptMasterInstructions();
      return;
    }
    if (result.reason === 'path_not_allowed') {
      addMessage('assistant', 'Save blocked: path not allowed.');
      return;
    }
    addMessage('assistant', `Save failed: ${result.reason}`);
    return;
  }
  activeFileOriginal = fileContentEl.value;
  if (pendingAiVerification) {
    pendingAiVerification = false;
    await runChecks();
  }
}

async function saveFile() {
  if (!activeFilePath) return;
  if (fileContentEl.value === activeFileOriginal) {
    addMessage('assistant', 'No changes to save.');
    return;
  }
  openDiffModal(activeFileOriginal, fileContentEl.value);
}

async function aiEditFile(instructionOverride = '') {
  if (!activeFilePath) {
    addMessage('assistant', 'Open a file first.');
    return;
  }
  await refreshSelfUpdateStatus();
  if (selfUpdateGuardEnabled && !selfUpdateUnlocked) {
    addMessage('assistant', 'AI code updates are locked. Type `allow code update` first.');
    return;
  }

  let instruction = String(instructionOverride || '').trim();
  if (!instruction) {
    instruction = String(prompt('Describe the edit you want the assistant to apply to the open file.') || '').trim();
  }
  if (!instruction) return;

  assistantBuffer = '';
  assistantMessageEl = addMessage('assistant', 'Editing file...');
  updateStatus('Editing...');

  try {
    const beforeContent = fileContentEl.value;
    const result = await window.overlay.workflowEdit({
      path: activeFilePath,
      content: beforeContent,
      instruction,
    });
    if (!result || result.ok === false) {
      addMessage('assistant', formatWorkflowReason(result?.reason));
      return;
    }

    fileContentEl.value = result.updatedContent || beforeContent;
    pendingAiVerification = true;

    if (Array.isArray(result.plan) && result.plan.length) {
      addMessage('assistant', `Plan:\n- ${result.plan.join('\n- ')}`);
    }
    if (Array.isArray(result.notes) && result.notes.length) {
      addMessage('assistant', `Notes:\n- ${result.notes.join('\n- ')}`);
    }
    if (result.review) {
      const findings = Array.isArray(result.review.findings) && result.review.findings.length
        ? `Findings:\n- ${result.review.findings.join('\n- ')}`
        : 'Findings: none';
      const checks = Array.isArray(result.review.verification) && result.review.verification.length
        ? `Checks:\n- ${result.review.verification.join('\n- ')}`
        : 'Checks: lint/typecheck/test (if available)';
      addMessage(
        'assistant',
        `Self-review (${result.review.riskLevel || 'low'}, ${result.review.verdict || 'pass'}):\n${findings}\n${checks}`,
      );
    }

    openDiffModal(beforeContent, fileContentEl.value);
    addMessage('assistant', 'Draft edit ready. Review diff, then Save to apply.');
    speakText('Draft edit ready. Review diff and save.');
  } catch {
    addMessage('assistant', 'AI edit failed.');
  } finally {
    renderStatus();
  }
}

async function runChecks() {
  if (!activeFilePath) {
    addMessage('assistant', 'Open a file first.');
    return;
  }
  addMessage('assistant', 'Running verification checks...');
  const result = await window.overlay.runWorkflowChecks({ path: activeFilePath });
  if (!result || result.ok === false) {
    addMessage('assistant', formatVerificationReason(result?.reason));
    return;
  }

  const runs = Array.isArray(result.runs) ? result.runs : [];
  if (!runs.length) {
    addMessage('assistant', 'No verification scripts ran.');
    return;
  }

  addMessage('assistant', `Verification:\n- ${runs.map(summarizeCheckRun).join('\n- ')}`);
  const failed = runs.find((run) => !run.ok);
  if (failed && failed.output) {
    addMessage('assistant', `First failure output (${failed.script}):\n${failed.output}`);
  }
}

async function captureScreen() {
  const result = await window.overlay.captureScreen();
  if (!result.ok) {
    if (result.reason === 'master_locked') {
      promptMasterInstructions();
      return;
    }
    addMessage('assistant', `Capture failed: ${result.reason}`);
    return;
  }
  addMessage('assistant', `Capture saved: ${result.path}`);
}

async function searchMemories() {
  const query = memoryQuery.value.trim();
  if (!query) return;
  const results = await window.overlay.searchMemories(query);
  renderMemoryResults(results || []);
}

async function runWebSearch(queryOverride) {
  const query = String(queryOverride || (webQueryInput ? webQueryInput.value : '')).trim();
  if (!query) return;
  if (webQueryInput && !queryOverride) webQueryInput.value = query;

  const result = await window.overlay.webSearch({ query, limit: 6 });
  if (!result || result.ok === false) {
    const reason = formatWebSearchReason(result?.reason);
    addMessage('assistant', reason);
    renderWebResults([]);
    return;
  }

  const entries = Array.isArray(result.results) ? result.results : [];
  renderWebResults(entries);
  if (!entries.length) {
    addMessage('assistant', `No web results for: ${query}`);
    return;
  }
  const summary = entries
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.title}\n${item.url}`)
    .join('\n\n');
  addMessage('assistant', `Web results for "${query}":\n\n${summary}`);
}

async function runGitStatus(cwdOverride) {
  const result = await window.overlay.gitStatus({ cwd: cwdOverride || resolveGitCwd() });
  if (!result || result.ok === false) {
    const detail = formatGitReason(result?.reason);
    addMessage('assistant', detail);
    return;
  }
  addMessage('assistant', `Git status (${result.cwd}):\n${result.output || '(clean)'}`);
}

async function runGitLog(cwdOverride) {
  const result = await window.overlay.gitLog({ cwd: cwdOverride || resolveGitCwd(), limit: 20 });
  if (!result || result.ok === false) {
    addMessage('assistant', formatGitReason(result?.reason));
    return;
  }
  addMessage('assistant', `Git log (${result.cwd}):\n${result.output || '(no commits)'}`);
}

async function runGitDiff(cwdOverride) {
  const result = await window.overlay.gitDiff({ cwd: cwdOverride || resolveGitCwd() });
  if (!result || result.ok === false) {
    addMessage('assistant', formatGitReason(result?.reason));
    return;
  }
  const diff = summarizeCommandOutput(result.output, 5000);
  const suffix = result.truncated ? '\n...[diff truncated]' : '';
  addMessage('assistant', `Git diff (${result.cwd}):\n${diff || '(no diff)'}${suffix}`);
}

async function runGitCommit(messageOverride, cwdOverride) {
  const message = String(messageOverride || (gitCommitMessageInput ? gitCommitMessageInput.value : '')).trim();
  if (!message) {
    addMessage('assistant', formatGitReason('missing_message'));
    return;
  }
  if (gitCommitMessageInput && !messageOverride) gitCommitMessageInput.value = message;
  const result = await window.overlay.gitCommit({
    cwd: cwdOverride || resolveGitCwd(),
    message,
  });
  if (!result || result.ok === false) {
    const base = formatGitReason(result?.reason);
    const stderr = summarizeCommandOutput(result?.stderr);
    const stdout = summarizeCommandOutput(result?.stdout);
    let details = base;
    if (stderr) details += `\nstderr:\n${stderr}`;
    else if (stdout) details += `\nstdout:\n${stdout}`;
    addMessage('assistant', details);
    return;
  }
  addMessage('assistant', `Git commit created (${result.cwd}).\n${result.output || ''}`);
}

async function runCommand(commandOverride = '', cwdOverride = '') {
  const command = String(commandOverride || shellCommandInput.value || '').trim();
  if (!command) return;
  if (!commandOverride && shellCommandInput) shellCommandInput.value = command;

  const timeoutMs = Number.parseInt(commandTimeoutInput.value, 10);
  const payload = {
    command,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
  };
  const cwd = String(cwdOverride || (commandCwdInput ? commandCwdInput.value : '')).trim();
  if (cwd) payload.cwd = cwd;
  if (cwdOverride && commandCwdInput) commandCwdInput.value = cwd;

  addMessage('assistant', `Running command: ${command}`);
  const result = await window.overlay.runCommand(payload);
  if (!result || result.ok === false) {
    const reasonMessage = formatCommandRunReason(result?.reason);
    const stdout = summarizeCommandOutput(result?.stdout);
    const stderr = summarizeCommandOutput(result?.stderr);
    let details = reasonMessage;
    if (stderr) details += `\nstderr:\n${stderr}`;
    else if (stdout) details += `\nstdout:\n${stdout}`;
    addMessage('assistant', details);
    return;
  }

  const exitCode = Number.isFinite(result.exitCode) ? result.exitCode : 0;
  const stdout = summarizeCommandOutput(result.stdout);
  const stderr = summarizeCommandOutput(result.stderr);
  let output = `Command completed (exit ${exitCode}).`;
  if (stdout) output += `\nstdout:\n${stdout}`;
  if (stderr) output += `\nstderr:\n${stderr}`;
  if (result.outputTruncated) output += '\nOutput truncated.';
  addMessage('assistant', output);
}

window.overlay.onChunk((chunk) => {
  const textChunk = typeof chunk === 'string' ? chunk : String(chunk || '');
  if (!textChunk) return;
  if (thinkingIntervalId) stopThinkingIndicator();
  assistantBuffer += textChunk;
  if (assistantMessageEl) assistantMessageEl.textContent = assistantBuffer;
  chatEl.scrollTop = chatEl.scrollHeight;
});

sendBtn.addEventListener('click', sendPrompt);

promptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

permBtn.addEventListener('click', async () => {
  if (masterGuardEnabled && !masterUnlocked) {
    promptMasterInstructions();
    return;
  }
  const currentlyAllowed = await window.overlay.getEditPermission();
  if (currentlyAllowed) {
    await window.overlay.revokeEditPermission();
    addMessage('assistant', 'Edit permission revoked.');
    await refreshPermissionUi();
    return;
  }
  const allowed = await window.overlay.requestEditPermission();
  if (allowed) addMessage('assistant', 'Edit permission granted.');
  await refreshPermissionUi();
});

settingsBtn.addEventListener('click', () => {
  const isOpen = settingsPanel.classList.toggle('open');
  settingsPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
});

if (llmProviderInput) {
  llmProviderInput.addEventListener('change', () => {
    applyProviderDefaults(llmProviderInput.value);
  });
}

if (micModeInput) {
  micModeInput.addEventListener('change', () => {
    micMode = normalizeMicMode(micModeInput.value);
    if (recognition) recognition.continuous = micMode === 'wake';
    if (isRecording && micMode === 'push') {
      stopMicRecording();
    } else {
      applyMicButtonState();
      renderStatus();
    }
  });
}

if (speechRateInput) {
  speechRateInput.addEventListener('change', () => {
    speechRate = normalizeSpeechRate(speechRateInput.value);
    speechRateInput.value = speechRate.toFixed(2);
  });
}

if (autoToolModeInput) {
  autoToolModeInput.addEventListener('change', () => {
    autoToolMode = !!autoToolModeInput.checked;
    renderStatus();
  });
}

if (feelingsEnabledInput) {
  feelingsEnabledInput.addEventListener('change', () => {
    feelingsEnabled = feelingsEnabledInput.checked;
    renderStatus();
  });
}

if (feelingsExpressivenessInput) {
  feelingsExpressivenessInput.addEventListener('change', () => {
    feelingsExpressivenessInput.value = normalizeFeelingsExpressiveness(feelingsExpressivenessInput.value);
  });
}

if (feelingsDecayInput) {
  feelingsDecayInput.addEventListener('change', () => {
    feelingsDecayInput.value = String(normalizeFeelingsDecayMinutes(feelingsDecayInput.value));
  });
}

saveSettingsBtn.addEventListener('click', async () => {
  await saveConfig();
});

trustProjectBtn.addEventListener('click', trustProject);
newFileBtn.addEventListener('click', createNewFile);
openFileBtn.addEventListener('click', openFile);
aiEditBtn.addEventListener('click', aiEditFile);
if (runChecksBtn) runChecksBtn.addEventListener('click', runChecks);
saveFileBtn.addEventListener('click', saveFile);
captureBtn.addEventListener('click', captureScreen);

confirmSaveBtn.addEventListener('click', async () => {
  await saveFileConfirmed();
  closeDiffModal();
});

closeDiffBtn.addEventListener('click', () => {
  closeDiffModal();
});

diffModal.addEventListener('click', (e) => {
  if (e.target === diffModal) closeDiffModal();
});

micBtn.addEventListener('click', () => {
  if (micMode === 'push') {
    if (isRecording) {
      stopMicRecording();
      return;
    }
    startMicRecording('Push mode active. Speak one command.');
    return;
  }

  if (isRecording) {
    stopMicRecording();
    return;
  }
  startMicRecording('Listening for wake word: "Olivia".');
});

speakBtn.addEventListener('click', () => {
  speakEnabled = !speakEnabled;
  speakBtn.textContent = speakEnabled ? 'Speak On' : 'Speak Off';
  speakBtn.classList.toggle('active', speakEnabled);
  if (!speakEnabled && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
});

searchMemoriesBtn.addEventListener('click', searchMemories);
memoryQuery.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchMemories();
  }
});

if (webSearchBtn) webSearchBtn.addEventListener('click', () => runWebSearch());
if (webQueryInput) {
  webQueryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runWebSearch();
    }
  });
}

if (gitStatusBtn) gitStatusBtn.addEventListener('click', () => runGitStatus());
if (gitLogBtn) gitLogBtn.addEventListener('click', () => runGitLog());
if (gitDiffBtn) gitDiffBtn.addEventListener('click', () => runGitDiff());
if (gitCommitBtn) gitCommitBtn.addEventListener('click', () => runGitCommit());
if (gitCommitMessageInput) {
  gitCommitMessageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runGitCommit();
    }
  });
}

if (runCommandBtn) runCommandBtn.addEventListener('click', runCommand);
if (shellCommandInput) {
  shellCommandInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runCommand();
    }
  });
}

if (minimizeBtn) {
  minimizeBtn.addEventListener('click', () => {
    window.overlay.minimizeWindow();
  });
}

if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    window.overlay.closeWindow();
  });
}

async function bootstrap() {
  setupSpeechVoices();
  await loadMemories();
  await loadConfig();
  await checkOllamaStatus();
  await refreshFeelingsState();
  await refreshMasterStatus();
  await refreshSelfUpdateStatus();
  await refreshPermissionUi();
}

bootstrap();
setInterval(checkOllamaStatus, 15000);
setInterval(refreshFeelingsState, 12000);
setInterval(refreshMasterStatus, 10000);
setInterval(refreshSelfUpdateStatus, 10000);
setInterval(refreshPermissionUi, 10000);
