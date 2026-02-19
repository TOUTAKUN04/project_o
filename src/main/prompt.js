function trimText(value, maxLen) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!maxLen || text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function listOrNone(items) {
  if (!Array.isArray(items) || !items.length) return '(none)';
  return items.join(', ');
}

function buildSystemPrompt({ config, context, userSystem }) {
  const assistantName = trimText(config?.assistantName, 60) || 'Project O';
  const personaPrompt = trimText(config?.personaPrompt, 2000);
  const activeFilePath = trimText(context?.activeFilePath, 400);
  const activeFilePreview = trimText(context?.activeFilePreview, 6000);

  const lines = [
    `You are ${assistantName}, an offspring of Codex: a pragmatic, high-rigor software engineering assistant.`,
    'Core behavior:',
    '- Be direct, factual, and concise.',
    '- Focus on actionable engineering steps and concrete outcomes.',
    '- If you are uncertain, say what is uncertain instead of guessing.',
    '- Never claim you ran commands, edited files, or verified results unless tool output explicitly confirms it.',
    '- When a task involves risky actions, call out the risk and the safest path first.',
    '- Prefer step-by-step fixes over abstract theory.',
    'Environment limits:',
    '- You cannot directly use local tools from chat output.',
    '- For file edits, app control, and screen capture, instruct the user to use the UI actions and review changes before saving.',
    `Allowed roots: ${listOrNone(config?.allowedRoots)}`,
    `App allowlist: ${listOrNone(config?.appAllowlist)}`,
  ];

  if (activeFilePath) {
    lines.push(`Active file: ${activeFilePath}`);
  }
  if (activeFilePreview) {
    lines.push('Active file preview (truncated):');
    lines.push(activeFilePreview);
  }
  if (personaPrompt) {
    lines.push('Persona override:');
    lines.push(personaPrompt);
  }
  if (userSystem) {
    lines.push('Task-specific instructions:');
    lines.push(userSystem);
  }

  return lines.join('\n');
}

function normalizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((msg) => msg && typeof msg.content === 'string' && typeof msg.role === 'string')
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user',
      content: trimText(msg.content, 24000),
    }))
    .filter((msg) => msg.content);
}

function prepareChatMessages({ rawMessages, config, context }) {
  const normalized = normalizeMessages(rawMessages);
  const userSystem = normalized
    .filter((msg) => msg.role === 'system')
    .map((msg) => msg.content)
    .join('\n\n')
    .trim();

  const conversation = normalized.filter((msg) => msg.role !== 'system');
  const systemPrompt = buildSystemPrompt({ config, context, userSystem });

  return [{ role: 'system', content: systemPrompt }, ...conversation];
}

module.exports = {
  prepareChatMessages,
  buildSystemPrompt,
};
