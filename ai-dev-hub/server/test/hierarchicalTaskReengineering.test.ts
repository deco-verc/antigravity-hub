import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { db } from '../src/db.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { ChatIntentClassifier } from '../src/chatIntentClassifier.js';

function createTempGitRepo(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@decohub.local"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "DecoHUB Test"', { cwd: dir, stdio: 'ignore' });

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'decohub-reengineering-test',
        version: '1.0.0',
        scripts: {
          test: 'node --test test/*.test.cjs'
        }
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'test', 'smoke.test.cjs'),
    `const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('smoke', () => { assert.equal(1, 1); });\n`,
    'utf-8'
  );
  execSync('git add -A && git commit -m "chore: initial repo"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function registerProjectAndRun(repoDir: string, name: string, objective: string, briefing?: string) {
  const projectId = `proj-${crypto.randomUUID().slice(0, 8)}`;
  const runId = `run-${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, path, objective, description, stack, status, is_trusted, full_dev_autonomy, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Node.js, TypeScript, HTML, CSS', 'active', 1, 1, ?, ?)
  `).run(projectId, name, repoDir, objective, briefing || objective, nowIso, nowIso);

  db.prepare(`
    INSERT INTO autonomous_runs (
      id, project_id, name, objective, briefing, status, autonomy_mode,
      max_hours, max_cycles, current_cycle, start_time, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'running', 'autonomous', 8, 100, 1, ?, ?, ?)
  `).run(runId, projectId, `Run ${name}`, objective, briefing || objective, nowIso, nowIso, nowIso);

  return { projectId, runId };
}

test('Cenários 1, 2 e 3: Decomposição adaptativa proporcional à complexidade (Simples vs Médio vs Complexo sem teto de 6 tarefas)', () => {
  // 1. PromptArchitectureService não possui mais limite rígido "3 a 6 tarefas"
  const supPrompt = PromptArchitectureService.buildSupervisorPrompt({
    mode: 'INITIAL_PLAN',
    projectName: 'App Teste',
    projectPath: '/tmp/app',
    projectObjective: 'Construir sistema web',
    briefing: 'Sistema completo'
  });
  assert.ok(
    !supPrompt.prompt.includes('Gere entre 3 a 6 tarefas'),
    'O prompt do Supervisor não deve conter o teto artificial de "3 a 6 tarefas"'
  );
  assert.ok(
    supPrompt.prompt.includes('DECOMPOSIÇÃO ORIENTADA POR COMPLEXIDADE'),
    'O prompt do Supervisor deve instruir decomposição proporcional à complexidade'
  );

  // 2. Projeto Simples -> decomposição enxuta (1 a 3 microtarefas)
  const simpleRepo = createTempGitRepo('decohub-simple-');
  const simpleCtx = registerProjectAndRun(
    simpleRepo,
    'Simple Util',
    'Criar uma função utilitária de soma em src/sum.cjs com teste unitário'
  );
  const simpleDecomp = AutonomousManager.decomposeProjectAdaptively({
    projectId: simpleCtx.projectId,
    runId: simpleCtx.runId,
    projectPath: simpleRepo,
    briefing: 'Criar função utilitária sum(a,b) em src/sum.cjs',
    initialFlatTasks: [
      {
        title: 'Implementar função sum: Criar src/sum.cjs e validar soma básica',
        description: 'Criar função sum(a, b) exportada em src/sum.cjs com teste unitário.',
        milestone: 'M1',
        criteria: ['Exportar sum(a, b)', 'Passar no teste unitário'],
        expectedFiles: ['src/sum.cjs', 'test/smoke.test.cjs'],
        verificationCommand: 'npm test'
      }
    ]
  });
  assert.equal(simpleDecomp.complexityAnalysis.complexityTier, 'SIMPLE');
  assert.ok(
    simpleDecomp.microtasks.length >= 1 && simpleDecomp.microtasks.length <= 3,
    `Projeto simples deve ter entre 1 e 3 microtarefas, mas gerou ${simpleDecomp.microtasks.length}`
  );

  // 3. Projeto Médio -> decomposição multi-etapas (4 a 12 microtarefas)
  const medRepo = createTempGitRepo('decohub-medium-');
  const medBriefing =
    'Construa uma API REST de tarefas com persistência em banco de dados SQLite, validação de entrada, filtros de busca e testes automatizados.';
  const medCtx = registerProjectAndRun(medRepo, 'Medium Task API', medBriefing);
  const medDecomp = AutonomousManager.decomposeProjectAdaptively({
    projectId: medCtx.projectId,
    runId: medCtx.runId,
    projectPath: medRepo,
    briefing: medBriefing
  });
  assert.ok(
    ['MODERATE', 'COMPLEX'].includes(medDecomp.complexityAnalysis.complexityTier),
    `Esperado tier MODERATE/COMPLEX para projeto médio, obteve ${medDecomp.complexityAnalysis.complexityTier}`
  );
  assert.ok(medDecomp.majorTasks.length >= 3, 'Projeto médio deve ter pelo menos 3 Grandes Tarefas');
  assert.ok(
    medDecomp.microtasks.length >= 6,
    `Projeto médio deve decompor em múltiplas etapas/microtarefas (>= 6), obteve ${medDecomp.microtasks.length}`
  );

  // 4. Projeto Complexo -> decomposição profunda (> 15 microtarefas, múltiplas Grandes Tarefas e Etapas)
  const complexRepo = createTempGitRepo('decohub-complex-plan-');
  const complexBriefing =
    'Construa um sistema financeiro web completo, com autenticação, dashboard, receitas e despesas, categorias, filtros, relatórios, persistência de dados, segurança, testes e interface responsiva.';
  const complexCtx = registerProjectAndRun(complexRepo, 'DecoHUB Finance Complex', complexBriefing);
  const complexDecomp = AutonomousManager.decomposeProjectAdaptively({
    projectId: complexCtx.projectId,
    runId: complexCtx.runId,
    projectPath: complexRepo,
    briefing: complexBriefing
  });
  assert.equal(complexDecomp.complexityAnalysis.complexityTier, 'ENTERPRISE');
  assert.ok(
    complexDecomp.majorTasks.length >= 6,
    `Projeto complexo deve gerar >= 6 Grandes Tarefas, gerou ${complexDecomp.majorTasks.length}`
  );
  assert.ok(
    complexDecomp.microtasks.length > 15,
    `Projeto complexo deve gerar > 15 microtarefas atômicas (sem limite de 6), gerou ${complexDecomp.microtasks.length}`
  );
  const totalStages = complexDecomp.majorTasks.reduce((acc, m) => acc + (m.stages?.length || 0), 0);
  assert.ok(totalStages >= 10, `Projeto complexo deve conter múltiplas Etapas explícitas (>= 10), obteve ${totalStages}`);
});

