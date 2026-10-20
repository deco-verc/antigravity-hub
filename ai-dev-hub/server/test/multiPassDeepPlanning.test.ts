import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { db } from '../src/db.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { GeminiSupervisorProvider, PlannedTask } from '../src/geminiSupervisorProvider.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';

function createTempGitRepo(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@decohub.local"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "DecoHUB Test"', { cwd: dir, stdio: 'ignore' });

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'decohub-multipass-test',
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
    VALUES (?, ?, ?, ?, ?, 'Node.js, TypeScript, SQLite', 'active', 1, 1, ?, ?)
  `).run(projectId, name, repoDir, objective, briefing || objective, nowIso, nowIso);

  db.prepare(`
    INSERT INTO autonomous_runs (
      id, project_id, name, objective, briefing, status, autonomy_mode,
      max_hours, max_cycles, current_cycle, start_time, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'running', 'autonomous', 8, 100, 1, ?, ?, ?)
  `).run(runId, projectId, `Run ${name}`, objective, briefing || objective, nowIso, nowIso, nowIso);

  return { projectId, runId };
}

test('Multi-Pass Deep Planning 1: Planejamento Multi-Pass com briefing complexo gerando >15 microtarefas sem ciclos e com 100% de cobertura', async () => {
  const repoDir = createTempGitRepo('decohub-deep-plan-');
  const complexBriefing = `
Construir um SaaS completo de Gestão de Assinaturas e Cobranças Recorrentes contendo:
1. Esquema de banco de dados SQLite com migrations para contas, planos, assinaturas, faturas e transações.
2. Camada de autenticação JWT com hash seguro de senhas e middleware de autorização por perfil.
3. Motor de cálculos financeiros com prorata, cálculo de faturamento mensal/anual e aplicação de cupons.
4. Endpoints de API REST para gestão de planos, clientes, assinaturas e webhooks com retry e idempotência.
5. Interface de usuário responsiva com dashboard de métricas (MRR, Churn), formulários dinâmicos e relatórios exportáveis.
6. Suíte abrangente de testes automatizados unitários, de integração e validação ponta a ponta.
  `.trim();

  const { projectId } = registerProjectAndRun(
    repoDir,
    'SaaS Assinaturas',
    'Construir SaaS completo de Gestão de Assinaturas',
    complexBriefing
  );

  const supervisor = new GeminiSupervisorProvider('flash', undefined, undefined, projectId);

  // Executa o planejamento Multi-Pass (duas ondas)
  const plannedTasks = await supervisor.planTasks(complexBriefing, {
    name: 'SaaS Assinaturas',
    path: repoDir,
    objective: 'Construir SaaS completo de Gestão de Assinaturas',
    id: projectId
  }, {
    multiPass: true,
    deepPlanning: true
  });

  // 1. O número de microtarefas deve escalar além do antigo limite de 6 tarefas (> 15 tarefas)
  assert.ok(
    plannedTasks.length >= 15,
    `O plano multi-pass deve gerar mais de 15 microtarefas atômicas (gerou: ${plannedTasks.length})`
  );

  // 2. As microtarefas devem estar distribuídas em múltiplas Grandes Tarefas (GT-1 a GT-6)
  const majorCodes = new Set(plannedTasks.map(t => t.majorTaskCode || t.milestone));
  assert.ok(majorCodes.size >= 4, `O plano deve cobrir pelo menos 4 Grandes Tarefas distintas (encontradas: ${majorCodes.size})`);
  assert.ok(majorCodes.has('GT-1'), 'Deve conter GT-1 (Scaffolding/Infra)');
  assert.ok(majorCodes.has('GT-2'), 'Deve conter GT-2 (Modelagem/Persistência)');
  assert.ok(majorCodes.has('GT-3'), 'Deve conter GT-3 (Domínio/Cálculos)');
  assert.ok(majorCodes.has('GT-6'), 'Deve conter GT-6 (Testes/Homologação)');

  // 3. Verificação contra ciclos no DAG
  const dagCheck = HierarchicalOrchestrationService.detectCircularDependencies(
    plannedTasks.map(t => ({
      id: t.code || t.title,
      title: t.title,
      code: t.code,
      dependencies: t.dependencies || []
    }))
  );
  assert.equal(dagCheck.hasCycle, false, `O plano multi-pass NÃO deve conter ciclos no DAG. Ciclo detectado: ${dagCheck.cyclePath.join(' -> ')}`);
  assert.equal(dagCheck.cyclePath.length, 0, 'O caminho de ciclo deve estar vazio');

  // 4. Todas as microtarefas devem ter critérios verificáveis, arquivos delimitados e comando de teste
  for (const t of plannedTasks) {
    assert.ok(t.title && t.title.trim().length > 0, 'Toda tarefa deve possuir título válido');
    assert.ok(Array.isArray(t.criteria) && t.criteria.length >= 2, `Tarefa "${t.title}" deve ter pelo menos 2 critérios de aceitação`);
    assert.ok(t.verificationCommand && t.verificationCommand.trim().length > 0, `Tarefa "${t.title}" deve ter comando de verificação`);
    assert.ok(
      (Array.isArray(t.expectedFiles) && t.expectedFiles.length > 0) ||
      (Array.isArray(t.expectedScopeFiles) && t.expectedScopeFiles.length > 0) ||
      (Array.isArray(t.allowedScope) && t.allowedScope.length > 0),
      `Tarefa "${t.title}" deve ter arquivos de escopo delimitados`
    );
    assert.ok(t.doneWhen && t.doneWhen.trim().length > 0, `Tarefa "${t.title}" deve ter contrato doneWhen explícito`);
  }

  // 5. Rastreabilidade de requisitos: requisitos extraídos devem estar vinculados às microtarefas
  const allLinkedReqIds = new Set(plannedTasks.flatMap(t => t.requirementIds || []));
  assert.ok(allLinkedReqIds.size >= 3, `Pelo menos 3 requisitos devem estar vinculados às tarefas (vinculados: ${allLinkedReqIds.size})`);
});

test('Multi-Pass Deep Planning 2: Resiliência a tarefas parciais e eliminação do portão tudo-ou-nada', () => {
  const repoDir = createTempGitRepo('decohub-resilience-');

  // Lote bruto com 20 tarefas: 17 completas, 2 parciais (sem critérios/doneWhen/verificationCommand) e 1 corrompida (sem título/inválida)
  const rawBatch: any[] = [];

  for (let i = 1; i <= 17; i++) {
    rawBatch.push({
      code: `1.${i}`,
      majorTaskCode: 'GT-1',
      title: `Tarefa Completa ${i}: Implementar módulo ${i}`,
      description: `Descrição detalhada do módulo ${i}`,
      milestone: 'GT-1',
      orderIndex: i,
      dependencies: i > 1 ? [`1.${i - 1}`] : [],
      criteria: [`Critério 1 da tarefa ${i}`, `Critério 2 da tarefa ${i}`],
      verificationCommand: 'npm test',
      doneWhen: 'Critérios verificados com código 0.',
      expectedFiles: [`src/module${i}.ts`]
    });
  }

  // Tarefa parcial 1: sem criteria, sem verificationCommand, sem doneWhen, sem expectedFiles, sem orderIndex
  rawBatch.push({
    title: 'Configurar monitoramento Sentry e métricas operacionais',
    description: 'Adicionar instrumentação de erros e métricas',
    majorTaskCode: 'GT-1'
  });

  // Tarefa parcial 2: usa "name" em vez de "title", sem criteria, sem verificationCommand
  rawBatch.push({
    name: 'Adicionar compressão gzip HTTP e cache headers',
    description: 'Ativar middleware de compressão e cabeçalhos de cache',
    majorTaskCode: 'GT-1'
  });

  // Tarefa corrompida 3: sem título, objeto com campos vazios (irrecuperável)
  rawBatch.push({
    title: '   ',
    description: 'objeto sem título válido',
    dependencies: []
  });

  assert.equal(rawBatch.length, 20, 'O lote bruto deve conter exatamente 20 itens');

  // Executa sanitizeAndRepairPlannedTask individualmente
  const sanitizedList: PlannedTask[] = [];
  let droppedCount = 0;

  for (let idx = 0; idx < rawBatch.length; idx++) {
    const repaired = GeminiSupervisorProvider.sanitizeAndRepairPlannedTask(rawBatch[idx], repoDir, idx + 1);
    if (repaired) {
      sanitizedList.push(repaired);
    } else {
      droppedCount++;
    }
  }

  // A tarefa corrompida deve ser descartada, e as 2 parciais devem ser reparadas com sucesso
  assert.equal(droppedCount, 1, 'Exatamente 1 tarefa corrompida deve ter sido descartada');
  assert.equal(sanitizedList.length, 19, 'Exatamente 19 tarefas válidas devem ter sido preservadas');

  // Verifica que a tarefa parcial 1 foi devidamente reparada
  const repairedTask1 = sanitizedList.find(t => t.title.includes('Configurar monitoramento Sentry'));
  assert.ok(repairedTask1, 'A tarefa parcial 1 deve ter sido preservada');
  assert.ok(repairedTask1.criteria.length >= 2, 'Critérios de aceitação devem ter sido auto-gerados para a tarefa parcial 1');
  assert.equal(repairedTask1.verificationCommand, 'npm test', 'Comando de verificação padrão deve ter sido atribuído');
  assert.ok(repairedTask1.doneWhen && repairedTask1.doneWhen.includes('Critérios verificados'), 'doneWhen deve ter sido auto-gerado');

  // Verifica que a tarefa parcial 2 (com "name") foi devidamente reparada
  const repairedTask2 = sanitizedList.find(t => t.title.includes('Adicionar compressão gzip'));
  assert.ok(repairedTask2, 'A tarefa parcial 2 deve ter sido recuperada via campo "name"');
  assert.equal(repairedTask2.title, 'Adicionar compressão gzip HTTP e cache headers');
  assert.ok(repairedTask2.criteria.length >= 2, 'Critérios devem ter sido auto-gerados');

  // Adiciona uma dependência para uma tarefa inexistente/descartada em uma das tarefas
  sanitizedList[0].dependencies = ['Tarefa Descartada Inexistente', sanitizedList[1].title];

  // Executa validateAndRefinePlanQuality
  const refined = GeminiSupervisorProvider.validateAndRefinePlanQuality(sanitizedList);

  assert.equal(refined.length, 19, 'Todas as 19 tarefas devem permanecer preservadas após validação de qualidade');
  // Dependência não-existente deve ter sido limpa automaticamente para prevenir deadlock no DAG
  assert.ok(
    !refined[0].dependencies.includes('Tarefa Descartada Inexistente'),
    'Dependência quebrada apontando para tarefa descartada deve ser removida'
  );
  assert.ok(
    refined[0].dependencies.includes(sanitizedList[1].title),
    'Dependência válida existente deve ser mantida'
  );
});

test('Multi-Pass Deep Planning 3: Integração E2E com persistHierarchicalPlan e escalabilidade do scheduler no SQLite', () => {
  const repoDir = createTempGitRepo('decohub-e2e-scheduler-');
  const briefing = `
Construir sistema de faturamento e pagamentos:
1. Modelagem de dados e migrations relacionais em SQLite
2. Regras de domínio e validação de cupons de desconto
3. Endpoints HTTP para processamento de cobranças
4. Interface de visualização de faturas e recibos
5. Testes automatizados de integração
  `.trim();

  const { projectId, runId } = registerProjectAndRun(
    repoDir,
    'Faturamento E2E',
    'Construir sistema de faturamento e pagamentos',
    briefing
  );

  // Gera tarefas multi-pass estruturadas
  const multiPassTasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
    briefing,
    projectPath: repoDir,
    projectName: 'Faturamento E2E',
    projectId
  });

  assert.ok(multiPassTasks.length >= 15, `Deve gerar >= 15 tarefas (gerou: ${multiPassTasks.length})`);

  // Persiste o plano no banco SQLite via persistHierarchicalPlan
  const persisted = HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId,
    runId,
    projectPath: repoDir,
    originalDescription: briefing,
    flatTasks: multiPassTasks.map(t => ({
      code: t.code,
      title: t.title,
      description: t.description,
      majorTaskCode: t.majorTaskCode,
      majorTaskTitle: t.majorTaskTitle,
      stageCode: t.stageCode,
      stageTitle: t.stageTitle,
      milestone: t.milestone,
      orderIndex: t.orderIndex,
      dependencies: t.dependencies,
      criteria: t.criteria,
      verificationCommand: t.verificationCommand,
      doneWhen: t.doneWhen,
      expectedFiles: t.expectedFiles,
      allowedScope: t.allowedScope,
      requirementIds: t.requirementIds
    })),
    subdivideOversized: false
  });

  // 1. Verifica persistência das Grandes Tarefas no banco SQLite
  const dbMajorTasks: any[] = db.prepare(
    'SELECT * FROM autonomous_major_tasks WHERE run_id = ? ORDER BY order_index ASC'
  ).all(runId);
  assert.ok(dbMajorTasks.length >= 4, `Grandes Tarefas devem estar gravadas no SQLite (encontradas: ${dbMajorTasks.length})`);

  // 2. Verifica persistência das Microtarefas no banco SQLite
  const dbMicrotasks: any[] = db.prepare(
    'SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC'
  ).all(runId);
  assert.ok(dbMicrotasks.length >= 15, `Microtarefas devem estar gravadas no SQLite (encontradas: ${dbMicrotasks.length})`);

  // 3. Verifica persistência dos Requisitos Estruturados
  const dbReqs: any[] = db.prepare(
    'SELECT * FROM project_requirements WHERE run_id = ? ORDER BY rowid ASC'
  ).all(runId);
  assert.ok(dbReqs.length >= 2, `Requisitos estruturados devem estar gravados no SQLite (encontrados: ${dbReqs.length})`);

  // 4. Scheduler inicial: apenas as tarefas da primeira Grande Tarefa sem dependências devem estar elegíveis (READY)
  const initialSchedule = HierarchicalOrchestrationService.getEligibleParallelTasks(runId);
  assert.ok(initialSchedule.eligibleTasks.length >= 1, 'Pelo menos uma tarefa deve estar inicialmente elegível');

  const firstEligible = initialSchedule.eligibleTasks[0];
  assert.equal(firstEligible.code, '1.1', 'A primeira microtarefa elegível deve ser a 1.1');
  assert.equal(firstEligible.lifecycle_state, 'READY', 'A tarefa 1.1 deve estar em estado READY');

  // Tarefas subsequentes com dependências não concluídas devem permanecer PLANNED
  const task1_2 = dbMicrotasks.find(t => t.code === '1.2');
  assert.ok(task1_2, 'A microtarefa 1.2 deve existir no banco');
  assert.equal(task1_2.lifecycle_state, 'PLANNED', 'A microtarefa 1.2 deve estar PLANNED inicialmente aguardando a 1.1');

  const task2_1 = dbMicrotasks.find(t => t.code === '2.1');
  assert.ok(task2_1, 'A microtarefa 2.1 deve existir no banco');
  assert.equal(task2_1.lifecycle_state, 'PLANNED', 'A microtarefa 2.1 deve estar PLANNED aguardando a conclusão de GT-1');

  // 5. Simula a conclusão da tarefa 1.1 e valida que o scheduler libera a 1.2
  db.prepare("UPDATE autonomous_tasks SET status = 'completed', lifecycle_state = 'COMPLETED', task_commit_sha = 'abc1234' WHERE id = ?").run(firstEligible.id);
  HierarchicalOrchestrationService.recalculateMajorTaskState(firstEligible.major_task_id, 'supervisor');

  // Atualiza o estado da 1.2 para READY pois sua dependência 1.1 agora está concluída
  const postStepSchedule = HierarchicalOrchestrationService.getEligibleParallelTasks(runId);
  const eligibleCodes = postStepSchedule.eligibleTasks.map(t => t.code);
  assert.ok(
    eligibleCodes.includes('1.2'),
    `A tarefa 1.2 deve tornar-se elegível após a conclusão da 1.1 (elegíveis atuais: ${eligibleCodes.join(', ')})`
  );
  assert.ok(
    !eligibleCodes.includes('2.1'),
    'A tarefa 2.1 da GT-2 NÃO deve estar elegível antes de todas as tarefas de GT-1 serem concluídas'
  );

  // 6. Conclui as demais tarefas de GT-1 e valida que a microtarefa 2.1 de GT-2 é liberada
  db.prepare("UPDATE autonomous_tasks SET status = 'completed', lifecycle_state = 'COMPLETED', task_commit_sha = 'cde5678' WHERE run_id = ? AND major_task_id = ?").run(runId, firstEligible.major_task_id);
  HierarchicalOrchestrationService.recalculateMajorTaskState(firstEligible.major_task_id, 'supervisor');

  const postGt1Schedule = HierarchicalOrchestrationService.getEligibleParallelTasks(runId);
  const postGt1Codes = postGt1Schedule.eligibleTasks.map(t => t.code);
  assert.ok(
    postGt1Codes.includes('2.1'),
    `A tarefa 2.1 de GT-2 deve tornar-se elegível após a conclusão integral de GT-1 (elegíveis atuais: ${postGt1Codes.join(', ')})`
  );
});
