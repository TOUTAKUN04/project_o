const path = require('path');
const Database = require('better-sqlite3');
const { app } = require('electron');
const { log } = require('./logger');

let db;

function initDb() {
  if (db) return db;
  const dbPath = path.join(app.getPath('userData'), 'memories.db');
  try {
    db = new Database(dbPath);
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
    `);
    return db;
  } catch (error) {
    log('error', 'initDb failed', { error: String(error) });
    throw error;
  }
}

function addMemory({ role, content }) {
  try {
    if (!db) initDb();
    const stmt = db.prepare('INSERT INTO memories (role, content, created_at) VALUES (?, ?, ?)');
    const info = stmt.run(role, content, new Date().toISOString());
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

function getAllMemoryVectors() {
  try {
    if (!db) initDb();
    const stmt = db.prepare(`
      SELECT memories.id as id, memories.role as role, memories.content as content, memory_vectors.vector_json as vector_json
      FROM memories
      JOIN memory_vectors ON memories.id = memory_vectors.memory_id
    `);
    return stmt.all();
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
  const rows = getAllMemoryVectors();
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

module.exports = {
  initDb,
  addMemory,
  addMemoryVector,
  getRecentMemories,
  searchMemories,
};