test('Cenários 4, 5, 6 e 7: Cobertura de requisitos pré-execução, subdivisão recursiva com limite de profundidade e descoberta dinâmica sem duplicação', () => {
  const repoDir = createTempGitRepo('decohub-adaptive-loop-');
  const briefing =
    'Sistema com autenticação JWT, cadastro de categorias financeiras e exportação de relatórios.';
  const { projectId, runId } = registerProjectAndRun(repoDir, 'Adaptive Loop App', briefing);

  // Cenário 5 & 6: Tarefa grande demais subdividida automaticamente e respeitando maxSubdivisionDepth
  const oversizedTask = {
    title: 'Implementar Autenticação, Banco de Dados, Categorias, Dashboard, Relatórios e Segurança Completo',
    description: 'Super tarefa monolítica com múltiplos objetivos distintos.',
    milestone: 'GT-1',
    criteria: [
      'Configurar schema SQLite e migrations',
      'Criar hash de senha e sessão JWT',
      'Criar rotas CRUD de categorias',
      'Construir tela de login e autenticação',
      'Construir dashboard com gráficos',
      'Implementar exportação de relatórios CSV',
      'Adicionar rate limit e sanitização XSS',
      'Criar suíte de testes E2E completa'
    ],
    expectedFiles: [
      'src/db.cjs',
      'src/auth.cjs',
      'src/categories.cjs',
      'src/dashboard.cjs',
      'src/reports.cjs',
      'src/security.cjs',
      'public/index.html',
      'test/all.test.cjs'
    ],
    verificationCommand: 'npm test'
  };

  const subdivided = HierarchicalOrchestrationService.validateAndSubdivideMicrotasks([oversizedTask], {
    subdivideOversized: true,
    maxSubdivisionDepth: 2
  });
  assert.ok(subdivided.length >= 4, `Tarefa monolítica de 8 critérios/8 arquivos deve ser subdividida em >= 4 partes, obteve ${subdivided.length}`);
  assert.ok(
    subdivided.every(t => (t.subdivisionDepth ?? 0) <= 2),
    'Nenhuma microtarefa subdividida pode ultrapassar maxSubdivisionDepth = 2'
  );

  // Cenário 4: Plano inicial que esquece um requisito obrigatório ("relatórios") é detectado e coberto antes da execução
  HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId,
    runId,
    projectPath: repoDir,
    originalDescription: briefing,
    requirements: [
      'REQ-1: Autenticação de usuários e controle de sessão',
      'REQ-2: Gestão e cadastro de categorias financeiras',
      'REQ-3: Relatórios financeiros e exportação de dados'
    ],
    flatTasks: [
      {
        title: 'Implementar autenticação de usuários: Criar src/auth.cjs',
        description: 'Módulo de login e sessão.',
        milestone: 'GT-1',
        requirementIds: ['REQ-1'],
        criteria: ['Login funcional', 'Validação de token'],
        expectedFiles: ['src/auth.cjs'],
        verificationCommand: 'npm test'
      },
      {
        title: 'Implementar cadastro de categorias: Criar src/categories.cjs',
        description: 'CRUD de categorias.',
        milestone: 'GT-2',
        requirementIds: ['REQ-2'],
        criteria: ['Criar categoria', 'Listar categorias'],
        expectedFiles: ['src/categories.cjs'],
        verificationCommand: 'npm test'
      }
    ],
    ensureRequirementCoverage: false
  });

  const diagBefore = AutonomousManager.queryPlanDiagnostics(runId);
  assert.ok(
    diagBefore.uncoveredRequirements.some(r => r.code === 'REQ-3'),
    'REQ-3 deve ser detectado como requisito descoberto antes de ensureRequirementCoverage'
  );

  const coverageResult = AutonomousManager.ensureRequirementCoverage(runId, { projectPath: repoDir });
  assert.equal(coverageResult.uncoveredBefore.length, 1);
  assert.equal(coverageResult.uncoveredBefore[0], 'REQ-3');
  assert.ok(coverageResult.createdTasks.length >= 1, 'Deve criar automaticamente tarefa(s) para cobrir REQ-3');
  assert.equal(coverageResult.uncoveredAfter.length, 0, 'Todos os requisitos devem ficar 100% cobertos após ensureRequirementCoverage');

  // Cenário 7: Descoberta dinâmica de subtarefas durante a execução + proteção anti-duplicação
  const allTasksBefore = AutonomousManager.getRun(runId).tasks;
  const authTask = allTasksBefore.find((t: any) => t.title.includes('autenticação'));
  assert.ok(authTask);

  const discovery1 = AutonomousManager.discoverDynamicSubtasks({
    runId,
    originTaskId: authTask.id,
    discoveredFrom: 'execution_gap',
    reason: 'Necessário criar middleware de bloqueio de força bruta antes de finalizar autenticação',
    subtasks: [
      {
        title: 'Implementar proteção contra brute-force no login: Criar src/rateLimiter.cjs',
        objective: 'Bloquear tentativas excessivas de login',
        description: 'Criar limitador de tentativas por IP/usuário.',
        stageCode: 'ET-SEGURANCA',
        stageTitle: 'Segurança de Autenticação',
        requirementIds: ['REQ-1'],
        criteria: ['Bloquear após 5 falhas consecutivas', 'Testar reset de janela'],
        expectedFiles: ['src/rateLimiter.cjs'],
        verificationCommand: 'npm test'
      }
    ]
  });
  assert.equal(discovery1.createdTasks.length, 1, 'Deve criar a subtarefa dinâmica descoberta em execução');
  assert.equal(discovery1.skippedDuplicates.length, 0);

  // Tentar descobrir a mesma subtarefa novamente -> deve ser ignorada pelo guard anti-duplicação
  const discoveryDuplicate = AutonomousManager.discoverDynamicSubtasks({
    runId,
    originTaskId: authTask.id,
    discoveredFrom: 'execution_gap',
    reason: 'Mesma lacuna reportada novamente',
    subtasks: [
      {
        title: 'Implementar proteção contra brute-force no login: Criar src/rateLimiter.cjs',
        objective: 'Bloquear tentativas excessivas de login',
        description: 'Criar limitador de tentativas por IP/usuário.',
        criteria: ['Bloquear após 5 falhas consecutivas'],
        expectedFiles: ['src/rateLimiter.cjs'],
        verificationCommand: 'npm test'
      }
    ]
  });
  assert.equal(discoveryDuplicate.createdTasks.length, 0, 'Não deve duplicar subtarefa dinâmica já existente');
  assert.equal(discoveryDuplicate.skippedDuplicates.length, 1, 'Deve registrar a duplicata ignorada');
});

