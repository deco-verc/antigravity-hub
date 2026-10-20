// server/test/uiAndPersistenceOfflineProof.test.ts
// Offline Verification of UI Visibility, Skill Accuracy, Restart Recovery & Zero Duplications

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { SkillRouter } from '../src/skillRouter.js';
import { CouncilManager } from '../src/councilManager.js';
import { EngineeringContextService } from '../src/engineeringContextService.js';

test('UI & Persistence Offline Proof: Council Visibility, Skill Accuracy, Restart Recovery & Zero Duplications', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-ui-proof-'));
  const projId = `proj-ui-proof-${Date.now()}`;
  const now = new Date().toISOString();

  // Seed project in SQLite
  db.prepare(`
    INSERT INTO projects (id, name, path, objective, stack, status, is_trusted, full_dev_autonomy, created_at, updated_at)
    VALUES (?, 'UI & Persistence Test Project', ?, 'Construir pipeline com Council e Skills', 'Node.js', 'active', 1, 1, ?, ?)
  `).run(projId, tmpRoot, now, now);

  t.after(() => {
    try {
      db.prepare('DELETE FROM autonomous_events WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(projId);
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(projId);
      db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM council_deliberations WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "uiAndPersistenceOfflineProof.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:uiAndPersistenceOfflineProof.test]", err);
      }
    }
  });

  await t.test('1. Especialidades Corretas: Roteamento mapeia estritamente cada domínio técnico', async () => {
    const testCases = [
      { title: 'Criar esquema SQLite, migrações e índices de alta performance', expected: 'DATABASE_ARCHITECT' },
      { title: 'Implementar autenticação JWT, sanitização de inputs e proteção contra XSS', expected: 'SECURITY_REVIEWER' },
      { title: 'Desenvolver testes automatizados e critérios de aceitação rigorosos', expected: 'TEST_ENGINEER' },
      { title: 'Construir interface de usuário responsiva com componentes Tailwind e tela de dashboard', expected: 'FRONTEND_SPECIALIST' },
      { title: 'Refatorar e simplificar código removendo classes intermediárias (clean code)', expected: 'KARPATHY_MINIMALIST' },
      { title: 'Desenvolver endpoints REST Express para ingestão de eventos e rotas de API', expected: 'BACKEND_API' }
    ];

    for (const tc of testCases) {
      const routed = SkillRouter.routeTask({ title: tc.title, description: tc.title });
      assert.equal(routed.skill, tc.expected, `Tarefa "${tc.title}" deve rotear para ${tc.expected}, obteve ${routed.skill}`);
      assert.ok(routed.methodologies.length > 0, 'Deve conter metodologias atribuídas');
      assert.ok(routed.concreteTechniques.length > 0, 'Deve conter técnicas concretas');
      assert.ok(routed.priorityInvariants.length > 0, 'Deve conter diretrizes invariantes');
    }
  });

  let sharedRunId = '';

  await t.test('2. Council e Research: Visíveis na API e vinculados aos identificadores de persistência', async () => {
    // Create run
    const run = await AutonomousManager.createRun({
      projectId: projId,
      name: 'Run de Prova de UI',
      objective: 'Validar visibilidade do Council e Research',
      forceNew: true
    });

    assert.ok(run.id, 'Run deve ser criado');
    sharedRunId = run.id;

    // Simulate Research Gate analysis
    const research = EngineeringContextService.evaluateResearch('Validar SQLite com transações atômicas', 'Node.js', 'high');
    assert.ok(research.untrustedDataEnvelope, 'Research deve gerar envelope de dados');
    const researchSummary = JSON.stringify({
      findingsCount: research.findings.length,
      safeToAdopt: research.safeToAdopt,
      untrustedEnvelope: research.untrustedDataEnvelope.slice(0, 200)
    });

    // Simulate Council plan deliberation
    const planDeliberation = await CouncilManager.deliberate({
      taskId: 'plan-root',
      projectId: projId,
      runId: run.id,
      task: { title: 'Plano do Projeto', plannedTasks: [{ title: 'T1', criteria: ['Critério 1'] }] },
      riskLevel: 'high',
      policyTrigger: 'HIGH_RISK_TASK'
    });

    assert.ok(planDeliberation.id, 'Deliberação do plano deve ser gerada');
    assert.equal(planDeliberation.chairmanVerdict, 'APPROVED');

    // Persist deliberation link and research summary on run
    db.prepare(`
      UPDATE autonomous_runs
      SET plan_deliberation_id = ?, research_summary_json = ?
      WHERE id = ?
    `).run(planDeliberation.id, researchSummary, run.id);

    // Verify retrieval from SQLite
    const updatedRun: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(run.id);
    assert.equal(updatedRun.plan_deliberation_id, planDeliberation.id);
    assert.equal(updatedRun.research_summary_json, researchSummary);

    // Verify task skill and task deliberation links
    const task: any = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? LIMIT 1').get(run.id);
    if (task) {
      const routedSkill = SkillRouter.routeTask(task);
      SkillRouter.persistSkillAssignment(task.id, run.id, routedSkill);

      const savedSkill = SkillRouter.getSkillForTask(task.id);
      assert.ok(savedSkill, 'Skill deve ser recuperada para a tarefa');
      assert.equal(savedSkill.skill, routedSkill.skill);

      const taskDeliberation = await CouncilManager.deliberate({
        taskId: task.id,
        projectId: projId,
        runId: run.id,
        task,
        diff: 'exports.add = (a, b) => a + b;',
        evaluation: {
          verdict: 'PASS',
          taskIsDone: true,
          exitCode: 0,
          actual: 'Passou',
          durationMs: 50,
          evidence: { output: 'Exit Code: 0' }
        } as any,
        riskLevel: 'medium'
      });

      db.prepare('UPDATE autonomous_tasks SET council_deliberation_id = ? WHERE id = ?').run(taskDeliberation.id, task.id);

      const retrievedTaskDelib = CouncilManager.getDeliberation(taskDeliberation.id);
      assert.ok(retrievedTaskDelib, 'Deliberação da tarefa deve ser encontrada');
      assert.equal(retrievedTaskDelib.taskId, task.id);
      assert.equal(retrievedTaskDelib.reviews.length, 3, 'Deve conter 3 pareceres de revisores');
    }
  });

  await t.test('3. Ausência de Tarefas Duplicadas: Idempotência garantida na criação e re-execução', async () => {
    assert.ok(sharedRunId, 'Deve existir um run compartilhado');

    const tasksBefore = db.prepare('SELECT COUNT(*) c FROM autonomous_tasks WHERE run_id = ?').get(sharedRunId) as any;

    // Tentativa de criar run sem forceNew reusa o run existente sem duplicar tarefas
    const reusedRun = await AutonomousManager.createRun({
      projectId: projId,
      name: 'Run Reusado Sem Duplicar',
      objective: 'Reusar',
      forceNew: false
    });

    assert.equal(reusedRun.id, sharedRunId, 'Deve reusar o mesmo run ativo');
    const tasksAfter = db.prepare('SELECT COUNT(*) c FROM autonomous_tasks WHERE run_id = ?').get(sharedRunId) as any;
    assert.equal(tasksAfter.c, tasksBefore.c, 'Contagem de tarefas deve permanecer estritamente idêntica');
  });

  await t.test('4. Estados Persistidos Após Reinício: Restauração preserva tarefas sem perder vínculos', async () => {
    assert.ok(sharedRunId, 'Deve existir um run compartilhado');

    // Mark run as running and one task as in_progress
    db.prepare("UPDATE autonomous_runs SET status = 'running' WHERE id = ?").run(sharedRunId);
    const firstTask: any = db.prepare('SELECT id FROM autonomous_tasks WHERE run_id = ? LIMIT 1').get(sharedRunId);
    if (firstTask) {
      db.prepare("UPDATE autonomous_tasks SET status = 'in_progress' WHERE id = ?").run(firstTask.id);
    }

    // Simulate crash recovery via AutonomousRunnerService
    AutonomousRunnerService.recoverInterruptedRuns();

    if (firstTask) {
      const restoredTask: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(firstTask.id);
      assert.equal(restoredTask.status, 'ready', 'Tarefa em andamento deve voltar para ready para nova tentativa segura');
    }

    // Verify deliberation links remain intact
    const restoredRun: any = db.prepare('SELECT plan_deliberation_id, research_summary_json FROM autonomous_runs WHERE id = ?').get(sharedRunId);
    assert.ok(restoredRun.plan_deliberation_id, 'plan_deliberation_id deve ser preservado após reinício');
    assert.ok(restoredRun.research_summary_json, 'research_summary_json deve ser preservado após reinício');
  });

  await t.test('5. Frontend Bundle: Componentes e Badges de Inteligência presentes no build de produção', async () => {
    const clientDistPath = path.resolve(__dirname, '../../client/dist/assets');
    assert.ok(fs.existsSync(clientDistPath), 'Diretório client/dist/assets deve existir após build');

    const jsFiles = fs.readdirSync(clientDistPath).filter(f => f.endsWith('.js'));
    assert.ok(jsFiles.length > 0, 'Deve conter arquivos JS transpilados');

    const mainJs = fs.readFileSync(path.join(clientDistPath, jsFiles[0]), 'utf-8');

    // Check presence of key intelligence keywords and UI badges in the bundle
    assert.ok(mainJs.includes('Council Deliberation') || mainJs.includes('Conselho'), 'Deve conter referências a Council Deliberation no bundle');
    assert.ok(mainJs.includes('Research Gate') || mainJs.includes('Pesquisa'), 'Deve conter referências ao Research Gate no bundle');
    assert.ok(mainJs.includes('skill_routed') || mainJs.includes('Especialidade'), 'Deve conter tratamento de skill_routed no bundle');
  });
});
