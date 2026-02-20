const { log } = require('./logger');

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProvider(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'openai' || raw === 'gemini') return raw;
  return 'ollama';
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function requireApiKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Missing API key.');
  return key;
}

function toGeminiModelPath(model, fallbackModel = 'gemini-2.5-flash') {
  const raw = String(model || '').trim() || fallbackModel;
  const withPrefix = raw.startsWith('models/') ? raw : `models/${raw}`;
  // Keep model path simple/safe for URL path interpolation.
  return withPrefix.replace(/\s+/g, '');
}

function toGeminiEmbeddingModelPath(model) {
  const raw = String(model || '').trim();
  if (!raw) return 'models/text-embedding-004';
  if (/embed/i.test(raw)) return toGeminiModelPath(raw, 'text-embedding-004');
  return 'models/text-embedding-004';
}

function buildGeminiGeneratePayload(messages) {
  const normalized = Array.isArray(messages) ? messages : [];
  const systemParts = [];
  const contents = [];

  normalized.forEach((message) => {
    const roleRaw = String(message?.role || '').toLowerCase();
    const text = typeof message?.content === 'string' ? message.content.trim() : '';
    if (!text) return;

    if (roleRaw === 'system') {
      systemParts.push(text);
      return;
    }

    contents.push({
      role: roleRaw === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    });
  });

  if (!contents.length) {
    contents.push({
      role: 'user',
      parts: [{ text: 'Continue.' }],
    });
  }

  const payload = { contents };
  if (systemParts.length) {
    payload.systemInstruction = {
      parts: [{ text: systemParts.join('\n\n') }],
    };
  }
  return payload;
}

function extractGeminiText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  let full = '';
  candidates.forEach((candidate) => {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    parts.forEach((part) => {
      if (typeof part?.text === 'string' && part.text) {
        full += part.text;
      }
    });
  });
  return full;
}

async function streamChatOllamaOnce({
  baseUrl,
  model,
  messages,
  onChunk,
  connectTimeoutMs,
  inactivityTimeoutMs,
}) {
  const emitChunk = typeof onChunk === 'function' ? onChunk : () => {};
  const controller = new AbortController();
  let timer = null;

  const resetTimer = (ms) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), ms);
  };

  try {
    resetTimer(connectTimeoutMs);
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(`Ollama error: ${res.status} ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    resetTimer(inactivityTimeoutMs);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetTimer(inactivityTimeoutMs);
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        let data;
        try {
          data = JSON.parse(line);
        } catch (error) {
          log('warn', 'streamChat line parse failed', {
            error: String(error),
            linePreview: line.slice(0, 240),
          });
          continue;
        }
        if (data.message && data.message.content) {
          full += data.message.content;
          emitChunk(data.message.content);
        }
        if (data.done) {
          return { content: full, model: data.model };
        }
      }
    }

    return { content: full, model };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function streamChatOpenAiOnce({
  baseUrl,
  apiKey,
  model,
  messages,
  onChunk,
  connectTimeoutMs,
  inactivityTimeoutMs,
}) {
  const emitChunk = typeof onChunk === 'function' ? onChunk : () => {};
  const controller = new AbortController();
  let timer = null;

  const resetTimer = (ms) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), ms);
  };

  try {
    const token = requireApiKey(apiKey);
    resetTimer(connectTimeoutMs);
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(`API chat error: ${res.status} ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    resetTimer(inactivityTimeoutMs);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetTimer(inactivityTimeoutMs);
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line || !line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          return { content: full, model };
        }

        let data;
        try {
          data = JSON.parse(payload);
        } catch (error) {
          log('warn', 'streamChat API line parse failed', {
            error: String(error),
            linePreview: payload.slice(0, 240),
          });
          continue;
        }

        if (data?.error) {
          throw new Error(typeof data.error?.message === 'string' ? data.error.message : 'API stream error');
        }
        const delta = data?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          full += delta;
          emitChunk(delta);
        }
      }
    }

    return { content: full, model };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function streamChatGeminiOnce({
  baseUrl,
  apiKey,
  model,
  messages,
  onChunk,
  connectTimeoutMs,
  inactivityTimeoutMs,
}) {
  const emitChunk = typeof onChunk === 'function' ? onChunk : () => {};
  const token = requireApiKey(apiKey);
  const controller = new AbortController();
  const timeoutMs = Math.max(
    toInt(connectTimeoutMs, 30000),
    toInt(inactivityTimeoutMs, 45000),
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const modelPath = toGeminiModelPath(model, 'gemini-2.5-flash');
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/${modelPath}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': token,
      },
      body: JSON.stringify(buildGeminiGeneratePayload(messages)),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini chat error: ${res.status} ${text}`);
    }

    const data = await res.json();
    const content = extractGeminiText(data);
    if (!content) {
      const block = data?.promptFeedback?.blockReason;
      if (block) throw new Error(`Gemini blocked response: ${block}`);
      throw new Error('Invalid Gemini chat response.');
    }
    emitChunk(content);
    return { content, model: modelPath };
  } finally {
    clearTimeout(timeout);
  }
}

async function streamChatOnce(args) {
  const provider = normalizeProvider(args?.provider);
  if (provider === 'openai') {
    return streamChatOpenAiOnce(args);
  }
  if (provider === 'gemini') {
    return streamChatGeminiOnce(args);
  }
  return streamChatOllamaOnce(args);
}

async function streamChat({
  provider = 'ollama',
  baseUrl,
  apiKey,
  model,
  messages,
  onChunk,
  connectTimeoutMs = toInt(process.env.OVERLAY_OLLAMA_CHAT_CONNECT_TIMEOUT_MS, 30000),
  inactivityTimeoutMs = toInt(process.env.OVERLAY_OLLAMA_CHAT_INACTIVITY_TIMEOUT_MS, 45000),
  maxRetries = toInt(process.env.OVERLAY_OLLAMA_CHAT_RETRIES, 1),
}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await streamChatOnce({
        provider,
        baseUrl,
        apiKey,
        model,
        messages,
        onChunk,
        connectTimeoutMs,
        inactivityTimeoutMs,
      });
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxRetries;
      if (shouldRetry) {
        log('warn', 'streamChat retrying', { attempt: attempt + 1, error: String(error) });
        await sleep(250 * (attempt + 1));
        continue;
      }
      break;
    }
  }
  log('error', 'streamChat failed', { provider, error: String(lastError) });
  throw lastError;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function embedTextOllama({
  baseUrl,
  model,
  prompt,
  timeoutMs,
}) {
  const res = await fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
    }),
  }, timeoutMs);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama embeddings error: ${res.status} ${text}`);
  }

  const data = await res.json();
  if (!Array.isArray(data?.embedding)) {
    throw new Error('Invalid Ollama embeddings response.');
  }
  return data.embedding;
}

