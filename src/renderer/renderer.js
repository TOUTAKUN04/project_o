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
const modelInput = document.getElementById('modelInput');
const embeddingInput = document.getElementById('embeddingInput');
const ollamaInput = document.getElementById('ollamaInput');
const allowRemoteInput = document.getElementById('allowRemoteInput');
const allowedRootsInput = document.getElementById('allowedRootsInput');
const appAllowlistInput = document.getElementById('appAllowlistInput');
const trustProjectBtn = document.getElementById('trustProject');
const hotkeyInput = document.getElementById('hotkeyInput');
const startupInput = document.getElementById('startupInput');
const popupInput = document.getElementById('popupInput');
const saveSettingsBtn = document.getElementById('saveSettings');
const newFileBtn = document.getElementById('newFile');
const openFileBtn = document.getElementById('openFile');
const aiEditBtn = document.getElementById('aiEdit');
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
const appCommandInput = document.getElementById('appCommand');
const launchAppBtn = document.getElementById('launchApp');
const focusAppBtn = document.getElementById('focusApp');

let messages = [];
let assistantBuffer = '';
let assistantMessageEl = null;
let activeFilePath = '';
let activeFileOriginal = '';
let recognition = null;
let isRecording = false;
let speakEnabled = false;
let lastOllamaOk = true;

function addMessage(role, content) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.textContent = content;
  chatEl.appendChild(el);
  chatEl.scrollTop = chatEl.scrollHeight;
  return el;
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

async function loadMemories() {
  const memories = await window.overlay.getRecentMemories();
  if (memories.length) {
    addMessage('assistant', 'Loaded recent memories.');
  }
}

async function loadConfig() {
  const cfg = await window.overlay.getConfig();
  assistantNameInput.value = cfg.assistantName || 'Project O';
  personaPromptInput.value = cfg.personaPrompt || '';
  assistantTitleEl.textContent = cfg.assistantName || 'Project O';
  modelInput.value = cfg.model || '';
  embeddingInput.value = cfg.embeddingModel || '';
  ollamaInput.value = cfg.ollamaUrl || '';
  allowRemoteInput.checked = !!cfg.allowRemoteOllama;
  allowedRootsInput.value = Array.isArray(cfg.allowedRoots) ? cfg.allowedRoots.join('; ') : '';
  appAllowlistInput.value = Array.isArray(cfg.appAllowlist) ? cfg.appAllowlist.join('; ') : '';
  hotkeyInput.value = cfg.hotkey || '';
  startupInput.checked = !!cfg.startup;
  popupInput.value = cfg.popupMode || 'hotkey';
}

async function saveConfig() {
  const patch = {
    assistantName: assistantNameInput.value.trim(),
    personaPrompt: personaPromptInput.value,
    model: modelInput.value.trim(),
    embeddingModel: embeddingInput.value.trim(),
    ollamaUrl: ollamaInput.value.trim(),
    allowRemoteOllama: allowRemoteInput.checked,
    allowedRoots: allowedRootsInput.value.trim(),
    appAllowlist: appAllowlistInput.value.trim(),
    hotkey: hotkeyInput.value.trim(),
    startup: startupInput.checked,
    popupMode: popupInput.value,
  };
  const cfg = await window.overlay.setConfig(patch);
  assistantNameInput.value = cfg.assistantName || 'Project O';
  personaPromptInput.value = cfg.personaPrompt || '';
  assistantTitleEl.textContent = cfg.assistantName || 'Project O';
  modelInput.value = cfg.model || '';
  embeddingInput.value = cfg.embeddingModel || '';
  ollamaInput.value = cfg.ollamaUrl || '';
  allowRemoteInput.checked = !!cfg.allowRemoteOllama;
  allowedRootsInput.value = Array.isArray(cfg.allowedRoots) ? cfg.allowedRoots.join('; ') : '';
  appAllowlistInput.value = Array.isArray(cfg.appAllowlist) ? cfg.appAllowlist.join('; ') : '';
  hotkeyInput.value = cfg.hotkey || '';
  startupInput.checked = !!cfg.startup;
  popupInput.value = cfg.popupMode || 'hotkey';

  if (cfg._warnings && cfg._warnings.length) {
    addMessage('assistant', `Config warnings: ${cfg._warnings.join(' | ')}`);
  }
}

async function trustProject() {
  const result = await window.overlay.trustProject();
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
  const utterance = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utterance);
}

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      transcript += event.results[i][0].transcript;
    }
    promptEl.value = transcript.trim();
  };
  rec.onend = () => {
    isRecording = false;
    micBtn.textContent = 'Mic Off';
    micBtn.classList.remove('active');
    updateStatus(lastOllamaOk ? 'Local' : 'Offline');
  };
  rec.onerror = () => {
    isRecording = false;
    micBtn.textContent = 'Mic Off';
    micBtn.classList.remove('active');
    updateStatus(lastOllamaOk ? 'Local' : 'Offline');
  };
  return rec;
}

