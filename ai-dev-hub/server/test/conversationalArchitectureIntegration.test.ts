// server/test/conversationalArchitectureIntegration.test.ts
// Comprehensive regression and integration test suite validating Antigravity Conversational Architecture

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { ChatIntentClassifier } from '../src/chatIntentClassifier.js';
import { ProjectContextBridge } from '../src/projectContextBridge.js';
import { AntigravityConversationalService } from '../src/antigravityConversationalService.js';
import { ProjectChatService } from '../src/projectChatService.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { AgentApiGateway, DefaultFakeAgentApiProvider } from '../src/agentApiGateway.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';

describe('Arquitetura Conversacional Integrada com Antigravity', () => {
  let tempDir1: string;
  let tempDir2: string;
  let project1Id: string;
  let project2Id: string;
  let mockProvider: DefaultFakeAgentApiProvider;

  before(async () => {
    process.env.DECOHUB_OFFLINE_MODE = 'true';
    mockProvider = AgentApiGateway.installDefaultMock();

    // Create 2 isolated test project workspaces
    tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-test-proj1-'));
    tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-test-proj2-'));

    fs.mkdirSync(path.join(tempDir1, '.ai-dev-hub'), { recursive: true });
    fs.mkdirSync(path.join(tempDir2, '.ai-dev-hub'), { recursive: true });

    fs.writeFileSync(
      path.join(tempDir1, '.ai-dev-hub', 'project.md'),
      '# Projeto Alfa\nObjetivo: Sistema de Gestão Financeira Pessoal com Dashboard e Categorias.\n'
    );
    fs.writeFileSync(
      path.join(tempDir1, '.ai-dev-hub', 'decisions.md'),
      '# Decisões\n- **Decisão:** Uso de Clean Architecture com adaptadores em memória e arquivo.\n'
    );
    fs.writeFileSync(
      path.join(tempDir1, '.ai-dev-hub', 'tasks.md'),
      '# Tarefas\n## Concluído\n- [x] Configuração inicial\n## Pendente\n- [ ] Exportação em PDF\n'
    );

    fs.writeFileSync(
      path.join(tempDir2, '.ai-dev-hub', 'project.md'),
      '# Projeto Beta\nObjetivo: Aplicativo de Mensagens Instantâneas P2P com Criptografia E2E.\n'
    );

    project1Id = `proj-test-${crypto.randomUUID().slice(0, 8)}`;
    project2Id = `proj-test-${crypto.randomUUID().slice(0, 8)}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(project1Id, 'Projeto Financeiro Alfa', tempDir1, 'Sistema de Gestão Financeira Pessoal', 'TypeScript/Node.js', nowIso, nowIso);

    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(project2Id, 'Projeto Mensagens Beta', tempDir2, 'Aplicativo de Mensagens Instantâneas', 'Go/WebSockets', nowIso, nowIso);
  });

  after(() => {
    try { fs.rmSync(tempDir1, { recursive: true, force: true }); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "conversationalArchitectureIntegration.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:conversationalArchitectureIntegration.test]", err);
      }
    }
    try { fs.rmSync(tempDir2, { recursive: true, force: true }); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "conversationalArchitectureIntegration.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:conversationalArchitectureIntegration.test]", err);
      }
    }
    try { db.prepare('DELETE FROM projects WHERE id IN (?, ?)').run(project1Id, project2Id); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "conversationalArchitectureIntegration.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:conversationalArchitectureIntegration.test]", err);
      }
    }
    try { db.prepare('DELETE FROM autonomous_runs WHERE project_id IN (?, ?)').run(project1Id, project2Id); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "conversationalArchitectureIntegration.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:conversationalArchitectureIntegration.test]", err);
      }
    }
    try { db.prepare('DELETE FROM agent_sessions WHERE project_id IN (?, ?)').run(project1Id, project2Id); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "conversationalArchitectureIntegration.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:conversationalArchitectureIntegration.test]", err);
      }
    }
    AgentApiGateway.restoreLiveGateway();
  });

  // -------------------------------------------------------------
  // FASE 2 & 5: TESTES DE CONVERSA E QUALIDADE
  // -------------------------------------------------------------
  describe('Camada Conversacional (Conversa e Exploração de Ideias)', () => {
    test('1. Discussão técnica de arquitetura não inicia run e recebe resposta contextualizada', async () => {
      const intent = ChatIntentClassifier.classify('O que você acha dessa arquitetura?');
      assert.equal(intent.intent, 'CONVERSATION');
      assert.equal(intent.subType, 'ARCHITECTURE_DISCUSSION');

      const runsBefore = db.prepare('SELECT count(*) as cnt FROM autonomous_runs WHERE project_id = ?').get(project1Id) as any;

      const res = await ProjectChatService.handleConversationalMessageAsync({
        projectId: project1Id,
        content: 'O que você acha dessa arquitetura?',
        intentResult: intent
      });

      const runsAfter = db.prepare('SELECT count(*) as cnt FROM autonomous_runs WHERE project_id = ?').get(project1Id) as any;
      assert.equal(runsBefore.cnt, runsAfter.cnt, 'Nenhum Run deve ser criado para discussão de arquitetura');
      assert.ok(res.replyContent.length > 50, 'Deve gerar resposta técnica detalhada');
      assert.ok(/arquitetura|camada|modular/i.test(res.replyContent), 'Deve ponderar aspectos arquiteturais');
    });

    test('2. Exploração de ideias ("Será que vale a pena adicionar autenticação?") não enfileira tarefa', async () => {
      const intent = ChatIntentClassifier.classify('Será que vale a pena adicionar autenticação?');
      assert.equal(intent.intent, 'CONVERSATION');
      assert.equal(intent.subType, 'IDEA_EXPLORATION');

      const tasksBefore = db.prepare('SELECT count(*) as cnt FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').get(project1Id) as any;

      const res = await ProjectChatService.handleConversationalMessageAsync({
        projectId: project1Id,
        content: 'Será que vale a pena adicionar autenticação?',
        intentResult: intent
      });

      const tasksAfter = db.prepare('SELECT count(*) as cnt FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').get(project1Id) as any;
      assert.equal(tasksBefore.cnt, tasksAfter.cnt, 'Nenhuma tarefa deve ser criada para exploração de ideias');
      assert.ok(/trade-offs|benefício|complexidade|recomenda/i.test(res.replyContent));
    });

    test('3. Pergunta sobre logs consulta o estado real e não cria tarefa', async () => {
      const intent = ChatIntentClassifier.classify('Onde eu vejo a log?');
      assert.equal(intent.intent, 'STATE_QUERY');
      assert.equal(intent.subType, 'LOG_QUERY');

      const res = await ProjectChatService.handleConversationalMessageAsync({
        projectId: project1Id,
        content: 'Onde eu vejo a log?',
        intentResult: intent
      });

      assert.ok(res.replyContent.includes('backend.log'), 'Deve citar o log do backend');
      assert.ok(res.replyContent.includes('hub.db'), 'Deve citar o banco SQLite');
      assert.ok(res.replyContent.includes('terminal-logs'), 'Deve citar a pasta de logs de terminal');
    });

    test('4. Pergunta sobre trabalho restante ("O que falta para terminar o projeto?") consulta tarefas sem executar', async () => {
      const intent = ChatIntentClassifier.classify('O que falta para terminar o projeto?');
      assert.equal(intent.intent, 'STATE_QUERY');
      assert.equal(intent.subType, 'REMAINING_TASKS_QUERY');

      const res = await ProjectChatService.handleConversationalMessageAsync({
        projectId: project1Id,
        content: 'O que falta para terminar o projeto?',
        intentResult: intent
      });

      assert.ok(res.replyContent.length > 20);
    });

    test('5. Mensagens ambíguas provocam esclarecimento e não disparam execução destrutiva', async () => {
      const c1 = ChatIntentClassifier.classify('Isso está errado.');
      assert.equal(c1.intent, 'AMBIGUOUS');
      assert.equal(c1.subType, 'AMBIGUOUS_COMPLAINT');

      const c2 = ChatIntentClassifier.classify('Precisamos resolver isso.');
      assert.equal(c2.intent, 'AMBIGUOUS');
      assert.equal(c2.subType, 'AMBIGUOUS_COMPLAINT');

      const c3 = ChatIntentClassifier.classify('E agora?');
      assert.equal(c3.intent, 'AMBIGUOUS');
      assert.equal(c3.subType, 'AMBIGUOUS_UNCERTAIN');

      const res = await ProjectChatService.handleConversationalMessageAsync({
        projectId: project1Id,
        content: 'Isso está errado.',
        intentResult: c1
      });

      assert.ok(res.replyContent.includes('não iniciei alterações automaticamente'));
      assert.ok(res.replyContent.includes('Corrija a causa do erro identificado') || res.replyContent.includes('Qual foi o erro'));
    });
  });

  // -------------------------------------------------------------
  // FASE 3: CONTEXTO, INTEGRAÇÃO E ISOLAMENTO
  // -------------------------------------------------------------
  describe('Contexto, Integração e Isolamento entre Projetos', () => {
    test('6. ProjectContextBridge obtém dados autoritativos e isola projetos distintos', () => {
      const snap1 = ProjectContextBridge.getSnapshot(project1Id);
      const snap2 = ProjectContextBridge.getSnapshot(project2Id);

      assert.ok(snap1);
      assert.ok(snap2);
      assert.equal(snap1.project.name, 'Projeto Financeiro Alfa');
      assert.equal(snap2.project.name, 'Projeto Mensagens Beta');
      assert.notEqual(snap1.project.path, snap2.project.path);
      assert.ok(snap1.memory.decisionsMd.includes('Clean Architecture'));
      assert.equal(snap2.memory.decisionsMd.includes('Clean Architecture'), false, 'Não deve vazar decisões do Projeto 1 para o Projeto 2');
    });

    test('7. Sessão persistente CONVERSATIONAL é criada com papel dedicado no Antigravity', async () => {
      const { session, isNew } = await AgentSessionManager.getOrCreateAgentSession(project1Id, 'CONVERSATIONAL');
      assert.ok(session);
      assert.equal(session.role, 'CONVERSATIONAL');
      assert.equal(session.status, 'ACTIVE');

      // Reutilização idempotente da mesma sessão
      const { session: reused, isNew: isNewReused } = await AgentSessionManager.getOrCreateAgentSession(project1Id, 'CONVERSATIONAL');
      assert.equal(session.id, reused.id);
      assert.equal(isNewReused, false, 'Deve reutilizar a sessão conversacional ativa existente');
    });

    test('8. Falha de conexão ou ausência de projeto é reportada com declaração explícita', async () => {
      const res = await ProjectChatService.handleConversationalMessageAsync({
        projectId: 'inexistent-id-999',
        content: 'Olá',
        intentResult: { intent: 'CONVERSATION', subType: 'GENERAL_CONVERSATION', confidence: 0.9, explanation: '' }
      });
      assert.ok(res.replyContent.includes('não localizado'));
    });
  });

  // -------------------------------------------------------------
  // FASE 4: SEPARAÇÃO DE EXECUÇÃO NO BACKEND
  // -------------------------------------------------------------
  describe('Separação Estrita de Consulta e Execução', () => {
    test('9. Instrução explícita ("Corrija a causa do erro identificado.") é classificada para execução', () => {
      const intent = ChatIntentClassifier.classify('Corrija a causa do erro identificado.');
      assert.equal(intent.intent, 'EXECUTION_INSTRUCTION');
      assert.equal(intent.subType, 'FIX_AND_CONTINUE');
    });

    test('10. Instrução imperativa ("Implemente o filtro por categoria.") é classificada para execução', () => {
      const intent = ChatIntentClassifier.classify('Implemente o filtro por categoria.');
      assert.equal(intent.intent, 'EXECUTION_INSTRUCTION');
      assert.equal(intent.subType, 'BUILD_TASK');
    });

    test('11. Uma pergunta técnica ("Como poderíamos melhorar esse aplicativo?") JAMAIS vira execução', () => {
      const intent = ChatIntentClassifier.classify('Como poderíamos melhorar esse aplicativo?');
      assert.notEqual(intent.intent, 'EXECUTION_INSTRUCTION');
      assert.equal(intent.intent, 'CONVERSATION');
    });
  });

  // -------------------------------------------------------------
  // FASE 6: REVISÃO INDEPENDENTE E RESILIÊNCIA CONTRA REGRESSÕES
  // -------------------------------------------------------------
  describe('Diagnóstico de Revisão e Proteção contra Regressões', () => {
    test('12. Review rejeitado preserva problemas reais e não exibe elogios contraditórios', () => {
      const runId = `test-run-rej-${crypto.randomUUID().slice(0, 8)}`;
      const taskId = `test-task-rej-${crypto.randomUUID().slice(0, 8)}`;
      const nowIso = new Date().toISOString();

      db.prepare(`
        INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
        VALUES (?, ?, 'Run Teste', 'Objetivo', 'running', ?, ?, ?)
      `).run(runId, project1Id, nowIso, nowIso, nowIso);

      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, order_index, criteria_json, created_at, updated_at)
        VALUES (?, ?, 'Tarefa com falha', 'in_review', 'REVIEW_PENDING', 1, '["Critério A"]', ?, ?)
      `).run(taskId, runId, nowIso, nowIso);

      try {
        const reviewRes = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
          runId,
          taskId,
          projectPath: tempDir1,
          evaluationResult: {
            id: 'eval-fail-test',
            contractId: 'contract-1',
            taskId,
            verdict: 'FAIL',
            builderStatus: 'COMPLETED',
            evaluatorVerdict: 'FAIL',
            taskIsDone: false,
            passedCriteria: [],
            failedCriteria: ['Critério A'],
            evidence: {},
            expected: 'Pass',
            actual: 'Falha comprovada no teste unitário',
            evaluatorNotes: 'Reprovado pelo Evaluator: Critério A não atendido',
            executedCommands: ['npm test'],
            exitCode: 1,
            durationMs: 50,
            createdAt: nowIso
          },
          supervisorVerdict: 'APPROVED', // Supervisor erroneamente aprovou
          supervisorFeedback: 'Implementação formalmente aprovada com nota 10/10'
        });

        assert.equal(reviewRes.decision, 'REJECTED');
        assert.ok(!reviewRes.justification.includes('aprovada com nota 10/10'), 'Justificativa de reprovação não pode conter elogio contraditório');
        assert.ok(reviewRes.justification.includes('Critério A não atendido') || reviewRes.justification.includes('Reprovado'), 'Justificativa deve conter o motivo real da falha');
      } finally {
        try { db.prepare('DELETE FROM autonomous_tasks WHERE id = ?').run(taskId); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "conversationalArchitectureIntegration.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:conversationalArchitectureIntegration.test]", err);
      }
    }
        try { db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "conversationalArchitectureIntegration.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:conversationalArchitectureIntegration.test]", err);
      }
    }
      }
    });
  });
});