async function embedTextOpenAi({
  baseUrl,
  apiKey,
  model,
  prompt,
  timeoutMs,
}) {
  const token = requireApiKey(apiKey);
  const res = await fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
    }),
  }, timeoutMs);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API embeddings error: ${res.status} ${text}`);
  }

  const data = await res.json();
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    throw new Error('Invalid API embeddings response.');
  }
  return vector;
}

async function embedTextGemini({
  baseUrl,
  apiKey,
  model,
  prompt,
  timeoutMs,
}) {
  const token = requireApiKey(apiKey);
  const modelPath = toGeminiEmbeddingModelPath(model);
  const res = await fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/${modelPath}:embedContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': token,
    },
    body: JSON.stringify({
      content: {
        parts: [{ text: String(prompt || '') }],
      },
    }),
  }, timeoutMs);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini embeddings error: ${res.status} ${text}`);
  }

  const data = await res.json();
  const vector = data?.embedding?.values;
  if (!Array.isArray(vector)) {
    throw new Error('Invalid Gemini embeddings response.');
  }
  return vector;
}

async function embedText({
  provider = 'ollama',
  baseUrl,
  apiKey,
  model,
  prompt,
  timeoutMs = toInt(process.env.OVERLAY_OLLAMA_EMBED_TIMEOUT_MS, 15000),
  maxRetries = toInt(process.env.OVERLAY_OLLAMA_EMBED_RETRIES, 1),
}) {
  const selectedProvider = normalizeProvider(provider);
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      if (selectedProvider === 'openai') {
        return await embedTextOpenAi({
          baseUrl,
          apiKey,
          model,
          prompt,
          timeoutMs,
        });
      }
      if (selectedProvider === 'gemini') {
        return await embedTextGemini({
          baseUrl,
          apiKey,
          model,
          prompt,
          timeoutMs,
        });
      }
      return await embedTextOllama({
        baseUrl,
        model,
        prompt,
        timeoutMs,
      });
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxRetries;
      if (shouldRetry) {
        log('warn', 'embedText retrying', { attempt: attempt + 1, error: String(error) });
        await sleep(200 * (attempt + 1));
        continue;
      }
      break;
    }
  }
  log('error', 'embedText failed', { provider: selectedProvider, error: String(lastError) });
  throw lastError;
}

async function checkHealth({ provider = 'ollama', baseUrl, apiKey, timeoutMs = 2000 }) {
  const selectedProvider = normalizeProvider(provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = `${normalizeBaseUrl(baseUrl)}/api/tags`;
    let headers;
    if (selectedProvider === 'openai') {
      const token = requireApiKey(apiKey);
      url = `${normalizeBaseUrl(baseUrl)}/models`;
      headers = { Authorization: `Bearer ${token}` };
    } else if (selectedProvider === 'gemini') {
      const token = requireApiKey(apiKey);
      url = `${normalizeBaseUrl(baseUrl)}/models`;
      headers = { 'x-goog-api-key': token };
    }
    const res = await fetch(url, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    clearTimeout(timeout);
    return { ok: false, error: String(error) };
  }
}

module.exports = {
  streamChat,
  embedText,
  checkHealth,
  normalizeProvider,
};
