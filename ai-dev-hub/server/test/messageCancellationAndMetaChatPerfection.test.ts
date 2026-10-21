// server/test/messageCancellationAndMetaChatPerfection.test.ts
// Testes automatizados para FASE 21: Cancelamento Universal de Mensagens & Perfeição Operacional do Meta-Chat

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { apiRouter } from '../src/routes.js';
import { MetaChatService } from '../src/metaChatService.js';
import { TurnCancellationManager } from '../src/turnCancellationManager.js';
import { ExecutionCoordinator } from '../src/executionCoordinator.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';
import { db } from '../src/db.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { observeTranscript } from '../src/agentTurnState.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';

describe('FASE 21: Cancelamento Universal de Mensagens & Perfeição Operacional do Meta-Chat', () => {
  let server: any;
  let baseUrl: string;
  let testProjectId: string;
  const root = MetaChatService.getDecoHubRoot();
  const testHelperPath = path.join(root, 'server', 'src', 'utils', '__metaChatClampTest.ts');
  const dirtyFilePath = path.join(root, 'server', 'src', 'utils', '__dirtyCancelTest.ts');

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DECOHUB_OFFLINE_MODE = 'true';
    AgentApiGateway.installDefaultMock();
    MetaChatService.resetMessages();

    // Iniciar servidor express para rotas HTTP
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const port = (server.address() as any).port;
    baseUrl = `http://127.0.0.1:${port}/api`;

    // Criar projeto de teste para validação de cancelamento de chat de projeto
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-cancel-test-'));
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Projeto Teste Cancelamento',
        folderPath: tempDir,
        objective: 'Testar cancelamento de mensagens',
        description: 'Projeto temporário',
        initGit: true
      })
    });
    const projectData: any = await createRes.json();
    testProjectId = projectData.id;

    if (fs.existsSync(testHelperPath)) {
      try { fs.unlinkSync(testHelperPath); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "messageCancellationAndMetaChatPerfection.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:messageCancellationAndMetaChatPerfection.test]", err);
      }
    }
    }
    if (fs.existsSync(dirtyFilePath)) {
      try { fs.unlinkSync(dirtyFilePath); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "messageCancellationAndMetaChatPerfection.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:messageCancellationAndMetaChatPerfection.test]", err);
      }
    }
    }
  });

  after(async () => {
    if (fs.existsSync(testHelperPath)) {
      try { fs.unlinkSync(testHelperPath); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "messageCancellationAndMetaChatPerfection.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:messageCancellationAndMetaChatPerfection.test]", err);
      }
    }
    }
    if (fs.existsSync(dirtyFilePath)) {
      try { fs.unlinkSync(dirtyFilePath); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "messageCancellationAndMetaChatPerfection.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:messageCancellationAndMetaChatPerfection.test]", err);
      }
    }
    }
    MetaChatService.resetMessages();
    delete process.env.DECOHUB_OFFLINE_MODE;
    AgentApiGateway.restoreLiveGateway();

    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  // =========================================================================
  // PARTE 1: Cancelamento de Mensagens no Chat do Projeto (Rotas & Gerenciador)
  // =========================================================================

  it('1.1 POST /api/projects/:id/messages/cancel cancela execução ativa e registra cancelamento no TurnCancellationManager', async () => {
    // 1. Limpa cancelamentos prévios
    TurnCancellationManager.clearCancellation(testProjectId);
    assert.equal(TurnCancellationManager.isCancelled(testProjectId), false);

    // 2. Chama endpoint de cancelamento
    const res = await fetch(`${baseUrl}/projects/${testProjectId}/messages/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 200);
    const data: any = await res.json();
    assert.equal(data.cancelled, true);
    assert.ok(data.message.includes('cancelad'));

    // 3. Verifica que o token de cancelamento ficou ativo
    assert.equal(TurnCancellationManager.isCancelled(testProjectId), true);
    TurnCancellationManager.clearCancellation(testProjectId);
  });

  it('1.2 POST /api/projects/:id/messages/cancel com messageId cancela mensagem enfileirada no banco', async () => {
    const messageId = `msg-queued-${Date.now()}`;
    const insertStmt = db.prepare(`
      INSERT INTO messages (id, project_id, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    insertStmt.run(messageId, testProjectId, 'user', 'Instrução que ficou enfileirada', JSON.stringify({ execution: { status: 'queued' } }));

    // Verifica que está no banco com status queued
    const rowBefore: any = db.prepare(`SELECT metadata FROM messages WHERE id = ?`).get(messageId);
    const metaBefore = JSON.parse(rowBefore.metadata || '{}');
    assert.equal(metaBefore.execution?.status, 'queued');

    // Chama cancelamento com messageId
    const res = await fetch(`${baseUrl}/projects/${testProjectId}/messages/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId })
    });

    assert.equal(res.status, 200);
    const data: any = await res.json();
    assert.equal(data.cancelled, true);

    // Verifica que o status no metadata mudou para cancelled
    const rowAfter: any = db.prepare(`SELECT content, metadata FROM messages WHERE id = ?`).get(messageId);
    const metaAfter = JSON.parse(rowAfter.metadata || '{}');
    assert.equal(metaAfter.execution?.status, 'cancelled');
    assert.ok(rowAfter.content.includes('[CANCELADA]'));
  });

  it('1.3 DELETE /api/projects/:id/messages/:messageId exclui mensagem cancelada ou abortada do histórico', async () => {
    const messageId = `msg-del-${Date.now()}`;
    db.prepare(`
      INSERT INTO messages (id, project_id, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(messageId, testProjectId, 'user', 'Instrução para deletar', JSON.stringify({ execution: { status: 'cancelled' } }));

    const res = await fetch(`${baseUrl}/projects/${testProjectId}/messages/${messageId}`, {
      method: 'DELETE'
    });

    assert.equal(res.status, 200);
    const data: any = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.message, 'Mensagem removida com sucesso.');

    const checkRow: any = db.prepare(`SELECT id FROM messages WHERE id = ?`).get(messageId);
    assert.equal(checkRow, undefined);
  });

  // =========================================================================
  // PARTE 2: Meta-Chat Status, Cancelamento com Rollback & Lock Release
  // =========================================================================

  it('2.1 GET /api/metachat/status retorna estado e fase em tempo real', async () => {
    const res = await fetch(`${baseUrl}/metachat/status`);
    assert.equal(res.status, 200);
    const status: any = await res.json();
    assert.equal(typeof status.isRunning, 'boolean');
    assert.equal(typeof status.isExecuting, 'boolean');
    assert.equal(typeof status.currentPhase, 'string');
    assert.equal(status.cancelRequested, false);
  });

  it('2.2 POST /api/metachat/cancel cancela execução, restaura baseline e libera locks', async () => {
    // 1. Simular reserva de lock ativa no ExecutionCoordinator para metachat
    const token = ExecutionCoordinator.acquire('metachat', {
      projectId: 'ai-dev-hub',
      runId: 'metachat-test-run',
      reason: 'Turno de teste do Meta-Chat'
    });
    assert.ok(token);

    const activeBefore = db.prepare('SELECT * FROM execution_reservations WHERE scope = ?').get('metachat');
    assert.ok(activeBefore, 'Deve existir reserva ativa no coordinator');

    // 2. Simular execução ativa com baseline e arquivo sujo criado no repo
    const baseline = MetaChatService.captureFileBaseline(root);
    (MetaChatService as any)._currentExecution = {
      root,
      baselineBefore: baseline,
      filesChanged: new Set(['server/src/utils/__dirtyCancelTest.ts']),
      phase: 'Inspecionando e modificando código no Antigravity',
      cancelRequested: false,
      model: 'gemini-3.8-flash',
      accountId: 'test-account'
    };
    fs.writeFileSync(dirtyFilePath, 'export const DIRTY = true;\n', 'utf8');
    assert.ok(fs.existsSync(dirtyFilePath));

    // 3. Chamar POST /api/metachat/cancel
    const res = await fetch(`${baseUrl}/metachat/cancel`, {
      method: 'POST'
    });
    assert.equal(res.status, 200);
    const data: any = await res.json();
    assert.equal(data.cancelled, true);
    assert.equal(data.message, 'Execução do Meta-Chat cancelada com sucesso.');

    // 4. Verificar que a reserva do ExecutionCoordinator foi liberada (zero locks presos!)
    const activeAfter = db.prepare('SELECT * FROM execution_reservations WHERE scope = ?').get('metachat');
    assert.equal(activeAfter, undefined, 'Reserva do coordinator DEVE ser nula após cancelamento');

    // 5. Verificar que o arquivo sujo foi revertido/removido pela restauração de baseline
    assert.equal(fs.existsSync(dirtyFilePath), false, 'Arquivo criado durante turno deve ser removido pelo rollback');

    // 6. Verificar que a mensagem [CANCELADO] foi registrada no histórico do Meta-Chat
    const messages = MetaChatService.getMessages();
    const lastMsg = messages[messages.length - 1];
    assert.ok(lastMsg);
    assert.ok(lastMsg.content.includes('[CANCELADO]'));
  });

  it('2.3 DELETE /api/metachat/messages/:id remove mensagem do histórico do Meta-Chat', async () => {
    const msg = MetaChatService.addMessage({
      role: 'user',
      content: 'Mensagem de teste para remoção no Meta-Chat'
    });
    assert.ok(msg.id);

    const res = await fetch(`${baseUrl}/metachat/messages/${msg.id}`, {
      method: 'DELETE'
    });
    assert.equal(res.status, 200);
    const data: any = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.message, 'Mensagem removida com sucesso.');

    const checkMsgs = MetaChatService.getMessages();
    assert.equal(checkMsgs.some(m => m.id === msg.id), false);
  });

  // =========================================================================
  // PARTE 3: Execução Híbrida do Meta-Chat com Modelo Flash, Reasoning HIGH, Anexos & Typecheck Guard
  // =========================================================================

  it('3.1 Executa alteração válida com gemini-3.8-flash, reasoningMode HIGH, anexos e passa no Typecheck Guard', async () => {
    const validContent = `export function clampValue(v: number, min: number, max: number): number {\n  return Math.min(Math.max(v, min), max);\n}\n`;

    const res = await fetch(`${baseUrl}/metachat/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Implemente uma função utilitária clampValue para testes do Meta-Chat',
        model: 'gemini-3.8-flash',
        reasoningMode: 'high',
        attachments: [
          {
            name: 'spec.txt',
            size: 28,
            type: 'text/plain',
            base64Content: 'VGVzdGUgZGUgYW5leG8gZGEgRkFTRSAyMQ=='
          }
        ],
        codeActions: [
          {
            action: 'write',
            filePath: 'server/src/utils/__metaChatClampTest.ts',
            content: validContent
          }
        ]
      })
    });

    assert.equal(res.status, 200);
    const data: any = await res.json();
    assert.equal(data.selfHealed, false);
    assert.equal(data.typecheck.passed, true);
    assert.ok(data.filesChanged.includes('server/src/utils/__metaChatClampTest.ts'));

    // Verifica integridade da mensagem retornada
    assert.ok(data.message);
    assert.equal(data.message.metadata.model, 'gemini-3.8-flash');
    assert.equal(data.message.metadata.reasoningMode, 'high');
    assert.equal(data.message.metadata.typecheck.passed, true);
    assert.ok(data.message.metadata.typecheck.duration_ms >= 0);

    // Verifica que o arquivo foi gravado de verdade
    assert.ok(fs.existsSync(testHelperPath));
    const saved = fs.readFileSync(testHelperPath, 'utf8');
    assert.ok(saved.includes('clampValue'));

    // Limpeza
    try { fs.unlinkSync(testHelperPath); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "messageCancellationAndMetaChatPerfection.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:messageCancellationAndMetaChatPerfection.test]", err);
      }
    }
  });

  it('3.2 Parser Híbrido: Extrai corretamente blocos [FILE: ...] ... [ENDFILE] da resposta textual', () => {
    const rawAiOutput = `
Certamente! Aqui está a alteração solicitada para o repositório:

[FILE: server/src/utils/__parsedUtilTest.ts]
export const PARSED_CONSTANT = 42;
export function getAnswer(): number {
  return PARSED_CONSTANT;
}
[ENDFILE]

Todos os arquivos foram atualizados com sucesso.
`;

    const actions = MetaChatService.parseCodeDirectives(rawAiOutput);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, 'write');
    assert.equal(actions[0].filePath, 'server/src/utils/__parsedUtilTest.ts');
    assert.ok(actions[0].content.includes('export const PARSED_CONSTANT = 42;'));
    assert.ok(actions[0].content.includes('return PARSED_CONSTANT;'));
  });

  it('3.3 Parser Híbrido: Suporta blocos no formato ```typescript [FILE: ...] ```', () => {
    const markdownAiOutput = `
Segue o código a ser aplicado:

\`\`\`typescript [FILE: server/src/utils/__fencedUtilTest.ts]
export function isFenced(): boolean {
  return true;
}
\`\`\`
`;

    const actions = MetaChatService.parseCodeDirectives(markdownAiOutput);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].filePath, 'server/src/utils/__fencedUtilTest.ts');
    assert.ok(actions[0].content.includes('isFenced'));
  });

  // =========================================================================
  // PARTE 4: Desbloqueio e Execução Real no Chat dos Projetos
  // =========================================================================

  it('4.1 Nova instrução substantiva em projeto com run anterior blocked ou error cria novo run sem enfileirar passivamente', async () => {
    const oldRunId = `run-blocked-${Date.now()}`;
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, autonomy_mode, branch_name, max_hours, max_cycles, current_cycle, start_time, created_at, updated_at, last_error)
      VALUES (?, ?, 'Run Antigo Bloqueado', 'Objetivo antigo', 'Briefing antigo', 'blocked', 'autonomous', 'branch-old', 4.0, 20, 1, ?, ?, ?, 'Runtime indisponivel')
    `).run(oldRunId, testProjectId, nowIso, nowIso, nowIso);

    const res = await fetch(`${baseUrl}/projects/${testProjectId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Implemente o modulo de exportacao CSV para clientes'
      })
    });

    assert.equal(res.status, 200);
    const data: any = await res.json();

    assert.equal(data.execution.status, 'started');
    assert.ok(data.autonomousRun);
    assert.notEqual(data.autonomousRun.id, oldRunId);

    const oldRunRow: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(oldRunId);
    assert.equal(oldRunRow.status, 'failed');
  });

  it('4.2 Envio de "resolver" ou "retomar" limpa last_error e redefine tarefas bloqueadas para ready chamando resumeRun', async () => {
    const stalledRunId = `run-stalled-${Date.now()}`;
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, autonomy_mode, branch_name, max_hours, max_cycles, current_cycle, start_time, created_at, updated_at, last_error)
      VALUES (?, ?, 'Run Travado', 'Objetivo', 'Briefing', 'blocked', 'autonomous', 'branch-stalled', 4.0, 20, 1, ?, ?, ?, 'Falha temporaria de cota')
    `).run(stalledRunId, testProjectId, nowIso, nowIso, nowIso);

    const taskId = `task-blocked-${Date.now()}`;
    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, description, status, lifecycle_state, order_index, created_at, updated_at)
      VALUES (?, ?, 'Tarefa Bloqueada', 'Desc', 'blocked', 'BLOCKED', 1, ?, ?)
    `).run(taskId, stalledRunId, nowIso, nowIso);

    const res = await fetch(`${baseUrl}/projects/${testProjectId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'resolver'
      })
    });

    assert.equal(res.status, 200);
    const data: any = await res.json();
    assert.ok(data.autonomousRun);
    assert.equal(data.autonomousRun.id, stalledRunId);

    const taskRow: any = db.prepare('SELECT status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(taskId);
    assert.ok(taskRow.status === 'ready' || taskRow.status === 'needs_changes' || taskRow.lifecycle_state === 'READY' || taskRow.lifecycle_state === 'REWORK_REQUIRED');
  });

  it('4.3 Idempotency Guard: createReservedRun finaliza run em error/blocked ou sem tarefas pendentes e permite novo run', async () => {
    const errorRunId = `run-error-${Date.now()}`;
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, autonomy_mode, branch_name, max_hours, max_cycles, current_cycle, start_time, created_at, updated_at, last_error)
      VALUES (?, ?, 'Run Erro', 'Objetivo erro', 'Briefing erro', 'error', 'autonomous', 'branch-err', 4.0, 20, 1, ?, ?, ?, 'CRASH')
    `).run(errorRunId, testProjectId, nowIso, nowIso, nowIso);

    const newRun = await AutonomousManager.createRun({
      projectId: testProjectId,
      name: 'Novo Run Apos Erro',
      objective: 'Construir nova feature',
      briefing: 'Briefing'
    });

    assert.ok(newRun);
    assert.notEqual(newRun.id, errorRunId);

    const oldRow: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(errorRunId);
    assert.equal(oldRow.status, 'failed');
  });

  // =========================================================================
  // PARTE 5: Reconhecimento Imediato de Respostas Conversacionais & Término de Turno
  // =========================================================================

  it('5.1 GeminiSupervisorProvider.waitForResponse extrai resposta conversacional ou JSON de tarefas imediatamente sem esperar timeout', async () => {
    const tempBrainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-supervisor-test-'));
    const convId = `conv-${Date.now()}`;
    const logDir = path.join(tempBrainDir, convId, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const transcriptFile = path.join(logDir, 'transcript.jsonl');
    const tasksJson = JSON.stringify([
      { title: 'Configurar banco', description: 'Criar migrations e schema inicial' }
    ]);
    const line = JSON.stringify({
      step_index: 1,
      type: 'MODEL_TURN',
      role: 'assistant',
      content: `Entendido! Aqui esta o planejamento inicial:\n\`\`\`json\n${tasksJson}\n\`\`\`\n`
    });
    fs.writeFileSync(transcriptFile, line + '\n', 'utf8');

    const supervisor = new GeminiSupervisorProvider({} as any, 'acc-test');
    (supervisor as any).appDataBrainDir = tempBrainDir;

    const start = Date.now();
    const result = await supervisor.waitForResponse(convId, 10000, 0, 'PLAN');
    const elapsed = Date.now() - start;

    assert.ok(result.includes('Configurar banco'));
    assert.ok(elapsed < 2000, `Deve retornar imediatamente sem travar (levou ${elapsed}ms)`);
  });

  it('5.2 observeTranscript detecta COMPLETE se último registro do modelo contiver texto ou código sem ferramentas pendentes', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-observe-test-'));
    const transcriptFile = path.join(tempDir, 'transcript.jsonl');

    const lines = [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', role: 'user', content: 'Inicie a implementacao' }),
      JSON.stringify({
        step_index: 1,
        type: 'MESSAGE',
        role: 'assistant',
        content: 'Aqui esta a implementacao concluida no arquivo utils.ts:\n```ts\nexport const ready = true;\n```',
        tool_calls: []
      })
    ];
    fs.writeFileSync(transcriptFile, lines.join('\n') + '\n', 'utf8');

    const obs = observeTranscript(transcriptFile, 0);
    assert.equal(obs.state, 'COMPLETE');
    assert.equal(obs.pendingTools.length, 0);
  });

  it('5.3 AntigravityProvider.getResult finaliza turno imediatamente ao detectar resposta final do assistente', async () => {
    const tempBrainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-antigravity-test-'));
    const sessionId = `session-${Date.now()}`;
    const logDir = path.join(tempBrainDir, sessionId, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const transcriptFile = path.join(logDir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Execute o teste' }),
      JSON.stringify({
        step_index: 1,
        type: 'ASSISTANT_RESPONSE',
        content: 'Trabalho finalizado com sucesso.',
        tool_calls: []
      })
    ];
    fs.writeFileSync(transcriptFile, lines.join('\n') + '\n', 'utf8');

    const provider = new AntigravityProvider();
    (provider as any).appDataBrainDir = tempBrainDir;

    const start = Date.now();
    const result = await provider.getResult(sessionId, 5000, tempBrainDir);
    const elapsed = Date.now() - start;

    assert.equal(result.status, 'success');
    assert.equal(result.rawResponse, 'Trabalho finalizado com sucesso.');
    assert.ok(elapsed < 2000, `Deve finalizar imediatamente sem aguardar timeout (levou ${elapsed}ms)`);
  });
});
