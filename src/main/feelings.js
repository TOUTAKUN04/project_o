function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeDecayMinutes(value, fallback = 45) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 5 || parsed > 240) return fallback;
  return parsed;
}

function normalizeSignalText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferSignal(text) {
  const normalized = normalizeSignalText(text);
  if (!normalized) return { mood: 'focused', strength: 8, reason: 'empty_input' };

  const frustratedTokens = ['angry', 'annoy', 'frustrat', 'wtf', 'hate', 'broken', 'useless', 'stupid'];
  const stressedTokens = ['urgent', 'asap', 'deadline', 'panic', 'quick', 'fast', 'now'];
  const optimisticTokens = ['great', 'awesome', 'nice', 'love', 'excited', 'thanks', 'good'];
  const warmTokens = ['please', 'thank you', 'appreciate', 'help me'];
  const focusTokens = ['fix', 'build', 'make', 'implement', 'write', 'run', 'debug'];

  if (frustratedTokens.some((token) => normalized.includes(token))) {
    return { mood: 'frustrated', strength: 30, reason: 'frustrated_signal' };
  }
  if (stressedTokens.some((token) => normalized.includes(token))) {
    return { mood: 'stressed', strength: 24, reason: 'stressed_signal' };
  }
  if (optimisticTokens.some((token) => normalized.includes(token))) {
    return { mood: 'optimistic', strength: 20, reason: 'positive_signal' };
  }
  if (warmTokens.some((token) => normalized.includes(token))) {
    return { mood: 'warm', strength: 16, reason: 'warm_signal' };
  }
  if (focusTokens.some((token) => normalized.includes(token))) {
    return { mood: 'focused', strength: 14, reason: 'task_signal' };
  }
  return { mood: 'focused', strength: 10, reason: 'neutral_task_signal' };
}

function createFeelingsEngine(options = {}) {
  let decayMinutes = normalizeDecayMinutes(options.decayMinutes, 45);
  let state = {
    mood: 'focused',
    intensity: 22,
    confidence: 50,
    reason: 'startup',
    updatedAt: Date.now(),
  };

  const applyDecay = (now = Date.now()) => {
    const elapsed = Math.max(0, now - state.updatedAt);
    const decayMs = decayMinutes * 60000;
    if (elapsed <= 0 || decayMs <= 0) return;
    const ratio = clamp(elapsed / decayMs, 0, 2);
    if (ratio < 0.12) return;
    const decaySteps = Math.floor(ratio * 18);
    if (decaySteps <= 0) return;

    state.intensity = clamp(state.intensity - decaySteps, 0, 100);
    state.confidence = clamp(state.confidence - Math.floor(decaySteps * 0.6), 20, 100);
    if (state.intensity <= 8 && state.mood !== 'neutral') {
      state.mood = 'neutral';
      state.reason = 'decayed_to_neutral';
    }
    state.updatedAt = now;
  };

  const setMood = (mood, intensity, reason, now = Date.now()) => {
    applyDecay(now);
    if (state.mood === mood) {
      state.intensity = clamp(Math.max(state.intensity, intensity), 0, 100);
      state.confidence = clamp(state.confidence + 4, 20, 100);
    } else {
      state.mood = mood;
      state.intensity = clamp(intensity, 0, 100);
      state.confidence = clamp(state.confidence + 2, 20, 100);
    }
    state.reason = reason || state.reason;
    state.updatedAt = now;
  };

  return {
    configure({ decayMinutes: nextDecayMinutes } = {}) {
      decayMinutes = normalizeDecayMinutes(nextDecayMinutes, decayMinutes);
    },
    observeUserText(text) {
      const signal = inferSignal(text);
      setMood(signal.mood, signal.strength, signal.reason);
      return this.snapshot();
    },
    observeOutcome({ ok, source } = {}) {
      const reasonPrefix = typeof source === 'string' && source ? source : 'outcome';
      if (ok) {
        if (state.mood === 'frustrated' || state.mood === 'stressed') {
          setMood('focused', 18, `${reasonPrefix}_recovered`);
        } else if (state.mood === 'focused' || state.mood === 'neutral') {
          setMood('optimistic', 16, `${reasonPrefix}_success`);
        } else {
          setMood(state.mood, Math.max(state.intensity - 4, 10), `${reasonPrefix}_stable`);
        }
      } else if (state.mood === 'frustrated') {
        setMood('frustrated', clamp(state.intensity + 8, 30, 80), `${reasonPrefix}_failure`);
      } else {
        setMood('stressed', clamp(state.intensity + 10, 24, 78), `${reasonPrefix}_failure`);
      }
      return this.snapshot();
    },
    snapshot() {
      applyDecay();
      return {
        mood: state.mood,
        intensity: state.intensity,
        confidence: state.confidence,
        reason: state.reason,
        decayMinutes,
        updatedAt: new Date(state.updatedAt).toISOString(),
      };
    },
  };
}

module.exports = {
  createFeelingsEngine,
};

