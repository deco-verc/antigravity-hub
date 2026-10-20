import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { execFileSync } from 'node:child_process';
import { db, initDatabase } from '../src/db.js';
import { apiRouter } from '../src/routes.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { DevAutonomyService } from '../src/devAutonomyService.js';

initDatabase();

function initGitWorkspace(dir: string) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@decohub.local'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'DecoHUB Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'hierarchical-test-app',
        version: '1.0.0',
        scripts: {
          test: 'node --test test/app.test.cjs'
        }
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.cjs'), 'module.exports = { ready: true };\n', 'utf-8');
  fs.writeFileSync(
    path.join(dir, 'test', 'app.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const app = require('../src/index.cjs');",
      "test('base app ready', () => {",
      "  assert.equal(app.ready, true);",
      "});",
      ""
    ].join('\n'),
    'utf-8'
  );
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: initial workspace setup'], { cwd: dir, stdio: 'pipe' });
}

test('Cenários 1, 2, 3, 4 e 5: Criação de projeto, vinculação com chat, geração e persistência de Grandes Tarefas e Microtarefas, detecção de ciclos e subdivisão de tarefas amplas', async (t) => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-hier-c1-5-'));
  initGitWorkspace(workspaceDir);
  t.after(() => fs.rmSync(workspaceDir, { recursive: true, force: true }));

  const projectId = `proj-hier-${crypto.randomUUID().slice(0, 8)}`;
  const runId = `run-hier-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  // 1. Criação de projeto e vinculação com o chat
  db.prepare(
    `INSERT INTO projects (id, name, path, objective, description, status, created_at, updated_at)
     VALUES (?, 'Projeto Hierárquico C1', ?, 'Construir sistema modular', 'Descrição original do usuário no chat', 'active', ?, ?)`
  ).run(projectId, workspaceDir, now, now);

  const chatMsgId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO messages (id, project_id, role, content, created_at)
     VALUES (?, ?, 'user', 'Quero um sistema com módulo base, API e validação integrada.', ?)`
  ).run(chatMsgId, projectId, now);

  db.prepare(
    `INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at)
     VALUES (?, ?, 'Run Hierárquico C1', 'Construir sistema modular', 'Quero um sistema com módulo base, API e validação integrada.', 'running', ?, ?, ?)`
  ).run(runId, projectId, now, now, now);

  // 4. Detecção de dependências circulares (teste negativo obrigatório)
  const circularCheck = HierarchicalOrchestrationService.detectCircularDependencies([
    { id: 't1', code: '1.1', title: 'Tarefa A', dependencies: ['1.2'] },
    { id: 't2', code: '1.2', title: 'Tarefa B', dependencies: ['1.1'] }
  ]);
  assert.equal(circularCheck.hasCycle, true, 'Cenário 4: Deve detectar dependência circular A <-> B');
  assert.ok(circularCheck.cyclePath.length >= 2);

  // Deve recusar persistência de plano com ciclo
  assert.throws(
    () =>
      HierarchicalOrchestrationService.persistHierarchicalPlan({
        projectId,
        runId,
        projectPath: workspaceDir,
        originalDescription: 'Plano com ciclo',
        majorTasks: [
          {
            code: 'GT-1',
            title: 'Grande Tarefa Circular',
            objective: 'Testar erro de ciclo',
            expectedOutcome: 'Erro',
            microtasks: [
              { code: '1.1', title: 'Micro A', description: 'A', criteria: ['C1'], dependencies: ['1.2'] },
              { code: '1.2', title: 'Micro B', description: 'B', criteria: ['C2'], dependencies: ['1.1'] }
            ]
          }
        ]
      }),
    /CIRCULAR_DEPENDENCY_DETECTED/,
    'Cenário 4: Persistência deve rejeitar plano com dependência circular'
  );

  // Deve recusar microtarefas vagas quando strictVagueCheck está ativo
  assert.throws(
    () =>
      HierarchicalOrchestrationService.validateAndSubdivideMicrotasks(
        [{ title: 'continuar desenvolvimento', description: 'vago', criteria: [] }],
        { strictVagueCheck: true }
      ),
    /VAGUE_MICROTASKS_REJECTED/,
    'Deve rejeitar microtarefa vaga sem critérios objetivos'
  );

  // 5. Subdivisão automática de tarefa excessivamente ampla (>5 critérios ou >6 arquivos)
  const oversizedTasks = HierarchicalOrchestrationService.validateAndSubdivideMicrotasks(
    [
      {
        title: 'Implementar Super Módulo Completo',
        description: 'Módulo grande demais para uma revisão única',
        criteria: ['Crit 1', 'Crit 2', 'Crit 3', 'Crit 4', 'Crit 5', 'Crit 6'],
        allowedScope: ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']
      }
    ],
    { subdivideOversized: true }
  );
  assert.equal(oversizedTasks.length, 2, 'Cenário 5: Tarefa excessivamente ampla deve ser subdividida em 2 microtarefas');
  assert.match(oversizedTasks[0].title, /Parte 1/);
  assert.match(oversizedTasks[1].title, /Parte 2/);
  assert.deepEqual(oversizedTasks[1].dependencies, [oversizedTasks[0].title]);

  // 2 & 3. Geração e persistência de Grandes Tarefas e Microtarefas com dependências e critérios
  const persisted = HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId,
    runId,
    projectPath: workspaceDir,
    originalDescription: 'Quero um sistema com módulo base, API e validação integrada.',
    requirements: ['REQ-1: Base de dados e domínio', 'REQ-2: Serviços e integração'],
    successCriteria: ['Todos os testes automatizados passando', 'Commits vinculados por microtarefa'],
    majorTasks: [
      {
        code: 'GT-1',
        title: 'Construir a base do aplicativo',
        objective: 'Configurar estrutura e modelo de dados',
        expectedOutcome: 'Base estruturada e testada',
        requirements: ['REQ-1: Base de dados e domínio'],
        acceptanceCriteria: ['Modelo de dados exportado e validado'],
        dependencies: [],
        microtasks: [
          {
            code: '1.1',
            title: 'Configurar estrutura inicial',
            objective: 'Garantir exportação inicial em src/index.cjs',
            description: 'Configurar módulo base src/index.cjs',
            allowedScope: ['src/index.cjs', 'test/app.test.cjs'],
            criteria: ['src/index.cjs exporta ready = true'],
            verificationCommand: 'npm test',
            dependencies: []
          },
          {
            code: '1.2',
            title: 'Implementar serviço de cálculo',
            objective: 'Criar função calcBalance em src/index.cjs',
            description: 'Adicionar cálculo de saldo em src/index.cjs',
            allowedScope: ['src/index.cjs', 'test/app.test.cjs'],
            criteria: ['calcBalance(100, 40) retorna 60'],
            verificationCommand: 'npm test',
            dependencies: ['1.1']
          }
        ]
      },
      {
        code: 'GT-2',
        title: 'Validar integração final',
        objective: 'Garantir funcionamento integrado',
        expectedOutcome: 'Suite integrada aprovada',
        requirements: ['REQ-2: Serviços e integração'],
        acceptanceCriteria: ['Integração testada de ponta a ponta'],
        dependencies: ['GT-1'],
        microtasks: [
          {
            code: '2.1',
            title: 'Criar testes de integração',
            objective: 'Validar fluxo completo no teste',
            description: 'Adicionar teste integrado em test/app.test.cjs',
            allowedScope: ['test/app.test.cjs'],
            criteria: ['Teste integrado executa com sucesso'],
            verificationCommand: 'npm test',
            dependencies: ['1.2']
          }
        ]
      }
    ]
  });

  assert.equal(persisted.majorTasks.length, 2, 'Cenário 2: Deve persistir 2 Grandes Tarefas');
  assert.equal(persisted.microtasks.length, 3, 'Cenário 3: Deve persistir 3 Microtarefas subordinadas');
  assert.equal(persisted.majorTasks[0].microtasks.length, 2);
  assert.equal(persisted.majorTasks[1].microtasks.length, 1);

  // Verify project link to active_run_id
  const projectRow: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  assert.equal(projectRow.active_run_id, runId, 'Cenário 1: Projeto deve estar vinculado ao plano de execução');
});

