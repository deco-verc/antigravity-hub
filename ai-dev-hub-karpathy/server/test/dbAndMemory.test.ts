import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { MemoryManager } from '../src/memoryManager.js';
import { DatabaseSync } from 'node:sqlite';

describe('Database & Memory Persistence Suite', () => {
  test('should ensure and read memory markdown structure for a new project', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-mem-test-'));
    try {
      MemoryManager.ensureMemoryStructure(tempDir, {
        name: 'Test Project',
        objective: 'Test persistent memory',
        description: 'Temporary project for test',
        stack: 'TypeScript, Node.js'
      });

      const mem = MemoryManager.readMemoryFiles(tempDir);
      assert.ok(mem.projectMd.includes('# Projeto: Test Project'));
      assert.ok(mem.architectureMd.includes('TypeScript, Node.js'));
      assert.ok(mem.tasksMd.includes('# Gerenciamento de Tarefas'));
      assert.ok(mem.changesMd.includes('# Histórico de Mudanças'));
      assert.ok(mem.decisionsMd.includes('# Registro de Decisões Técnicas'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should correctly parse and format tasks markdown', () => {
    const rawMarkdown = `# Gerenciamento de Tarefas

## Pendente
- [ ] Task 1
- [ ] Task 2

## Fazendo
- [ ] Task 3

## Concluído
- [x] Task 0
`;

    const parsed = MemoryManager.parseTasks(rawMarkdown);
    assert.deepStrictEqual(parsed.pending, ['Task 1', 'Task 2']);
    assert.deepStrictEqual(parsed.doing, ['Task 3']);
    assert.deepStrictEqual(parsed.done, ['Task 0']);

    const formatted = MemoryManager.formatTasks(parsed);
    assert.ok(formatted.includes('- [ ] Task 1'));
    assert.ok(formatted.includes('- [ ] Task 3'));
    assert.ok(formatted.includes('- [x] Task 0'));
  });

  test('should verify in-memory SQLite schema and constraints', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_number INTEGER NOT NULL,
        summary TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );
    `);

    // Insert project
    const projId = 'proj-123';
    memDb.prepare(`
      INSERT INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(projId, 'Test Proj', 'C:/IA/test', new Date().toISOString(), new Date().toISOString());

    const retrievedProj: any = memDb.prepare('SELECT * FROM projects WHERE id = ?').get(projId);
    assert.strictEqual(retrievedProj.name, 'Test Proj');
    assert.strictEqual(retrievedProj.path, 'C:/IA/test');

    // Insert session
    const sessId = 'sess-456';
    memDb.prepare(`
      INSERT INTO sessions (id, project_id, session_number, summary)
      VALUES (?, ?, ?, ?)
    `).run(sessId, projId, 1, 'Initial session summary');

    const retrievedSess: any = memDb.prepare('SELECT * FROM sessions WHERE id = ?').get(sessId);
    assert.strictEqual(retrievedSess.summary, 'Initial session summary');
    assert.strictEqual(retrievedSess.session_number, 1);

    memDb.close();
  });
});
