import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { ChatIntentClassifier } from '../src/chatIntentClassifier.js';
import { ProjectChatService } from '../src/projectChatService.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { db, getHubDataDir } from '../src/db.js';

test('ChatIntentClassifier — 12 Frases Obrigatórias em Português', async (t) => {
  // 1. "Qual foi o erro?" -> STATE_QUERY (ERROR_QUERY)
  await t.test('1. "Qual foi o erro?" -> STATE_QUERY', () => {
    const res = ChatIntentClassifier.classify('Qual foi o erro?');
    assert.equal(res.intent, 'STATE_QUERY');
    assert.equal(res.subType, 'ERROR_QUERY');
  });

  // 2. "Onde eu vejo a log?" -> STATE_QUERY (LOG_QUERY)
  await t.test('2. "Onde eu vejo a log?" -> STATE_QUERY', () => {
    const res = ChatIntentClassifier.classify('Onde eu vejo a log?');
    assert.equal(res.intent, 'STATE_QUERY');
    assert.equal(res.subType, 'LOG_QUERY');
  });

  // 3. "Mostre os logs desta execução" -> STATE_QUERY (LOG_QUERY)
  await t.test('3. "Mostre os logs desta execução" -> STATE_QUERY', () => {
    const res = ChatIntentClassifier.classify('Mostre os logs desta execução');
    assert.equal(res.intent, 'STATE_QUERY');
    assert.equal(res.subType, 'LOG_QUERY');
  });

  // 4. "Por que o Review rejeitou?" -> STATE_QUERY (REVIEW_QUERY)
  await t.test('4. "Por que o Review rejeitou?" -> STATE_QUERY', () => {
    const res = ChatIntentClassifier.classify('Por que o Review rejeitou?');
    assert.equal(res.intent, 'STATE_QUERY');
    assert.equal(res.subType, 'REVIEW_QUERY');
  });

  // 5. "Como está o andamento?" -> STATE_QUERY (PROGRESS_QUERY)
  await t.test('5. "Como está o andamento?" -> STATE_QUERY', () => {
    const res = ChatIntentClassifier.classify('Como está o andamento?');
    assert.equal(res.intent, 'STATE_QUERY');
    assert.equal(res.subType, 'PROGRESS_QUERY');
  });

  // 6. "Você já corrigiu o erro?" -> CONVERSATION (STATUS_INQUIRY)
  await t.test('6. "Você já corrigiu o erro?" -> CONVERSATION', () => {
    const res = ChatIntentClassifier.classify('Você já corrigiu o erro?');
    assert.equal(res.intent, 'CONVERSATION');
    assert.equal(res.subType, 'STATUS_INQUIRY');
  });

  // 7. "Por que você não corrigiu o erro?" -> CONVERSATION (EXPLANATION_REQUEST)
  await t.test('7. "Por que você não corrigiu o erro?" -> CONVERSATION', () => {
    const res = ChatIntentClassifier.classify('Por que você não corrigiu o erro?');
    assert.equal(res.intent, 'CONVERSATION');
    assert.equal(res.subType, 'EXPLANATION_REQUEST');
  });

  // 8. "Corrija o erro e continue" -> EXECUTION_INSTRUCTION (FIX_AND_CONTINUE)
  await t.test('8. "Corrija o erro e continue" -> EXECUTION_INSTRUCTION', () => {
    const res = ChatIntentClassifier.classify('Corrija o erro e continue');
    assert.equal(res.intent, 'EXECUTION_INSTRUCTION');
    assert.equal(res.subType, 'FIX_AND_CONTINUE');
  });

  // 9. "Implemente o dashboard e teste" -> EXECUTION_INSTRUCTION (BUILD_TASK)
  await t.test('9. "Implemente o dashboard e teste" -> EXECUTION_INSTRUCTION', () => {
    const res = ChatIntentClassifier.classify('Implemente o dashboard e teste');
    assert.equal(res.intent, 'EXECUTION_INSTRUCTION');
    assert.equal(res.subType, 'BUILD_TASK');
  });

  // 10. "Podemos corrigir isso?" -> AMBIGUOUS (CAPABILITY_OR_PROPOSAL)
  await t.test('10. "Podemos corrigir isso?" -> AMBIGUOUS', () => {
    const res = ChatIntentClassifier.classify('Podemos corrigir isso?');
    assert.equal(res.intent, 'AMBIGUOUS');
    assert.equal(res.subType, 'CAPABILITY_OR_PROPOSAL');
  });

  // 11. "Não faça mais nada; explique o erro" -> STATE_QUERY (ERROR_QUERY)
  await t.test('11. "Não faça mais nada; explique o erro" -> STATE_QUERY', () => {
    const res = ChatIntentClassifier.classify('Não faça mais nada; explique o erro');
    assert.equal(res.intent, 'STATE_QUERY');
    assert.equal(res.subType, 'ERROR_QUERY');
  });

  // 12. "Pare e me mostre os logs" -> STATE_QUERY (LOG_QUERY)
  await t.test('12. "Pare e me mostre os logs" -> STATE_QUERY', () => {
    const res = ChatIntentClassifier.classify('Pare e me mostre os logs');
    assert.equal(res.intent, 'STATE_QUERY');
    assert.equal(res.subType, 'LOG_QUERY');
  });
});