test('Cenários 6 a 22: Seleção elegível, contrato do Worker, estados, bloqueio de autoaprovação, Review independente (APPROVED/REJECTED/BLOCKED), retrabalho, commit pós-aprovação, falha de commit, avanço de Grande Tarefa e validação final', async (t) => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-hier-c6-22-'));
  initGitWorkspace(workspaceDir);
  t.after(() => fs.rmSync(workspaceDir, { recursive: true, force: true }));

  const projectId = `proj-hier-${crypto.randomUUID().slice(0, 8)}`;
  const runId = `run-hier-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO projects (id, name, path, objective, description, status, is_trusted, full_dev_autonomy, created_at, updated_at)
     VALUES (?, 'Projeto Hierárquico C6-22', ?, 'Construir motor financeiro verificável', 'Motor financeiro com validação independente', 'active', 1, 1, ?, ?)`
  ).run(projectId, workspaceDir, now, now);

  db.prepare(
    `INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at)
     VALUES (?, ?, 'Run C6-22', 'Construir motor financeiro verificável', 'Motor financeiro com validação independente', 'running', ?, ?, ?)`
  ).run(runId, projectId, now, now, now);

  const plan = HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId,
    runId,
    projectPath: workspaceDir,
    originalDescription: 'Motor financeiro com validação independente',
    majorTasks: [
      {
        code: 'GT-1',
        title: 'Base Financeira',
        objective: 'Implementar cálculo e validação',
        expectedOutcome: 'Módulo base aprovado e commitado',
        microtasks: [
          {
            code: '1.1',
            title: 'Implementar ledger básico',
            objective: 'Criar src/ledger.cjs com cálculo de saldo',
            description: 'Criar arquivo src/ledger.cjs exportando computeSaldo(receitas, despesas)',
            allowedScope: ['src/ledger.cjs', 'test/app.test.cjs'],
            criteria: [
              'Arquivo src/ledger.cjs criado no escopo',
              'computeSaldo(500, 200) retorna 300 nos testes'
            ],
            verificationCommand: 'npm test',
            dependencies: []
          },
          {
            code: '1.2',
            title: 'Implementar resumo por categoria',
            objective: 'Adicionar groupByCategory em src/ledger.cjs',
            description: 'Agrupar lançamentos por categoria em src/ledger.cjs',
            allowedScope: ['src/ledger.cjs', 'test/app.test.cjs'],
            criteria: [
              'groupByCategory soma valores por categoria corretamente'
            ],
            verificationCommand: 'npm test',
            dependencies: ['1.1']
          }
        ]
      }
    ]
  });

  const task1 = plan.microtasks[0];
  const task2 = plan.microtasks[1];

  // Cenário 6: Seleção correta da primeira microtarefa elegível (apenas 1.1 está READY; 1.2 depende de 1.1 e está PLANNED)
  const availableInitial = AutonomousManager.getAvailableTasks(runId);
  assert.equal(availableInitial.length, 1, 'Cenário 6: Apenas a microtarefa 1.1 sem dependências pendentes deve estar disponível');
  assert.equal(availableInitial[0].id, task1.id);

  // Cenário 22 (parte 1): Transições inválidas devem ser recusadas no backend
  assert.throws(
    () =>
      HierarchicalOrchestrationService.transitionTaskState({
        taskId: task2.id, // PLANNED
        toState: 'COMPLETED',
        actor: 'supervisor',
        reason: 'Tentativa ilegal de pular direto para COMPLETED'
      }),
    /INVALID_STATE_TRANSITION/,
    'Cenário 22: Não pode transicionar de PLANNED direto para COMPLETED'
  );

  // Cenário 7: Envio de contrato completo para o Worker e transição READY -> IN_PROGRESS
  AutonomousManager.claimTask(task1.id, 'worker-1');
  const contract1 = HierarchicalOrchestrationService.buildWorkerExecutionContract(runId, task1.id);
  assert.equal(contract1.taskId, task1.id, 'Cenário 7: Contrato deve conter ID da microtarefa');
  assert.equal(contract1.code, '1.1');
  assert.equal(contract1.criteria.length, 2);
  assert.ok(Array.isArray(contract1.allowedScope));
  assert.equal(contract1.verificationCommand, 'npm test');

  const task1AfterClaim: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(task1.id);
  assert.equal(task1AfterClaim.status, 'in_progress');
  assert.equal(task1AfterClaim.lifecycle_state, 'IN_PROGRESS');

  // Cenário 9: Impossibilidade de o Worker aprovar ou concluir a própria tarefa
  assert.throws(
    () =>
      HierarchicalOrchestrationService.transitionTaskState({
        taskId: task1.id,
        toState: 'APPROVED',
        actor: 'worker',
        reason: 'Worker tentando se autoaprovar'
      }),
    /WORKER_SELF_APPROVAL_FORBIDDEN/,
    'Cenário 9: Worker jamais pode aprovar a própria tarefa'
  );
  assert.throws(
    () =>
      HierarchicalOrchestrationService.transitionTaskState({
        taskId: task1.id,
        toState: 'COMPLETED',
        actor: 'worker',
        reason: 'Worker tentando concluir a própria tarefa'
      }),
    /WORKER_SELF_APPROVAL_FORBIDDEN/,
    'Cenário 9: Worker jamais pode concluir a própria tarefa'
  );

  // Cenário 8 & 10 & 11: Worker registra execução com placeholder/TODO -> vai para REVIEW_PENDING (não COMPLETED) e Review REPROVA (REJECTED)
  fs.writeFileSync(
    path.join(workspaceDir, 'src', 'ledger.cjs'),
    '// TODO: implement later\nmodule.exports = { computeSaldo: () => 0 };\n',
    'utf-8'
  );

  const reportAttempt1 = AutonomousManager.submitBuilderReport({
    runId,
    taskId: task1.id,
    status: 'success',
    filesChanged: ['src/ledger.cjs'],
    implemented: ['Criado stub de ledger.cjs'],
    testsRun: 'npm test',
    testResults: '1 passing'
  });
  assert.equal(reportAttempt1.taskStatus, 'in_review', 'Cenário 8: Relatório do Worker deve deixar tarefa em REVIEW_PENDING (in_review), nunca COMPLETED');

  const indepEvalAttempt1 = await IndependentEvaluator.evaluate(task1.contract_id, workspaceDir, {
    status: 'success',
    filesChanged: ['src/ledger.cjs'],
    implemented: ['Criado stub de ledger.cjs']
  });

  // Review avalia independentemente e detecta placeholder '// TODO: implement later'
  const reviewAttempt1 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: task1.id,
    verdict: 'CHANGES_REQUESTED',
    feedback: 'Reprovado: src/ledger.cjs contém placeholder TODO e retorna valor fixo 0.',
    criteriaMet: ['Arquivo src/ledger.cjs criado no escopo'],
    criteriaFailed: ['computeSaldo(500, 200) retorna 300 nos testes'],
    issuesFound: ['Placeholder TODO detectado em src/ledger.cjs'],
    nextAction: 'Implementar cálculo real computeSaldo(r, d) = r - d e adicionar teste real',
    evaluation: indepEvalAttempt1
  });

  assert.equal(reviewAttempt1.reviewDecision.decision, 'REJECTED', 'Cenário 10 & 11: Review deve produzir decisão REJECTED quando há placeholder ou critério não atendido');
  const task1AfterReject: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(task1.id);
  assert.equal(task1AfterReject.lifecycle_state, 'REWORK_REQUIRED', 'Cenário 11: Estado deve ir para REWORK_REQUIRED após reprovação');
  assert.equal(task1AfterReject.retry_count, 1);

  // Cenário 18 (parte 1): Tarefa 1.2 NÃO pode ser liberada enquanto 1.1 foi reprovada
  const availableAfterReject = AutonomousManager.getAvailableTasks(runId);
  assert.equal(availableAfterReject.some((t: any) => t.id === task2.id), false, 'Cenário 18: Microtarefa dependente 1.2 deve continuar bloqueada');
  assert.equal(availableAfterReject[0].id, task1.id, 'Microtarefa 1.1 em REWORK_REQUIRED é disponibilizada para retrabalho');

  // Cenário 12: Retorno para retrabalho com contexto e instruções de correção do Review/Supervisor
  AutonomousManager.claimTask(task1.id, 'worker-1');
  const reworkContract = HierarchicalOrchestrationService.buildWorkerExecutionContract(runId, task1.id);
  assert.ok(reworkContract.reworkContext, 'Cenário 12: Contrato de retrabalho deve incluir reworkContext com motivos da reprovação');
  assert.equal(reworkContract.reworkContext?.previousDecision, 'REJECTED');
  assert.equal(reworkContract.reworkInstructions?.isRework, true, 'Cenário 12: Contrato deve conter instruções estruturadas de retrabalho');
  assert.ok((reworkContract.reworkInstructions?.previousRejectionReasons || []).length > 0);

  // Cenário 13: Bloqueio (BLOCKED) quando há impedimento de infraestrutura/evidência
  const blockedDecision = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
    runId,
    taskId: task1.id,
    projectPath: workspaceDir,
    workerReport: {
      status: 'blocked',
      filesChanged: [],
      implemented: []
    },
    independentEvaluation: {
      verdict: 'BLOCKED',
      taskIsDone: false,
      actual: 'Infraestrutura de verificação indisponível no momento',
      reasons: ['Ambiente bloqueado']
    } as any
  });
  assert.equal(blockedDecision.decision, 'BLOCKED', 'Cenário 13: Review deve produzir BLOCKED quando a avaliação não puder ser concluída por falta de infraestrutura/evidência');

  // Agora o Worker executa a implementação real e limpa de 1.1 e adiciona o teste correspondente
  fs.writeFileSync(
    path.join(workspaceDir, 'src', 'ledger.cjs'),
    [
      'function computeSaldo(receitas, despesas) {',
      '  return Number(receitas || 0) - Number(despesas || 0);',
      '}',
      'module.exports = { computeSaldo };',
      ''
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(workspaceDir, 'test', 'app.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const app = require('../src/index.cjs');",
      "const { computeSaldo } = require('../src/ledger.cjs');",
      "test('base app ready and computeSaldo', () => {",
      "  assert.equal(app.ready, true);",
      "  assert.equal(computeSaldo(500, 200), 300);",
      "});",
      ""
    ].join('\n'),
    'utf-8'
  );

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: task1.id,
    status: 'success',
    filesChanged: ['src/ledger.cjs', 'test/app.test.cjs'],
    implemented: ['Implementado computeSaldo real em src/ledger.cjs e teste unitário'],
    testsRun: 'npm test',
    testResults: '1 passing'
  });

  const indepEvalAttempt2 = await IndependentEvaluator.evaluate(task1.contract_id, workspaceDir, {
    status: 'success',
    filesChanged: ['src/ledger.cjs', 'test/app.test.cjs'],
    implemented: ['Implementado computeSaldo real em src/ledger.cjs e teste unitário']
  });
  assert.equal(indepEvalAttempt2.verdict, 'PASS');

  // Cenário 16: Verificar que ANTES da aprovação do Review nenhum commit da tarefa 1.1 foi criado
  const gitLogBeforeReview = execFileSync('git', ['log', '--oneline'], { cwd: workspaceDir, encoding: 'utf-8' }).trim().split('\n');
  assert.equal(gitLogBeforeReview.length, 1, 'Cenário 16: Nenhum commit deve existir antes da aprovação do Review');

  // Cenários 14 e 15: Aprovação pelo Review com evidências reais + criação de commit APÓS aprovação
  const reviewAttempt2 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: task1.id,
    verdict: 'APPROVED',
    feedback: 'Critérios verificados independentemente e testes passando.',
    criteriaMet: [
      'Arquivo src/ledger.cjs criado no escopo',
      'computeSaldo(500, 200) retorna 300 nos testes'
    ],
    criteriaFailed: [],
    evaluation: indepEvalAttempt2
  });

  assert.equal(reviewAttempt2.reviewDecision.decision, 'APPROVED', 'Cenário 14: Review aprova com evidências reais');
  assert.equal(reviewAttempt2.commitGate?.committed, true, 'Cenário 15: Commit criado automaticamente após aprovação do Review');
  assert.ok(reviewAttempt2.commitGate?.commitSha, 'Cenário 15: Hash do commit deve estar preenchido');

  const task1Completed: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(task1.id);
  assert.equal(task1Completed.status, 'completed');
  assert.equal(task1Completed.lifecycle_state, 'COMPLETED');
  assert.equal(task1Completed.task_commit_sha, reviewAttempt2.commitGate?.commitSha);

  // Verificar no git log real que o commit referencia a microtarefa [1.1]
  const gitLogAfterTask1 = execFileSync('git', ['log', '-n', '1', '--pretty=%B'], { cwd: workspaceDir, encoding: 'utf-8' }).trim();
  assert.match(gitLogAfterTask1, /\[1\.1\]/, 'Cenário 15: Mensagem do commit deve identificar a microtarefa [1.1]');

  // Cenário 18 (parte 2): Liberação da próxima microtarefa (1.2) após conclusão completa de 1.1
  const availableAfterTask1 = AutonomousManager.getAvailableTasks(runId);
  assert.equal(availableAfterTask1.length, 1, 'Cenário 18: Microtarefa 1.2 deve ser liberada somente após conclusão e commit de 1.1');
  assert.equal(availableAfterTask1[0].id, task2.id);

  // Cenário 21 (parte 1): Validação final deve IMPEDIR conclusão do projeto enquanto 1.2 está pendente
  const prematureValidation = HierarchicalOrchestrationService.validateProjectFinalCompletion(runId);
  assert.equal(prematureValidation.canCompleteProject, false, 'Cenário 21: Não deve concluir projeto com microtarefa pendente');
  assert.ok(prematureValidation.blockingReasons.length > 0);

  // Cenário 17: Tratamento de falha de commit (quando requireCodeChanges = true mas nenhum arquivo de código foi alterado)
  AutonomousManager.claimTask(task2.id, 'worker-1');
  AutonomousManager.submitBuilderReport({
    runId,
    taskId: task2.id,
    status: 'success',
    filesChanged: [],
    implemented: ['Nada alterado em disco']
  });
  HierarchicalOrchestrationService.transitionTaskState({
    taskId: task2.id,
    toState: 'APPROVED',
    actor: 'review',
    reason: 'Simulando aprovação para testar falha de commit sem alterações em disco'
  });
  const failedCommitGate = HierarchicalOrchestrationService.executePostReviewCommitGate({
    runId,
    taskId: task2.id,
    projectPath: workspaceDir,
    filesChanged: [],
    requireCodeChanges: true
  });
  assert.equal(failedCommitGate.committed, false, 'Cenário 17: Commit deve falhar quando requireCodeChanges=true e não há mudanças de código');
  const task2AfterFailedCommit: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(task2.id);
  assert.equal(task2AfterFailedCommit.lifecycle_state, 'BLOCKED', 'Cenário 17: Falha no commit deve bloquear a tarefa e impedir COMPLETED');

  // Desbloquear 1.2 com resolução registrada e executar implementação real de 1.2
  HierarchicalOrchestrationService.transitionTaskState({
    taskId: task2.id,
    toState: 'IN_PROGRESS',
    actor: 'supervisor',
    reason: 'Desbloqueando 1.2 para escrever código real em src/ledger.cjs',
    metadata: { blockResolution: 'Worker irá escrever groupByCategory em src/ledger.cjs' }
  });

  fs.writeFileSync(
    path.join(workspaceDir, 'src', 'ledger.cjs'),
    [
      'function computeSaldo(receitas, despesas) {',
      '  return Number(receitas || 0) - Number(despesas || 0);',
      '}',
      'function groupByCategory(items) {',
      '  return (items || []).reduce((acc, item) => {',
      '    const cat = item.category || "Outros";',
      '    acc[cat] = (acc[cat] || 0) + Number(item.amount || 0);',
      '    return acc;',
      '  }, {});',
      '}',
      'module.exports = { computeSaldo, groupByCategory };',
      ''
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(workspaceDir, 'test', 'app.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const app = require('../src/index.cjs');",
      "const { computeSaldo, groupByCategory } = require('../src/ledger.cjs');",
      "test('base app ready, computeSaldo and groupByCategory', () => {",
      "  assert.equal(app.ready, true);",
      "  assert.equal(computeSaldo(500, 200), 300);",
      "  assert.deepEqual(groupByCategory([{ category: 'Salário', amount: 1000 }, { category: 'Salário', amount: 500 }]), { 'Salário': 1500 });",
      "});",
      ""
    ].join('\n'),
    'utf-8'
  );

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: task2.id,
    status: 'success',
    filesChanged: ['src/ledger.cjs', 'test/app.test.cjs'],
    implemented: ['Implementado groupByCategory em src/ledger.cjs']
  });

  const indepEvalTask2 = await IndependentEvaluator.evaluate(task2.contract_id, workspaceDir, {
    status: 'success',
    filesChanged: ['src/ledger.cjs', 'test/app.test.cjs'],
    implemented: ['Implementado groupByCategory em src/ledger.cjs']
  });

  const reviewTask2 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: task2.id,
    verdict: 'APPROVED',
    feedback: 'groupByCategory verificado com sucesso.',
    criteriaMet: ['groupByCategory soma valores por categoria corretamente'],
    criteriaFailed: [],
    evaluation: indepEvalTask2
  });
  assert.equal(reviewTask2.commitGate?.committed, true);

  // Cenário 19: Conclusão de Grande Tarefa quando todas as suas microtarefas terminam
  const majorTasksAfter = HierarchicalOrchestrationService.getMajorTasksForRun(runId);
  assert.equal(majorTasksAfter[0].lifecycle_state, 'COMPLETED', 'Cenário 19: Grande Tarefa GT-1 deve ser calculada como COMPLETED quando 1.1 e 1.2 concluírem');
  assert.equal(majorTasksAfter[0].progressPct, 100);

  // Cenário 20: Conclusão do projeto somente quando todas as Grandes Tarefas terminam e validação final aprova
  const finalValidation = HierarchicalOrchestrationService.validateProjectFinalCompletion(runId);
  assert.equal(finalValidation.canCompleteProject, true, 'Cenário 20: Validação final deve aprovar quando todas as Grandes Tarefas e Microtarefas estão concluídas e commitadas');
  assert.equal(finalValidation.allMajorTasksCompleted, true);
  assert.equal(finalValidation.allMicrotasksCompleted, true);
  assert.equal(finalValidation.allCommitsVerified, true);
});

