const TOOL_SCHEMAS = {
  'files:open': {
    required: [],
    properties: {},
  },
  'files:save': {
    required: ['path', 'content'],
    properties: {
      path: 'string',
      content: 'string',
    },
  },
  'files:create': {
    required: ['root', 'relativePath', 'content'],
    properties: {
      root: 'string',
      relativePath: 'string',
      content: 'string',
    },
  },
  'capture:screen': {
    required: [],
    properties: {},
  },
  'apps:launch': {
    required: ['command'],
    properties: {
      command: 'string',
    },
  },
  'apps:focus': {
    required: ['appName'],
    properties: {
      appName: 'string',
    },
  },
};

function validateToolCall(tool, payload) {
  const schema = TOOL_SCHEMAS[tool];
  if (!schema) return { ok: false, reason: 'unknown_tool' };
  const data = payload || {};

  for (const key of schema.required) {
    if (!(key in data)) return { ok: false, reason: `missing_${key}` };
  }

  for (const [key, type] of Object.entries(schema.properties)) {
    if (key in data && typeof data[key] !== type) {
      return { ok: false, reason: `invalid_${key}` };
    }
  }

  return { ok: true };
}

module.exports = { TOOL_SCHEMAS, validateToolCall };