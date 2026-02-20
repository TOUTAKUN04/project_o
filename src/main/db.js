const path = require('path');
const Database = require('better-sqlite3');
const { app } = require('electron');
const { log } = require('./logger');

const MAX_VECTOR_SCAN = Number.parseInt(process.env.OVERLAY_MAX_MEMORY_VECTOR_SCAN || '2000', 10);
const MEMORY_RETENTION_MAX = Number.parseInt(process.env.OVERLAY_MEMORY_RETENTION_MAX || '5000', 10);
const MAX_TASK_EVENTS = Number.parseInt(process.env.OVERLAY_MAX_TASK_EVENTS || '4000', 10);

let db;

function nowIso() {
  return new Date().toISOString();
}

function initDb() {
  if (db) return db;
  const dbPath = path.join(app.getPath('userData'), 'memories.db');
  try {
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_vectors (
        memory_id INTEGER PRIMARY KEY,
        vector_json TEXT NOT NULL,
        FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT,
        error_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS task_steps (
        task_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        step_type TEXT NOT NULL,
        tool_name TEXT,
        input_json TEXT,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        output_json TEXT,
        error_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(task_id, step_index),
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id, id DESC);
    `);
    return db;
  } catch (error) {
    log('error', 'initDb failed', { error: String(error) });
    throw error;
  }
}

function pruneOldMemories(maxRows = MEMORY_RETENTION_MAX) {
  try {
    if (!db) initDb();
    const limit = Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 5000;
    const stmt = db.prepare(`
      DELETE FROM memories
      WHERE id NOT IN (
        SELECT id FROM memories ORDER BY id DESC LIMIT ?
      )
    `);
    stmt.run(limit);
  } catch (error) {
    log('warn', 'pruneOldMemories failed', { error: String(error) });
  }
}

function addMemory({ role, content }) {
  try {
    if (!db) initDb();
    const stmt = db.prepare('INSERT INTO memories (role, content, created_at) VALUES (?, ?, ?)');
    const info = stmt.run(role, content, nowIso());
    if (Number(info.lastInsertRowid) % 20 === 0) {
      pruneOldMemories(MEMORY_RETENTION_MAX);
    }
    return info.lastInsertRowid;
  } catch (error) {
    log('error', 'addMemory failed', { error: String(error) });
    return null;
  }
}

function addMemoryVector({ memoryId, vector }) {
  try {
    if (!db) initDb();
    if (!memoryId || !vector) return;
    const stmt = db.prepare('INSERT OR REPLACE INTO memory_vectors (memory_id, vector_json) VALUES (?, ?)');
    stmt.run(memoryId, JSON.stringify(vector));
  } catch (error) {
    log('error', 'addMemoryVector failed', { error: String(error) });
  }
}

function getRecentMemories(limit = 20) {
  try {
    if (!db) initDb();
    const stmt = db.prepare('SELECT role, content, created_at FROM memories ORDER BY id DESC LIMIT ?');
    return stmt.all(limit).reverse();
  } catch (error) {
    log('error', 'getRecentMemories failed', { error: String(error) });
    return [];
  }
}

function getAllMemoryVectors(limit = MAX_VECTOR_SCAN) {
  try {
    if (!db) initDb();
    const stmt = db.prepare(`
      SELECT memories.id as id, memories.role as role, memories.content as content, memory_vectors.vector_json as vector_json
      FROM memories
      JOIN memory_vectors ON memories.id = memory_vectors.memory_id
      ORDER BY memories.id DESC
      LIMIT ?
    `);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 2000;
    return stmt.all(safeLimit);
  } catch (error) {
    log('error', 'getAllMemoryVectors failed', { error: String(error) });
    return [];
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function searchMemories(queryVector, limit = 5) {
  const rows = getAllMemoryVectors(MAX_VECTOR_SCAN);
  const scored = rows.map((row) => {
    let vec = [];
    try {
      vec = JSON.parse(row.vector_json);
    } catch {
      vec = [];
    }
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      score: cosineSimilarity(queryVector, vec),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function pruneOldTaskEvents(maxRows = MAX_TASK_EVENTS) {
  try {
    if (!db) initDb();
    const limit = Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 4000;
    const stmt = db.prepare(`
      DELETE FROM task_events
      WHERE id NOT IN (
        SELECT id FROM task_events ORDER BY id DESC LIMIT ?
      )
    `);
    stmt.run(limit);
  } catch (error) {
    log('warn', 'pruneOldTaskEvents failed', { error: String(error) });
  }
}

function parseJsonSafe(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function createTask({ id, title, goal, metadata, steps }) {
  try {
    if (!db) initDb();
    if (!id) return false;
    const now = nowIso();
    const stepItems = Array.isArray(steps) ? steps : [];
    const insertTask = db.prepare(`
      INSERT INTO tasks (id, title, goal, status, metadata_json, error_text, created_at, updated_at, started_at, completed_at)
      VALUES (?, ?, ?, 'queued', ?, NULL, ?, ?, NULL, NULL)
    `);
    const insertStep = db.prepare(`
      INSERT INTO task_steps (
        task_id, step_index, name, step_type, tool_name, input_json, requires_approval, status, output_json, error_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
    `);
    const tx = db.transaction(() => {
      insertTask.run(
        id,
        String(title || 'Task').slice(0, 180),
        String(goal || '').slice(0, 4000),
        metadata ? JSON.stringify(metadata) : null,
        now,
        now,
      );
      stepItems.forEach((step, index) => {
        const isTool = step?.stepType === 'tool';
        insertStep.run(
          id,
          index,
          String(step?.name || `Step ${index + 1}`).slice(0, 240),
          isTool ? 'tool' : 'note',
          isTool ? String(step?.toolName || '') : null,
          step?.input !== undefined ? JSON.stringify(step.input) : null,
          step?.requiresApproval ? 1 : 0,
          now,
          now,
        );
      });
    });
    tx();
    return true;
  } catch (error) {
    log('error', 'createTask failed', { error: String(error) });
    return false;
  }
}

function listTasks(limit = 50) {
  try {
    if (!db) initDb();
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    const stmt = db.prepare(`
      SELECT id, title, goal, status, metadata_json, error_text, created_at, updated_at, started_at, completed_at
      FROM tasks
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(safeLimit).map((row) => ({
      ...row,
      metadata: parseJsonSafe(row.metadata_json, null),
    }));
  } catch (error) {
    log('error', 'listTasks failed', { error: String(error) });
    return [];
  }
}

function getTaskById(taskId) {
  try {
    if (!db) initDb();
    const taskStmt = db.prepare(`
      SELECT id, title, goal, status, metadata_json, error_text, created_at, updated_at, started_at, completed_at
      FROM tasks
      WHERE id = ?
      LIMIT 1
    `);
    const stepStmt = db.prepare(`
      SELECT task_id, step_index, name, step_type, tool_name, input_json, requires_approval, status, output_json, error_text, created_at, updated_at
      FROM task_steps
      WHERE task_id = ?
      ORDER BY step_index ASC
    `);
    const row = taskStmt.get(taskId);
    if (!row) return null;
    const steps = stepStmt.all(taskId).map((step) => ({
      taskId: step.task_id,
      stepIndex: step.step_index,
      name: step.name,
      stepType: step.step_type,
      toolName: step.tool_name,
      input: parseJsonSafe(step.input_json, null),
      requiresApproval: !!step.requires_approval,
      status: step.status,
      output: parseJsonSafe(step.output_json, null),
      errorText: step.error_text,
      createdAt: step.created_at,
      updatedAt: step.updated_at,
    }));
    return {
      id: row.id,
      title: row.title,
      goal: row.goal,
      status: row.status,
      metadata: parseJsonSafe(row.metadata_json, null),
      errorText: row.error_text,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      steps,
    };
  } catch (error) {
    log('error', 'getTaskById failed', { error: String(error) });
    return null;
  }
}

function claimNextQueuedTask() {
  try {
    if (!db) initDb();
    const selectStmt = db.prepare(`
      SELECT id FROM tasks
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
    `);
    const updateStmt = db.prepare(`
      UPDATE tasks
      SET status = 'running',
          updated_at = ?,
          started_at = COALESCE(started_at, ?),
          error_text = NULL
      WHERE id = ? AND status = 'queued'
    `);
    const tx = db.transaction(() => {
      const row = selectStmt.get();
      if (!row) return null;
      const now = nowIso();
      const info = updateStmt.run(now, now, row.id);
      if (info.changes !== 1) return null;
      return row.id;
    });
    const taskId = tx();
    return taskId || null;
  } catch (error) {
    log('error', 'claimNextQueuedTask failed', { error: String(error) });
    return null;
  }
}

function updateTaskStatus({ taskId, status, errorText = null, startedAt, completedAt }) {
  try {
    if (!db) initDb();
    const now = nowIso();
    const stmt = db.prepare(`
      UPDATE tasks
      SET status = ?,
          updated_at = ?,
          error_text = ?,
          started_at = COALESCE(?, started_at),
          completed_at = ?
      WHERE id = ?
    `);
    const info = stmt.run(
      status,
      now,
      errorText,
      startedAt || null,
      completedAt || null,
      taskId,
    );
    return info.changes === 1;
  } catch (error) {
    log('error', 'updateTaskStatus failed', { error: String(error) });
    return false;
  }
}

function updateTaskStepStatus({ taskId, stepIndex, status, output, errorText }) {
  try {
    if (!db) initDb();
    const now = nowIso();
    const stmt = db.prepare(`
      UPDATE task_steps
      SET status = ?,
          output_json = ?,
          error_text = ?,
          updated_at = ?
      WHERE task_id = ? AND step_index = ?
    `);
    const info = stmt.run(
      status,
      output === undefined ? null : JSON.stringify(output),
      errorText || null,
      now,
      taskId,
      stepIndex,
    );
    return info.changes === 1;
  } catch (error) {
    log('error', 'updateTaskStepStatus failed', { error: String(error) });
    return false;
  }
}

function cancelPendingTaskSteps(taskId) {
  try {
    if (!db) initDb();
    const now = nowIso();
    const stmt = db.prepare(`
      UPDATE task_steps
      SET status = 'canceled',
          updated_at = ?
      WHERE task_id = ? AND status IN ('pending', 'running', 'waiting_approval')
    `);
    stmt.run(now, taskId);
    return true;
  } catch (error) {
    log('error', 'cancelPendingTaskSteps failed', { error: String(error) });
    return false;
  }
}

function addTaskEvent({ taskId, level = 'info', message, payload }) {
  try {
    if (!db) initDb();
    if (!taskId || !message) return false;
    const stmt = db.prepare(`
      INSERT INTO task_events (task_id, level, message, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      taskId,
      String(level || 'info').slice(0, 24),
      String(message).slice(0, 500),
      payload === undefined ? null : JSON.stringify(payload),
      nowIso(),
    );
    if (Number(info.lastInsertRowid) % 40 === 0) {
      pruneOldTaskEvents(MAX_TASK_EVENTS);
    }
    return true;
  } catch (error) {
    log('error', 'addTaskEvent failed', { error: String(error) });
    return false;
  }
}

function listTaskEvents(taskId, limit = 100) {
  try {
    if (!db) initDb();
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
    const stmt = db.prepare(`
      SELECT id, task_id, level, message, payload_json, created_at
      FROM task_events
      WHERE task_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);
    return stmt.all(taskId, safeLimit).reverse().map((row) => ({
      id: row.id,
      taskId: row.task_id,
      level: row.level,
      message: row.message,
      payload: parseJsonSafe(row.payload_json, null),
      createdAt: row.created_at,
    }));
  } catch (error) {
    log('error', 'listTaskEvents failed', { error: String(error) });
    return [];
  }
}

module.exports = {
  initDb,
  addMemory,
  addMemoryVector,
  getRecentMemories,
  searchMemories,
  createTask,
  listTasks,
  getTaskById,
  claimNextQueuedTask,
  updateTaskStatus,
  updateTaskStepStatus,
  cancelPendingTaskSteps,
  addTaskEvent,
  listTaskEvents,
};