test('Cenários 23, 24 e Robustez: Replanejamento por mudança de requisitos preservando tarefas concluídas, idempotência de mensagens concorrentes e recuperação após reinício', async (t) => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-hier-c23-24-'));
  initGitWorkspace(workspaceDir);
  t.after(() => fs.rmSync(workspaceDir, { recursive: true, force: true }));

  const projectId = `proj-hier-${crypto.randomUUID().slice(0, 8)}`;
  const runId = `run-hier-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO projects (id, name, path, objective, description, status, is_trusted, full_dev_autonomy, created_at, updated_at)
     VALUES (?, 'Projeto Replan C23-24', ?, 'App Financeiro', 'App Financeiro Inicial', 'active', 1, 1, ?, ?)`
  ).run(projectId, workspaceDir, now, now);

  db.prepare(
    `INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at)
     VALUES (?, ?, 'Run Replan C23-24', 'App Financeiro', 'App Financeiro Inicial', 'running', ?, ?, ?)`
  ).run(runId, projectId, now, now, now);

  const initialPlan = HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId,
    runId,
    projectPath: workspaceDir,
    originalDescription: 'App Financeiro Inicial',
    majorTasks: [
      {
        code: 'GT-1',
        title: 'Base do App',
        objective: 'Criar módulo inicial',
        expectedOutcome: 'Módulo inicial pronto',
        microtasks: [
          {
            code: '1.1',
            title: 'Criar módulo inicial',
            objective: 'Garantir exportação inicial',
            description: 'Manter src/index.cjs funcional',
            allowedScope: ['src/index.cjs'],
            criteria: ['src/index.cjs exporta ready = true'],
            verificationCommand: 'npm test',
            dependencies: []
          }
        ]
      }
    ]
  });

  const t1 = initialPlan.microtasks[0];
  AutonomousManager.claimTask(t1.id, 'worker-1');
  fs.writeFileSync(path.join(workspaceDir, 'src', 'index.cjs'), 'module.exports = { ready: true, version: 1 };\n', 'utf-8');
  AutonomousManager.submitBuilderReport({
    runId,
    taskId: t1.id,
    status: 'success',
    filesChanged: ['src/index.cjs'],
    implemented: ['Adicionado version: 1 em src/index.cjs']
  });
  const evalT1 = await IndependentEvaluator.evaluate(t1.contract_id, workspaceDir, {
    status: 'success',
    filesChanged: ['src/index.cjs'],
    implemented: ['Adicionado version: 1 em src/index.cjs']
  });
  const revT1 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: t1.id,
    verdict: 'APPROVED',
    feedback: 'Módulo inicial aprovado.',
    criteriaMet: ['src/index.cjs exporta ready = true'],
    criteriaFailed: [],
    evaluation: evalT1
  });
  const originalCommitSha = revT1.commitGate?.commitSha;
  assert.ok(originalCommitSha, 'Tarefa 1.1 deve ter commit registrado antes do replanejamento');

  // Cenário 23 & 24: Replanejamento por mudança de requisito (NEW_FEATURE e DEFECT_FIX) preservando tarefas concluídas
  const replanFeature = HierarchicalOrchestrationService.replanRunForRequirementChange({
    runId,
    instruction: 'Adicionar exportação de relatório mensal em JSON',
    changeType: 'NEW_FEATURE'
  });

  assert.equal(replanFeature.classification, 'NEW_FEATURE');
  assert.equal(replanFeature.preservedCompletedCount, 1, 'Cenário 24: Tarefa concluída deve ser preservada');
  assert.equal(replanFeature.addedMicrotasks.length, 1, 'Cenário 23: Nova microtarefa deve ser adicionada ao plano');

  // Verificar que a tarefa 1.1 concluída NÃO foi sobrescrita nem perdeu seu commit
  const preservedTask1: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(t1.id);
  assert.equal(preservedTask1.status, 'completed', 'Cenário 24: Tarefa 1.1 permanece completed');
  assert.equal(preservedTask1.lifecycle_state, 'COMPLETED');
  assert.equal(preservedTask1.task_commit_sha, originalCommitSha, 'Cenário 24: Commit SHA da tarefa 1.1 permanece intacto');

  // Replanejamento do tipo DEFECT_FIX deve referenciar a tarefa concluída original sem apagá-la
  const replanDefect = HierarchicalOrchestrationService.replanRunForRequirementChange({
    runId,
    instruction: 'Corrigir arredondamento decimal no módulo inicial',
    changeType: 'DEFECT_FIX',
    originTaskId: t1.id
  });
  assert.equal(replanDefect.classification, 'DEFECT_FIX');
  assert.equal(replanDefect.addedMicrotasks[0].replan_origin_task_id, t1.id, 'Cenário 24: Correção de defeito referencia a tarefa original concluída');

  // Teste de idempotência contra duplicação de mensagens concorrentes entre agentes
  const idempKey = `comm-test-idemp-${crypto.randomUUID()}`;
  const comm1 = HierarchicalOrchestrationService.recordAgentCommunication({
    idempotencyKey: idempKey,
    projectId,
    runId,
    microTaskId: t1.id,
    fromAgent: 'supervisor',
    toAgent: 'worker',
    messageType: 'TASK_ASSIGNED',
    content: 'Atribuição idempotente'
  });
  const comm2 = HierarchicalOrchestrationService.recordAgentCommunication({
    idempotencyKey: idempKey,
    projectId,
    runId,
    microTaskId: t1.id,
    fromAgent: 'supervisor',
    toAgent: 'worker',
    messageType: 'TASK_ASSIGNED',
    content: 'Atribuição idempotente duplicada'
  });
  assert.equal(comm1.duplicate, false);
  assert.equal(comm2.duplicate, true, 'Mensagens com mesma idempotencyKey não devem duplicar registros');
  assert.equal(comm1.id, comm2.id);

  // Recuperação após reinício do backend: reconsultar estado completo do Run a partir do SQLite
  const recoveredRun = AutonomousManager.getRun(runId);
  assert.equal(recoveredRun.planVersion, 3);
  assert.equal(recoveredRun.tasks.length, 3);
  assert.ok(recoveredRun.majorTasks.length >= 2);
  assert.ok(recoveredRun.stateTransitions.length >= 4);
  assert.ok(recoveredRun.agentCommunications.length >= 3);
});

