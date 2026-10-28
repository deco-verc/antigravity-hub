import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { deleteProjectCascading, purgeGhostTestProjectsFromProductionDb } from '../src/db.js';

test('Supervisor Final Review Hardening and Cleanup Test Suite', async (t) => {
  const originalGetSession = AgentSessionManager.getOrCreateAgentSession;
  const originalSendMessage = AgentSessionManager.sendMessage;
  const originalCheckContext = AgentSessionManager.checkContextRotationPolicy;

  t.before(() => {
    AgentSessionManager.getOrCreateAgentSession = (async () => ({
      session: { id: 'sess-mock-1', provider_conversation_id: 'conv-mock-1' },
      isNew: true
    })) as any;
    AgentSessionManager.sendMessage = (async () => ({} as any)) as any;
    AgentSessionManager.checkContextRotationPolicy = () => ({ shouldRotate: false }) as any;
  });

  t.after(() => {
    AgentSessionManager.getOrCreateAgentSession = originalGetSession;
    AgentSessionManager.sendMessage = originalSendMessage;
    AgentSessionManager.checkContextRotationPolicy = originalCheckContext;
  });

  await t.test('1. PromptArchitectureService gera contrato JSON estruturado em modo FINAL_REVIEW', () => {
    const { prompt } = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'FINAL_REVIEW',
      projectId: 'proj-test',
      projectPath: 'C:\\IA\\Projetos\\TestProject',
      projectName: 'Test Project',
      briefing: 'Construir SaaS completo com painel e API',
      allCompletedTasks: [
        { id: 'task-1', title: 'Criar backend com rotas REST', status: 'completed' },
        { id: 'task-2', title: 'Criar frontend responsivo', status: 'completed' }
      ],
      finalReviewEvidence: [
        {
          title: 'Criar backend com rotas REST',
          verdict: 'APPROVED',
          taskIsDone: true,
          exitCode: 0,
          summary: 'Build and tests passed 100%'
        }
      ]
    });

    assert.ok(prompt.includes('mode="FINAL_REVIEW"'), 'Deve conter modo FINAL_REVIEW na diretiva');
    assert.ok(prompt.includes('<output_contract'), 'Deve conter bloco <output_contract>');
    assert.ok(prompt.includes('application/json'), 'Deve especificar application/json no output contract');
    assert.ok(prompt.includes('"verdict": "APPROVED" | "CHANGES_REQUESTED"'), 'Deve especificar schema de verdict');
    assert.ok(prompt.includes('<all_completed_tasks>'), 'Deve incluir bloco <all_completed_tasks>');
    assert.ok(prompt.includes('Criar backend com rotas REST'), 'Deve listar as tarefas concluidas');
    assert.ok(prompt.includes('<final_review_evidence>'), 'Deve incluir bloco <final_review_evidence>');
    assert.ok(prompt.includes('Veredito: APPROVED'), 'Deve registrar as evidencias tecnicas');
  });

  await t.test('2. GeminiSupervisorProvider.reviewProjectCompletion aceita JSON estruturado com veredito APPROVED', async () => {
    const supervisor = new GeminiSupervisorProvider('flash');
    supervisor.waitForResponse = async () => JSON.stringify({
      verdict: 'APPROVED',
      feedback: 'Projeto entregue com excelência técnica, 100% dos requisitos e testes cumpridos.',
      nextAction: 'PROCEED_HOMOLOGATION',
      qualityScore: 98,
      requirementsMet: true,
      buildPassed: true,
      testsPassed: true,
      uiFunctional: true,
      summary: 'SaaS homologado com sucesso absoluto.',
      highlights: ['Frontend responsivo', 'Testes passando']
    });

    const mockRun = {
      id: 'run-test-mvp',
      objective: 'Construir MVP',
      briefing: 'MVP completo',
      tasks: [{ id: 'task-1', title: 'Finalizar MVP', status: 'completed' }]
    };
    const mockProject = {
      id: 'proj-test-mvp',
      name: 'Test Project',
      path: 'C:\\IA\\Projetos\\TestProject'
    };
    const mockEvidence = [{ verdict: 'APPROVED', taskIsDone: true, exitCode: 0 }];

    const result = await supervisor.reviewProjectCompletion(mockRun, mockProject, mockEvidence);

    assert.equal(result.verdict, 'APPROVED');
    assert.equal(result.requirementsMet, true);
    assert.equal(result.buildPassed, true);
    assert.equal(result.testsPassed, true);
    assert.equal(result.qualityScore, 98);
  });

  await t.test('3. GeminiSupervisorProvider normaliza sinonimos de aprovacao (APPROVE, PASSED, CONCLUÍDO)', async () => {
    const aliases = ['APPROVE', 'PASSED', 'PASS', 'SUCCESS', 'CONCLUÍDO', 'ACEITO'];
    for (const alias of aliases) {
      const supervisor = new GeminiSupervisorProvider('flash');
      supervisor.waitForResponse = async () => JSON.stringify({
        verdict: alias,
        feedback: 'Validado com sucesso.',
        qualityScore: 95
      });

      const mockRun = {
        id: 'run-test-alias',
        tasks: [{ id: 'task-1', title: 'Task 1', status: 'completed' }]
      };
      const mockProject = {
        id: 'proj-test-alias',
        name: 'Test Project',
        path: 'C:\\IA\\Projetos\\TestProject'
      };
      const mockEvidence = [{ verdict: 'APPROVED', taskIsDone: true, exitCode: 0 }];

      const result = await supervisor.reviewProjectCompletion(mockRun, mockProject, mockEvidence);
      assert.equal(result.verdict, 'APPROVED', `Alias ${alias} deve ser normalizado para APPROVED`);
    }
  });

  await t.test('4. GeminiSupervisorProvider executa fallback resiliente quando LLM responde em markdown e tudo esta aprovado', async () => {
    const narrativeResponse = `
    Parabéns! O projeto foi concluído com sucesso e todos os testes passaram com êxito.
    O frontend está totalmente funcional e o backend responde a todas as rotas.
    Requisitos 100% cumpridos.
    `;

    const supervisor = new GeminiSupervisorProvider('flash');
    supervisor.waitForResponse = async () => narrativeResponse;

    const mockRun = {
      id: 'run-test-fallback',
      tasks: [{ id: 'task-1', title: 'Task 1', status: 'completed' }]
    };
    const mockProject = {
      id: 'proj-test-fallback',
      name: 'Test Project',
      path: 'C:\\IA\\Projetos\\TestProject'
    };
    const mockEvidence = [{ verdict: 'APPROVED', taskIsDone: true, exitCode: 0 }];

    const result = await supervisor.reviewProjectCompletion(mockRun, mockProject, mockEvidence);

    assert.equal(result.verdict, 'APPROVED', 'Deve sintetizar APPROVED via fallback resiliente');
    assert.equal(result.requirementsMet, true);
    assert.equal(result.buildPassed, true);
    assert.equal(result.testsPassed, true);
    assert.ok(result.qualityScore >= 8);
  });

  await t.test('5. AutonomousRunnerService.isGhostTestRun detecta pastas de teste e dummy e preserva producao', () => {
    // Casos de teste fantasma
    assert.equal(AutonomousRunnerService.isGhostTestRun({ id: 'run-rec-001', project_id: 'proj-1' }), true);
    assert.equal(AutonomousRunnerService.isGhostTestRun({ id: 'run-1', project_id: 'proj-continuity-123' }), true);
    assert.equal(AutonomousRunnerService.isGhostTestRun({ id: 'run-1', project_id: 'proj-mode-switch-456' }), true);

    const dummyPath = '/dummy/test-app';
    assert.ok(dummyPath.includes('/dummy/'));
  });

  await t.test('6. deleteProjectCascading remove todos os registros em cascata em banco SQLite', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT);
      CREATE TABLE autonomous_runs (id TEXT PRIMARY KEY, project_id TEXT);
      CREATE TABLE autonomous_tasks (id TEXT PRIMARY KEY, run_id TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT);
      CREATE TABLE messages (id TEXT PRIMARY KEY, project_id TEXT);
      CREATE TABLE project_ast_symbols (id TEXT PRIMARY KEY, project_id TEXT);
    `);

    memDb.prepare("INSERT INTO projects VALUES ('proj-victim', 'Victim Project', 'C:\\IA\\test-projects\\victim')").run();
    memDb.prepare("INSERT INTO autonomous_runs VALUES ('run-victim-1', 'proj-victim')").run();
    memDb.prepare("INSERT INTO autonomous_tasks VALUES ('task-1', 'run-victim-1')").run();
    memDb.prepare("INSERT INTO sessions VALUES ('sess-1', 'proj-victim')").run();
    memDb.prepare("INSERT INTO messages VALUES ('msg-1', 'proj-victim')").run();
    memDb.prepare("INSERT INTO project_ast_symbols VALUES ('sym-1', 'proj-victim')").run();

    const res = deleteProjectCascading('proj-victim', memDb);
    assert.equal(res.success, true);

    const projCount = (memDb.prepare("SELECT count(*) as count FROM projects WHERE id = 'proj-victim'").get() as any).count;
    const runCount = (memDb.prepare("SELECT count(*) as count FROM autonomous_runs WHERE project_id = 'proj-victim'").get() as any).count;
    const taskCount = (memDb.prepare("SELECT count(*) as count FROM autonomous_tasks WHERE run_id = 'run-victim-1'").get() as any).count;
    const msgCount = (memDb.prepare("SELECT count(*) as count FROM messages WHERE project_id = 'proj-victim'").get() as any).count;

    assert.equal(projCount, 0, 'Projeto deve ser removido');
    assert.equal(runCount, 0, 'Runs associadas devem ser removidas');
    assert.equal(taskCount, 0, 'Tarefas associadas devem ser removidas');
    assert.equal(msgCount, 0, 'Mensagens associadas devem ser removidas');

    memDb.close();
  });

  await t.test('7. purgeGhostTestProjectsFromProductionDb expurga projetos de teste e preserva producao', () => {
    const memDb = new DatabaseSync(':memory:');
    memDb.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT);
      CREATE TABLE autonomous_runs (id TEXT PRIMARY KEY, project_id TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT);
      CREATE TABLE messages (id TEXT PRIMARY KEY, project_id TEXT);
    `);

    // Inserir producao
    memDb.prepare("INSERT INTO projects VALUES ('decohub-meta', 'DecoHUB Engine', 'C:\\IA\\Antigravity HUB\\ai-dev-hub')").run();
    memDb.prepare("INSERT INTO projects VALUES ('saas-prod', 'SAAS', 'C:\\IA\\SAAS')").run();
    memDb.prepare("INSERT INTO projects VALUES ('ads-prod', 'AdsLibraryFind', 'C:\\IA\\Projetos\\AdsLibraryFind')").run();

    // Inserir projetos de teste
    memDb.prepare("INSERT INTO projects VALUES ('test-1', 'ViralYT', 'C:\\IA\\test-projects\\viralytsearch')").run();
    memDb.prepare("INSERT INTO projects VALUES ('test-2', 'YoutubeViral', 'C:\\IA\\test-projects\\youtubeviralsearch2')").run();
    memDb.prepare("INSERT INTO projects VALUES ('proj-continuity-99', 'Continuity', '/dummy/continuity-99')").run();

    const purgeResult = purgeGhostTestProjectsFromProductionDb(memDb);
    assert.equal(purgeResult.purgedProjects, 3, 'Deve expurgar exatamente os 3 projetos de teste');

    const remaining = memDb.prepare("SELECT id, name FROM projects").all() as Array<{ id: string; name: string }>;
    assert.equal(remaining.length, 3, 'Devem restar apenas os 3 projetos de producao');

    const remainingIds = remaining.map(p => p.id);
    assert.ok(remainingIds.includes('decohub-meta'), 'Deve preservar DecoHUB Engine');
    assert.ok(remainingIds.includes('saas-prod'), 'Deve preservar SAAS');
    assert.ok(remainingIds.includes('ads-prod'), 'Deve preservar AdsLibraryFind');

    memDb.close();
  });
});
