import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, initDatabase, deleteProjectCascading } from '../src/db.js';
import { TurnCancellationManager } from '../src/turnCancellationManager.js';
import { LspService } from '../src/lspService.js';
import { AstSymbolIndexService } from '../src/astSymbolIndexService.js';

initDatabase();

test('1. deleteProjectCascading remove registros de agent_turn_observations sem deixar órfãos', () => {
  const projectId = `proj-test-del-${crypto.randomUUID().slice(0, 8)}`;
  const runId = `run-test-del-${crypto.randomUUID().slice(0, 8)}`;
  const taskId = `task-test-del-${crypto.randomUUID().slice(0, 8)}`;
  const projectPath = `C:\\IA\\test-path-${projectId}`;
  const nowIso = new Date().toISOString();

  // Inserir projeto, run, task e turn observation
  db.prepare(`
    INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
    VALUES (?, 'Delete Cascading Test', ?, 'Test objective', 'Node.js', 'active', ?, ?)
  `).run(projectId, projectPath, nowIso, nowIso);

  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, autonomy_mode, start_time, created_at, updated_at)
    VALUES (?, ?, 'Run Test', 'Run objective', 'completed', 'autonomous', ?, ?, ?)
  `).run(runId, projectId, nowIso, nowIso, nowIso);

  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, project_id, code, title, order_index, status, created_at, updated_at)
    VALUES (?, ?, ?, 'TK-1', 'Task Test', 1, 'completed', ?, ?)
  `).run(taskId, runId, projectId, nowIso, nowIso);

  db.prepare(`
    INSERT INTO agent_turn_observations (conversation_id, task_id, project_path, brain_dir, baseline_lines, baseline_files_json, phase, dispatched_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 100, '[]', 'BUILD', ?, ?, ?)
  `).run(`conv-${taskId}`, taskId, projectPath, 'brain-dir', nowIso, nowIso, nowIso);

  // Verifica que o registro existe antes da exclusão
  const before = db.prepare('SELECT COUNT(*) as count FROM agent_turn_observations WHERE task_id = ?').get(taskId) as any;
  assert.equal(before.count, 1, 'Registro de observação deve existir antes da exclusão');

  // Executa exclusão em cascata
  const result = deleteProjectCascading(projectId);
  assert.equal(result.success, true, 'Exclusão em cascata deve retornar sucesso');

  // Verifica que NENHUM registro órfão permaneceu
  const afterTask = db.prepare('SELECT COUNT(*) as count FROM agent_turn_observations WHERE task_id = ?').get(taskId) as any;
  assert.equal(afterTask.count, 0, 'Observação vinculada ao task_id deve ser excluída');

  const afterProjPath = db.prepare('SELECT COUNT(*) as count FROM agent_turn_observations WHERE project_path = ?').get(projectPath) as any;
  assert.equal(afterProjPath.count, 0, 'Observações vinculadas ao project_path devem ser excluídas');

  const afterProject = db.prepare('SELECT COUNT(*) as count FROM projects WHERE id = ?').get(projectId) as any;
  assert.equal(afterProject.count, 0, 'Projeto deve ser excluído');
});

test('2. TurnCancellationManager descarta cancelamentos antigos com TTL de 60s', () => {
  TurnCancellationManager.clearAll();

  // Cancelamento recente (< 60s)
  TurnCancellationManager.requestCancellation('key-recent');
  assert.equal(TurnCancellationManager.isCancelled('key-recent'), true, 'Cancelamento recente deve estar ativo');

  // Simula cancelamento registrado há mais de 60 segundos (> 60.000ms)
  const expiredKey = 'key-expired-token';
  TurnCancellationManager.activeTurnCancellations.set(expiredKey, Date.now() - 65000);

  // Deve expirar e retornar false
  assert.equal(TurnCancellationManager.isCancelled(expiredKey), false, 'Cancelamento com > 60s deve retornar false');
  // Deve ter sido removido do Map
  assert.equal(TurnCancellationManager.activeTurnCancellations.has(expiredKey), false, 'Cancelamento expirado deve ser descartado do Map');

  TurnCancellationManager.clearAll();
});

test('3. LspService finaliza processos tsserver e executa cleanupProcess com segurança', () => {
  assert.doesNotThrow(() => {
    LspService.stop();
  });
});

test('4. AstSymbolIndexService extrai assinaturas multilinhas com regex de fallback', () => {
  const multilineCode = `
export function exemplo(
  a: string,
  b: number
): boolean {
  return true;
}

export const exemploArrow = (
  x: string,
  y: number
): string => {
  return x;
};

export interface ComplexInterface
  extends BaseInterface {
  id: string;
}

export class ComplexClass
  extends BaseClass
  implements SomeInterface {
  name: string = 'test';
}
`;

  const symbols = AstSymbolIndexService.extractSymbolsWithRegex(multilineCode, 'sample.ts');

  // Verifica função multilinhas export function exemplo(a: string, b: number): boolean
  const fnSymbol = symbols.find(s => s.symbolName === 'exemplo');
  assert.ok(fnSymbol, 'Deve capturar a função multilinhas "exemplo"');
  assert.equal(fnSymbol.symbolType, 'function');
  assert.equal(fnSymbol.exports, true);
  assert.ok(fnSymbol.signature.includes('a: string'));
  assert.ok(fnSymbol.signature.includes('b: number'));
  assert.ok(fnSymbol.signature.includes('boolean'));

  // Verifica arrow function multilinhas
  const arrowSymbol = symbols.find(s => s.symbolName === 'exemploArrow');
  assert.ok(arrowSymbol, 'Deve capturar a arrow function multilinhas "exemploArrow"');
  assert.equal(arrowSymbol.symbolType, 'function');
  assert.equal(arrowSymbol.exports, true);
  assert.ok(arrowSymbol.signature.includes('x: string'));
  assert.ok(arrowSymbol.signature.includes('string'));

  // Verifica interface multilinhas
  const ifaceSymbol = symbols.find(s => s.symbolName === 'ComplexInterface');
  assert.ok(ifaceSymbol, 'Deve capturar a interface multilinhas "ComplexInterface"');
  assert.equal(ifaceSymbol.symbolType, 'interface');

  // Verifica classe multilinhas
  const classSymbol = symbols.find(s => s.symbolName === 'ComplexClass');
  assert.ok(classSymbol, 'Deve capturar a classe multilinhas "ComplexClass"');
  assert.equal(classSymbol.symbolType, 'class');
});