test('Cenários 8, 9, 10, 11, 12 e 13: Separação Planejamento/Execução/Conclusão, Grafo de Dependências, Conflito de Escopo de Arquivos e Bloqueio Seletivo', async () => {
  const repoDir = createTempGitRepo('decohub-dag-scope-');
  const { projectId, runId } = registerProjectAndRun(
    repoDir,
    'DAG & Scope Guard App',
    'Sistema com módulos paralelos, controle de escopo e validação de requisitos'
  );

  // Cenário 11: Rejeição de dependência circular
  assert.throws(
    () => {
      HierarchicalOrchestrationService.persistHierarchicalPlan({
        projectId,
        runId,
        projectPath: repoDir,
        originalDescription: 'Teste de ciclo',
        flatTasks: [
          {
            title: 'Tarefa Ciclo A: Criar src/a.cjs',
            description: 'Depende de B',
            dependencies: ['Tarefa Ciclo B: Criar src/b.cjs'],
            criteria: ['Criar src/a.cjs']
          },
          {
            title: 'Tarefa Ciclo B: Criar src/b.cjs',
            description: 'Depende de A',
            dependencies: ['Tarefa Ciclo A: Criar src/a.cjs'],
            criteria: ['Criar src/b.cjs']
          }
        ]
      });
    },
    /CIRCULAR_DEPENDENCY_DETECTED/,
    'Deve detectar e rejeitar dependência circular entre microtarefas'
  );

  // Criar plano válido com 2 Grandes Tarefas e 3 requisitos (REQ-1, REQ-2, REQ-3 onde REQ-3 ficará inicialmente sem tarefa para testar bloqueio de 100%)
  HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId,
    runId,
    projectPath: repoDir,
    originalDescription: 'Módulos paralelos e requisitos verificados',
    requirements: [
      'REQ-1: Módulo compartilhado de banco em src/sharedDb.cjs',
      'REQ-2: Módulo independente de relatórios em src/independentReport.cjs',
      'REQ-3: Módulo de auditoria obrigatória em src/audit.cjs'
    ],
    majorTasks: [
      {
        code: 'GT-1',
        title: 'Camada Compartilhada',
        objective: 'Implementar e evoluir src/sharedDb.cjs',
        requirementIds: ['REQ-1'],
        microtasks: [
          {
            code: '1.1',
            title: 'Criar base compartilhada: Criar src/sharedDb.cjs',
            description: 'Primeira tarefa que toca src/sharedDb.cjs',
            requirementIds: ['REQ-1'],
            criteria: ['Arquivo src/sharedDb.cjs criado'],
            expectedFiles: ['src/sharedDb.cjs'],
            allowedScope: ['src/sharedDb.cjs', 'test/smoke.test.cjs'],
            verificationCommand: 'npm test'
          },
          {
            code: '1.2',
            title: 'Adicionar índice na base compartilhada: Atualizar src/sharedDb.cjs',
            description: 'Segunda tarefa sem dependência explícita, mas que toca o MESMO arquivo src/sharedDb.cjs',
            requirementIds: ['REQ-1'],
            criteria: ['Índice adicionado em src/sharedDb.cjs'],
            expectedFiles: ['src/sharedDb.cjs'],
            allowedScope: ['src/sharedDb.cjs', 'test/smoke.test.cjs'],
            verificationCommand: 'npm test'
          }
        ]
      },
      {
        code: 'GT-2',
        title: 'Frente Independente de Relatórios',
        objective: 'Implementar src/independentReport.cjs em paralelo seguro',
        requirementIds: ['REQ-2'],
        microtasks: [
          {
            code: '2.1',
            title: 'Criar gerador de relatórios independente: Criar src/independentReport.cjs',
            description: 'Toca apenas src/independentReport.cjs',
            requirementIds: ['REQ-2'],
            criteria: ['Arquivo src/independentReport.cjs criado'],
            expectedFiles: ['src/independentReport.cjs'],
            allowedScope: ['src/independentReport.cjs', 'test/smoke.test.cjs'],
            verificationCommand: 'npm test'
          }
        ]
      }
    ],
    ensureRequirementCoverage: false
  });

  const runInitial = AutonomousManager.getRun(runId);
  const task11 = runInitial.tasks.find((t: any) => t.code === '1.1');
  const task12 = runInitial.tasks.find((t: any) => t.code === '1.2');
  const task21 = runInitial.tasks.find((t: any) => t.code === '2.1');
  assert.ok(task11 && task12 && task21);

  // Cenário 12: Conflito de escopo de arquivos impedido entre tarefas paralelas
  const parallelCheck = HierarchicalOrchestrationService.getEligibleParallelTasks(runId);
  const eligibleCodes = parallelCheck.eligible.map(t => t.code);
  assert.ok(eligibleCodes.includes('1.1'), 'Tarefa 1.1 deve ser elegível');
  assert.ok(eligibleCodes.includes('2.1'), 'Tarefa 2.1 (escopo disjunto) deve ser elegível em paralelo com 1.1');
  assert.ok(!eligibleCodes.includes('1.2'), 'Tarefa 1.2 NÃO deve ser elegível simultaneamente com 1.1 pois ambas alteram src/sharedDb.cjs');
  assert.equal(parallelCheck.deferredByScopeConflict.length, 1);
  assert.equal(parallelCheck.deferredByScopeConflict[0].task.code, '1.2');

  // Reivindicar 1.1 -> entra em IN_PROGRESS
  AutonomousManager.claimTask(runId, task11.id, 'Worker-1');

  // Tentar reivindicar 1.2 enquanto 1.1 está IN_PROGRESS -> deve lançar TASK_SCOPE_CONFLICT
  assert.throws(
    () => {
      AutonomousManager.claimTask(runId, task12.id, 'Worker-2');
    },
    /TASK_SCOPE_CONFLICT/,
    'Reivindicar tarefa com escopo de arquivo sobreposto a tarefa IN_PROGRESS deve falhar com TASK_SCOPE_CONFLICT'
  );

  // Já a tarefa 2.1 (escopo disjunto) pode ser reivindicada normalmente em paralelo!
  AutonomousManager.claimTask(runId, task21.id, 'Worker-2');

  // Cenário 13: Bloqueio seletivo — se 1.1 ficar BLOCKED, a tarefa independente 2.1 continua e conclui normalmente
  AutonomousManager.transitionTaskState(task11.id, 'BLOCKED', 'supervisor', 'Aguardando definição externa de schema');
  const runWhileBlocked = AutonomousManager.getRun(runId);
  const major1WhileBlocked = runWhileBlocked.majorTasks.find((m: any) => m.code === 'GT-1');
  assert.equal(major1WhileBlocked.lifecycle_state, 'BLOCKED');

  // Concluir 2.1 com evidência real
  fs.writeFileSync(path.join(repoDir, 'src', 'independentReport.cjs'), 'module.exports = { report: () => "ok" };\n', 'utf-8');
  AutonomousManager.submitBuilderReport({
    runId,
    taskId: task21.id,
    status: 'success',
    filesChanged: ['src/independentReport.cjs'],
    implemented: ['Arquivo src/independentReport.cjs criado'],
    testsRun: 'npm test',
    testResults: 'Passed',
    buildStatus: 'Passed'
  });
  const eval21 = await IndependentEvaluator.evaluate(
    task21.contract_id,
    repoDir,
    {
      status: 'success',
      filesChanged: ['src/independentReport.cjs'],
      implemented: ['Arquivo src/independentReport.cjs criado'],
      commandsExecuted: ['npm test'],
      tests: { ran: true, command: 'npm test', passed: true },
      buildStatus: 'Passed',
      problems: [],
      decisions: []
    },
    { expectedScopeFiles: ['src/independentReport.cjs'] }
  );
  AutonomousManager.submitSupervisorReview({
    runId,
    taskId: task21.id,
    verdict: 'APPROVED',
    feedback: 'Aprovado com evidência.',
    evaluation: eval21,
    requireGitCommit: true
  });

  // Cenário 8: GT-1 não pode ser concluída enquanto suas subtarefas (1.1 e 1.2) não estiverem concluídas
  const runAfter21 = AutonomousManager.getRun(runId);
  const gt1After21 = runAfter21.majorTasks.find((m: any) => m.code === 'GT-1');
  const gt2After21 = runAfter21.majorTasks.find((m: any) => m.code === 'GT-2');
  assert.equal(gt2After21.status, 'completed', 'GT-2 independente deve concluir mesmo com GT-1 bloqueada');
  assert.notEqual(gt1After21.status, 'completed', 'GT-1 não pode concluir com filhos pendentes/bloqueados');

  // Desbloquear e concluir 1.1 e 1.2
  AutonomousManager.transitionTaskState(task11.id, 'READY', 'supervisor', 'Schema definido');
  AutonomousManager.claimTask(runId, task11.id, 'Worker-1');
  fs.writeFileSync(path.join(repoDir, 'src', 'sharedDb.cjs'), 'module.exports = { db: true };\n', 'utf-8');
  AutonomousManager.submitBuilderReport({
    runId,
    taskId: task11.id,
    status: 'success',
    filesChanged: ['src/sharedDb.cjs'],
    implemented: ['Arquivo src/sharedDb.cjs criado'],
    testsRun: 'npm test',
    testResults: 'Passed',
    buildStatus: 'Passed'
  });
  const eval11 = await IndependentEvaluator.evaluate(
    task11.contract_id,
    repoDir,
    {
      status: 'success',
      filesChanged: ['src/sharedDb.cjs'],
      implemented: ['Arquivo src/sharedDb.cjs criado'],
      commandsExecuted: ['npm test'],
      tests: { ran: true, command: 'npm test', passed: true },
      buildStatus: 'Passed',
      problems: [],
      decisions: []
    },
    { expectedScopeFiles: ['src/sharedDb.cjs'] }
  );
  AutonomousManager.submitSupervisorReview({
    runId,
    taskId: task11.id,
    verdict: 'APPROVED',
    feedback: '1.1 aprovado.',
    evaluation: eval11,
    requireGitCommit: true
  });

  // Agora 1.2 ainda está pendente -> GT-1 ainda NÃO pode estar concluída (Cenário 8)
  const runBefore12 = AutonomousManager.getRun(runId);
  const gt1Before12 = runBefore12.majorTasks.find((m: any) => m.code === 'GT-1');
  assert.notEqual(gt1Before12.status, 'completed', 'GT-1 não pode concluir enquanto 1.2 estiver pendente');

  // Concluir 1.2
  AutonomousManager.claimTask(runId, task12.id, 'Worker-1');
  fs.writeFileSync(path.join(repoDir, 'src', 'sharedDb.cjs'), 'module.exports = { db: true, index: true };\n', 'utf-8');
  AutonomousManager.submitBuilderReport({
    runId,
    taskId: task12.id,
    status: 'success',
    filesChanged: ['src/sharedDb.cjs'],
    implemented: ['Índice adicionado em src/sharedDb.cjs'],
    testsRun: 'npm test',
    testResults: 'Passed',
    buildStatus: 'Passed'
  });
  const eval12 = await IndependentEvaluator.evaluate(
    task12.contract_id,
    repoDir,
    {
      status: 'success',
      filesChanged: ['src/sharedDb.cjs'],
      implemented: ['Índice adicionado em src/sharedDb.cjs'],
      commandsExecuted: ['npm test'],
      tests: { ran: true, command: 'npm test', passed: true },
      buildStatus: 'Passed',
      problems: [],
      decisions: []
    },
    { expectedScopeFiles: ['src/sharedDb.cjs'] }
  );
  AutonomousManager.submitSupervisorReview({
    runId,
    taskId: task12.id,
    verdict: 'APPROVED',
    feedback: '1.2 aprovado.',
    evaluation: eval12,
    requireGitCommit: true
  });

  // Cenário 9 & 10: Todas as microtarefas planejadas (1.1, 1.2, 2.1) estão concluídas, MAS o requisito obrigatório REQ-3 não foi verificado!
  // O progresso percentual do projeto NÃO pode atingir 100% e validateProjectFinalCompletion DEVE bloquear a conclusão!
  const runWithUnverifiedReq = AutonomousManager.getRun(runId);
  assert.ok(
    runWithUnverifiedReq.stats.progressPct < 100,
    `Progresso do projeto não pode ser 100% enquanto REQ-3 obrigatório não estiver verificado (obteve ${runWithUnverifiedReq.stats.progressPct}%)`
  );
  const finalValBlocked = AutonomousManager.validateProjectFinalCompletion(runId);
  assert.equal(finalValBlocked.canComplete, false, 'Projeto não pode ser concluído com requisito obrigatório REQ-3 sem verificação');
  assert.ok(
    finalValBlocked.blockingReasons.some(r => r.includes('REQ-3')),
    'Motivo de bloqueio final deve citar explicitamente REQ-3'
  );
});

