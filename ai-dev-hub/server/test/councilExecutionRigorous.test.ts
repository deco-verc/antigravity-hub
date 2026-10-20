import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { CouncilManager } from '../src/councilManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';

test('Council Rigorous Verification Suite: Defective Plan Rejection, Anti-Slop Gate & Independent Deliberation', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-council-rigorous-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const projId = `proj-council-rigorous-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, path, objective, stack, is_trusted, full_dev_autonomy, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Node/TypeScript', 1, 1, 'active', ?, ?)
  `).run(projId, 'Council Rigorous Test Project', tmpRoot, 'Validar comportamento crítico do conselho', now, now);

  t.after(() => {
    try {
      db.prepare('DELETE FROM council_deliberations WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(projId);
      db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "councilExecutionRigorous.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:councilExecutionRigorous.test]", err);
      }
    }
  });

  await t.test('1. Council Plan Critique: Reprova plano com critérios ausentes (CHANGES_REQUESTED)', async () => {
    // Plano com tarefas incompletas/sem critérios de aceitação
    const defectivePlannedTasks = [
      {
        title: 'Criar módulo central de autenticação',
        description: 'Implementar auth sem especificar critérios',
        milestone: 'M1',
        criteria: [] // VAZIO: Violação proposital de critério
      },
      {
        title: 'Criar dashboard de controle',
        description: 'Interface de usuário genérica',
        milestone: 'M1',
        criteria: []
      }
    ];

    const planDeliberation = await CouncilManager.deliberate({
      taskId: 'plan-test-critique',
      projectId: projId,
      task: {
        title: 'Plano Defeituoso Inicial',
        description: 'Briefing do sistema',
        plannedTasks: defectivePlannedTasks
      },
      riskLevel: 'high',
      policyTrigger: 'PLAN_ARCHITECTURE_CRITIQUE'
    });

    assert.equal(planDeliberation.chairmanVerdict, 'CHANGES_REQUESTED', 'Conselho DEVE reprovar plano sem critérios de aceitação');
    assert.ok(planDeliberation.actionItems.length > 0, 'Conselho DEVE gerar itens de ação corretivos');
    assert.ok(planDeliberation.actionItems.some(i => i.includes('critérios') || i.includes('aceitação')));
    assert.ok(planDeliberation.scores.correctness <= 5, 'Nota de corretude deve ser rebaixada');
  });

  await t.test('2. Bloqueio de Despacho: Reprovação do Conselho impede Worker de receber tarefas defeituosas', async () => {
    // Simular que o Supervisor propõe plano defeituoso e não consegue resolver
    const originalPlanTasks = GeminiSupervisorProvider.prototype.planTasks;
    try {
      GeminiSupervisorProvider.prototype.planTasks = async () => [
        {
          title: 'Tarefa Sem Critérios',
          description: 'Defeituosa proposital',
          milestone: 'M1',
          criteria: [] // Causa rejeição no conselho
        }
      ];

      const run = await AutonomousManager.createRun({
        projectId: projId,
        name: 'Run com Plano Defeituoso',
        objective: 'Testar contenção do Conselho',
        briefing: 'Criar aplicação',
        autonomyMode: 'safe',
        forceNew: true
      });

      // O run deve estar aguardando aprovação humana (waiting_approval) e NÃO ter tarefas liberadas para execução
      assert.equal(run.status, 'waiting_approval', 'Run com plano reprovado pelo Conselho deve ser travado como waiting_approval');
      const tasks = AutonomousManager.getAvailableTasks(run.id);
      assert.equal(tasks.length, 0, 'Worker NÃO pode receber nenhuma tarefa de plano reprovado');
    } finally {
      GeminiSupervisorProvider.prototype.planTasks = originalPlanTasks;
    }
  });

  await t.test('3. Refinamento do Plano: Supervisor recebe crítica, refina critérios e Conselho aprova', async () => {
    let callCount = 0;
    const originalPlanTasks = GeminiSupervisorProvider.prototype.planTasks;
    try {
      GeminiSupervisorProvider.prototype.planTasks = async (briefing, proj, opts) => {
        callCount++;
        if (opts.mode === 'REPLAN') {
          // Versão corrigida em resposta à crítica do Conselho
          return [
            {
              title: 'Autenticação JWT com Validação Estrita',
              description: 'Implementar token JWT com expiração e verificação',
              milestone: 'M1',
              criteria: ['Token assinado com chave secreta', 'Expiração em 3600 segundos', 'Rejeição de token inválido com 401'],
              verificationCommand: 'node test/auth.test.js'
            }
          ];
        }
        // Primeira tentativa sem critérios
        return [
          {
            title: 'Autenticação Genérica',
            description: 'Auth',
            milestone: 'M1',
            criteria: []
          }
        ];
      };

      const run = await AutonomousManager.createRun({
        projectId: projId,
        name: 'Run com Refinamento de Plano',
        objective: 'Testar ciclo crítica -> replan -> aprovação',
        briefing: 'Criar auth segura',
        autonomyMode: 'safe',
        forceNew: true
      });

      assert.ok(callCount >= 2, 'Supervisor deve ter sido chamado para planejar e depois para replanejar');
      assert.equal(run.status, 'running', 'Run com plano refinado e aprovado deve transicionar para running');
      const available = AutonomousManager.getAvailableTasks(run.id);
      assert.equal(available.length, 1, 'Worker deve receber a versão refinada com critérios');
      assert.ok(available[0].criteria.length >= 3, 'Critérios de aceitação refinados devem estar presentes na tarefa');
    } finally {
      GeminiSupervisorProvider.prototype.planTasks = originalPlanTasks;
    }
  });

  await t.test('4. Anti-Slop Review Gate: Entrega com testes PASS ainda é reprovada por overengineering / complexidade excessiva', async () => {
    // Cenário: Worker entrega código onde os testes passam no terminal (PASS), mas o diff contém
    // classes, fábricas redundantes e código prolixo desnecessário (Overengineering).
    const bloatedDiff = `
+ class AbstractServiceFactory {
+   static createInstance() { return new ConcreteAdapterProxy(); }
+ }
+ class ConcreteAdapterProxy {
+   execute(a, b) { return a + b; }
+ }
+ exports.add = (a, b) => AbstractServiceFactory.createInstance().execute(a, b);
`;
    const mockPassingEval = {
      taskIsDone: true,
      verdict: 'PASS',
      executedCommands: ['node test/add.test.js'],
      actual: 'Exit Code: 0 (PASS)'
    };

    const deliberation = await CouncilManager.deliberate({
      taskId: 'task-bloated-test',
      projectId: projId,
      task: { title: 'Implementar soma aritmética simples' },
      diff: bloatedDiff,
      filesChanged: ['src/math.js'],
      evaluation: mockPassingEval,
      riskLevel: 'medium',
      policyTrigger: 'POST_EVALUATION_REVIEW'
    });

    // O Conselho DEVE solicitar correções (CHANGES_REQUESTED) mesmo com teste PASS
    assert.equal(deliberation.chairmanVerdict, 'CHANGES_REQUESTED');
    assert.ok(deliberation.scores.simplicity <= 5, 'Nota de simplicidade deve ser rebaixada por overengineering');
    assert.ok(deliberation.chairmanSynthesis.includes('Simplicity Alert') || deliberation.chairmanSynthesis.includes('Overengineering'));
    assert.ok(deliberation.actionItems.some(i => i.includes('classes') || i.includes('redundantes') || i.includes('simples')));
  });

  await t.test('5. Reavaliação Pós-Reparo: Código cirúrgico reparado é aprovado sem carregar reprovação obsoleta', async () => {
    // Cenário: Worker repara o código substituindo a hierarquia de classes por 1 linha simples
    const cleanSurgicalDiff = `+ exports.add = (a, b) => a + b;`;
    const mockPassingEval = {
      taskIsDone: true,
      verdict: 'PASS',
      executedCommands: ['node test/add.test.js'],
      actual: 'Exit Code: 0 (PASS)'
    };

    const deliberation = await CouncilManager.deliberate({
      taskId: 'task-clean-repaired',
      projectId: projId,
      task: { title: 'Implementar soma aritmética simples' },
      diff: cleanSurgicalDiff,
      filesChanged: ['src/math.js'],
      evaluation: mockPassingEval,
      riskLevel: 'low',
      policyTrigger: 'POST_EVALUATION_REVIEW'
    });

    assert.equal(deliberation.chairmanVerdict, 'APPROVED');
    assert.ok(deliberation.scores.simplicity >= 8, 'Código cirúrgico deve ter alta nota de simplicidade');
    assert.ok(deliberation.scores.correctness >= 8);
    assert.ok(deliberation.scores.final >= 8);
  });

  await t.test('6. Pareceres Independentes: Deliberação usa 3 revisores especializados e ranking anônimo', async () => {
    const deliberation = await CouncilManager.deliberate({
      taskId: 'task-multi-reviewer',
      projectId: projId,
      task: { title: 'Verificar integridade multi-revisores' },
      diff: '+ exports.test = true;',
      filesChanged: ['src/test.js'],
      evaluation: { taskIsDone: true, verdict: 'PASS', actual: 'Exit Code: 0 (PASS)' },
      riskLevel: 'high'
    });

    // 3 revisores independentes
    assert.equal(deliberation.reviews.length, 3);
    const roles = deliberation.reviews.map(r => r.roleName);
    assert.ok(roles.includes('Correctness'), 'Revisor A: Corretude Funcional');
    assert.ok(roles.includes('Simplicity'), 'Revisor B: Simplicidade Karpathy');
    assert.ok(roles.includes('Regression'), 'Revisor C: Regressão e Segurança');

    // Revisão por pares anônima (Peer Ranking)
    assert.ok(deliberation.peerRankings.length === 3, 'Cada revisor deve ter classificado anonimamente os pares');
    assert.ok(deliberation.consensusLevel);
  });
});
