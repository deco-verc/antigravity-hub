import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { MetaChatService } from '../src/metaChatService.js';
import { SseStreamService } from '../src/sseStreamService.js';
import { TurnCancellationManager } from '../src/turnCancellationManager.js';
import express from 'express';
import { apiRouter } from '../src/routes.js';

describe('ISOLAMENTO TOTAL DE CONVERSAS NO META-CHAT (THREAD ISOLATION & DEDICATED SESSIONS)', () => {
  const threadAlphaId = 'thread-test-iso-alpha';
  const threadBetaId = 'thread-test-iso-beta';

  before(() => {
    try {
      db.prepare('DELETE FROM meta_chat_messages WHERE thread_id IN (?, ?)').run(threadAlphaId, threadBetaId);
      db.prepare('DELETE FROM meta_chat_threads WHERE id IN (?, ?)').run(threadAlphaId, threadBetaId);
      db.prepare("DELETE FROM system_settings WHERE key LIKE 'metachat_conversation_id:thread:%'").run();
    } catch {}

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO meta_chat_threads (id, title, status, created_at, updated_at)
      VALUES (?, 'Conversa Alpha', 'idle', ?, ?),
             (?, 'Conversa Beta', 'idle', ?, ?)
    `).run(threadAlphaId, now, now, threadBetaId, now, now);
  });

  after(() => {
    try {
      MetaChatService.cancelActiveExecution(threadAlphaId);
      MetaChatService.cancelActiveExecution(threadBetaId);
      db.prepare('DELETE FROM meta_chat_messages WHERE thread_id IN (?, ?)').run(threadAlphaId, threadBetaId);
      db.prepare('DELETE FROM meta_chat_threads WHERE id IN (?, ?)').run(threadAlphaId, threadBetaId);
      db.prepare("DELETE FROM system_settings WHERE key LIKE 'metachat_conversation_id:thread:%'").run();
    } catch {}
  });

  it('1. Sessão Dedicada: getActiveConversationId retorna null para thread sem sessão própria (nunca usa fallback legado)', () => {
    // Grava uma sessão global legada
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('metachat_conversation_id', 'conv-legacy-global-999', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(new Date().toISOString());

    // Chamada para uma thread específica sem sessão gravada DEVE retornar null
    const convForAlpha = MetaChatService.getActiveConversationId(null, threadAlphaId);
    assert.equal(convForAlpha, null, 'Thread sem sessão deve retornar null para forçar criação de sessão dedicada limpa');

    // Chamada global legada (sem threadId) pode retornar o fallback global
    const globalConv = MetaChatService.getActiveConversationId(null, null);
    assert.equal(globalConv, 'conv-legacy-global-999', 'Chamada sem threadId preserva compatibilidade legada');

    // Ao associar uma sessão dedicada à thread Alpha
    MetaChatService.setActiveConversationId('conv-alpha-dedicated', null, threadAlphaId);

    // Alpha agora retorna sua própria sessão
    const activeAlpha = MetaChatService.getActiveConversationId(null, threadAlphaId);
    assert.equal(activeAlpha, 'conv-alpha-dedicated', 'Alpha deve retornar sua sessão gravada');

    // Beta continua retornando null (100% isolada de Alpha e do global!)
    const activeBeta = MetaChatService.getActiveConversationId(null, threadBetaId);
    assert.equal(activeBeta, null, 'Beta não deve vazar a sessão de Alpha');
  });

  it('2. Isolamento de Execução Ativa: _currentExecutions e getActiveTurnStatus respondem estritamente pela thread solicitada', () => {
    // Simula execução ativa na thread Alpha
    const fakeExecAlpha = {
      cancelRequested: false,
      startedAt: new Date(Date.now() - 5000).toISOString(),
      phase: 'Implementando funcionalidade Alpha...',
      model: 'gemini-3.8-flash',
      accountId: 'acc-1',
      threadId: threadAlphaId,
      root: process.cwd(),
      baselineBefore: new Map(),
      conversationId: 'conv-alpha-dedicated',
      filesChanged: new Set<string>(['alpha.ts']),
      currentActionSummary: 'Editando alpha.ts',
      pipelineTasks: [
        { id: 'task-facade', label: 'Chat Facade', status: 'completed' as const },
        { id: 'task-supervisor', label: 'Supervisor', status: 'completed' as const },
        { id: 'task-worker', label: 'Worker', status: 'in_progress' as const, details: 'Modificando alpha.ts' },
        { id: 'task-reviewer', label: 'Reviewer', status: 'pending' as const }
      ],
      liveSteps: [
        { id: 's1', type: 'EDIT' as const, target: 'alpha.ts', status: 'running' as const, timestamp: new Date().toISOString() }
      ],
      currentStage: {
        code: 'STATUS_WORKER_EXECUTING',
        title: 'Worker (Execução)'
      },
      lastTranscriptLineCount: 0
    };

    (MetaChatService as any)._currentExecutions.set(threadAlphaId, fakeExecAlpha);

    try {
      // Status de Alpha deve indicar execução ativa
      const statusAlpha = MetaChatService.getActiveTurnStatus(threadAlphaId);
      assert.equal(statusAlpha.isRunning, true, 'Alpha deve estar em execução');
      assert.equal(statusAlpha.executingThreadId, threadAlphaId);
      assert.equal(statusAlpha.threadId, threadAlphaId);
      assert.ok(statusAlpha.elapsedSeconds >= 4, 'Cronômetro de Alpha deve estar contando');
      assert.equal(statusAlpha.currentStage?.code, 'STATUS_WORKER_EXECUTING');

      // Status de Beta DEVE indicar repouso (0 segundos, não executando, sem etapas de Alpha)
      const statusBeta = MetaChatService.getActiveTurnStatus(threadBetaId);
      assert.equal(statusBeta.isRunning, false, 'Beta DEVE estar parada mesmo com Alpha em execução');
      assert.equal(statusBeta.executingThreadId, null, 'executingThreadId de Beta deve ser null');
      assert.equal(statusBeta.elapsedSeconds, 0, 'Cronômetro de Beta deve ser 0');
      assert.equal(statusBeta.currentStage, undefined, 'currentStage de Beta não deve conter os dados de Alpha');
      assert.equal(statusBeta.steps.length, 0, 'Beta não deve ter etapas de execução');
      assert.equal(statusBeta.pipelineTasks.length, 0, 'Beta não deve ter tarefas de pipeline');

      // getExecution para Beta deve retornar null
      const execBeta = MetaChatService.getExecution(threadBetaId);
      assert.equal(execBeta, null, 'getExecution(threadBeta) não deve retornar o estado de Alpha');

      // getLiveStatus também deve manter isolamento estrito
      const liveAlpha = MetaChatService.getLiveStatus(threadAlphaId);
      assert.equal(liveAlpha.isRunning, true);
      assert.equal(liveAlpha.executingThreadId, threadAlphaId);

      const liveBeta = MetaChatService.getLiveStatus(threadBetaId);
      assert.equal(liveBeta.isRunning, false, 'Live status de Beta deve ser falso');
      assert.equal(liveBeta.executingThreadId, null);
      assert.equal(liveBeta.elapsedSeconds, 0);
    } finally {
      (MetaChatService as any)._currentExecutions.delete(threadAlphaId);
    }
  });

  it('3. listThreads: apenas a thread em execução retorna status="running" e as outras permanecem "idle"', () => {
    const fakeExecAlpha = {
      cancelRequested: false,
      startedAt: new Date().toISOString(),
      phase: 'Trabalhando em Alpha',
      threadId: threadAlphaId,
      root: process.cwd(),
      baselineBefore: new Map(),
      filesChanged: new Set<string>(),
      currentActionSummary: 'Ação Alpha',
      pipelineTasks: [],
      liveSteps: [],
      lastTranscriptLineCount: 0
    };

    (MetaChatService as any)._currentExecutions.set(threadAlphaId, fakeExecAlpha as any);

    try {
      const threads = MetaChatService.listThreads();
      const alpha = threads.find(t => t.id === threadAlphaId);
      const beta = threads.find(t => t.id === threadBetaId);

      assert.ok(alpha);
      assert.equal(alpha.status, 'running', 'Apenas Alpha deve ter status running');

      assert.ok(beta);
      assert.equal(beta.status, 'idle', 'Beta deve permanecer estritamente idle');
    } finally {
      (MetaChatService as any)._currentExecutions.delete(threadAlphaId);
    }
  });

  it('4. Telemetria SSE: broadcastTelemetry inclui threadId em toda transmissão', () => {
    const broadcasts: Array<{ event: string; data: any }> = [];
    const origBroadcast = SseStreamService.broadcast;

    (SseStreamService as any).broadcast = (channel: string, event: string, data: any) => {
      if (channel === 'metachat') {
        broadcasts.push({ event, data });
      }
    };

    try {
      // 1. Telemetria com threadId explícito
      MetaChatService.broadcastTelemetry('custom_stage', {
        threadId: threadAlphaId,
        message: 'Etapa personalizada para Alpha'
      });

      assert.ok(broadcasts.length >= 2, 'Deveria transmitir em activity e custom_stage');
      const last = broadcasts[broadcasts.length - 1];
      assert.equal(last.data.threadId, threadAlphaId, 'threadId explícito deve ser preservado');
      assert.equal(last.data.status, 'custom_stage');
      assert.ok(last.data.timestamp);

      // 2. Telemetria sem threadId explícito (deve herdar thread ativa ou execução)
      MetaChatService.setActiveThreadId(threadBetaId);
      MetaChatService.broadcastTelemetry('inferred_stage', {
        message: 'Sem threadId explícito'
      });

      const inferred = broadcasts[broadcasts.length - 1];
      assert.equal(inferred.data.threadId, threadBetaId, 'Deve inferir threadId da thread ativa');
      assert.equal(inferred.data.status, 'inferred_stage');
    } finally {
      (SseStreamService as any).broadcast = origBroadcast;
    }
  });

  it('5. API HTTP: GET /api/metachat/status com ?threadId retorna status estrito daquela thread', async () => {
    const fakeExecAlpha = {
      cancelRequested: false,
      startedAt: new Date(Date.now() - 3000).toISOString(),
      phase: 'Rodando Alpha',
      threadId: threadAlphaId,
      root: process.cwd(),
      baselineBefore: new Map(),
      filesChanged: new Set<string>(),
      currentActionSummary: 'Ação Alpha',
      pipelineTasks: [],
      liveSteps: [],
      lastTranscriptLineCount: 0
    };

    (MetaChatService as any)._currentExecutions.set(threadAlphaId, fakeExecAlpha as any);

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    const server = app.listen(0);
    const port = (server.address() as any).port;

    try {
      // Consulta para Alpha (em execução)
      const resAlpha = await fetch(`http://127.0.0.1:${port}/api/metachat/status?threadId=${threadAlphaId}`);
      assert.equal(resAlpha.status, 200);
      const dataAlpha = await resAlpha.json();
      assert.equal(dataAlpha.isRunning, true);
      assert.equal(dataAlpha.executingThreadId, threadAlphaId);
      assert.equal(dataAlpha.activeTurnStatus?.isRunning, true);

      // Consulta para Beta (em repouso)
      const resBeta = await fetch(`http://127.0.0.1:${port}/api/metachat/status?threadId=${threadBetaId}`);
      assert.equal(resBeta.status, 200);
      const dataBeta = await resBeta.json();
      assert.equal(dataBeta.isRunning, false, 'Beta deve retornar isRunning: false pela API');
      assert.equal(dataBeta.executingThreadId, null);
      assert.equal(dataBeta.activeTurnStatus?.isRunning, false);
      assert.equal(dataBeta.elapsedSeconds, 0);
    } finally {
      (MetaChatService as any)._currentExecutions.delete(threadAlphaId);
      server.close();
    }
  });

  it('6. Auto-limpeza de cancelamento: novo turno limpa resíduos e escopa cancelamento por thread', () => {
    const threadTestId = 'thread-cancellation-test';
    const convTestId = 'conv-test-cancellation-999';

    // Simula token antigo 'metachat' órfão no TurnCancellationManager
    TurnCancellationManager.requestCancellation('metachat');
    TurnCancellationManager.requestCancellation(convTestId);
    assert.equal(TurnCancellationManager.isCancelled('metachat'), true);
    assert.equal(TurnCancellationManager.isCancelled(convTestId), true);

    // Verificação estrita por thread: não deve ser cancelada se o token for apenas 'metachat'
    const shouldCancelThread = () => Boolean(
      MetaChatService.getExecution(threadTestId)?.cancelRequested ||
      TurnCancellationManager.isCancelled(threadTestId, 'conv-other')
    );
    assert.equal(shouldCancelThread(), false, 'Thread não deve ser cancelada por token residual metachat');

    // Executa limpeza de início de turno
    TurnCancellationManager.clearCancellation('metachat', convTestId, threadTestId);
    assert.equal(TurnCancellationManager.isCancelled('metachat'), false, 'Token metachat deve estar limpo');
    assert.equal(TurnCancellationManager.isCancelled(convTestId), false, 'Token da conversa deve estar limpo');
    assert.equal(TurnCancellationManager.isCancelled(threadTestId), false, 'Token da thread deve estar limpo');

    // Quando cancelamento explícito da thread é solicitado
    TurnCancellationManager.requestCancellation(threadTestId);
    assert.equal(TurnCancellationManager.isCancelled(threadTestId, convTestId), true, 'Cancelamento da thread específica deve ser detectado');

    // Limpeza final
    TurnCancellationManager.clearCancellation(threadTestId, convTestId, 'metachat');
  });
});
