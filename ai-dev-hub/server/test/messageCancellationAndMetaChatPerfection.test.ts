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
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "messageCancellationAndMetaChatPerfection.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:messageCancellationAndMetaChatPerfection.test]", err);
      }
    }
    }
    if (fs.existsSync(dirtyFilePath)) {
      try { fs.unlinkSync(dirtyFilePath); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "messageCancellationAndMetaChatPerfection.test",
          error: err?.message || String(err)
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
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "messageCancellationAndMetaChatPerfection.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:messageCancellationAndMetaChatPerfection.test]", err);
      }
    }
    }
    if (fs.existsSync(dirtyFilePath)) {
      try { fs.unlinkSync(dirtyFilePath); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "messageCancellationAndMetaChatPerfection.test",
          error: err?.message || String(err)
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
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "messageCancellationAndMetaChatPerfection.test",
          error: err?.message || String(err)
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
});