test('ChatIntentClassifier — 12 Frases Canônicas da Auditoria Independente', async (t) => {
  const canonicalAuditPhrases = [
    { text: 'Qual foi o erro?', expectedIntent: 'STATE_QUERY', expectedSubType: 'ERROR_QUERY' },
    { text: 'Onde eu vejo os logs?', expectedIntent: 'STATE_QUERY', expectedSubType: 'LOG_QUERY' },
    { text: 'Por que o Review rejeitou?', expectedIntent: 'STATE_QUERY', expectedSubType: 'REVIEW_QUERY' },
    { text: 'O que você acha dessa arquitetura?', expectedIntent: 'CONVERSATION', expectedSubType: 'ARCHITECTURE_DISCUSSION' },
    { text: 'Será que vale a pena adicionar autenticação?', expectedIntent: 'CONVERSATION', expectedSubType: 'IDEA_EXPLORATION' },
    { text: 'Podemos corrigir isso?', expectedIntent: 'AMBIGUOUS', expectedSubType: 'CAPABILITY_OR_PROPOSAL' },
    { text: 'Corrija o erro e continue.', expectedIntent: 'EXECUTION_INSTRUCTION', expectedSubType: 'FIX_AND_CONTINUE' },
    { text: 'Não faça nada ainda; primeiro explique o problema.', expectedIntent: 'STATE_QUERY', expectedSubType: 'ERROR_QUERY' },
    { text: 'Olhe o arquivo e me diga o que está errado.', expectedIntent: 'STATE_QUERY', expectedSubType: 'ERROR_QUERY' },
    { text: 'Pode corrigir isso?', expectedIntent: 'AMBIGUOUS', expectedSubType: 'CAPABILITY_OR_PROPOSAL' },
    { text: 'Vamos resolver esse erro.', expectedIntent: 'AMBIGUOUS', expectedSubType: 'AMBIGUOUS_COMPLAINT' },
    { text: 'Pare e me mostre os logs.', expectedIntent: 'STATE_QUERY', expectedSubType: 'LOG_QUERY' },
  ];

  for (const item of canonicalAuditPhrases) {
    await t.test(`Frase: "${item.text}"`, () => {
      const res = ChatIntentClassifier.classify(item.text);
      assert.equal(res.intent, item.expectedIntent, `Intent incorreto para "${item.text}"`);
      assert.equal(res.subType, item.expectedSubType, `SubType incorreto para "${item.text}"`);
    });
  }
});

test('ChatIntentClassifier — Variações robustas de pontuação e acentos', () => {
  assert.equal(ChatIntentClassifier.classify('qual foi o erro  ?').intent, 'STATE_QUERY');
  assert.equal(ChatIntentClassifier.classify('Onde eu vejo a log ?').intent, 'STATE_QUERY');
  assert.equal(ChatIntentClassifier.classify('onde ficam os logs?').intent, 'STATE_QUERY');
  assert.equal(ChatIntentClassifier.classify('qual é o erro?').intent, 'STATE_QUERY');
  assert.equal(ChatIntentClassifier.classify('oi tudo bem?').intent, 'CONVERSATION');
  assert.equal(ChatIntentClassifier.classify('dá pra arrumar isso?').intent, 'AMBIGUOUS');
  assert.equal(ChatIntentClassifier.classify('replanejar: novo requisito').intent, 'EXECUTION_INSTRUCTION');
  assert.equal(ChatIntentClassifier.classify('continuar').intent, 'EXECUTION_INSTRUCTION');
});

