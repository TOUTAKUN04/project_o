const { log } = require('./logger');

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function toInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

function decodeHtmlEntities(value) {
  const text = String(value || '');
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number.parseInt(code, 10) || 0))
    .replace(/&#x([a-fA-F0-9]+);/g, (_m, code) => String.fromCharCode(Number.parseInt(code, 16) || 0));
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeResultUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text, 'https://duckduckgo.com');
    if (parsed.hostname.toLowerCase().endsWith('duckduckgo.com') && parsed.pathname === '/l/') {
      const redirect = parsed.searchParams.get('uddg');
      if (redirect) {
        return normalizeResultUrl(decodeURIComponent(redirect));
      }
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function dedupeResults(items, limit) {
  const seen = new Set();
  const results = [];
  for (const item of items) {
    const url = normalizeResultUrl(item?.url);
    const title = stripTags(item?.title);
    const snippet = stripTags(item?.snippet);
    if (!url || !title) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url, snippet });
    if (results.length >= limit) break;
  }
  return results;
}

function parseDuckDuckGoHtml(html, limit) {
  const text = String(html || '');
  const sections = [];

  const blockRegex = /<div class="result__body">([\s\S]*?)<\/div>\s*<\/div>/gi;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(text)) !== null) {
    sections.push(blockMatch[1]);
  }

  const parsed = sections.map((block) => {
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>[\s\S]*?<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    return {
      url: titleMatch ? titleMatch[1] : '',
      title: titleMatch ? titleMatch[2] : '',
      snippet: snippetMatch ? (snippetMatch[1] || snippetMatch[0]) : '',
    };
  });

  return dedupeResults(parsed, limit);
}

function parseFallbackLinks(html, limit) {
  const text = String(html || '');
  const links = [];
  const regex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    links.push({
      url: match[1],
      title: match[2],
      snippet: '',
    });
    if (links.length >= limit * 5) break;
  }
  return dedupeResults(links, limit);
}

async function searchWeb({ query, limit = DEFAULT_LIMIT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const text = String(query || '').trim();
  if (!text) return { ok: false, reason: 'missing_query', results: [] };

  const safeLimit = toInt(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const safeTimeout = toInt(timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 30000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), safeTimeout);

  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(text)}&kl=us-en`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 OliviaAssistant/0.1',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}`, results: [] };
    }

    const html = await response.text();
    let results = parseDuckDuckGoHtml(html, safeLimit);
    if (!results.length) {
      results = parseFallbackLinks(html, safeLimit);
    }

    return {
      ok: true,
      engine: 'duckduckgo',
      query: text,
      results,
    };
  } catch (error) {
    log('warn', 'searchWeb failed', { error: String(error), query: text });
    return { ok: false, reason: 'search_failed', error: String(error), results: [] };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  searchWeb,
};