test('Cenários 14, 15, 16 e 17: Rastreabilidade Bidirecional (7 perguntas de diagnóstico), Persistência/Reconstrução e Intenção Conversacional vs Executável', async () => {
  const repoDir = createTempGitRepo('decohub-trace-chat-');
  const { projectId, runId } = registerProjectAndRun(
    repoDir,
    'Traceability & Chat App',
    'Sistema com rastreabilidade bidirecional e separação entre perguntas e instruções'
  );

  HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId,
    runId,
    projectPath: repoDir,
    originalDescription: 'Autenticação e Exportação CSV',
    requirements: [
      'REQ-1: Autenticação segura',
      'REQ-2: Exportação de relatórios'
    ],
    flatTasks: [
      {
        code: '1.1',
        title: 'Implementar autenticação segura: Criar src/auth.cjs',
        description: 'Módulo de autenticação.',
        milestone: 'GT-1',
        requirementIds: ['REQ-1'],
        criteria: ['Autenticar usuário válido'],
        expectedFiles: ['src/auth.cjs'],
        verificationCommand: 'npm test'
      },
      {
        code: '2.1',
        title: 'Implementar exportação de relatórios: Criar src/export.cjs',
        description: 'Módulo de exportação.',
        milestone: 'GT-2',
        requirementIds: ['REQ-2'],
        dependencies: ['1.1'],
        criteria: ['Exportar dados com cabeçalho'],
        expectedFiles: ['src/export.cjs'],
        verificationCommand: 'npm test'
      }
    ]
  });

  // Cenário 15: Persistência e reconstrução completa + Resposta determinística às 7 perguntas da Seção 7
  const rehydratedRun = AutonomousManager.getRun(runId);
  assert.equal(rehydratedRun.majorTasks.length, 2);
  assert.equal(rehydratedRun.projectRequirements.length, 2);

  const q1 = AutonomousManager.queryPlanDiagnostics(runId, 'Quais requisitos ainda não têm tarefas?');
  assert.ok(q1.directAnswer.includes('Todos os requisitos'), `Resposta Q1 inesperada: ${q1.directAnswer}`);

  const q2 = AutonomousManager.queryPlanDiagnostics(runId, 'Quais tarefas estão prontas para execução?');
  assert.equal(q2.readyTasks.length, 1);
  assert.equal(q2.readyTasks[0].code, '1.1');

  const q5 = AutonomousManager.queryPlanDiagnostics(runId, 'Por que a Grande Tarefa GT-2 ainda não foi concluída?');
  assert.ok(q5.directAnswer.includes('GT-2'), `Resposta Q5 deve explicar pendências de GT-2: ${q5.directAnswer}`);

  const q6 = AutonomousManager.queryPlanDiagnostics(runId, 'O que falta para o projeto terminar?');
  assert.ok(q6.remainingForProjectCompletion.pendingMicrotasksCount === 2);

  // Cenário 16: Pergunta conversacional no chat NÃO cria tarefa executável
  const tasksCountBeforeQuestion = AutonomousManager.getRun(runId).tasks.length;
  const intentClassification = ChatIntentClassifier.classify(
    'Quais requisitos ainda faltam e por que a Grande Tarefa GT-2 ainda não foi concluída?'
  );
  assert.notEqual(
    intentClassification.intent,
    'EXECUTION_INSTRUCTION',
    `Pergunta diagnóstica jamais deve ser classificada como EXECUTION_INSTRUCTION (obteve ${intentClassification.intent})`
  );
  const tasksCountAfterQuestion = AutonomousManager.getRun(runId).tasks.length;
  assert.equal(
    tasksCountAfterQuestion,
    tasksCountBeforeQuestion,
    'Pergunta conversacional no chat nunca deve criar microtarefas no plano'
  );

  // Cenário 17: Instrução executável cria/expande o plano de forma rastreável
  const replanRes = AutonomousManager.replanRun({
    runId,
    userRequest: 'Adicione assinatura HMAC SHA-256 nos relatórios exportados em src/hmacSignature.cjs',
    replanType: 'NEW_FEATURE',
    newMajorTaskTitle: 'Segurança de Exportação HMAC',
    newMicrotasks: [
      {
        title: 'Implementar assinatura HMAC em relatórios: Criar src/hmacSignature.cjs',
        objective: 'Assinar relatórios com HMAC SHA-256',
        description: 'Criar função signReport(payload, secret) em src/hmacSignature.cjs.',
        criteria: ['Gerar assinatura HMAC válida'],
        expectedFiles: ['src/hmacSignature.cjs'],
        verificationCommand: 'npm test'
      }
    ]
  });
  assert.equal(replanRes.addedMicrotasks.length, 1);
  assert.equal(replanRes.addedMicrotasks[0].replan_type, 'NEW_FEATURE');
  assert.equal(AutonomousManager.getRun(runId).tasks.length, tasksCountBeforeQuestion + 1);
});