test('ProjectChatService — Respostas factuais com contexto real do projeto', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-chat-test-'));
  const projId = 'test-proj-chat-' + Date.now();
  const runId = 'test-run-chat-' + Date.now();

  try {
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(projId, 'Chat Test Project', tempDir, 'Aplicativo de Teste Conversacional', 'Node.js', new Date().toISOString(), new Date().toISOString());

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, last_error, next_action, start_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'error', 'NEEDS_EVIDENCE: Testes falharam no terminal com exit code 1', 'Aguardando autorização de correção', ?, ?, ?)
    `).run(runId, projId, 'Run de Teste', 'Objetivo do Run', new Date().toISOString(), new Date().toISOString(), new Date().toISOString());

    db.prepare(`
      INSERT INTO autonomous_events (id, run_id, task_id, agent_role, event_type, message, created_at)
      VALUES (?, ?, null, 'supervisor', 'REVIEW_REJECTED', 'Revisão reprovada por ausência de evidência', ?)
    `).run('evt-1', runId, new Date().toISOString());

    await t.test('Responde a "Qual foi o erro?" com detalhes factuais do erro', () => {
      const intent = ChatIntentClassifier.classify('Qual foi o erro?');
      const res = ProjectChatService.handleConversationalMessage({
        projectId: projId,
        content: 'Qual foi o erro?',
        intentResult: intent
      });

      assert.ok(res.replyContent.includes('Diagnóstico do Erro'));
      assert.ok(res.replyContent.includes('NEEDS_EVIDENCE'));
      assert.ok(res.replyContent.includes('Corrija o erro e continue'));
      assert.equal(res.metadata.status, 'answered');
    });

    await t.test('Responde a "Onde eu vejo a log?" com caminhos reais de disco e interface', () => {
      const intent = ChatIntentClassifier.classify('Onde eu vejo a log?');
      const res = ProjectChatService.handleConversationalMessage({
        projectId: projId,
        content: 'Onde eu vejo a log?',
        intentResult: intent
      });

      assert.ok(res.replyContent.includes('Central de Logs'));
      assert.ok(res.replyContent.includes('backend.log'));
      assert.ok(res.replyContent.includes('hub.db'));
      assert.ok(res.replyContent.includes('Observabilidade'));
      assert.ok(res.replyContent.includes('autonomous_events'));
      assert.equal(res.metadata.status, 'answered');
    });

    await t.test('Responde a "Podemos corrigir isso?" esclarecendo sem executar', () => {
      const intent = ChatIntentClassifier.classify('Podemos corrigir isso?');
      const res = ProjectChatService.handleConversationalMessage({
        projectId: projId,
        content: 'Podemos corrigir isso?',
        intentResult: intent
      });

      assert.ok(res.replyContent.includes('Sim, podemos corrigir!'));
      assert.ok(res.replyContent.includes('não iniciei alterações automaticamente'));
      assert.ok(res.replyContent.includes('Corrija o erro e continue'));
      assert.equal(res.metadata.status, 'answered');
    });

    await t.test('Responde a "Você já corrigiu o erro?" confirmando estado real', () => {
      const intent = ChatIntentClassifier.classify('Você já corrigiu o erro?');
      const res = ProjectChatService.handleConversationalMessage({
        projectId: projId,
        content: 'Você já corrigiu o erro?',
        intentResult: intent
      });

      assert.ok(res.replyContent.includes('Ainda não realizei a correção'));
      assert.ok(res.replyContent.includes('Corrija o erro e continue'));
    });
  } finally {
    try {
      db.prepare('DELETE FROM autonomous_events WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "chatIntentAndLogs.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:chatIntentAndLogs.test]", err);
      }
    }
  }
});

test('Chat Integration — Prevenção de fila indesejada quando Run está em error', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-queue-trap-test-'));
  const projId = 'test-proj-trap-' + Date.now();
  const runId = 'test-run-trap-' + Date.now();

  try {
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(projId, 'Trap Test Project', tempDir, 'App Teste', 'Node.js', new Date().toISOString(), new Date().toISOString());

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, last_error, next_action, start_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'error', 'NEEDS_EVIDENCE: Falha na validação', 'Aguardando ação', ?, ?, ?)
    `).run(runId, projId, 'Run em Erro', 'Objetivo', new Date().toISOString(), new Date().toISOString(), new Date().toISOString());

    // Inspeciona que perguntas conversacionais não geram QUEUED_USER_INSTRUCTION
    const intent1 = ChatIntentClassifier.classify('qual foi o erro?');
    assert.equal(intent1.intent, 'STATE_QUERY');
    const res1 = ProjectChatService.handleConversationalMessage({ projectId: projId, content: 'qual foi o erro?', intentResult: intent1 });
    assert.equal(res1.metadata.status, 'answered');

    const intent2 = ChatIntentClassifier.classify('Onde eu vejo a log?');
    assert.equal(intent2.intent, 'STATE_QUERY');
    const res2 = ProjectChatService.handleConversationalMessage({ projectId: projId, content: 'Onde eu vejo a log?', intentResult: intent2 });
    assert.equal(res2.metadata.status, 'answered');

    // Confirma que nenhum evento QUEUED_USER_INSTRUCTION foi inserido
    const queuedEvents = db.prepare("SELECT count(*) as count FROM autonomous_events WHERE run_id = ? AND event_type = 'QUEUED_USER_INSTRUCTION'").get(runId) as any;
    assert.equal(queuedEvents.count, 0, 'Nenhum evento QUEUED_USER_INSTRUCTION deve ser gerado para consultas conversacionais.');

    // Simula envio de comando "Corrija o erro e continue"
    const intent3 = ChatIntentClassifier.classify('Corrija o erro e continue');
    assert.equal(intent3.intent, 'EXECUTION_INSTRUCTION');
    assert.equal(intent3.subType, 'FIX_AND_CONTINUE');
  } finally {
    try {
      db.prepare('DELETE FROM autonomous_events WHERE run_id = ?').run(runId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "chatIntentAndLogs.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:chatIntentAndLogs.test]", err);
      }
    }
  }
});