async function checkOllamaStatus() {
  const status = await window.overlay.checkOllama();
  lastOllamaOk = status && status.ok;
  updateStatus(lastOllamaOk ? 'Local' : 'Offline');
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

async function sendPrompt() {
  const content = promptEl.value.trim();
  if (!content) return;
  promptEl.value = '';

  messages.push({ role: 'user', content });
  addMessage('user', content);

  assistantBuffer = '';
  assistantMessageEl = addMessage('assistant', '');

  updateStatus('Thinking...');
  try {
    const response = await window.overlay.chat(messages, buildChatContext());
    if (response && response.error) {
      if (assistantMessageEl) {
        assistantMessageEl.textContent = response.error;
      } else {
        addMessage('assistant', response.error);
      }
      updateStatus('Offline');
      return;
    }
    if (response && response.content) {
      messages.push({ role: 'assistant', content: response.content });
      await window.overlay.addMemory({ role: 'user', content });
      await window.overlay.addMemory({ role: 'assistant', content: response.content });
      speakText(response.content);
    }
  } catch (error) {
    if (assistantMessageEl && !assistantBuffer) {
      assistantMessageEl.textContent = 'Chat failed. Check Ollama connection.';
    } else {
      addMessage('assistant', 'Chat failed. Check Ollama connection.');
    }
  }
  updateStatus(lastOllamaOk ? 'Local' : 'Offline');
}

async function openFile() {
  const result = await window.overlay.openFile();
  if (!result.ok) {
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
    if (result.reason === 'path_not_allowed') {
      addMessage('assistant', 'Save blocked: path not allowed.');
      return;
    }
    addMessage('assistant', `Save failed: ${result.reason}`);
    return;
  }
  activeFileOriginal = fileContentEl.value;
}

async function saveFile() {
  if (!activeFilePath) return;
  if (fileContentEl.value === activeFileOriginal) {
    addMessage('assistant', 'No changes to save.');
    return;
  }
  openDiffModal(activeFileOriginal, fileContentEl.value);
}

async function aiEditFile() {
  if (!activeFilePath) {
    addMessage('assistant', 'Open a file first.');
    return;
  }

  const instruction = prompt('Describe the edit you want the assistant to apply to the open file.');
  if (!instruction) return;

  const system = {
    role: 'system',
    content: 'You are a coding assistant. Return ONLY the full updated file content. Do not add explanations or markdown.'
  };

  const user = {
    role: 'user',
    content: `File path: ${activeFilePath}\n\nCurrent content:\n${fileContentEl.value}\n\nInstruction:\n${instruction}`
  };

  assistantBuffer = '';
  assistantMessageEl = addMessage('assistant', 'Editing file...');
  updateStatus('Editing...');

  try {
    const response = await window.overlay.chat([system, user], buildChatContext({ task: 'ai_edit' }));
    if (response && response.content) {
      fileContentEl.value = response.content;
      addMessage('assistant', 'Draft edit ready. Review and click Save.');
      speakText('Draft edit ready. Please review and click save.');
    }
  } catch {
    addMessage('assistant', 'AI edit failed.');
  }
  updateStatus(lastOllamaOk ? 'Local' : 'Offline');
}

async function captureScreen() {
  const result = await window.overlay.captureScreen();
  if (!result.ok) {
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

async function launchApp() {
  const command = appCommandInput.value.trim();
  if (!command) return;
  const result = await window.overlay.launchApp(command);
  if (!result.ok) {
    if (result.reason === 'not_allowed') {
      addMessage('assistant', 'Launch blocked: app not in allowlist.');
      return;
    }
    if (result.reason === 'user_denied') {
      addMessage('assistant', 'Launch cancelled.');
      return;
    }
    addMessage('assistant', `Launch failed: ${result.reason}`);
  } else {
    addMessage('assistant', `Launched: ${command}`);
  }
}

async function focusApp() {
  const name = appCommandInput.value.trim();
  if (!name) return;
  const result = await window.overlay.focusApp(name);
  if (!result.ok) {
    if (result.reason === 'not_allowed') {
      addMessage('assistant', 'Focus blocked: app not in allowlist.');
      return;
    }
    if (result.reason === 'user_denied') {
      addMessage('assistant', 'Focus cancelled.');
      return;
    }
    addMessage('assistant', `Focus failed: ${result.reason}`);
  } else {
    addMessage('assistant', `Focused: ${name}`);
  }
}

window.overlay.onChunk((chunk) => {
  assistantBuffer += chunk;
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
  const allowed = await window.overlay.requestEditPermission();
  if (allowed) {
    permBtn.textContent = 'Edits Allowed';
  }
});

settingsBtn.addEventListener('click', () => {
  const isOpen = settingsPanel.classList.toggle('open');
  settingsPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
});

saveSettingsBtn.addEventListener('click', async () => {
  await saveConfig();
});

trustProjectBtn.addEventListener('click', trustProject);
newFileBtn.addEventListener('click', createNewFile);
openFileBtn.addEventListener('click', openFile);
aiEditBtn.addEventListener('click', aiEditFile);
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
  if (!recognition) {
    recognition = initSpeechRecognition();
  }
  if (!recognition) {
    addMessage('assistant', 'Speech recognition not supported in this runtime.');
    return;
  }
  if (isRecording) {
    recognition.stop();
    return;
  }
  isRecording = true;
  micBtn.textContent = 'Mic On';
  micBtn.classList.add('active');
  updateStatus('Listening...');
  recognition.start();
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

launchAppBtn.addEventListener('click', launchApp);
focusAppBtn.addEventListener('click', focusApp);

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

loadMemories();
loadConfig();
checkOllamaStatus();
setInterval(checkOllamaStatus, 15000);
