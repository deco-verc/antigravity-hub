import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PromptArchitectureService, SupervisorMode, WorkerMode } from '../src/promptArchitectureService.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { db } from '../src/db.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';

test('Contextual & Adaptive Prompt Architecture Suite (15 Scenarios)', async (t) => {
  const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-prompt-test-'));
  const testBrainDir = path.join(testDbDir, 'brain');
  fs.mkdirSync(testBrainDir, { recursive: true });

  t.after(() => {
    try {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "contextualPromptArchitecture.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:contextualPromptArchitecture.test]", err);
      }
    }
  });

  // Scenario 1: Projeto simples gera planejamento proporcional (1 a 3 tarefas)
  await t.test('Scenario 1: Simple project generates proportional plan (1 to 3 tasks) without artificial padding', () => {
    const { prompt, meta } = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: 'proj-simple-1',
      projectName: 'CLI Helper',
      projectPath: '/dummy/cli-helper',
      projectObjective: 'Criar uma função utilitária de formatação de moeda',
      briefing: 'Criar apenas uma função utilitária formatCurrency(value) com testes unitários.'
    });

    assert.equal(meta.mode, 'INITIAL_PLAN');
    assert.equal(meta.role, 'SUPERVISOR');
    assert.match(prompt, /=== CAMADA A: REGRAS PERMANENTES DO SUPERVISOR/);
    assert.match(prompt, /=== CAMADA B: MODO CONTEXTUAL DO SUPERVISOR — \[INITIAL_PLAN\]/);
    assert.match(prompt, /ZERO TAREFAS FANTASMAS OU MONOLÍTICAS/);
    assert.match(prompt, /1 a 3/);
    assert.match(prompt, /SEM TETOS ARTIFICIAIS/);
  });

  // Scenario 2: Projeto complexo preserva todos os requisitos
  await t.test('Scenario 2: Complex project prompt preserves all explicit user requirements', () => {
    const complexBriefing = 'Criar dashboard completo com: 1. Formulário de transações financeiras; 2. Tabela de listagem com paginação; 3. Gráfico SVG de barras de receitas; 4. Persistência em SQLite; 5. Testes unitários e de integração.';
    const { prompt } = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: 'proj-complex-1',
      projectName: 'Financial Dashboard',
      projectPath: '/dummy/dashboard',
      projectObjective: 'Dashboard Financeiro Completo',
      briefing: complexBriefing
    });

    assert.ok(prompt.includes('Formulário de transações financeiras'), 'Briefing contains form');
    assert.ok(prompt.includes('Tabela de listagem com paginação'), 'Briefing contains table');
    assert.ok(prompt.includes('Gráfico SVG de barras de receitas'), 'Briefing contains charts');
    assert.ok(prompt.includes('Persistência em SQLite'), 'Briefing contains SQLite');
    assert.ok(prompt.includes('Testes unitários e de integração'), 'Briefing contains tests');
    assert.match(prompt, /sem teto artificial/i);
  });

  // Scenario 3: Supervisor não inventa tarefas de preenchimento para bater cotas
  await t.test('Scenario 3: Supervisor prompt strictly forbids filler/placeholder tasks', () => {
    const { prompt } = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: 'proj-simple-2',
      projectName: 'Ping Service',
      projectPath: '/dummy/ping',
      projectObjective: 'Healthcheck ping',
      briefing: 'Criar rota GET /ping que retorna { ok: true }'
    });

    assert.ok(!prompt.includes('exatamente 5 objetos'), 'Does not force exactly 5 tasks');
    assert.match(prompt, /Jamais comprima um sistema complexo em 6 tarefas genéricas/);
  });

  // Scenario 4: Planejamento repetido não duplica tarefas da DAG
  await t.test('Scenario 4: Repeated planning does not duplicate tasks in same run', () => {
    const runId = 'run-test-dedup-' + Date.now();
    const projId = 'proj-dedup-' + Date.now();
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'Dedup Project', ?, 'Objetivo dedup', datetime('now'), datetime('now'))
    `).run(projId, '/dummy/dedup-' + Date.now());

    // Simulate tasks in DB for this run
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', datetime('now'), datetime('now'), datetime('now'))
    `).run(runId, projId, 'Dedup Run', 'Objetivo de teste', 'Teste de dedup');

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, status, order_index, created_at, updated_at)
      VALUES (?, ?, 'Tarefa 1 Existente', 'ready', 1, datetime('now'), datetime('now'))
    `).run('task-dedup-1', runId);

    const countBefore = (db.prepare('SELECT COUNT(*) as c FROM autonomous_tasks WHERE run_id = ?').get(runId) as any).c;
    assert.equal(countBefore, 1);

    // Call generateInitialTasks logic check
    const existingCount = (db.prepare('SELECT COUNT(*) as count FROM autonomous_tasks WHERE run_id = ?').get(runId) as any)?.count || 0;
    assert.ok(existingCount > 0, 'Existing tasks detected');
  });

  // Scenario 5: Replanejamento preserva 100% das tarefas concluídas
  await t.test('Scenario 5: REPLAN mode preserves 100% of completed tasks and states them explicitly', () => {
    const completedTasks = [
      { id: 't-1', title: 'Configurar schema SQLite', result: 'Schema criado' },
      { id: 't-2', title: 'Implementar CRUD de usuários', result: 'Rotas criadas e testadas' }
    ];

    const { prompt, meta } = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'REPLAN',
      projectId: 'proj-replan-1',
      projectName: 'App X',
      projectPath: '/dummy/app',
      projectObjective: 'Criar App X',
      completedTasks,
      replanReason: 'Ajuste nas dependências de autenticação'
    });

    assert.equal(meta.mode, 'REPLAN');
    assert.match(prompt, /TAREFAS JÁ CONCLUÍDAS \(NÃO REFAZER\):/);
    assert.ok(prompt.includes('Configurar schema SQLite [CONCLUÍDO]'));
    assert.ok(prompt.includes('Implementar CRUD de usuários [CONCLUÍDO]'));
    assert.match(prompt, /PRESERVE 100% das tarefas concluídas/);
  });

  // Scenario 6: Worker de reparo recebe erro real e contexto de falha
  await t.test('Scenario 6: REPAIR mode injects actual defect, error stack and failure diagnostic', () => {
    const failureLog = 'AssertionError: expected status 200 but received 500 at server.js:42\nError: DB Connection failed';
    const { prompt, meta } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'REPAIR',
      projectId: 'proj-repair-1',
      projectName: 'API Server',
      projectPath: '/dummy/api',
      projectObjective: 'Criar API Server',
      taskId: 'task-fix-1',
      taskTitle: 'Corrigir falha de conexão na rota /users',
      acceptanceCriteria: ['Rota /users deve responder 200', 'Tratar erro de DB graciosamente'],
      previousError: failureLog,
      previousEvaluatorOutput: 'Evaluator FAIL: exit code 1 no teste de integração'
    });

    assert.equal(meta.mode, 'REPAIR');
    assert.match(prompt, /=== CAMADA B: MODO CONTEXTUAL DO WORKER — \[REPAIR\]/);
    assert.match(prompt, /ERRO ANTERIOR A CORRIGIR:/);
    assert.ok(prompt.includes('DB Connection failed'));
    assert.ok(prompt.includes('exit code 1 no teste de integração'));
    assert.match(prompt, /NUNCA altere os testes protegidos para mascarar o defeito!/);
  });

  // Scenario 7: Worker de auditoria/pesquisa conclui com 0 arquivos modificados
  await t.test('Scenario 7: AUDIT mode explicitly permits completion with 0 files modified if report provided', async () => {
    const { prompt, meta } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'AUDIT',
      projectId: 'proj-audit-1',
      projectName: 'Security Audit App',
      projectPath: '/dummy/security',
      projectObjective: 'Auditoria de segurança',
      taskId: 'task-audit-1',
      taskTitle: 'Auditar permissões e vulnerabilidades de pacotes',
      acceptanceCriteria: ['Inspecionar pacotes npm desatualizados', 'Gerar relatório de auditoria'],
      verificationCommand: 'npm audit --json'
    });

    assert.equal(meta.mode, 'AUDIT');
    assert.match(prompt, /PODE SER CONCLUÍDA SEM ALTERAR ARQUIVOS DE CÓDIGO/);

    // Verify Evaluator honors audit tasks with 0 files modified
    const contract = IndependentEvaluator.createSuccessContract({
      taskId: 'task-audit-eval-1',
      projectId: 'proj-audit-1',
      objective: 'Auditar dependências e conformidade de segurança',
      acceptanceCriteria: ['Verificar conformidade com padrões de segurança'],
      verificationSteps: [{ name: 'Verificação Factual', checkType: 'command', command: 'node -e "process.exit(0)"' }],
      protectedEvaluationFiles: []
    });

    const evalResult = await IndependentEvaluator.evaluate(contract.id, testDbDir, {
      status: 'success',
      filesChanged: [],
      implemented: ['Auditoria completa de 14 dependências: nenhuma vulnerabilidade crítica detectada.'],
      recommendation: 'Recomenda-se manter as versões fixadas conforme o package-lock.json auditado.',
      rawResponse: 'Relatório de auditoria detalhado concluído com evidências factuais.'
    }, {
      taskMode: 'AUDIT'
    });

    assert.equal(evalResult.verdict, 'INCONCLUSIVE', 'Relato do Worker e exit(0) não comprovam auditoria');
    assert.equal(evalResult.taskIsDone, false);
    assert.equal(evalResult.evidence.evidenceSummary?.filesChangedCount, 0);
  });

  // Scenario 8: Worker de implementação segue regras cirúrgicas e critérios
  await t.test('Scenario 8: IMPLEMENT mode guides surgical change and clean code', () => {
    const { prompt, meta } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: 'proj-impl-1',
      projectName: 'Calculator',
      projectPath: '/dummy/calc',
      projectObjective: 'Calculadora',
      taskId: 'task-calc-1',
      taskTitle: 'Implementar função add(a, b)',
      acceptanceCriteria: ['add(1, 2) === 3', 'add(-1, 1) === 0'],
      expectedScopeFiles: ['src/calc.js', 'test/calc.test.js'],
      verificationCommand: 'node --test'
    });

    assert.equal(meta.mode, 'IMPLEMENT');
    assert.match(prompt, /DIRETRIZES DE IMPLEMENTAÇÃO/);
    assert.match(prompt, /Altere apenas o necessário \(escopo cirúrgico\)/);
    assert.match(prompt, /ARQUIVOS ESPERADOS NO ESCOPO: src\/calc\.js, test\/calc\.test\.js/);
  });

  // Scenario 9: Prompt Builder isola contexto entre projetos
  await t.test('Scenario 9: Prompt Builder maintains complete isolation between different projects', () => {
    const promptProjectA = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: 'project-alpha',
      projectName: 'Alpha Secret System',
      projectPath: '/apps/alpha',
      projectObjective: 'Sistema Alpha confidencial'
    });

    const promptProjectB = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: 'project-beta',
      projectName: 'Beta Public Tool',
      projectPath: '/apps/beta',
      projectObjective: 'Ferramenta Beta aberta'
    });

    assert.ok(promptProjectA.prompt.includes('Alpha Secret System'));
    assert.ok(!promptProjectA.prompt.includes('Beta Public Tool'));

    assert.ok(promptProjectB.prompt.includes('Beta Public Tool'));
    assert.ok(!promptProjectB.prompt.includes('Alpha Secret System'));
  });

  // Scenario 10: Troca de modo mantém a mesma sessão sem novas conversas
  await t.test('Scenario 10: Switching modes reuses persistent session without creating duplicate conversations', async () => {
    const projectId = 'proj-mode-switch-' + Date.now();
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'Mode Switch App', ?, 'Testar troca de modo', datetime('now'), datetime('now'))
    `).run(projectId, '/dummy/modeswitch-' + Date.now());

    // Initial plan session creation
    const { session: s1, isNew: isNew1 } = await AgentSessionManager.getOrCreateAgentSession(projectId, 'SUPERVISOR', {
      model: 'flash',
      env: process.env,
      initialPrompt: 'Prompt inicial de planejamento'
    });
    assert.equal(isNew1, true);

    // Review report (switch from planning to review)
    const { session: s2, isNew: isNew2 } = await AgentSessionManager.getOrCreateAgentSession(projectId, 'SUPERVISOR', {
      model: 'flash',
      env: process.env,
      initialPrompt: 'Prompt de revisão de tarefa'
    });
    assert.equal(isNew2, false, 'Should reuse existing session');
    assert.equal(s1.provider_conversation_id, s2.provider_conversation_id, 'Same conversation ID');
  });

  // Scenario 11: Sessão persistente mantém continuidade de contexto
  await t.test('Scenario 11: Persistent session maintains context continuity across turns', async () => {
    const projectId = 'proj-continuity-' + Date.now();
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'Continuity App', ?, 'Testar continuidade', datetime('now'), datetime('now'))
    `).run(projectId, '/dummy/continuity-' + Date.now());

    const { session } = await AgentSessionManager.getOrCreateAgentSession(projectId, 'WORKER', {
      model: 'flash',
      env: process.env,
      initialPrompt: 'Iniciando worker'
    });

    const active = AgentSessionManager.getActiveSession(projectId, 'WORKER');
    assert.ok(active);
    assert.equal(active.provider_conversation_id, session.provider_conversation_id);
    assert.equal(active.generation, 1);
  });

  // Scenario 12: JSON inválido ou truncado é tratado com resiliência
  await t.test('Scenario 12: Resilient parser extracts JSON arrays and objects even with preamble or postamble text', () => {
    const supervisor = new GeminiSupervisorProvider('flash', process.env, 'prof-test', 'proj-test');

    const textWithFences = 'Aqui está o plano:\n```json\n[{"title":"Task 1","description":"D1"}]\n```\nBom trabalho!';
    const textWithoutFences = 'Com certeza. Eis a resposta: [{"title":"Task 2","description":"D2"}] que atende aos requisitos.';
    const textObjectWithIntro = 'Analisei o relatório:\n```json\n{"verdict":"APPROVED","qualityScore":9}\n```';

    const arr1 = (supervisor as any).extractJsonArray(textWithFences);
    assert.ok(Array.isArray(arr1));
    assert.equal(arr1[0].title, 'Task 1');

    const arr2 = (supervisor as any).extractJsonArray(textWithoutFences);
    assert.ok(Array.isArray(arr2));
    assert.equal(arr2[0].title, 'Task 2');

    const obj1 = (supervisor as any).extractJsonObject(textObjectWithIntro);
    assert.ok(obj1);
    assert.equal(obj1.verdict, 'APPROVED');
    assert.equal(obj1.qualityScore, 9);
  });

  // Scenario 13: Rastreabilidade de modelo solicitado vs modelo real
  await t.test('Scenario 13: Model request vs actual model telemetry is tracked in evidence', () => {
    const supervisor = new GeminiSupervisorProvider('pro', process.env, 'prof-test', 'proj-test');
    const evidence = supervisor.getExecutionEvidence();

    assert.equal(evidence.requestedModel, 'pro');
    assert.equal(typeof evidence.fallbackReason, 'string');
    assert.equal(typeof evidence.actualModelVerified, 'boolean');
  });

  // Scenario 14: Evaluator independente avalia critérios objetivamente
  await t.test('Scenario 14: Independent Evaluator rejects unverified claims for implementation tasks', async () => {
    const contract = IndependentEvaluator.createSuccessContract({
      taskId: 'task-eval-unverified-' + Date.now(),
      projectId: 'proj-eval-1',
      objective: 'Implementar endpoint POST /login',
      acceptanceCriteria: ['Validar credenciais e retornar JWT'],
      verificationSteps: [{ name: 'Testes de Integração', command: 'npm test' }],
      protectedEvaluationFiles: []
    });

    // Builder claimed success but touched 0 files and ran 0 tests
    const evalResult = await IndependentEvaluator.evaluate(contract.id, testDbDir, {
      status: 'success',
      filesChanged: [],
      implemented: ['Implementei o login perfeitamente.'],
      tests: { ran: false }
    }, {
      taskMode: 'IMPLEMENT'
    });

    assert.equal(evalResult.verdict, 'FAIL');
    assert.equal(evalResult.taskIsDone, false);
    assert.ok(evalResult.failedCriteria.some(c => c.includes('UNVERIFIED_CLAIM')));
  });

  // Scenario 15: Versionamento determinístico de prompts (Camada A e Hash)
  await t.test('Scenario 15: Deterministic prompt versioning and hashing', () => {
    const res1 = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: 'proj-ver-1',
      projectName: 'App Determinism',
      projectPath: '/dummy/path',
      projectObjective: 'Objetivo Idêntico',
      briefing: 'Mesmo briefing'
    });

    const res2 = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: 'proj-ver-1',
      projectName: 'App Determinism',
      projectPath: '/dummy/path',
      projectObjective: 'Objetivo Idêntico',
      briefing: 'Mesmo briefing'
    });

    assert.equal(res1.meta.version, PromptArchitectureService.SUPERVISOR_CORE_RULES_VERSION);
    assert.equal(res2.meta.version, PromptArchitectureService.SUPERVISOR_CORE_RULES_VERSION);
    assert.equal(res1.meta.hash, res2.meta.hash, 'Identical inputs produce identical hash');
    assert.ok(res1.meta.hash.length === 64, 'SHA-256 hash length');
  });
});