test('Review Regression — Justificativa de reprovação não exibe elogios contraditórios', async () => {
  const { HierarchicalOrchestrationService } = await import('../src/hierarchicalOrchestrationService.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-rejection-test-'));
  const projId = 'test-proj-rej-' + Date.now();
  const runId = 'test-run-rej-' + Date.now();
  const taskId = 'test-task-rej-' + Date.now();

  try {
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(projId, 'Rejection Test Project', tempDir, 'App Teste', 'Node.js', new Date().toISOString(), new Date().toISOString());

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
    `).run(runId, projId, 'Run Teste', 'Objetivo', new Date().toISOString(), new Date().toISOString(), new Date().toISOString());

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, order_index, criteria_json, created_at, updated_at)
      VALUES (?, ?, 'Tarefa com falha', 'in_review', 'REVIEW_PENDING', 1, '["Critério A"]', ?, ?)
    `).run(taskId, runId, new Date().toISOString(), new Date().toISOString());

    const reviewRes = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
      runId,
      taskId,
      projectPath: tempDir,
      evaluationResult: {
        id: 'eval-fail',
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
        createdAt: new Date().toISOString()
      },
      supervisorVerdict: 'APPROVED', // Supervisor erroneamente aprovou
      supervisorFeedback: 'Implementação formalmente aprovada com nota 10/10'
    });

    assert.equal(reviewRes.decision, 'REJECTED');
    assert.ok(!reviewRes.justification.includes('aprovada com nota 10/10'), 'Justificativa de reprovação não pode conter elogio contraditório');
    assert.ok(reviewRes.justification.includes('Critério A não atendido') || reviewRes.justification.includes('Reprovado'), 'Justificativa deve conter o motivo real da falha');
  } finally {
    try {
      db.prepare('DELETE FROM autonomous_tasks WHERE id = ?').run(taskId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "chatIntentAndLogs.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:chatIntentAndLogs.test]", err);
      }
    }
  }
});


