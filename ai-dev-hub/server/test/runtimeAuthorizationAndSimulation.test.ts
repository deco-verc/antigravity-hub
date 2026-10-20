import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { AgentApiGateway, FailClosedGuardError, AgentApiMockProvider } from '../src/agentApiGateway.js';
import { DevAutonomyService } from '../src/devAutonomyService.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { PolicyEngine } from '../src/policyEngine.js';

describe('DecoHUB — Homologação de Autorização de Runtime e Provedor Simulado', () => {
  const tmpDir = path.join(os.tmpdir(), `decohub-runtime-auth-test-${Date.now()}`);
  const authorizedProjId = `proj-auth-${Date.now()}`;
  const trustedOnlyProjId = `proj-trusted-only-${Date.now()}`;
  const untrustedProjId = `proj-untrusted-${Date.now()}`;
  const nowIso = new Date().toISOString();

  // Custom Simulated Provider tracking all sent operations
  class SimulatedRecordedProvider implements AgentApiMockProvider {
    createdConversations: Array<{ id: string; model: string; title: string; prompt: string; projectId?: string | null; role?: string | null }> = [];
    sentMessages: Array<{ conversationId: string; prompt: string; projectId?: string | null; role?: string | null }> = [];
    counter = 0;

    newConversation(options: { model: string; title: string; prompt: string; projectId?: string | null; role?: string | null }): string {
      this.counter++;
      const id = `conv-simulated-${options.role?.toLowerCase() || 'agent'}-${this.counter}`;
      this.createdConversations.push({ id, ...options });
      return id;
    }

    sendMessage(options: { conversationId: string; prompt: string; projectId?: string | null; role?: string | null }): void {
      this.sentMessages.push(options);
    }

    getConversationMetadata(conversationId: string): any {
      const exists = this.createdConversations.some(c => c.id === conversationId);
      return {
        rootConversationId: conversationId,
        status: exists ? 'ACTIVE' : 'NOT_FOUND'
      };
    }

    reset(): void {
      this.createdConversations = [];
      this.sentMessages = [];
      this.counter = 0;
    }
  }

  const simulatedProvider = new SimulatedRecordedProvider();

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1. Authorized Project: is_trusted = 1, full_dev_autonomy = 1
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, 'Projeto Autorizado', ?, 'Executar com autonomia total', 'node', 'active', 1, 1, ?, ?)
    `).run(authorizedProjId, path.join(tmpDir, 'auth-proj'), nowIso, nowIso);

    // 2. Trusted-Only Project: is_trusted = 1, full_dev_autonomy = 0 (Requires explicit policy)
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, 'Projeto Somente Confiável', ?, 'Apenas confia no workspace, sem autonomia total', 'node', 'active', 1, 0, ?, ?)
    `).run(trustedOnlyProjId, path.join(tmpDir, 'trusted-only-proj'), nowIso, nowIso);

    // 3. Untrusted Project: is_trusted = 0, full_dev_autonomy = 0
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, 'Projeto Não Confiável', ?, 'Bloquear execuções', 'node', 'active', 0, 0, ?, ?)
    `).run(untrustedProjId, path.join(tmpDir, 'untrusted-proj'), nowIso, nowIso);
  });

  after(() => {
    AgentApiGateway.installDefaultMock();
    db.prepare('DELETE FROM agent_sessions WHERE project_id IN (?, ?, ?)').run(authorizedProjId, trustedOnlyProjId, untrustedProjId);
    db.prepare('DELETE FROM projects WHERE id IN (?, ?, ?)').run(authorizedProjId, trustedOnlyProjId, untrustedProjId);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "runtimeAuthorizationAndSimulation.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:runtimeAuthorizationAndSimulation.test]", err);
      }
    }
  });

  test('1. Isolamento de Autorização: Projeto não confiável é terminantemente bloqueado', () => {
    const authCheck = DevAutonomyService.isProjectAuthorizedForLiveExecution(untrustedProjId);
    assert.strictEqual(authCheck.authorized, false);
    assert.ok(authCheck.reason.includes('is_trusted=0'));

    // Projeto inexistente também é bloqueado
    const nonExistentCheck = DevAutonomyService.isProjectAuthorizedForLiveExecution('proj-inexistente-xyz');
    assert.strictEqual(nonExistentCheck.authorized, false);
  });

  test('2. Política de Autonomia: Confiança no workspace NÃO confere autonomia total automaticamente', () => {
    // is_trusted = 1, mas full_dev_autonomy = 0
    assert.strictEqual(DevAutonomyService.isProjectTrusted(trustedOnlyProjId), true);
    assert.strictEqual(DevAutonomyService.hasFullDevAutonomy(trustedOnlyProjId), false);

    const authCheck = DevAutonomyService.isProjectAuthorizedForLiveExecution(trustedOnlyProjId);
    assert.strictEqual(authCheck.authorized, false);
    assert.ok(authCheck.reason.includes('full_dev_autonomy=0'), 'Deve exigir explicitamente a política de autonomia');
  });

  test('3. Projeto Autorizado possui is_trusted=1 e full_dev_autonomy=1 comprovados no SQLite', () => {
    assert.strictEqual(DevAutonomyService.isProjectTrusted(authorizedProjId), true);
    assert.strictEqual(DevAutonomyService.hasFullDevAutonomy(authorizedProjId), true);

    const authCheck = DevAutonomyService.isProjectAuthorizedForLiveExecution(authorizedProjId);
    assert.strictEqual(authCheck.authorized, true);
  });

  test('4. Fluxo Autorizado chega até o Provider Simulado Registrado com gravação completa de operações', async () => {
    simulatedProvider.reset();
    AgentApiGateway.setMockProvider(simulatedProvider);

    // 1. Criação de sessão de Supervisor para projeto autorizado
    const { session: supSession, isNew: supIsNew } = await AgentSessionManager.getOrCreateAgentSession(
      authorizedProjId,
      'SUPERVISOR',
      { model: 'pro', initialPrompt: 'Planejamento do Run' }
    );

    assert.strictEqual(supIsNew, true);
    assert.ok(supSession.provider_conversation_id.startsWith('conv-simulated-supervisor-'));
    assert.strictEqual(simulatedProvider.createdConversations.length, 1);
    assert.strictEqual(simulatedProvider.createdConversations[0].projectId, authorizedProjId);

    // 2. Criação de sessão de Worker para projeto autorizado
    const { session: wrkSession, isNew: wrkIsNew } = await AgentSessionManager.getOrCreateAgentSession(
      authorizedProjId,
      'WORKER',
      { model: 'flash', initialPrompt: 'Implementação da Task' }
    );

    assert.strictEqual(wrkIsNew, true);
    assert.ok(wrkSession.provider_conversation_id.startsWith('conv-simulated-worker-'));
    assert.strictEqual(simulatedProvider.createdConversations.length, 2);
    assert.strictEqual(simulatedProvider.createdConversations[1].projectId, authorizedProjId);
  });

  test('5. Reutilização Estrita: 10 Tasks consecutivas reutilizam as mesmas sessões simuladas (0 novas conversas)', async () => {
    const initialCreations = simulatedProvider.createdConversations.length; // 2
    assert.strictEqual(initialCreations, 2);

    for (let i = 1; i <= 10; i++) {
      // Reutiliza Supervisor
      const { session: sup, isNew: supIsNew } = await AgentSessionManager.getOrCreateAgentSession(
        authorizedProjId,
        'SUPERVISOR'
      );
      assert.strictEqual(supIsNew, false, `Task ${i}: Supervisor deve ser reutilizado`);

      // Envia mensagem simulada
      await AgentSessionManager.sendMessage(sup, `Turno ${i} de revisão`);

      // Reutiliza Worker
      const { session: wrk, isNew: wrkIsNew } = await AgentSessionManager.getOrCreateAgentSession(
        authorizedProjId,
        'WORKER'
      );
      assert.strictEqual(wrkIsNew, false, `Task ${i}: Worker deve ser reutilizado`);

      // Envia mensagem simulada
      await AgentSessionManager.sendMessage(wrk, `Turno ${i} de execução de código`);
    }

    // Comprova que nenhuma conversa adicional foi criada
    assert.strictEqual(
      simulatedProvider.createdConversations.length,
      initialCreations,
      'Ao longo de 10 Tasks, ZERO novas conversas foram criadas no provedor simulado'
    );

    // Comprova que as mensagens chegaram com sucesso
    assert.strictEqual(simulatedProvider.sentMessages.length, 20);
  });

  test('6. Operações de Alto Risco permanecem estritamente sujeitas à aprovação humana', () => {
    // Mesmo com autonomia total do projeto, comandos perigosos devem continuar RED
    const highRiskCommands = [
      'rm -rf /',
      'git push origin main --force',
      'drop database production',
      'cat credentials.json',
      'stripe checkout charge 500'
    ];

    for (const cmd of highRiskCommands) {
      const evaluation = PolicyEngine.evaluateCommand(cmd, { fullDevAutonomy: true });
      assert.strictEqual(evaluation.riskLevel, 'red', `Comando ${cmd} deve ser classificado como RED`);
      assert.strictEqual(evaluation.requiresHumanApproval, true);
      assert.strictEqual(evaluation.isHardBlocked, true);
    }
  });
});
