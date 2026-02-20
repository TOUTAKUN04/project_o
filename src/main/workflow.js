const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { streamChat } = require('./ollama');
const { isPathAllowed } = require('./files');

const MAX_FILE_PROMPT_CHARS = 120000;
const MAX_JSON_TEXT_CHARS = 400000;
const MAX_OUTPUT_CHARS = 8000;
const DEFAULT_STEP_TIMEOUT_MS = 120000;
const SAFE_SCRIPT_ORDER = ['lint', 'typecheck', 'test'];
const WORKFLOW_CHAT_CONNECT_TIMEOUT_MS = 60000;
const WORKFLOW_CHAT_INACTIVITY_TIMEOUT_MS = 180000;

function clampText(value, maxChars) {
  const text = typeof value === 'string' ? value : String(value || '');
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function parseJsonStrict(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;

  const candidates = [text];
  if (text.startsWith('```')) {
    const unfenced = text
      .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
      .replace(/```$/, '')
      .trim();
    if (unfenced) candidates.push(unfenced);
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

function extractFirstCodeBlock(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const match = raw.match(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/);
  if (!match || typeof match[1] !== 'string') return '';
  return match[1];
}

function toStringArray(value, limit = 10, maxItemLen = 280) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (result.length >= limit) break;
    const text = String(item || '').trim();
    if (!text) continue;
    result.push(clampText(text, maxItemLen));
  }
  return result;
}

function normalizeRiskLevel(value) {
  const level = String(value || '').toLowerCase().trim();
  if (level === 'high') return 'high';
  if (level === 'medium') return 'medium';
  return 'low';
}

function normalizeVerdict(value) {
  return String(value || '').toLowerCase().trim() === 'needs_attention'
    ? 'needs_attention'
    : 'pass';
}

async function requestDraftEdit({
  provider,
  baseUrl,
  apiKey,
  model,
  filePath,
  currentContent,
  instruction,
}) {
  const system = [
    'You are a rigorous coding editor.',
    'Return JSON only with this exact shape:',
    '{',
    '  "plan": ["short implementation steps"],',
    '  "updatedContent": "FULL UPDATED FILE CONTENT",',
    '  "notes": ["important caveats or assumptions"]',
    '}',
    'Rules:',
    '- Do not output markdown.',
    '- updatedContent must contain the entire file, not a diff.',
    '- Keep behavior stable except the requested change.',
    '- If instruction is ambiguous, choose the safest minimal change and mention it in notes.',
  ].join('\n');

  const user = [
    `File path: ${filePath}`,
    '',
    `Instruction: ${instruction}`,
    '',
    'Current file content:',
    currentContent,
  ].join('\n');

  const response = await streamChat({
    provider,
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    connectTimeoutMs: WORKFLOW_CHAT_CONNECT_TIMEOUT_MS,
    inactivityTimeoutMs: WORKFLOW_CHAT_INACTIVITY_TIMEOUT_MS,
  });

  const raw = clampText(response?.content || '', MAX_JSON_TEXT_CHARS);
  const parsed = parseJsonStrict(raw);
  if (!parsed || typeof parsed.updatedContent !== 'string') {
    const fallback = extractFirstCodeBlock(raw) || raw;
    if (!fallback.trim()) return { ok: false, reason: 'invalid_model_response', raw };
    return {
      ok: true,
      plan: ['Model returned unstructured output; using fallback content.'],
      updatedContent: fallback,
      notes: ['Review the full diff carefully before saving.'],
    };
  }

  return {
    ok: true,
    plan: toStringArray(parsed.plan, 8, 220),
    updatedContent: parsed.updatedContent,
    notes: toStringArray(parsed.notes, 8, 260),
  };
}

async function requestSelfReview({
  provider,
  baseUrl,
  apiKey,
  model,
  filePath,
  instruction,
  originalContent,
  updatedContent,
}) {
  const system = [
    'You are a strict code reviewer.',
    'Return JSON only with this exact shape:',
    '{',
    '  "riskLevel": "low|medium|high",',
    '  "findings": ["concrete risks or regressions"],',
    '  "verification": ["checks to run"],',
    '  "verdict": "pass|needs_attention"',
    '}',
    'Rules:',
    '- Keep findings concrete and testable.',
    '- No markdown.',
    '- If no major issue, return an empty findings list.',
  ].join('\n');

  const user = [
    `File path: ${filePath}`,
    `Instruction: ${instruction}`,
    '',
    'Original content:',
    originalContent,
    '',
    'Updated content:',
    updatedContent,
  ].join('\n');

  const response = await streamChat({
    provider,
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    connectTimeoutMs: WORKFLOW_CHAT_CONNECT_TIMEOUT_MS,
    inactivityTimeoutMs: WORKFLOW_CHAT_INACTIVITY_TIMEOUT_MS,
  });

  const raw = clampText(response?.content || '', MAX_JSON_TEXT_CHARS);
  const parsed = parseJsonStrict(raw);
  if (!parsed || typeof parsed !== 'object') {
    return {
      riskLevel: 'medium',
      findings: ['Self-review parsing failed. Review diff manually before save.'],
      verification: [],
      verdict: 'needs_attention',
    };
  }
  return {
    riskLevel: normalizeRiskLevel(parsed.riskLevel),
    findings: toStringArray(parsed.findings, 8, 260),
    verification: toStringArray(parsed.verification, 8, 220),
    verdict: normalizeVerdict(parsed.verdict),
  };
}

async function runEditWorkflow({
  provider,
  baseUrl,
  apiKey,
  model,
  filePath,
  currentContent,
  instruction,
}) {
  const fileText = typeof currentContent === 'string' ? currentContent : String(currentContent || '');
  if (fileText.length > MAX_FILE_PROMPT_CHARS) {
    return { ok: false, reason: 'file_too_large_for_ai' };
  }

  const trimmedInstruction = String(instruction || '').trim();
  if (!trimmedInstruction) return { ok: false, reason: 'missing_instruction' };

  const draft = await requestDraftEdit({
    provider,
    baseUrl,
    apiKey,
    model,
    filePath,
    currentContent: fileText,
    instruction: trimmedInstruction,
  });
  if (!draft.ok) return draft;

  const review = await requestSelfReview({
    provider,
    baseUrl,
    apiKey,
    model,
    filePath,
    instruction: trimmedInstruction,
    originalContent: fileText,
    updatedContent: draft.updatedContent,
  });

  return {
    ok: true,
    plan: draft.plan,
    notes: draft.notes,
    updatedContent: draft.updatedContent,
    review,
  };
}

function findProjectRootFromFile(filePath) {
  let cursor = path.dirname(filePath);
  while (true) {
    const candidate = path.join(cursor, 'package.json');
    if (fs.existsSync(candidate)) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function listSafeScripts(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, ''));
    const scripts = parsed && typeof parsed === 'object' ? parsed.scripts : null;
    if (!scripts || typeof scripts !== 'object') return [];
    return SAFE_SCRIPT_ORDER.filter((name) => typeof scripts[name] === 'string' && scripts[name].trim());
  } catch {
    return [];
  }
}

function trimCommandOutput(text) {
  const input = typeof text === 'string' ? text : String(text || '');
  if (input.length <= MAX_OUTPUT_CHARS) return input;
  return `${input.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]`;
}

function runScript({ cwd, script, timeoutMs }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const isWindows = process.platform === 'win32';
    const child = spawn(isWindows ? `npm run ${script}` : 'npm', isWindows ? [] : ['run', script], {
      cwd,
      windowsHide: true,
      shell: isWindows,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        script,
        code: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        output: trimCommandOutput(`spawn_failed: ${String(error)}`),
      });
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const mergedOutput = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();
      const statusOk = !timedOut && code === 0;
      resolve({
        ok: statusOk,
        script,
        code: Number.isFinite(code) ? code : null,
        signal: signal || null,
        timedOut,
        durationMs: Date.now() - startedAt,
        output: trimCommandOutput(mergedOutput),
      });
    });
  });
}

async function runVerificationChecks({ filePath, allowedRoots, timeoutMs = DEFAULT_STEP_TIMEOUT_MS }) {
  if (!path.isAbsolute(String(filePath || ''))) {
    return { ok: false, reason: 'invalid_path' };
  }
  if (!isPathAllowed(filePath, allowedRoots)) {
    return { ok: false, reason: 'path_not_allowed' };
  }

  const projectRoot = findProjectRootFromFile(filePath);
  if (!projectRoot) {
    return { ok: false, reason: 'project_root_not_found' };
  }
  if (!isPathAllowed(projectRoot, allowedRoots)) {
    return { ok: false, reason: 'path_not_allowed' };
  }

  const scripts = listSafeScripts(projectRoot);
  if (!scripts.length) {
    return { ok: false, reason: 'no_supported_scripts', projectRoot };
  }

  const results = [];
  for (const script of scripts) {
    const result = await runScript({
      cwd: projectRoot,
      script,
      timeoutMs,
    });
    results.push(result);
  }

  const ok = results.every((run) => run.ok);
  return {
    ok,
    reason: ok ? null : 'verification_failed',
    projectRoot,
    scripts,
    runs: results,
  };
}

module.exports = {
  runEditWorkflow,
  runVerificationChecks,
};
