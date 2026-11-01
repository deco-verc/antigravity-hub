import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, initDatabase } from '../src/db.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { ProjectChatService } from '../src/projectChatService.js';

initDatabase();

function setupTestProject(prefix: string): { projectId: string; projectPath: string; runId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const projectId = `proj-${crypto.randomUUID().slice(0, 8)}`;
  const runId = `run-${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();

  fs.mkdirSync(path.join(dir, '.ai-dev-hub'), { recursive: true });

  db.prepare(`
    INSERT INTO projects (id, name, path, objective, description, stack, status, is_trusted, full_dev_autonomy, created_at, updated_at)
    VALUES (?, ?, ?, 'WhatsApp Cakto Automation', 'Test system', 'Node.js, TypeScript', 'active', 1, 1, ?, ?)
  `).run(projectId, `Project-${prefix}`, dir, nowIso, nowIso);

  db.prepare(`
    INSERT INTO autonomous_runs (
      id, project_id, name, objective, briefing, status, autonomy_mode,
      current_cycle, max_cycles, start_time, created_at, updated_at
    ) VALUES (?, ?, 'Run Test', 'Test run', 'Briefing test', 'completed', 'autonomous',
      1, 10, ?, ?, ?)
  `).run(runId, projectId, nowIso, nowIso, nowIso);

  return { projectId, projectPath: dir, runId };
}

function cleanupTestProject(projectPath: string, projectId: string) {
  try {
    db.prepare('DELETE FROM autonomous_tasks WHERE project_id = ? OR run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(projectId, projectId);
    db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  } catch {}
  try {
    fs.rmSync(projectPath, { recursive: true, force: true });
  } catch {}
}

test('Motor de Planejamento - Modo 1: PRÉ-PLANEJAMENTO (Dia 0 / Projeto Vazio)', async () => {
  const { projectId, projectPath } = setupTestProject('day0-test');

  try {
    const briefing = 'Sistema de automação WhatsApp com @whiskeysockets/baileys, cakto funil de vendas, pix recovery e sqlite better-sqlite3 WAL.';
    const tasks = HierarchicalOrchestrationService.decomposeArchitecturalBriefing({
      briefing,
      projectName: 'WhaatsEntreg',
      projectPath,
      projectId
    });

    assert.ok(tasks, 'Deve gerar plano de bootstrap');
    assert.equal(tasks.length, 6, 'Plano de Day 0 deve conter exatamente 6 tarefas');
    assert.equal(tasks[0].code, 'TK-1');
    assert.equal(tasks[5].code, 'TK-6');
    assert.ok(tasks[0].title.includes('Configuração Base'));
    assert.ok(tasks[1].title.includes('SQLite em Modo WAL'));

    // Verifica card do ProjectChatService em Day 0
    const proposal = await ProjectChatService.generateInteractivePlanProposal({
      projectId,
      projectPath,
      projectName: 'WhaatsEntreg',
      briefing
    });

    assert.ok(!proposal.replyContent.includes('PLANO DE EXPANSÃO INCREMENTAL'), 'Day 0 não deve conter cabeçalho de expansão incremental');
    assert.ok(proposal.replyContent.includes('proposta de arquitetura estruturada em **6 etapas coesas**'));
  } finally {
    cleanupTestProject(projectPath, projectId);
  }
});

test('Motor de Planejamento - Modo 2: PÓS-PLANEJAMENTO (Evolução / Delta Planning com 6 tarefas prévias)', async () => {
  const { projectId, projectPath, runId } = setupTestProject('evolution-test');

  try {
    const nowIso = new Date().toISOString();

    // Inserir 6 tarefas concluídas simulando projeto com ciclo base finalizado
    for (let i = 1; i <= 6; i++) {
      db.prepare(`
        INSERT INTO autonomous_tasks (
          id, run_id, project_id, code, title, order_index, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)
      `).run(`task-${i}`, runId, projectId, `TK-${i}`, `Tarefa Base ${i}`, i, nowIso, nowIso);
    }

    const evolutionBriefing = 'Quero adicionar um disparador manual de mensagens avulsas e um editor de templates com tags dinâmicas.';

    // Executa decomposição
    const tasks = HierarchicalOrchestrationService.decomposeArchitecturalBriefing({
      briefing: evolutionBriefing,
      projectName: 'WhaatsEntreg',
      projectPath,
      projectId
    });

    assert.ok(tasks, 'Deve gerar plano incremental para fase de evolução');
    assert.equal(tasks.length, 2, 'Deve gerar exatamente 2 tarefas para os recursos solicitados');

    // Validação da Tarefa TK-7 (Disparador Manual)
    assert.equal(tasks[0].code, 'TK-7', 'A primeira tarefa incremental deve ser TK-7');
    assert.equal(tasks[0].orderIndex, 7);
    assert.deepEqual(tasks[0].dependencies, ['TK-6'], 'TK-7 deve depender da última estável TK-6');
    assert.ok(tasks[0].title.includes('Disparo Rápido Manual'));

    // Validação da Tarefa TK-8 (Editor de Templates)
    assert.equal(tasks[1].code, 'TK-8', 'A segunda tarefa incremental deve ser TK-8');
    assert.equal(tasks[1].orderIndex, 8);
    assert.deepEqual(tasks[1].dependencies, ['TK-7'], 'TK-8 deve encadear em TK-7');
    assert.ok(tasks[1].title.includes('Editor de Templates'));

    // Garantir PROIBIÇÃO: nenhum template Day 0 (TK-1..TK-6 ou package.json base) retornado
    assert.ok(!tasks.some(t => t.code === 'TK-1' || t.code === 'TK-2'));

    // Validação de sincronização no ProjectChatService (rotulagem do card de proposta)
    const proposal = await ProjectChatService.generateInteractivePlanProposal({
      projectId,
      projectPath,
      projectName: 'WhaatsEntreg',
      briefing: evolutionBriefing
    });

    assert.ok(
      proposal.replyContent.includes('### [PLANO DE EXPANSÃO INCREMENTAL — ETAPAS TK-7 A TK-8]'),
      'Card do chat deve ser rotulado com o intervalo incremental TK-7 a TK-8'
    );
    assert.ok(
      proposal.replyContent.includes('proposta de expansão incremental estruturada em **2 etapas coesas**')
    );
  } finally {
    cleanupTestProject(projectPath, projectId);
  }
});

test('Motor de Planejamento - Modo 2 com 3 Recursos: Disparador Manual + Templates + Webhook Studio', async () => {
  const { projectId, projectPath, runId } = setupTestProject('evolution-triple-test');

  try {
    const nowIso = new Date().toISOString();

    for (let i = 1; i <= 6; i++) {
      db.prepare(`
        INSERT INTO autonomous_tasks (
          id, run_id, project_id, code, title, order_index, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)
      `).run(`task-trip-${i}`, runId, projectId, `TK-${i}`, `Base ${i}`, i, nowIso, nowIso);
    }

    const briefing = 'Adicionar disparador manual, editor de templates com spintax e webhook studio com simulador de payloads cakto.';

    const tasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
      briefing,
      projectName: 'WhaatsEntreg',
      projectPath,
      projectId
    });

    assert.equal(tasks.length, 3);
    assert.equal(tasks[0].code, 'TK-7');
    assert.deepEqual(tasks[0].dependencies, ['TK-6']);

    assert.equal(tasks[1].code, 'TK-8');
    assert.deepEqual(tasks[1].dependencies, ['TK-7']);

    assert.equal(tasks[2].code, 'TK-9');
    assert.deepEqual(tasks[2].dependencies, ['TK-8']);
    assert.ok(tasks[2].title.includes('Webhook'));

    const proposal = await ProjectChatService.generateInteractivePlanProposal({
      projectId,
      projectPath,
      projectName: 'WhaatsEntreg',
      briefing
    });

    assert.ok(
      proposal.replyContent.includes('### [PLANO DE EXPANSÃO INCREMENTAL — ETAPAS TK-7 A TK-9]'),
      'Card deve exibir intervalo TK-7 a TK-9'
    );
  } finally {
    cleanupTestProject(projectPath, projectId);
  }
});

test('Motor de Planejamento - Fallback de inspeção via .ai-dev-hub/tasks.md', async () => {
  const { projectId, projectPath } = setupTestProject('tasks-md-fallback-test');

  try {
    // Banco SQLite não tem nenhuma tarefa registrada, mas tasks.md no disco tem TK-1 a TK-6
    const tasksMdContent = `# Kanban de Tarefas
## Concluído (6)
- [x] **TK-1: Configuração Base**
- [x] **TK-2: Banco de Dados**
- [x] **TK-3: Motor WhatsApp**
- [x] **TK-4: Webhooks**
- [x] **TK-5: Funil de Vendas**
- [x] **TK-6: Worker Anti-Ban**
`;
    fs.writeFileSync(path.join(projectPath, '.ai-dev-hub', 'tasks.md'), tasksMdContent, 'utf-8');

    const tasks = HierarchicalOrchestrationService.decomposeArchitecturalBriefing({
      briefing: 'Adicionar disparador manual e painel de métricas',
      projectName: 'WhaatsEntreg',
      projectPath,
      projectId
    });

    assert.ok(tasks, 'Deve detectar tarefas no tasks.md');
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].code, 'TK-7');
    assert.deepEqual(tasks[0].dependencies, ['TK-6']);
    assert.equal(tasks[1].code, 'TK-8');
    assert.deepEqual(tasks[1].dependencies, ['TK-7']);
  } finally {
    cleanupTestProject(projectPath, projectId);
  }
});
