const { log } = require('./logger');

async function streamChat({ baseUrl, model, messages, onChunk }) {
  try {
    const emitChunk = typeof onChunk === 'function' ? onChunk : () => {};
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(`Ollama error: ${res.status} ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
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
  } catch (error) {
    log('error', 'streamChat failed', { error: String(error) });
    throw error;
  }
}

async function embedText({ baseUrl, model, prompt }) {
  try {
    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama embeddings error: ${res.status} ${text}`);
    }

    const data = await res.json();
    return data.embedding;
  } catch (error) {
    log('error', 'embedText failed', { error: String(error) });
    throw error;
  }
}

async function checkHealth({ baseUrl, timeoutMs = 2000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
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

module.exports = { streamChat, embedText, checkHealth };