test('HOMOLOGAÇÃO COMPLETA (Seção 10): Projeto Web Financeiro Complexo de Ponta a Ponta (>12 tarefas, 10 domínios, descoberta dinâmica, reprovação/retrabalho, commits reais e conclusão 100% verificada)', async () => {
  const repoDir = createTempGitRepo('decohub-finance-homolog-');
  const briefing =
    'Construa um sistema financeiro web completo, com autenticação, dashboard, receitas e despesas, categorias, filtros, relatórios, persistência de dados, segurança, testes e interface responsiva.';

  const { projectId, runId } = registerProjectAndRun(
    repoDir,
    'DecoHUB Finance Web Enterprise',
    briefing,
    briefing
  );

  // 1. Decomposição adaptativa completa do sistema financeiro web
  const decomp = AutonomousManager.decomposeProjectAdaptively({
    projectId,
    runId,
    projectPath: repoDir,
    briefing,
    ensureFullCoverage: true
  });

  // Verificações estruturais da decomposição (Seções 2, 3, 4 e 10)
  assert.equal(decomp.complexityAnalysis.complexityTier, 'ENTERPRISE');
  assert.ok(
    decomp.projectRequirements.length >= 10,
    `Deve extrair pelo menos os 10 requisitos funcionais/técnicos do sistema financeiro, extraiu ${decomp.projectRequirements.length}`
  );
  assert.ok(
    decomp.majorTasks.length >= 6,
    `Deve organizar o sistema financeiro em >= 6 Grandes Tarefas, gerou ${decomp.majorTasks.length}`
  );
  assert.ok(
    decomp.microtasks.length >= 14,
    `Deve decompor em >= 14 microtarefas atômicas e verificáveis, gerou ${decomp.microtasks.length}`
  );

  const diagInitial = AutonomousManager.queryPlanDiagnostics(runId);
  assert.equal(
    diagInitial.uncoveredRequirements.length,
    0,
    'Nenhum requisito do briefing financeiro pode ficar sem tarefa associada'
  );

  // 2. Implementar os artefatos reais do Sistema Financeiro Web no repositório para que os testes reais ("npm test") validem cada módulo
  fs.mkdirSync(path.join(repoDir, 'public'), { recursive: true });

  const moduleImplementations: Record<string, string> = {
    'src/db.cjs': `const fs = require('node:fs');
const path = require('node:path');
class FinanceStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(__dirname, '..', 'data-finance.json');
    this.state = { users: [], categories: [], transactions: [], auditLogs: [] };
    this._load();
  }
  _load() {
    if (fs.existsSync(this.filePath)) {
      try { this.state = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "hierarchicalTaskReengineering.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:hierarchicalTaskReengineering.test]", err);
      }
    }
    }
  }
  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }
}
module.exports = { FinanceStore };
`,
    'src/security.cjs': `const crypto = require('node:crypto');
function sanitizeInput(str) {
  return String(str || '').replace(/[<>]/g, '').trim();
}
function hashPassword(password, salt = 'decohub-salt') {
  return crypto.pbkdf2Sync(String(password), salt, 1000, 32, 'sha256').toString('hex');
}
function verifyCsrfToken(token, expected) {
  return Boolean(token && expected && token === expected);
}
module.exports = { sanitizeInput, hashPassword, verifyCsrfToken };
`,
    'src/auth.cjs': `const crypto = require('node:crypto');
const { hashPassword, sanitizeInput } = require('./security.cjs');
class AuthService {
  constructor(store) {
    this.store = store;
    this.sessions = new Map();
  }
  register(email, password, name) {
    const cleanEmail = sanitizeInput(email).toLowerCase();
    if (!cleanEmail.includes('@') || String(password).length < 6) throw new Error('INVALID_CREDENTIALS');
    if (this.store.state.users.some(u => u.email === cleanEmail)) throw new Error('USER_EXISTS');
    const user = { id: crypto.randomUUID(), email: cleanEmail, name: sanitizeInput(name), passwordHash: hashPassword(password) };
    this.store.state.users.push(user);
    this.store.save();
    return { id: user.id, email: user.email, name: user.name };
  }
  login(email, password) {
    const cleanEmail = sanitizeInput(email).toLowerCase();
    const user = this.store.state.users.find(u => u.email === cleanEmail && u.passwordHash === hashPassword(password));
    if (!user) throw new Error('AUTH_FAILED');
    const token = crypto.randomUUID();
    this.sessions.set(token, { userId: user.id, createdAt: Date.now() });
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  }
  verifySession(token) {
    return this.sessions.get(token) || null;
  }
}
module.exports = { AuthService };
`,
    'src/categories.cjs': `const crypto = require('node:crypto');
const { sanitizeInput } = require('./security.cjs');
class CategoryService {
  constructor(store) { this.store = store; }
  create(input) {
    const name = sanitizeInput(input.name);
    if (!name) throw new Error('CATEGORY_NAME_REQUIRED');
    const type = input.type === 'income' ? 'income' : 'expense';
    const cat = { id: crypto.randomUUID(), name, type, budgetLimit: Number(input.budgetLimit || 0) };
    this.store.state.categories.push(cat);
    this.store.save();
    return cat;
  }
  list() { return [...this.store.state.categories]; }
}
module.exports = { CategoryService };
`,
    'src/transactions.cjs': `const crypto = require('node:crypto');
const { sanitizeInput } = require('./security.cjs');
class TransactionService {
  constructor(store) { this.store = store; }
  add(input) {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
    if (!['income', 'expense'].includes(input.type)) throw new Error('INVALID_TYPE');
    const tx = {
      id: crypto.randomUUID(),
      title: sanitizeInput(input.title || 'Lançamento'),
      amount: Math.round(amount * 100) / 100,
      type: input.type,
      categoryId: input.categoryId || 'default',
      date: input.date || new Date().toISOString().slice(0, 10)
    };
    this.store.state.transactions.push(tx);
    this.store.save();
    return tx;
  }
  getSummary() {
    let income = 0, expense = 0;
    for (const tx of this.store.state.transactions) {
      if (tx.type === 'income') income += tx.amount;
      else expense += tx.amount;
    }
    return { income: Math.round(income * 100) / 100, expense: Math.round(expense * 100) / 100, balance: Math.round((income - expense) * 100) / 100 };
  }
}
module.exports = { TransactionService };
`,
    'src/filters.cjs': `function filterTransactions(transactions, query = {}) {
  return transactions.filter(tx => {
    if (query.type && tx.type !== query.type) return false;
    if (query.categoryId && tx.categoryId !== query.categoryId) return false;
    if (query.startDate && tx.date < query.startDate) return false;
    if (query.endDate && tx.date > query.endDate) return false;
    if (query.search && !tx.title.toLowerCase().includes(String(query.search).toLowerCase())) return false;
    return true;
  });
}
module.exports = { filterTransactions };
`,
    'src/reports.cjs': `function generateFinancialReport(transactions, categories = []) {
  const byCategory = {};
  let totalIncome = 0, totalExpense = 0;
  for (const tx of transactions) {
    if (tx.type === 'income') totalIncome += tx.amount;
    else totalExpense += tx.amount;
    byCategory[tx.categoryId] = (byCategory[tx.categoryId] || 0) + tx.amount;
  }
  const csvHeader = 'id,date,title,type,categoryId,amount';
  const csvRows = transactions.map(t => \`\${t.id},\${t.date},"\${t.title}",\${t.type},\${t.categoryId},\${t.amount}\`);
  return {
    totalIncome,
    totalExpense,
    netBalance: Math.round((totalIncome - totalExpense) * 100) / 100,
    byCategory,
    categoriesCount: categories.length,
    csv: [csvHeader, ...csvRows].join('\\n')
  };
}
module.exports = { generateFinancialReport };
`,
    'public/index.html': `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DecoHUB Finance — Dashboard Financeiro</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="topbar"><h1>DecoHUB Finance</h1></header>
  <main class="dashboard-grid">
    <section id="kpi-cards" class="kpi-section"></section>
    <section id="transactions-section" class="panel"></section>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
    'public/styles.css': `:root { --bg: #0b0f19; --card: #111827; --accent: #6366f1; }
body { margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: #f9fafb; }
.dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; padding: 1rem; }
@media (max-width: 768px) { .dashboard-grid { grid-template-columns: 1fr; } }
`
  };

  for (const [relPath, content] of Object.entries(moduleImplementations)) {
    const abs = path.join(repoDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }

  // Criar suíte de testes reais do projeto financeiro
  fs.writeFileSync(
    path.join(repoDir, 'test', 'finance.test.cjs'),
    `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { FinanceStore } = require('../src/db.cjs');
const { AuthService } = require('../src/auth.cjs');
const { CategoryService } = require('../src/categories.cjs');
const { TransactionService } = require('../src/transactions.cjs');
const { filterTransactions } = require('../src/filters.cjs');
const { generateFinancialReport } = require('../src/reports.cjs');
const { sanitizeInput } = require('../src/security.cjs');

test('Fluxo financeiro integrado: Auth, Persistência, Categorias, Receitas/Despesas, Filtros, Relatórios, Segurança e UI Responsiva', () => {
  const tmpFile = path.join(os.tmpdir(), 'finance-store-' + Date.now() + '.json');
  const store = new FinanceStore(tmpFile);
  const auth = new AuthService(store);
  const cats = new CategoryService(store);
  const txs = new TransactionService(store);

  const user = auth.register('admin@decohub.local', 'StrongPass123', '<script>Admin</script>');
  assert.equal(user.name, 'scriptAdmin/script');
  const session = auth.login('admin@decohub.local', 'StrongPass123');
  assert.ok(auth.verifySession(session.token));

  const catSalary = cats.create({ name: 'Salário', type: 'income', budgetLimit: 0 });
  const catFood = cats.create({ name: 'Alimentação', type: 'expense', budgetLimit: 1500 });
  assert.equal(cats.list().length, 2);

  txs.add({ title: 'Salário Mensal', amount: 8500, type: 'income', categoryId: catSalary.id, date: '2026-10-05' });
  txs.add({ title: 'Supermercado', amount: 650.5, type: 'expense', categoryId: catFood.id, date: '2026-10-10' });

  const summary = txs.getSummary();
  assert.equal(summary.income, 8500);
  assert.equal(summary.expense, 650.5);
  assert.equal(summary.balance, 7849.5);

  const expensesOnly = filterTransactions(store.state.transactions, { type: 'expense', search: 'super' });
  assert.equal(expensesOnly.length, 1);

  const report = generateFinancialReport(store.state.transactions, cats.list());
  assert.equal(report.netBalance, 7849.5);
  assert.ok(report.csv.includes('Supermercado'));
  assert.equal(sanitizeInput('<b>Seguro</b>'), 'bSeguro/b');

  // Verificar persistência em disco, tratamento adversarial de entradas inválidas e UI responsiva
  assert.throws(() => txs.add({ title: 'INVALID', amount: -50, type: 'income' }), /INVALID_AMOUNT/);
  assert.throws(() => auth.register('INVALID', '123', null), /INVALID_CREDENTIALS/);
  const reloaded = new FinanceStore(tmpFile);
  assert.equal(reloaded.state.transactions.length, 2);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf-8');
  assert.ok(css.includes('@media'));
});
`,
    'utf-8'
  );

  // 3. Executar todas as microtarefas em ordem topológica real, incluindo:
  //    - 1 descoberta dinâmica de subtarefa durante a execução
  //    - 1 reprovação pelo Review independente seguida de retrabalho aprovado
  let dynamicSubtaskInjected = false;
  let reworkSimulated = false;
  let safetyCounter = 0;

  while (safetyCounter++ < 60) {
    const available = AutonomousManager.getAvailableTasks(runId);
    if (available.length === 0) break;

    const currentTask = available[0];
    AutonomousManager.claimTask(runId, currentTask.id, 'Antigravity-Worker-1');

    // Na 3ª tarefa executada, descobrir dinamicamente uma subtarefa adicional de validação de orçamento
    if (!dynamicSubtaskInjected && safetyCounter === 3) {
      dynamicSubtaskInjected = true;
      AutonomousManager.discoverDynamicSubtasks({
        runId,
        originTaskId: currentTask.id,
        targetMajorTaskId: currentTask.major_task_id,
        discoveredFrom: 'execution_gap',
        reason: 'Descoberta necessidade de alerta de estouro de orçamento por categoria durante implementação',
        subtasks: [
          {
            title: 'Implementar alerta de limite de orçamento por categoria: Criar src/budgetAlert.cjs',
            objective: 'Emitir alerta quando despesas da categoria ultrapassarem budgetLimit',
            description: 'Criar função checkBudgetAlert(category, spent) em src/budgetAlert.cjs.',
            stageCode: currentTask.stage_code || undefined,
            stageTitle: currentTask.stage_title || undefined,
            requirementIds: currentTask.requirement_ids_json ? JSON.parse(currentTask.requirement_ids_json) : [],
            criteria: ['Retornar exceeded=true quando gasto > limite'],
            expectedFiles: ['src/budgetAlert.cjs'],
            verificationCommand: 'npm test'
          }
        ]
      });
    }

    // Garantir que os arquivos esperados pela microtarefa existem e são atualizados com rastreabilidade
    const expectedFiles: string[] = currentTask.expected_files?.length
      ? currentTask.expected_files
      : ['src/module-' + currentTask.id.slice(0, 6) + '.cjs'];

    for (const relFile of expectedFiles) {
      const absFile = path.join(repoDir, relFile);
      fs.mkdirSync(path.dirname(absFile), { recursive: true });
      if (!fs.existsSync(absFile)) {
        if (relFile.endsWith('.html')) {
          fs.writeFileSync(absFile, `<!-- ${currentTask.title} -->\n<div class="finance-widget">${currentTask.title}</div>\n`, 'utf-8');
        } else if (relFile.endsWith('.css')) {
          fs.writeFileSync(absFile, `/* ${currentTask.title} */\n@media (max-width: 768px) { .finance-widget { width: 100%; } }\n`, 'utf-8');
        } else {
          fs.writeFileSync(
            absFile,
            `// ${currentTask.code}: ${currentTask.title}\nmodule.exports = { taskCode: ${JSON.stringify(currentTask.code)}, verified: true };\n`,
            'utf-8'
          );
        }
      } else {
        const existing = fs.readFileSync(absFile, 'utf-8');
        const marker = relFile.endsWith('.html')
          ? `\n<!-- task:${currentTask.code} -->\n`
          : `\n/* task:${currentTask.code} */\n`;
        if (!existing.includes(`task:${currentTask.code}`)) {
          fs.writeFileSync(absFile, existing + marker, 'utf-8');
        }
      }
    }

    const taskCriteria: string[] = currentTask.criteria?.length ? currentTask.criteria : [`Entrega de ${currentTask.title}`];

    // Simular 1 ciclo real de reprovação pelo Review -> REWORK_REQUIRED -> correção e aprovação na 2ª tentativa
    if (!reworkSimulated && safetyCounter === 2) {
      reworkSimulated = true;
      AutonomousManager.submitBuilderReport({
        runId,
        taskId: currentTask.id,
        status: 'partial',
        filesChanged: expectedFiles,
        implemented: [taskCriteria[0]],
        testsRun: 'npm test',
        testResults: 'Falha parcial de cobertura na primeira tentativa',
        buildStatus: 'Passed',
        knownProblems: ['Faltou cobrir caso de borda de validação']
      });

      const rejectedRes = AutonomousManager.submitSupervisorReview({
        runId,
        taskId: currentTask.id,
        verdict: 'CHANGES_REQUESTED',
        feedback: 'Adicione tratamento de caso de borda e reexecute os testes.'
      });
      assert.equal(rejectedRes.reviewDecision.decision, 'REJECTED');

      // Re-reivindicar a tarefa liberada para retrabalho
      const readyAgain = AutonomousManager.getAvailableTasks(runId);
      assert.ok(readyAgain.some((t: any) => t.id === currentTask.id), 'Tarefa reprovada deve voltar a ficar disponível para retrabalho');
      AutonomousManager.claimTask(runId, currentTask.id, 'Antigravity-Worker-1');
    }

    // Submeter relatório completo e avaliar com IndependentEvaluator real
    AutonomousManager.submitBuilderReport({
      runId,
      taskId: currentTask.id,
      status: 'success',
      filesChanged: expectedFiles,
      implemented: taskCriteria,
      testsRun: 'npm test',
      testResults: 'Passed',
      buildStatus: 'Passed'
    });

    const evalResult = await IndependentEvaluator.evaluate(
      currentTask.contract_id,
      repoDir,
      {
        status: 'success',
        filesChanged: expectedFiles,
        implemented: taskCriteria,
        commandsExecuted: ['npm test'],
        tests: { ran: true, command: 'npm test', passed: true },
        buildStatus: 'Passed',
        problems: [],
        decisions: []
      },
      { expectedScopeFiles: expectedFiles }
    );
    assert.equal(evalResult.verdict, 'PASS', `Evaluator deve aprovar microtarefa ${currentTask.code} (${currentTask.title}): ${evalResult.actual}`);

    const reviewRes = AutonomousManager.submitSupervisorReview({
      runId,
      taskId: currentTask.id,
      verdict: 'APPROVED',
      feedback: `Microtarefa ${currentTask.code} verificada com sucesso.`,
      evaluation: evalResult,
      requireGitCommit: true
    });
    assert.equal(reviewRes.reviewDecision.decision, 'APPROVED');
    assert.ok(reviewRes.commitGate?.committed && reviewRes.commitGate?.commitSha, 'Cada microtarefa aprovada deve gerar commit Git rastreável');
  }

  // 4. Submeter revisão final do Supervisor e validar conclusão integral do projeto (Seções 5, 7 e 10)
  AutonomousManager.submitFinalProjectReview({
    runId,
    verdict: 'APPROVED',
    feedback: 'Sistema financeiro web completo homologado com 100% dos requisitos e testes verificados.'
  });

  const finalValidation = AutonomousManager.validateProjectFinalCompletion(runId);
  assert.equal(
    finalValidation.canComplete,
    true,
    `Projeto financeiro deve cumprir todos os critérios de conclusão final. Bloqueios: ${finalValidation.blockingReasons.join('; ')}`
  );

  const finalRun = AutonomousManager.getRun(runId);
  assert.equal(finalRun.stats.progressPct, 100, 'Progresso final deve atingir 100% após todos os requisitos serem verificados');
  assert.equal(finalRun.stats.requirementsVerificationPct, 100, '100% dos requisitos obrigatórios devem estar verificados');
  assert.ok(finalRun.majorTasks.every((m: any) => m.status === 'completed'), 'Todas as Grandes Tarefas devem estar concluídas');
  assert.ok(dynamicSubtaskInjected, 'Descoberta dinâmica deve ter ocorrido durante a homologação');
  assert.ok(reworkSimulated, 'Ciclo de reprovação e retrabalho deve ter ocorrido durante a homologação');
});