test('Homologação de Ponta a Ponta (Seção 12): Projeto Financeiro Isolado com Grandes Tarefas, Microtarefas, Reprovação/Retrabalho do Review, Commits Pós-Aprovação e Mudança de Requisito', async (t) => {
  const baseTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-homologacao-e2e-'));
  const targetFolder = path.join(baseTempDir, 'app-financeiro-homologacao');
  t.after(() => fs.rmSync(baseTempDir, { recursive: true, force: true }));

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  // 1. Criar projeto de teste isolado via API oficial POST /api/projects
  const createProjRes = await fetch(`${baseUrl}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'App Financeiro Homologação E2E',
      folderPath: targetFolder,
      objective: 'Quero um aplicativo financeiro com painel de resumo, cadastro de receitas e despesas, categorias e saldo calculado automaticamente.',
      description: 'Homologação ponta a ponta da orquestração hierárquica autônoma',
      initGit: true
    })
  });
  assert.equal(createProjRes.status, 201, '1. Projeto de homologação deve ser criado com status 201');
  const project: any = await createProjRes.json();
  assert.ok(project.id);
  DevAutonomyService.setProjectAutonomy(project.id, true, true);

  // Preparar package.json para rodar node --test no repositório isolado
  fs.writeFileSync(
    path.join(targetFolder, 'package.json'),
    JSON.stringify(
      {
        name: 'app-financeiro-homologacao',
        version: '1.0.0',
        scripts: {
          test: 'node --test test/finance.test.cjs'
        }
      },
      null,
      2
    ),
    'utf-8'
  );
  execFileSync('git', ['add', 'package.json'], { cwd: targetFolder, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: configure test runner script'], { cwd: targetFolder, stdio: 'pipe' });

  // 2. Enviar requisito inicial pelo chat do projeto e criar Run Hierárquico
  const now = new Date().toISOString();
  const runId = `run-homolog-${crypto.randomUUID().slice(0, 8)}`;
  const promptInicial =
    'Quero um aplicativo financeiro com painel de resumo, cadastro de receitas e despesas, categorias e saldo calculado automaticamente.';

  db.prepare(
    `INSERT INTO messages (id, project_id, role, content, created_at)
     VALUES (?, ?, 'user', ?, ?)`
  ).run(crypto.randomUUID(), project.id, promptInicial, now);

  db.prepare(
    `INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, autonomy_mode, branch_name, start_time, created_at, updated_at)
     VALUES (?, ?, 'Homologação App Financeiro', ?, ?, 'running', 'autonomous', 'main', ?, ?, ?)`
  ).run(runId, project.id, promptInicial, promptInicial, now, now, now);

  // 3. Supervisor gera e persiste plano hierárquico com Grandes Tarefas e Microtarefas
  const hierarchy = HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId: project.id,
    runId,
    projectPath: targetFolder,
    originalDescription: promptInicial,
    requirements: [
      'REQ-1: Cadastro de receitas e despesas com validação e categorias',
      'REQ-2: Cálculo automático de saldo (receitas - despesas) e resumo por categoria',
      'REQ-3: Painel de resumo HTML interativo integrado ao modelo financeiro',
      'REQ-4: Suite de testes de integração validando todos os critérios'
    ],
    successCriteria: [
      'Todas as Grandes Tarefas e Microtarefas aprovadas pelo Review independente',
      'Commits individuais gerados pós-aprovação para cada microtarefa',
      'Replanejamento de mudança de requisito executado sem perda de trabalho concluído'
    ],
    majorTasks: [
      {
        code: 'GT-1',
        title: 'Construir a base e motor financeiro',
        objective: 'Implementar modelo de lançamentos (receitas/despesas), categorias e cálculo automático de saldo',
        expectedOutcome: 'Módulo src/financeEngine.cjs funcional e testado',
        requirements: [
          'REQ-1: Cadastro de receitas e despesas com validação e categorias',
          'REQ-2: Cálculo automático de saldo (receitas - despesas) e resumo por categoria'
        ],
        acceptanceCriteria: [
          'Lançamentos de receita e despesa cadastrados com categoria',
          'Saldo calculado automaticamente como totalReceitas - totalDespesas'
        ],
        dependencies: [],
        microtasks: [
          {
            code: '1.1',
            title: 'Implementar motor de receitas, despesas, categorias e saldo',
            objective: 'Criar src/financeEngine.cjs com addTransaction e getSummary',
            description: 'Implementar cadastro de receitas e despesas por categoria e cálculo automático de saldo em src/financeEngine.cjs',
            allowedScope: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
            criteria: [
              'addTransaction registra receitas e despesas com categoria',
              'getSummary calcula totalIncome, totalExpense, balance e byCategory automaticamente'
            ],
            verificationCommand: 'npm test',
            dependencies: []
          }
        ]
      },
      {
        code: 'GT-2',
        title: 'Construir o painel de resumo e interface',
        objective: 'Criar o painel de resumo visual HTML e formulário de lançamento',
        expectedOutcome: 'Interface src/dashboard.html e renderizador src/dashboardView.cjs funcionais',
        requirements: ['REQ-3: Painel de resumo HTML interativo integrado ao modelo financeiro'],
        acceptanceCriteria: ['Painel de resumo exibe receitas, despesas, categorias e saldo calculado'],
        dependencies: ['GT-1'],
        microtasks: [
          {
            code: '2.1',
            title: 'Criar painel de resumo e formulário de lançamento',
            objective: 'Implementar src/dashboardView.cjs e src/dashboard.html',
            description: 'Criar gerador do painel de resumo HTML com cards de receitas, despesas, categorias e saldo',
            allowedScope: ['src/dashboardView.cjs', 'src/dashboard.html', 'test/finance.test.cjs'],
            criteria: [
              'renderDashboardSummary gera HTML com total de receitas, despesas, categorias e saldo',
              'Arquivo src/dashboard.html contém estrutura do painel de resumo e formulário'
            ],
            verificationCommand: 'npm test',
            dependencies: ['1.1']
          }
        ]
      }
    ]
  });

  assert.equal(hierarchy.majorTasks.length, 2, 'Plano hierárquico inicial possui 2 Grandes Tarefas (GT-1 e GT-2)');
  assert.equal(hierarchy.microtasks.length, 2, 'Plano hierárquico inicial possui 2 Microtarefas (1.1 e 2.1)');

  const mt1_1 = hierarchy.microtasks[0];
  const mt2_1 = hierarchy.microtasks[1];

  // 4. Executar Microtarefa 1.1:
  // Na Tentativa #1, o Worker entrega implementação com bug/placeholder -> Review REPROVA -> Worker corrige na Tentativa #2 -> Review APROVA -> Commit criado
  AutonomousManager.claimTask(mt1_1.id, 'worker-homolog-1');
  fs.mkdirSync(path.join(targetFolder, 'src'), { recursive: true });
  fs.mkdirSync(path.join(targetFolder, 'test'), { recursive: true });

  // Tentativa #1 (defeituosa com TODO placeholder)
  fs.writeFileSync(
    path.join(targetFolder, 'src', 'financeEngine.cjs'),
    '// TODO: implementar cálculo real de saldo\nmodule.exports = { createFinanceStore: () => ({}) };\n',
    'utf-8'
  );
  fs.writeFileSync(
    path.join(targetFolder, 'test', 'finance.test.cjs'),
    "const test = require('node:test');\ntest('placeholder', () => {});\n",
    'utf-8'
  );

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: mt1_1.id,
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
    implemented: ['Tentativa 1 com stub incompleto']
  });

  const eval1_Attempt1 = await IndependentEvaluator.evaluate(mt1_1.contract_id, targetFolder, {
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
    implemented: ['Tentativa 1 com stub incompleto']
  });

  const review1_Attempt1 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: mt1_1.id,
    verdict: 'CHANGES_REQUESTED',
    feedback: 'Reprovado pelo Review: src/financeEngine.cjs contém placeholder TODO e não calcula saldo nem categorias.',
    criteriaMet: [],
    criteriaFailed: [
      'addTransaction registra receitas e despesas com categoria',
      'getSummary calcula totalIncome, totalExpense, balance e byCategory automaticamente'
    ],
    issuesFound: ['Placeholder TODO encontrado em src/financeEngine.cjs'],
    nextAction: 'Implementar createFinanceStore completo com addTransaction e getSummary reais',
    evaluation: eval1_Attempt1
  });
  assert.equal(review1_Attempt1.reviewDecision.decision, 'REJECTED', 'Tentativa 1 de 1.1 deve ser REJECTED pelo Review');

  // Tentativa #2 (Retrabalho do Worker com código real e testes completos)
  AutonomousManager.claimTask(mt1_1.id, 'worker-homolog-1');
  const contract1_Attempt2 = HierarchicalOrchestrationService.buildWorkerExecutionContract(runId, mt1_1.id);
  assert.equal(contract1_Attempt2.attemptNumber, 2, 'Contrato da Tentativa #2 indica attemptNumber = 2');
  assert.equal(contract1_Attempt2.reworkContext?.previousDecision, 'REJECTED');

  fs.writeFileSync(
    path.join(targetFolder, 'src', 'financeEngine.cjs'),
    [
      'function createFinanceStore() {',
      '  const transactions = [];',
      '  function addTransaction({ description, amount, type, category }) {',
      '    const val = Number(amount);',
      '    if (!description || Number.isNaN(val) || val <= 0) {',
      '      throw new Error("INVALID_TRANSACTION");',
      '    }',
      '    if (type !== "income" && type !== "expense") {',
      '      throw new Error("INVALID_TYPE");',
      '    }',
      '    const entry = {',
      '      id: String(transactions.length + 1),',
      '      description: String(description).trim(),',
      '      amount: val,',
      '      type,',
      '      category: String(category || "Geral").trim()',
      '    };',
      '    transactions.push(entry);',
      '    return entry;',
      '  }',
      '  function getSummary() {',
      '    let totalIncome = 0;',
      '    let totalExpense = 0;',
      '    const byCategory = {};',
      '    for (const tx of transactions) {',
      '      if (tx.type === "income") totalIncome += tx.amount;',
      '      else totalExpense += tx.amount;',
      '      byCategory[tx.category] = (byCategory[tx.category] || 0) + (tx.type === "income" ? tx.amount : -tx.amount);',
      '    }',
      '    return {',
      '      totalIncome,',
      '      totalExpense,',
      '      balance: totalIncome - totalExpense,',
      '      byCategory,',
      '      count: transactions.length,',
      '      transactions: [...transactions]',
      '    };',
      '  }',
      '  return { addTransaction, getSummary };',
      '}',
      'module.exports = { createFinanceStore };',
      ''
    ].join('\n'),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(targetFolder, 'test', 'finance.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const { createFinanceStore } = require('../src/financeEngine.cjs');",
      "test('financeEngine addTransaction and automatic balance calculation', () => {",
      "  const store = createFinanceStore();",
      "  store.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'Renda' });",
      "  store.addTransaction({ description: 'Aluguel', amount: 1800, type: 'expense', category: 'Moradia' });",
      "  store.addTransaction({ description: 'Mercado', amount: 700, type: 'expense', category: 'Alimentação' });",
      "  const summary = store.getSummary();",
      "  assert.equal(summary.totalIncome, 5000);",
      "  assert.equal(summary.totalExpense, 2500);",
      "  assert.equal(summary.balance, 2500);",
      "  assert.equal(summary.byCategory['Renda'], 5000);",
      "  assert.equal(summary.byCategory['Moradia'], -1800);",
      "});",
      ""
    ].join('\n'),
    'utf-8'
  );

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: mt1_1.id,
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
    implemented: ['Implementado createFinanceStore com addTransaction, categorias e cálculo automático de saldo'],
    testsRun: 'npm test',
    testResults: '1 passing'
  });

  const eval1_Attempt2 = await IndependentEvaluator.evaluate(mt1_1.contract_id, targetFolder, {
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
    implemented: ['Implementado createFinanceStore com addTransaction, categorias e cálculo automático de saldo']
  });
  assert.equal(eval1_Attempt2.verdict, 'PASS');

  const review1_Attempt2 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: mt1_1.id,
    verdict: 'APPROVED',
    feedback: 'Microtarefa 1.1 aprovada com evidências verificáveis após retrabalho.',
    criteriaMet: [
      'addTransaction registra receitas e despesas com categoria',
      'getSummary calcula totalIncome, totalExpense, balance e byCategory automaticamente'
    ],
    criteriaFailed: [],
    evaluation: eval1_Attempt2
  });
  assert.equal(review1_Attempt2.reviewDecision.decision, 'APPROVED');
  assert.equal(review1_Attempt2.commitGate?.committed, true, 'Commit da microtarefa 1.1 criado após aprovação');
  const sha1_1 = review1_Attempt2.commitGate?.commitSha;
  assert.ok(sha1_1);

  // 5. Executar Microtarefa 2.1 (Painel de resumo HTML e formulário de lançamento)
  const availableForGt2 = AutonomousManager.getAvailableTasks(runId);
  assert.equal(availableForGt2.length, 1);
  assert.equal(availableForGt2[0].id, mt2_1.id, 'Microtarefa 2.1 liberada após conclusão da Grande Tarefa GT-1');

  AutonomousManager.claimTask(mt2_1.id, 'worker-homolog-1');
  fs.writeFileSync(
    path.join(targetFolder, 'src', 'dashboardView.cjs'),
    [
      'function renderDashboardSummary(summary) {',
      '  const cats = Object.entries(summary.byCategory || {})',
      '    .map(([k, v]) => `<li data-category="${k}">${k}: R$ ${Number(v).toFixed(2)}</li>`)',
      '    .join("");',
      '  return [',
      '    `<section id="summary-panel">`,',
      '    `  <div class="card income">Receitas: R$ ${Number(summary.totalIncome).toFixed(2)}</div>`,',
      '    `  <div class="card expense">Despesas: R$ ${Number(summary.totalExpense).toFixed(2)}</div>`,',
      '    `  <div class="card balance">Saldo: R$ ${Number(summary.balance).toFixed(2)}</div>`,',
      '    `  <ul class="categories">${cats}</ul>`,',
      '    `</section>`',
      '  ].join("\\n");',
      '}',
      'module.exports = { renderDashboardSummary };',
      ''
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(targetFolder, 'src', 'dashboard.html'),
    [
      '<!DOCTYPE html>',
      '<html lang="pt-BR">',
      '<head><meta charset="UTF-8"><title>Painel Financeiro</title></head>',
      '<body>',
      '  <h1>Painel de Resumo Financeiro</h1>',
      '  <form id="transaction-form">',
      '    <input name="description" placeholder="Descrição" required />',
      '    <input name="amount" type="number" placeholder="Valor" required />',
      '    <select name="type"><option value="income">Receita</option><option value="expense">Despesa</option></select>',
      '    <input name="category" placeholder="Categoria" required />',
      '    <button type="submit">Lançar</button>',
      '  </form>',
      '  <div id="dashboard-root"></div>',
      '</body>',
      '</html>',
      ''
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(targetFolder, 'test', 'finance.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const { createFinanceStore } = require('../src/financeEngine.cjs');",
      "const { renderDashboardSummary } = require('../src/dashboardView.cjs');",
      "test('financeEngine addTransaction and automatic balance calculation', () => {",
      "  const store = createFinanceStore();",
      "  store.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'Renda' });",
      "  store.addTransaction({ description: 'Aluguel', amount: 1800, type: 'expense', category: 'Moradia' });",
      "  store.addTransaction({ description: 'Mercado', amount: 700, type: 'expense', category: 'Alimentação' });",
      "  const summary = store.getSummary();",
      "  assert.equal(summary.totalIncome, 5000);",
      "  assert.equal(summary.totalExpense, 2500);",
      "  assert.equal(summary.balance, 2500);",
      "  assert.equal(summary.byCategory['Renda'], 5000);",
      "  assert.equal(summary.byCategory['Moradia'], -1800);",
      "});",
      "test('financeEngine and dashboard summary panel', () => {",
      "  const store = createFinanceStore();",
      "  store.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'Renda' });",
      "  store.addTransaction({ description: 'Aluguel', amount: 1800, type: 'expense', category: 'Moradia' });",
      "  const summary = store.getSummary();",
      "  assert.equal(summary.balance, 3200);",
      "  const html = renderDashboardSummary(summary);",
      "  assert.match(html, /Receitas: R\\$ 5000\\.00/);",
      "  assert.match(html, /Despesas: R\\$ 1800\\.00/);",
      "  assert.match(html, /Saldo: R\\$ 3200\\.00/);",
      "  assert.match(html, /Moradia: R\\$ -1800\\.00/);",
      "  const pageHtml = fs.readFileSync(path.join(__dirname, '../src/dashboard.html'), 'utf-8');",
      "  assert.match(pageHtml, /id=\"transaction-form\"/);",
      "});",
      ""
    ].join('\n'),
    'utf-8'
  );

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: mt2_1.id,
    status: 'success',
    filesChanged: ['src/dashboardView.cjs', 'src/dashboard.html', 'test/finance.test.cjs'],
    implemented: ['Implementado painel de resumo e formulário de lançamento'],
    testsRun: 'npm test',
    testResults: '2 passing'
  });

  const eval2_1 = await IndependentEvaluator.evaluate(mt2_1.contract_id, targetFolder, {
    status: 'success',
    filesChanged: ['src/dashboardView.cjs', 'src/dashboard.html', 'test/finance.test.cjs'],
    implemented: ['Implementado painel de resumo e formulário de lançamento']
  });
  assert.equal(eval2_1.verdict, 'PASS');

  const review2_1 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: mt2_1.id,
    verdict: 'APPROVED',
    feedback: 'Painel de resumo e formulário aprovados pelo Review independente.',
    criteriaMet: [
      'renderDashboardSummary gera HTML com total de receitas, despesas, categorias e saldo',
      'Arquivo src/dashboard.html contém estrutura do painel de resumo e formulário'
    ],
    criteriaFailed: [],
    evaluation: eval2_1
  });
  assert.equal(review2_1.reviewDecision.decision, 'APPROVED');
  assert.equal(review2_1.commitGate?.committed, true);
  const sha2_1 = review2_1.commitGate?.commitSha;
  assert.ok(sha2_1 && sha2_1 !== sha1_1);

  // 6. Simular mudança de requisito via endpoint HTTP POST /api/autonomous/runs/:id/replan
  const replanRes = await fetch(`${baseUrl}/autonomous/runs/${runId}/replan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction: 'Adicionar filtro de transações por categoria (filterByCategory) no motor financeiro',
      changeType: 'NEW_FEATURE'
    })
  });
  assert.equal(replanRes.status, 200, 'Endpoint de replanejamento deve responder 200 OK');
  const replanData: any = await replanRes.json();
  assert.equal(replanData.replanResult.preservedCompletedCount, 2, 'As 2 microtarefas concluídas anteriormente devem ser preservadas');
  assert.equal(replanData.replanResult.addedMicrotasks.length, 1, 'Nova microtarefa criada para o novo requisito');

  const mt3_1 = replanData.replanResult.addedMicrotasks[0];

  // Executar e aprovar a microtarefa replanejada 3.1
  AutonomousManager.claimTask(mt3_1.id, 'worker-homolog-1');
  fs.writeFileSync(
    path.join(targetFolder, 'src', 'financeEngine.cjs'),
    [
      'function createFinanceStore() {',
      '  const transactions = [];',
      '  function addTransaction({ description, amount, type, category }) {',
      '    const val = Number(amount);',
      '    if (!description || Number.isNaN(val) || val <= 0) {',
      '      throw new Error("INVALID_TRANSACTION");',
      '    }',
      '    if (type !== "income" && type !== "expense") {',
      '      throw new Error("INVALID_TYPE");',
      '    }',
      '    const entry = {',
      '      id: String(transactions.length + 1),',
      '      description: String(description).trim(),',
      '      amount: val,',
      '      type,',
      '      category: String(category || "Geral").trim()',
      '    };',
      '    transactions.push(entry);',
      '    return entry;',
      '  }',
      '  function filterByCategory(category) {',
      '    return transactions.filter(t => t.category.toLowerCase() === String(category || "").trim().toLowerCase());',
      '  }',
      '  function getSummary() {',
      '    let totalIncome = 0;',
      '    let totalExpense = 0;',
      '    const byCategory = {};',
      '    for (const tx of transactions) {',
      '      if (tx.type === "income") totalIncome += tx.amount;',
      '      else totalExpense += tx.amount;',
      '      byCategory[tx.category] = (byCategory[tx.category] || 0) + (tx.type === "income" ? tx.amount : -tx.amount);',
      '    }',
      '    return {',
      '      totalIncome,',
      '      totalExpense,',
      '      balance: totalIncome - totalExpense,',
      '      byCategory,',
      '      count: transactions.length,',
      '      transactions: [...transactions]',
      '    };',
      '  }',
      '  return { addTransaction, filterByCategory, getSummary };',
      '}',
      'module.exports = { createFinanceStore };',
      ''
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(targetFolder, 'test', 'finance.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const { createFinanceStore } = require('../src/financeEngine.cjs');",
      "const { renderDashboardSummary } = require('../src/dashboardView.cjs');",
      "test('financeEngine addTransaction and automatic balance calculation', () => {",
      "  const store = createFinanceStore();",
      "  store.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'Renda' });",
      "  store.addTransaction({ description: 'Aluguel', amount: 1800, type: 'expense', category: 'Moradia' });",
      "  store.addTransaction({ description: 'Mercado', amount: 700, type: 'expense', category: 'Alimentação' });",
      "  const summary = store.getSummary();",
      "  assert.equal(summary.totalIncome, 5000);",
      "  assert.equal(summary.totalExpense, 2500);",
      "  assert.equal(summary.balance, 2500);",
      "  assert.equal(summary.byCategory['Renda'], 5000);",
      "  assert.equal(summary.byCategory['Moradia'], -1800);",
      "});",
      "test('financeEngine and dashboard summary panel', () => {",
      "  const store = createFinanceStore();",
      "  store.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'Renda' });",
      "  store.addTransaction({ description: 'Aluguel', amount: 1800, type: 'expense', category: 'Moradia' });",
      "  const summary = store.getSummary();",
      "  assert.equal(summary.balance, 3200);",
      "  const html = renderDashboardSummary(summary);",
      "  assert.match(html, /Receitas: R\\$ 5000\\.00/);",
      "  assert.match(html, /Despesas: R\\$ 1800\\.00/);",
      "  assert.match(html, /Saldo: R\\$ 3200\\.00/);",
      "  assert.match(html, /Moradia: R\\$ -1800\\.00/);",
      "  const pageHtml = fs.readFileSync(path.join(__dirname, '../src/dashboard.html'), 'utf-8');",
      "  assert.match(pageHtml, /id=\"transaction-form\"/);",
      "});",
      "test('financeEngine full suite with filterByCategory replanned feature', () => {",
      "  const store = createFinanceStore();",
      "  store.addTransaction({ description: 'Salário', amount: 5000, type: 'income', category: 'Renda' });",
      "  store.addTransaction({ description: 'Aluguel', amount: 1800, type: 'expense', category: 'Moradia' });",
      "  store.addTransaction({ description: 'Condomínio', amount: 400, type: 'expense', category: 'Moradia' });",
      "  const moradia = store.filterByCategory('Moradia');",
      "  assert.equal(moradia.length, 2);",
      "  const summary = store.getSummary();",
      "  assert.equal(summary.balance, 2800);",
      "  const html = renderDashboardSummary(summary);",
      "  assert.match(html, /Saldo: R\\$ 2800\\.00/);",
      "});",
      ""
    ].join('\n'),
    'utf-8'
  );

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: mt3_1.id,
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
    implemented: ['Implementado filterByCategory conforme mudança de requisito'],
    testsRun: 'npm test',
    testResults: '3 passing'
  });

  const eval3_1 = await IndependentEvaluator.evaluate(mt3_1.contract_id, targetFolder, {
    status: 'success',
    filesChanged: ['src/financeEngine.cjs', 'test/finance.test.cjs'],
    implemented: ['Implementado filterByCategory conforme mudança de requisito']
  });
  assert.equal(eval3_1.verdict, 'PASS');

  const review3_1 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: mt3_1.id,
    verdict: 'APPROVED',
    feedback: 'Requisito replanejado filterByCategory aprovado e testado.',
    criteriaMet: mt3_1.criteria_json ? JSON.parse(mt3_1.criteria_json) : [],
    criteriaFailed: [],
    evaluation: eval3_1
  });
  assert.equal(review3_1.reviewDecision.decision, 'APPROVED');
  assert.equal(review3_1.commitGate?.committed, true);
  const sha3_1 = review3_1.commitGate?.commitSha;
  assert.ok(sha3_1);

  // 7. Executar validação integrada final via endpoint POST /api/autonomous/runs/:id/validate-final
  const validateRes = await fetch(`${baseUrl}/autonomous/runs/${runId}/validate-final`, {
    method: 'POST'
  });
  assert.equal(validateRes.status, 200);
  const validateBody: any = await validateRes.json();
  assert.equal(validateBody.validation.canCompleteProject, true, 'Validação integrada final deve aprovar o projeto completo');
  assert.equal(validateBody.validation.allMajorTasksCompleted, true);
  assert.equal(validateBody.validation.allMicrotasksCompleted, true);
  assert.equal(validateBody.validation.allCommitsVerified, true);

  // Consultar hierarquia completa via GET /api/autonomous/runs/:id/hierarchy
  const hierRes = await fetch(`${baseUrl}/autonomous/runs/${runId}/hierarchy`);
  assert.equal(hierRes.status, 200);
  const hierBody: any = await hierRes.json();
  assert.equal(hierBody.majorTasks.length, 3, 'Deve conter 3 Grandes Tarefas (2 iniciais + 1 do replanejamento)');
  assert.equal(hierBody.tasks.length, 3, 'Deve conter 3 Microtarefas concluídas e commitadas');
  assert.ok(hierBody.agentCommunications.length >= 8, 'Deve ter histórico rico de comunicações entre Supervisor, Worker e Review');
  assert.ok(hierBody.stateTransitions.length >= 10, 'Deve ter histórico auditável de transições na máquina de estados');
});
