function trimText(value, maxLen) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!maxLen || text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function normalizeProvider(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'openai' || raw === 'gemini') return raw;
  return 'ollama';
}

function listOrNone(items) {
  if (!Array.isArray(items) || !items.length) return '(none)';
  return items.join(', ');
}

function inferUserMood(text) {
  const input = String(text || '').toLowerCase();
  if (!input) return 'neutral';

  const frustratedSignals = ['angry', 'annoy', 'frustrat', 'stuck', 'wtf', 'hate', 'not working', 'broken'];
  const stressSignals = ['urgent', 'asap', 'deadline', 'panic', 'quick', 'fast'];
  const positiveSignals = ['great', 'awesome', 'nice', 'love', 'excited', 'good job', 'thanks'];

  if (frustratedSignals.some((token) => input.includes(token))) return 'frustrated';
  if (stressSignals.some((token) => input.includes(token))) return 'stressed';
  if (positiveSignals.some((token) => input.includes(token))) return 'positive';
  return 'neutral';
}

function normalizeExpressiveness(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'subtle' || raw === 'expressive') return raw;
  return 'balanced';
}

function getToneInstruction(tone, mood, expressiveness) {
  const levelHint = expressiveness === 'subtle'
    ? 'Keep emotional wording minimal.'
    : expressiveness === 'expressive'
      ? 'Use slightly richer emotional phrasing while staying professional.'
      : 'Use moderate emotional phrasing.';
  if (tone === 'calm') {
    if (mood === 'frustrated' || mood === 'stressed') {
      return `Use a calm, grounding tone and break actions into very clear short steps. ${levelHint}`;
    }
    return `Use a calm and measured tone. ${levelHint}`;
  }
  if (tone === 'warm') {
    if (mood === 'frustrated' || mood === 'stressed') return `Use warm empathy first, then provide direct steps. ${levelHint}`;
    return `Use a warm, friendly tone while staying precise. ${levelHint}`;
  }
  if (mood === 'frustrated' || mood === 'stressed') return `Acknowledge the pressure briefly, then provide concrete next actions. ${levelHint}`;
  return `Use balanced professional tone. ${levelHint}`;
}

function buildSystemPrompt({ config, context, userSystem }) {
  const assistantName = trimText(config?.assistantName, 60) || 'Olivia';
  const personaPrompt = trimText(config?.personaPrompt, 2000);
  const activeFilePath = trimText(context?.activeFilePath, 400);
  const activeFilePreview = trimText(context?.activeFilePreview, 3600);
  const latestUserMessage = trimText(context?.latestUserMessage, 1000);
  const rawFeelingsState = context?.feelingsState && typeof context.feelingsState === 'object'
    ? context.feelingsState
    : null;
  const llmProvider = normalizeProvider(config?.llmProvider);
  const providerEndpoint = llmProvider === 'ollama'
    ? trimText(config?.ollamaUrl, 300)
    : trimText(config?.apiBaseUrl, 300);
  const moodFromState = trimText(rawFeelingsState?.mood, 40).toLowerCase();
  const mood = moodFromState || inferUserMood(latestUserMessage);
  const feelingsEnabled = config?.simulatedFeelings !== false;
  const feelingsTone = ['calm', 'balanced', 'warm'].includes(String(config?.feelingsTone || '').toLowerCase())
    ? String(config.feelingsTone).toLowerCase()
    : 'balanced';
  const feelingsExpressiveness = normalizeExpressiveness(config?.feelingsExpressiveness);
  const feelingIntensity = Number.isFinite(Number(rawFeelingsState?.intensity))
    ? Math.max(0, Math.min(100, Number(rawFeelingsState.intensity)))
    : null;
  const feelingConfidence = Number.isFinite(Number(rawFeelingsState?.confidence))
    ? Math.max(0, Math.min(100, Number(rawFeelingsState.confidence)))
    : null;
  const feelingReason = trimText(rawFeelingsState?.reason, 120);

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
    '- The host app can run web search and git commands via UI actions and auto-intent routing.',
    '- For file edits, command execution, and screen capture, instruct the user to use the UI actions and review changes before saving.',
    '- Built-in slash commands exist in UI: /search, /git status, /git log, /git diff, /git commit.',
    `Allowed roots: ${listOrNone(config?.allowedRoots)}`,
    `LLM provider: ${llmProvider}`,
    `Provider endpoint: ${providerEndpoint || '(not set)'}`,
  ];

  if (feelingsEnabled) {
    lines.push('Emotion behavior:');
    lines.push('- You may express simulated feelings for better human communication.');
    lines.push('- Never claim consciousness, sentience, or real emotions.');
    lines.push(`- Tone preference: ${feelingsTone}.`);
    lines.push(`- Expressiveness: ${feelingsExpressiveness}.`);
    lines.push(`- Current user mood signal: ${mood}.`);
    if (feelingIntensity !== null || feelingConfidence !== null) {
      lines.push(`- Runtime mood state: ${moodFromState || mood} (intensity ${feelingIntensity ?? 0}/100, confidence ${feelingConfidence ?? 0}/100).`);
    }
    if (feelingReason) {
      lines.push(`- Runtime mood reason: ${feelingReason}.`);
    }
    lines.push(`- ${getToneInstruction(feelingsTone, mood, feelingsExpressiveness)}`);
  }

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

  lines.push('Final response rules (highest priority):');
  lines.push('- Do not ask repeated permission/confirmation questions for the same request.');
  lines.push('- If the user already said "go ahead", "yes", or equivalent, continue without asking again.');
  lines.push('- For read-only analysis, summaries, and explanations inside Allowed roots, proceed directly.');
  lines.push('- Ask confirmation only for clearly destructive or high-risk actions.');
  lines.push('- Do not claim a fixed training cutoff or no internet access in this app; route web/info requests to /search when needed.');

  return lines.join('\n');
}

function normalizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((msg) => msg && typeof msg.content === 'string' && typeof msg.role === 'string')
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user',
      content: trimText(msg.content, 12000),
    }))
    .filter((msg) => msg.content);
}

function trimConversationWindow(messages, maxChars = 16000, maxMessages = 18) {
  const normalized = Array.isArray(messages) ? messages : [];
  const selected = [];
  let usedChars = 0;

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index];
    if (!message || typeof message.content !== 'string') continue;
    const size = message.content.length;
    const wouldOverflow = usedChars + size > maxChars || selected.length >= maxMessages;
    if (wouldOverflow && selected.length > 0) break;
    selected.unshift(message);
    usedChars += size;
  }

  return selected;
}

function prepareChatMessages({ rawMessages, config, context }) {
  const normalized = normalizeMessages(rawMessages);
  const userSystem = normalized
    .filter((msg) => msg.role === 'system')
    .map((msg) => msg.content)
    .join('\n\n')
    .trim();

  const conversation = trimConversationWindow(
    normalized.filter((msg) => msg.role !== 'system'),
  );
  const systemPrompt = buildSystemPrompt({ config, context, userSystem });

  return [{ role: 'system', content: systemPrompt }, ...conversation];
}

module.exports = {
  prepareChatMessages,
  buildSystemPrompt,
};
