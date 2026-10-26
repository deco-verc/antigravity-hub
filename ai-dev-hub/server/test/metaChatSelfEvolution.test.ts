// server/test/metaChatSelfEvolution.test.ts
// Testes automatizados para FASE 15: DecoHUB Meta-Chat — Auto-Evolução e Modificação do Próprio Código

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MetaChatService } from '../src/metaChatService.js';
import { db } from '../src/db.js';
import { DevAutonomyService } from '../src/devAutonomyService.js';
import { NativeWorkspaceBinding } from '../src/nativeWorkspaceBinding.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';
import { observeTranscript, isRawToolOrCommandOutput } from '../src/agentTurnState.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';

describe('FASE 15: DecoHUB Meta-Chat — Auto-Evolução & Self-Healing Guard', () => {
  const root = MetaChatService.getDecoHubRoot();
  const testHelperPath = path.join(root, 'server', 'src', 'utils', '__metaChatTestUtil.ts');

  before(() => {
    process.env.NODE_ENV = 'test';
    process.env.DECOHUB_OFFLINE_MODE = 'true';
    AgentApiGateway.installDefaultMock();
    // Garantir que histórico de teste anterior esteja limpo
    MetaChatService.resetMessages();
    if (fs.existsSync(testHelperPath)) {
      try { fs.unlinkSync(testHelperPath); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatSelfEvolution.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatSelfEvolution.test]", err);
      }
    }
    }
  });

  after(() => {
    // Limpeza de artefatos de teste
    if (fs.existsSync(testHelperPath)) {
      try { fs.unlinkSync(testHelperPath); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatSelfEvolution.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatSelfEvolution.test]", err);
      }
    }
    }
    MetaChatService.resetMessages();
    delete process.env.DECOHUB_OFFLINE_MODE;
    AgentApiGateway.restoreLiveGateway();
  });

  it('1. Security Scope Guard: Rejeita com segurança caminhos fora do repositório', () => {
    // 1.1 Path traversal com ../
    assert.throws(
      () => MetaChatService.validatePathWithinRepo('../../outside.env'),
      /SECURITY_SCOPE_VIOLATION/,
      'Deve bloquear traversal com ../'
    );

    // 1.2 Caminho absoluto externo no Windows/Linux
    const extPath = process.platform === 'win32' ? 'C:\\Windows\\System32\\calc.exe' : '/etc/passwd';
    assert.throws(
      () => MetaChatService.validatePathWithinRepo(extPath),
      /SECURITY_SCOPE_VIOLATION/,
      'Deve bloquear acesso a arquivos de sistema fora do repositório'
    );

    // 1.3 Caminho válido interno
    const validInternal = MetaChatService.validatePathWithinRepo('server/package.json');
    assert.ok(validInternal.includes('server'), 'Caminho interno deve ser resolvido com sucesso');
  });

  it('2. Leitura Segura de Arquivos e Listagem de Diretórios do DecoHUB', () => {
    // Leitura de server/package.json
    const fileData = MetaChatService.readFile('server/package.json');
    assert.ok(fileData.content.includes('ai-dev-hub-server'), 'Deve ler o conteúdo real do package.json');
    assert.ok(fileData.lines > 10, 'Deve computar a quantidade de linhas');
    assert.equal(fileData.path, 'server/package.json');

    // Listagem da raiz do servidor
    const list = MetaChatService.listDirectory('server');
    assert.ok(list.includes('package.json'), 'Deve listar package.json');
    assert.ok(list.some(item => item.startsWith('src/')), 'Deve listar src/');
  });

  it('3. Histórico de Mensagens Persistente em SQLite (meta_chat_messages)', () => {
    MetaChatService.resetMessages();
    const initialMsgs = MetaChatService.getMessages();
    assert.equal(initialMsgs.length, 0, 'Histórico deve estar vazio após reset');

    const added = MetaChatService.addMessage({
      role: 'user',
      content: 'Instrução de teste: verificar status do DecoHUB'
    });
    assert.ok(added.id, 'Mensagem deve ter ID único gerado');
    assert.equal(added.role, 'user');

    const msgsAfter = MetaChatService.getMessages();
    assert.equal(msgsAfter.length, 1);
    assert.equal(msgsAfter[0].content, 'Instrução de teste: verificar status do DecoHUB');
  });

  it('4. Self-Healing Guard (Rollback Automático em caso de TypeScript Quebrado)', async () => {
    // Envia instrução com código TypeScript que viola a tipagem (atribuindo string para number com sintaxe inválida)
    const brokenCode = `export const INVALID_TEST_VALUE: number = "isto quebra a tipagem";\n{ syntax error `;

    const res = await MetaChatService.handleUserMessage(
      'Crie um utilitário com erro proposital para testar a autoproteção',
      {
        codeActions: [
          {
            action: 'write',
            filePath: 'server/src/utils/__metaChatTestBroken.ts',
            content: brokenCode
          }
        ]
      }
    );

    // Deve acionar Self-Healing
    assert.equal(res.selfHealed, true, 'Deve sinalizar que o Self-Healing Guard foi acionado');
    assert.equal(res.typecheck.passed, false, 'Typecheck deve indicar falha');
    assert.ok(res.message.content.includes('Autoproteção Ativa Ativada'), 'Mensagem deve avisar que o rollback ocorreu');

    // O arquivo quebrado NÃO deve persistir no disco após o rollback
    const brokenFilePath = path.join(root, 'server', 'src', 'utils', '__metaChatTestBroken.ts');
    assert.equal(fs.existsSync(brokenFilePath), false, 'Arquivo quebrado deve ter sido removido no rollback');
  });

  it('5. Escrita com Sucesso e Typecheck Guard Verde (Caminho Feliz)', async () => {
    // Código TypeScript válido e tipado estritamente
    const validCode = `// Utilitário de teste gerado pelo Meta-Chat\nexport function metaChatHealthCheck(): string {\n  return 'DECOHUB_META_CHAT_OK';\n}\n`;

    const res = await MetaChatService.handleUserMessage(
      'Adicione a função metaChatHealthCheck em server/src/utils/__metaChatTestUtil.ts',
      {
        codeActions: [
          {
            action: 'write',
            filePath: 'server/src/utils/__metaChatTestUtil.ts',
            content: validCode
          }
        ]
      }
    );

    assert.equal(res.selfHealed, false, 'Não deve acionar rollback quando o código é válido');
    assert.equal(res.typecheck.passed, true, 'Typecheck deve passar com sucesso');
    assert.ok(res.filesChanged.includes('server/src/utils/__metaChatTestUtil.ts'));
    assert.ok(fs.existsSync(testHelperPath), 'O arquivo válido deve ser persistido no disco');

    // Valida que o conteúdo salvo é exatamente o esperado
    const savedContent = fs.readFileSync(testHelperPath, 'utf-8');
    assert.ok(savedContent.includes('metaChatHealthCheck'));

    // Limpeza após o teste
    try { fs.unlinkSync(testHelperPath); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatSelfEvolution.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatSelfEvolution.test]", err);
      }
    }
  });

  it('6. Parser de Diretivas Markdown de Código ([FILE: path])', async () => {
    const promptWithDirective = `
Por favor, atualize o arquivo com a diretiva abaixo:
[FILE: server/src/utils/__metaChatTestUtil.ts]
\`\`\`ts
export const META_CHAT_TEST_CONSTANT = 42;
\`\`\`
    `.trim();

    const res = await MetaChatService.handleUserMessage(promptWithDirective, {
      codeActions: MetaChatService.parseCodeDirectives(promptWithDirective)
    });

    assert.equal(res.selfHealed, false);
    assert.equal(res.typecheck.passed, true);
    assert.ok(res.filesChanged.some(f => f.includes('__metaChatTestUtil.ts')));

    // Limpeza do arquivo criado pela diretiva
    if (fs.existsSync(testHelperPath)) {
      try { fs.unlinkSync(testHelperPath); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatSelfEvolution.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatSelfEvolution.test]", err);
      }
    }
    }
  });

  it('7. Despacho de Instrução em Linguagem Natural com Model Gemini 3.8 Flash, Reasoning High e Account', async () => {
    const naturalInstruction = 'Explique a estrutura de rotas do DecoHUB e verifique a integridade do backend.';

    const res = await MetaChatService.handleUserMessage(naturalInstruction, {
      model: 'gemini-3.8-flash',
      reasoningMode: 'high',
      accountId: 'acc-pro-1'
    });

    assert.ok(res.message, 'Deve retornar mensagem da resposta');
    assert.equal(res.message.role, 'assistant');
    assert.ok(res.message.content.length > 20, 'Resposta deve ser elaborada e não vazia');
    assert.ok(res.conversationId, 'Deve retornar ou associar um conversationId');
    assert.equal(res.message.metadata?.model, 'gemini-3.8-flash');
    assert.equal(res.message.metadata?.reasoningMode, 'high');
    assert.equal(res.message.metadata?.accountId, 'acc-pro-1');
    assert.equal(res.typecheck.passed, true, 'Typecheck deve ser validado');
    assert.ok(res.typecheck.durationMs >= 0, 'Duração do typecheck deve ser medida');
  });

  it('8. Upload e Persistência de Anexos em disco (.ai-dev-hub/metachat-uploads)', async () => {
    // 1x arquivo de texto com código e 1x arquivo de imagem simulada em base64
    const dummyImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const dummyCodeContent = 'export const TEST_ATTACHED_HELPER = "ok";';

    const res = await MetaChatService.handleUserMessage('Analise este código e print anexados', {
      model: 'gemini-3.8-flash',
      reasoningMode: 'high',
      attachments: [
        {
          name: 'screenshot-test.png',
          type: 'image/png',
          base64Content: dummyImageBase64
        },
        {
          name: 'helper.ts',
          type: 'text/typescript',
          content: dummyCodeContent
        }
      ]
    });

    assert.ok(res.message, 'Deve processar mensagem com anexos');
    const uploadsDir = path.join(root, '.ai-dev-hub', 'metachat-uploads');
    assert.ok(fs.existsSync(uploadsDir), 'Diretório .ai-dev-hub/metachat-uploads deve existir');

    const filesInUploads = fs.readdirSync(uploadsDir);
    assert.ok(filesInUploads.some(f => f.includes('screenshot-test') && f.endsWith('.png')), 'Screenshot PNG deve ser salvo em disco');
    assert.ok(filesInUploads.some(f => f.includes('helper') && f.endsWith('.ts')), 'Código anexado deve ser salvo em disco');

    // Validação da mensagem do usuário com metadados de anexos
    const msgs = MetaChatService.getMessages(10);
    const userMsg = msgs.find(m => m.role === 'user' && m.metadata?.attachments?.length === 2);
    assert.ok(userMsg, 'Mensagem do usuário deve conter metadados dos 2 anexos');
    assert.equal(userMsg.metadata.attachments[0].name, 'screenshot-test.png');
    assert.equal(userMsg.metadata.attachments[1].name, 'helper.ts');

    // Limpeza dos arquivos de teste em metachat-uploads
    for (const f of filesInUploads) {
      if (f.includes('screenshot-test') || f.includes('helper')) {
        try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "metaChatSelfEvolution.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:metaChatSelfEvolution.test]", err);
      }
    }
      }
    }
  });

  it('9. Persistência de conversationId e Reset Completo do Histórico', () => {
    MetaChatService.setActiveConversationId('conv-test-12345');
    assert.equal(MetaChatService.getActiveConversationId(), 'conv-test-12345');

    // Ao chamar resetMessages(), o histórico e a sessão ativa devem ser limpos
    MetaChatService.resetMessages();
    assert.equal(MetaChatService.getActiveConversationId(), null, 'conversationId deve ser anulado no reset');
    assert.equal(MetaChatService.getMessages().length, 0, 'Mensagens devem ser limpas');
  });

  it('10. Execução do Meta-Chat com perfil de conta específico (accountId) e autorização live contornando AUTHORIZATION_GUARD', async () => {
    // 10.1 DevAutonomyService autoriza chamadas vindas do MetaChatService mesmo sem projeto ou em projeto não confiável
    const authCaller = DevAutonomyService.isProjectAuthorizedForLiveExecution(null, 'MetaChatService.handleUserMessage');
    assert.equal(authCaller.authorized, true, 'Deve autorizar quando caller for MetaChatService');

    const authMetaProj = DevAutonomyService.isProjectAuthorizedForLiveExecution('__decohub_metachat__');
    assert.equal(authMetaProj.authorized, true, 'Deve autorizar projeto __decohub_metachat__');

    const authDecoHub = DevAutonomyService.isProjectAuthorizedForLiveExecution('decohub-meta');
    assert.equal(authDecoHub.authorized, true, 'Deve autorizar projeto decohub-meta');

    // 10.2 NativeWorkspaceBinding.assertEnvironment autoriza MetaChat sem exigir projeto registrado previamente
    const bindingRecord = NativeWorkspaceBinding.assertEnvironment(null, undefined, 'MetaChatService');
    assert.ok(bindingRecord, 'Deve retornar record válido');
    assert.equal(bindingRecord.executionPolicy?.mode, 'permissive', 'Deve usar política permissiva para Meta-Chat');

    // 10.3 handleUserMessage despacha com accountId específico isolado
    const res = await MetaChatService.handleUserMessage('Verifique o status da Conta 04', {
      model: 'gemini-3.8-flash',
      reasoningMode: 'high',
      accountId: 'acc-pro-4'
    });
    assert.ok(res.message, 'Deve retornar mensagem do assistente');
    assert.equal(res.message.metadata?.accountId, 'acc-pro-4');
  });

  it('11. Auto-recuperação quando sendMessage falha em conversationId antigo, criando nova conversa', async () => {
    // Configura conversationId antigo expirado
    const expiredConvId = 'conv-expired-old-999';
    MetaChatService.setActiveConversationId(expiredConvId, 'acc-recovery-test');
    assert.equal(MetaChatService.getActiveConversationId('acc-recovery-test'), expiredConvId);

    const mock = AgentApiGateway.getMockProvider()!;
    const origSendMessage = mock.sendMessage.bind(mock);
    let sendMessageAttempts = 0;

    mock.sendMessage = (opts: any) => {
      if (opts.conversationId === expiredConvId) {
        sendMessageAttempts++;
        throw new Error('SESSION_EXPIRED: sessão expirada no language server');
      }
      return origSendMessage(opts);
    };

    try {
      const res = await MetaChatService.handleUserMessage('Comando pós-sessão expirada', {
        accountId: 'acc-recovery-test'
      });

      assert.equal(sendMessageAttempts, 1, 'Deve ter tentado enviar na conversa expirada');
      assert.ok(res.conversationId, 'Deve retornar conversationId');
      assert.notEqual(res.conversationId, expiredConvId, 'Deve ter criado um novo conversationId de auto-recuperação');
      assert.equal(res.message.role, 'assistant');
      assert.equal(
        MetaChatService.getActiveConversationId('acc-recovery-test'),
        res.conversationId,
        'Novo conversationId deve ser salvo como ativo para a conta'
      );
    } finally {
      mock.sendMessage = origSendMessage;
    }
  });

  it('12. Persistência garantida de mensagem role: assistant em meta_chat_messages mesmo em cenário de erro', async () => {
    MetaChatService.resetMessages();
    const mock = (AgentApiGateway as any).getMockProvider()!;
    mock.simulateFailure = new Error('AGENTAPI_UNAVAILABLE: runtime caiu inesperadamente');

    try {
      const res = await MetaChatService.handleUserMessage('Instrução que gerará erro no runtime', {
        accountId: 'acc-fail-test'
      });

      // A resposta retornada DEVE ser do assistente com role assistant
      assert.ok(res.message, 'Deve retornar resposta estruturada mesmo em erro');
      assert.equal(res.message.role, 'assistant', 'Mensagem DEVE ter role assistant para não deixar usuário sem resposta');
      assert.ok(res.message.content.includes('[ERRO]'), 'Conteúdo deve conter diagnóstico de erro');
      assert.ok(res.message.content.includes('AGENTAPI_UNAVAILABLE'), 'Conteúdo deve citar AGENTAPI_UNAVAILABLE');

      // Verifica se a mensagem foi persistida na tabela meta_chat_messages
      const persisted = MetaChatService.getMessages();
      assert.equal(persisted.length, 2, 'Deve ter gravado mensagem do usuário e mensagem de erro do assistente');
      assert.equal(persisted[0].role, 'user');
      assert.equal(persisted[1].role, 'assistant');
      assert.ok(persisted[1].content.includes('[ERRO]'));
    } finally {
      mock.simulateFailure = null;
    }
  });

  it('13. Endpoint / Status em tempo real getLiveStatus e updateLiveStatus', () => {
    // Estado inicial após reset
    MetaChatService.resetMessages();
    const statusInitial = MetaChatService.getLiveStatus();
    assert.equal(statusInitial.isRunning, false);
    assert.equal(statusInitial.phase, 'IDLE');

    // Atualização de estado
    MetaChatService.updateLiveStatus({
      isRunning: true,
      phase: 'Conectando ao runtime da Conta 04...',
      activeAccount: 'Conta 04',
      activeModel: 'gemini-3.8-flash'
    });

    const statusRunning = MetaChatService.getLiveStatus();
    assert.equal(statusRunning.isRunning, true);
    assert.equal(statusRunning.phase, 'Conectando ao runtime da Conta 04...');
    assert.equal(statusRunning.activeAccount, 'Conta 04');
    assert.equal(statusRunning.activeModel, 'gemini-3.8-flash');

    // Finalização
    MetaChatService.updateLiveStatus({
      isRunning: false,
      phase: 'IDLE',
      lastStep: 'Concluído'
    });
    assert.equal(MetaChatService.getLiveStatus().isRunning, false);
  });

  it('14. Multi-Threads Persistentes: CRUD de Conversas Salvas e Isolamento de Mensagens', () => {
    // 14.1 Criação de Threads independentes
    const threadA = MetaChatService.createThread({
      title: 'Refatoração do Módulo de Autonomia',
      model: 'gemini-3.8-flash',
      effort: 'HIGH'
    });
    assert.ok(threadA.id.startsWith('thread-'));
    assert.equal(threadA.title, 'Refatoração do Módulo de Autonomia');
    assert.equal(threadA.status, 'idle');

    const threadB = MetaChatService.createThread({
      title: 'Investigação de Performance do SQLite',
      model: 'gemini-3.8-pro',
      effort: 'HIGH'
    });
    assert.ok(threadB.id.startsWith('thread-'));

    // 14.2 Active Thread Tracking
    assert.equal(MetaChatService.getActiveThreadId(), threadB.id);
    MetaChatService.setActiveThreadId(threadA.id);
    assert.equal(MetaChatService.getActiveThreadId(), threadA.id);

    // 14.3 Isolamento de Mensagens por Thread
    MetaChatService.addMessage({
      role: 'user',
      content: 'Mensagem pertencente à Thread A',
      thread_id: threadA.id
    });
    MetaChatService.addMessage({
      role: 'user',
      content: 'Mensagem pertencente à Thread B',
      thread_id: threadB.id
    });

    const msgsA = MetaChatService.getMessages(threadA.id);
    const msgsB = MetaChatService.getMessages(threadB.id);

    assert.equal(msgsA.length, 1);
    assert.equal(msgsA[0].content, 'Mensagem pertencente à Thread A');
    assert.equal(msgsA[0].thread_id, threadA.id);

    assert.equal(msgsB.length, 1);
    assert.equal(msgsB[0].content, 'Mensagem pertencente à Thread B');
    assert.equal(msgsB[0].thread_id, threadB.id);

    // 14.4 Listagem de Threads
    const allThreads = MetaChatService.listThreads();
    assert.ok(allThreads.some(t => t.id === threadA.id));
    assert.ok(allThreads.some(t => t.id === threadB.id));

    // 14.5 Atualização e Exclusão de Thread com Limpeza em Cascata
    MetaChatService.updateThread(threadA.id, { title: 'Refatoração Concluída' });
    const fetchedA = MetaChatService.getThread(threadA.id);
    assert.equal(fetchedA?.title, 'Refatoração Concluída');

    const deleted = MetaChatService.deleteThread(threadA.id);
    assert.equal(deleted, true);
    assert.equal(MetaChatService.getThread(threadA.id), null);
    assert.equal(MetaChatService.getMessages(threadA.id).length, 0);
  });

  it('15. Transparência Total: Telemetria de Atividade em Tempo Real (getLiveActivity & Pipeline Tasks)', async () => {
    // 15.1 Estado Idle da Telemetria
    const thread = MetaChatService.createThread({ title: 'Thread de Teste de Telemetria' });
    MetaChatService.setActiveThreadId(thread.id);

    const idleActivity = MetaChatService.getLiveActivity(thread.id);
    assert.equal(idleActivity.isExecuting, false);
    assert.equal(idleActivity.pipelineTasks.length, 4);
    assert.ok(idleActivity.pipelineTasks.some(t => t.id === 'task-inspect'));
    assert.ok(idleActivity.pipelineTasks.some(t => t.id === 'task-implement'));
    assert.ok(idleActivity.pipelineTasks.some(t => t.id === 'task-verify'));
    assert.ok(idleActivity.pipelineTasks.some(t => t.id === 'task-guard'));

    // 15.2 Execução com rastreamento de ações e persistência de executed_steps_json
    const res = await MetaChatService.handleUserMessage('Teste de telemetria e passos executados', {
      threadId: thread.id,
      model: 'gemini-3.8-flash',
      reasoningMode: 'high'
    });

    assert.ok(res.message);
    assert.equal(res.message.thread_id, thread.id);
    assert.ok(res.message.metadata?.executedSteps);
    assert.ok(Array.isArray(res.message.metadata.executedSteps));
    assert.ok(res.message.executed_steps_json);

    // 15.3 Atividade gravada recuperável após conclusão
    const completedActivity = MetaChatService.getLiveActivity(thread.id);
    assert.equal(completedActivity.isExecuting, false);
    assert.ok(completedActivity.liveSteps.length > 0);
    assert.equal(completedActivity.pipelineTasks.every(t => t.status === 'completed'), true);
  });

  it('16. getDecoHubRoot com suporte a DECOHUB_REPO_ROOT com prioridade máxima e validação sem client/package.json', () => {
    const originalEnv = process.env.DECOHUB_REPO_ROOT;
    const currentRoot = MetaChatService.getDecoHubRoot();

    try {
      // 16.1 DECOHUB_REPO_ROOT define a raiz diretamente
      process.env.DECOHUB_REPO_ROOT = currentRoot;
      const resolvedWithEnv = MetaChatService.getDecoHubRoot();
      assert.equal(resolvedWithEnv, currentRoot);

      // 16.2 Raiz válida contendo server/package.json ou dist-desktop sem exigir client/package.json
      assert.ok(fs.existsSync(path.join(currentRoot, 'server', 'package.json')));
    } finally {
      if (originalEnv) {
        process.env.DECOHUB_REPO_ROOT = originalEnv;
      } else {
        delete process.env.DECOHUB_REPO_ROOT;
      }
    }
  });

  it('17. Direct Patching: Aplica arquivos no disco a partir de markdown no retorno do agente', async () => {
    MetaChatService.resetMessages();
    const directPatchFile = path.join(root, 'server', 'src', 'utils', '__metaChatDirectPatchTest.ts');
    if (fs.existsSync(directPatchFile)) {
      try { fs.unlinkSync(directPatchFile); } catch {}
    }

    const mock = AgentApiGateway.getMockProvider()!;
    const origGetResponse = mock.getResponse?.bind(mock);

    mock.getResponse = () => {
      return `
Aqui está o código solicitado para o utilitário:

[FILE: server/src/utils/__metaChatDirectPatchTest.ts]
\`\`\`typescript
export const DIRECT_PATCH_SUCCESS = true;
\`\`\`
[ENDFILE]
      `.trim();
    };

    try {
      const res = await MetaChatService.handleUserMessage('Crie o utilitário de direct patch');
      assert.equal(res.selfHealed, false);
      assert.ok(res.filesChanged.some(f => f.includes('__metaChatDirectPatchTest.ts')));
      assert.ok(fs.existsSync(directPatchFile));
      const fileContent = fs.readFileSync(directPatchFile, 'utf-8');
      assert.ok(fileContent.includes('DIRECT_PATCH_SUCCESS = true'));
    } finally {
      if (origGetResponse) {
        mock.getResponse = origGetResponse;
      }
      if (fs.existsSync(directPatchFile)) {
        try { fs.unlinkSync(directPatchFile); } catch {}
      }
    }
  });

  it('18. Resiliência do Meta-Chat: Parser de blocos com múltiplos formatos de fences [FILE: ...]', () => {
    const rawMarkdown = `
Instrução executada com sucesso:
\`\`\`typescript [FILE: server/src/utils/__metaChatMultiFormat1.ts]
export const FORMAT_1 = 1;
\`\`\`

\`\`\`ts:server/src/utils/__metaChatMultiFormat2.ts
export const FORMAT_2 = 2;
\`\`\`
    `.trim();

    const parsed = (MetaChatService as any).parseCodeDirectives(rawMarkdown);
    assert.ok(parsed.length >= 2);
    assert.ok(parsed.some((p: any) => p.filePath.includes('__metaChatMultiFormat1.ts')));
    assert.ok(parsed.some((p: any) => p.filePath.includes('__metaChatMultiFormat2.ts')));

    // 18.2 Blindagem contra caminhos fictícios e placeholders de documentação
    const fakeMarkdown = `
Exemplo no prompt:
\`\`\`ts [FILE: caminho/do/arquivo.ts] ... \`\`\`
\`\`\`ts [FILE: path/to/exemplo.ts]
const x = 1;
\`\`\`
\`\`\`ts [FILE: server/src/valid.ts]
...
\`\`\`
\`\`\`ts [FILE: outside/root.ts]
export const SHOULD_FAIL_NOT_ALLOWED = true;
\`\`\`
    `.trim();

    const fakeParsed = (MetaChatService as any).parseCodeDirectives(fakeMarkdown);
    assert.equal(fakeParsed.length, 0, 'Caminhos fictícios e placeholders como caminho/do/arquivo.ts devem ser descartados');
  });

  it('19. Typecheck Guard Scoped: Valida com sucesso arquivos de escopo usando flags --noEmit e --skipLibCheck', async () => {
    // 19.1 Executa typecheck com escopo vazio ou arquivo existente válido
    const res = await MetaChatService.runTypecheck('server', ['server/src/utils/logger.ts']);
    assert.equal(typeof res.passed, 'boolean');
    assert.equal(typeof res.durationMs, 'number');
    assert.ok(Array.isArray(res.errors));

    // 19.2 Em caso de erro proposital em arquivo do escopo, extrai os detalhes estruturados de arquivo, linha e mensagem
    const brokenPath = path.join(root, 'server', 'src', 'utils', '__tempTypecheckErrorTest.ts');
    fs.writeFileSync(brokenPath, 'export const ERROR_VALUE: number = "violacao_de_tipo";\n');
    try {
      const brokenRes = await MetaChatService.runTypecheck('server', ['server/src/utils/__tempTypecheckErrorTest.ts']);
      assert.equal(brokenRes.passed, false);
      assert.ok(brokenRes.errors && brokenRes.errors.length > 0);
      assert.ok(brokenRes.errors.some(e => e.file.includes('__tempTypecheckErrorTest.ts')));
    } finally {
      if (fs.existsSync(brokenPath)) {
        try { fs.unlinkSync(brokenPath); } catch {}
      }
    }
  });

  it('20. Isolamento Estrito de Conversas por Thread (provider_conversation_id) e Reset Seguro', async () => {
    // 20.1 Criação de Threads independentes
    const tA = MetaChatService.createThread({ title: 'Thread Alpha - Diagnóstico' });
    const tB = MetaChatService.createThread({ title: 'Thread Beta - Refatoração' });

    // 20.2 Associação de conversas distintas no provider
    MetaChatService.setActiveConversationId('conv-alpha-001', 'acc-pro-1', tA.id);
    MetaChatService.setActiveConversationId('conv-beta-002', 'acc-pro-1', tB.id);

    // 20.3 Validação de isolamento do ID de conversa ativo por Thread
    assert.equal(MetaChatService.getActiveConversationId('acc-pro-1', tA.id), 'conv-alpha-001');
    assert.equal(MetaChatService.getActiveConversationId('acc-pro-1', tB.id), 'conv-beta-002');

    // 20.4 Validação no registro da tabela meta_chat_threads
    const storedA = MetaChatService.getThread(tA.id);
    const storedB = MetaChatService.getThread(tB.id);
    assert.equal(storedA?.provider_conversation_id, 'conv-alpha-001');
    assert.equal(storedB?.provider_conversation_id, 'conv-beta-002');

    // 20.5 Nova Thread sem mensagens deve retornar null (força nova conversa no primeiro envio)
    const tC = MetaChatService.createThread({ title: 'Thread Gamma - Nova' });
    assert.equal(MetaChatService.getActiveConversationId('acc-pro-1', tC.id), null);

    // 20.6 Reset de Alpha não pode afetar Beta
    MetaChatService.resetMessages(tA.id);
    assert.equal(MetaChatService.getActiveConversationId('acc-pro-1', tA.id), null);
    assert.equal(MetaChatService.getThread(tA.id)?.provider_conversation_id, null);

    // Beta permanece 100% preservada
    assert.equal(MetaChatService.getActiveConversationId('acc-pro-1', tB.id), 'conv-beta-002');
    assert.equal(MetaChatService.getThread(tB.id)?.provider_conversation_id, 'conv-beta-002');
  });

  it('21. Bloqueio de Falsos Positivos: isRawToolOrCommandOutput impede encerramento prematuro e contaminação de resposta', () => {
    // 21.1 Detecta saída de comando bruto como tool output
    const rawOutput = `Created At: 2026-10-22T02:05:09-03:00\nCompleted At: 2026-10-22T02:05:09-03:00\nCommand exited with code 0.\nCommand output:\nserver/src/agentGuidelines.ts:280: return true;`;
    assert.equal(isRawToolOrCommandOutput(rawOutput), true);

    // 21.2 Não confunde respostas reais do assistente
    const genuineAssistantResponse = `Aqui está a implementação concluída no arquivo utils.ts:\n\`\`\`ts\nexport const ready = true;\n\`\`\``;
    assert.equal(isRawToolOrCommandOutput(genuineAssistantResponse), false);

    // 21.3 observeTranscript mantém estado RUNNING se última entrada for saída crua de comando
    const tempDir = fs.mkdtempSync(path.join(path.join(root, 'server', 'test'), 'temp-raw-observe-'));
    const transcriptFile = path.join(tempDir, 'transcript.jsonl');
    try {
      const lines = [
        JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Execute a busca' }),
        JSON.stringify({
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          role: 'assistant',
          content: rawOutput,
          tool_calls: []
        })
      ];
      fs.writeFileSync(transcriptFile, lines.join('\n') + '\n', 'utf8');

      const obs = observeTranscript(transcriptFile, 0);
      assert.equal(obs.state, 'RUNNING', 'Estado deve permanecer RUNNING enquanto for apenas saída crua de comando');
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('22. Coletor Automático de Telemetria Forense (collectSystemTelemetryDossier)', () => {
    const thread = MetaChatService.createThread({ title: 'Thread Autopilot Telemetria' });
    const dossier = MetaChatService.collectSystemTelemetryDossier(thread.id);

    assert.equal(typeof dossier.prompt, 'string');
    assert.ok(dossier.prompt.length > 200);
    assert.ok(dossier.prompt.includes('# MISSÃO AUTÔNOMA DE AUTO-EVOLUÇÃO'));
    assert.ok(dossier.prompt.includes('### 1. TELEMETRIA COLETADA DO SISTEMA:'));
    assert.ok(dossier.prompt.includes('### 2. DIRETRIZES DE EXECUÇÃO CIRÚRGICA:'));
    assert.equal(typeof dossier.telemetry.problematicTasksCount, 'number');
    assert.equal(typeof dossier.telemetry.rejectedEvaluationsCount, 'number');
  });

  it('23. Daemon Autônomo "Meta-Chat Autopilot": Execução de 2 ciclos autônomos sem intervenção humana', async () => {
    // 23.1 Inicia Autopilot com meta de 2 ciclos e cooldown zero
    const initialStatus = await MetaChatService.startAutopilot({
      maxCycles: 2,
      cooldownSeconds: 0
    });

    assert.equal(initialStatus.enabled, true);
    assert.equal(initialStatus.maxCycles, 2);
    assert.equal(initialStatus.mode, 'BATCH');
    assert.ok(initialStatus.activeThreadId);

    // 23.2 Aguarda a conclusão dos 2 ciclos com timeout
    const finalStatus = await MetaChatService.waitForAutopilotCompletion(20000);

    assert.equal(finalStatus.enabled, false);
    assert.equal(finalStatus.completedCycles, 2);
    assert.ok(finalStatus.lastCycleSummary && finalStatus.lastCycleSummary.length > 0);
  });

  it('24. Karpathy Autoresearch Ledger (results.tsv): Criação, registro e leitura de histórico recente', () => {
    const root = MetaChatService.getDecoHubRoot();
    const tsvPath = path.join(root, 'results.tsv');
    const backupContent = fs.existsSync(tsvPath) ? fs.readFileSync(tsvPath, 'utf-8') : null;

    try {
      if (fs.existsSync(tsvPath)) fs.unlinkSync(tsvPath);

      // 24.1 appendAutoresearchLedger cria o cabeçalho oficial de 5 colunas
      MetaChatService.appendAutoresearchLedger({
        commit: 'd4a0c98',
        scoreMetric: 'tc:0_tests:100%_pass',
        durationSec: 1.5,
        status: 'keep',
        description: 'Primeiro experimento Karpathy baseline'
      });

      assert.ok(fs.existsSync(tsvPath), 'results.tsv deve existir no disco');
      const lines = fs.readFileSync(tsvPath, 'utf-8').trim().split('\n');
      assert.equal(lines.length, 2, 'Deve conter cabeçalho + 1 linha');
      assert.equal(lines[0], 'commit\tscore_metric\tduration_s\tstatus\tdescription');
      assert.ok(lines[1].startsWith('d4a0c98\ttc:0_tests:100%_pass\t1.5\tkeep\t'));

      // 24.2 Inserção de experimentos subsequentes com keep, discard e crash
      MetaChatService.appendAutoresearchLedger({
        commit: 'a1b2c3d',
        scoreMetric: 'tc:failed',
        durationSec: 2.1,
        status: 'discard',
        description: 'Refatoração descartada por erro de tipagem'
      });

      MetaChatService.appendAutoresearchLedger({
        commit: 'e5f6g7h',
        scoreMetric: 'crash',
        durationSec: 0.8,
        status: 'crash',
        description: 'Tentativa que gerou exceção'
      });

      const history = MetaChatService.getRecentAutoresearchHistory(10);
      assert.ok(history.includes('commit\tscore_metric\tduration_s\tstatus\tdescription'));
      assert.ok(history.includes('d4a0c98'));
      assert.ok(history.includes('a1b2c3d'));
      assert.ok(history.includes('e5f6g7h'));

      // 24.3 .gitignore contém results.tsv
      const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
      assert.ok(gitignore.includes('results.tsv'), '.gitignore deve listar results.tsv');
    } finally {
      if (backupContent !== null) {
        fs.writeFileSync(tsvPath, backupContent, 'utf-8');
      }
    }
  });

  it('25. Injeção de Disciplina do program.md no Prompt do Autopilot (4 Regras Operacionais)', () => {
    const thread = MetaChatService.createThread({ title: 'Thread Karpathy Prompt Injection' });
    const dossier = MetaChatService.collectSystemTelemetryDossier(thread.id);

    // Valida injeção da tabela results.tsv no prompt
    assert.ok(dossier.prompt.includes('=== HISTÓRICO RECENTE DE EXPERIMENTOS (RESULTS.TSV) ==='));

    // Valida injeção das 4 regras canônicas do program.md
    assert.ok(dossier.prompt.includes('PROTOCOLO KARPATHY AUTORESEARCH'));
    assert.ok(dossier.prompt.includes('Escopo Cirúrgico (Single Logical Target)'));
    assert.ok(dossier.prompt.includes('Critério de Simplicidade (Simplicity Criterion)'));
    assert.ok(dossier.prompt.includes('Higiene de Contexto em Comandos de Terminal (Log Redirection)'));
    assert.ok(dossier.prompt.includes('Memória Experimental (results.tsv)'));
  });

  it('26. Oráculo Duplo de Avaliação Imutável e Critério de Simplicidade (Occam Razor)', async () => {
    // 26.1 Resolução de teste focado para arquivos do servidor
    const testResolved = MetaChatService.resolveMatchingServerTest(['server/src/metaChatService.ts']);
    assert.ok(testResolved.includes('metaChatSelfEvolution.test.ts') || testResolved.includes('metaChat'));

    // 26.2 Cálculo de delta de linhas (calculateLineDiff)
    const baseMap = new Map<string, { size: number; mtime: number; content: string }>();
    baseMap.set('server/src/sample.ts', { size: 10, mtime: Date.now(), content: 'line 1\nline 2\nline 3\n' });

    // 26.3 Validação da Navalha de Occam (bloqueio de complexidade desnecessária)
    const simplicityFail = MetaChatService.checkSimplicityCriterion(
      root,
      ['server/src/sample.ts'],
      baseMap,
      { testsPassed: false }
    );
    assert.equal(typeof simplicityFail.passed, 'boolean');
    assert.equal(typeof simplicityFail.delta, 'number');

    // 26.4 Client Visual Gate
    const clientGate = await MetaChatService.runClientVisualGate(['client/src/App.tsx']);
    assert.equal(typeof clientGate.passed, 'boolean');
    assert.equal(typeof clientGate.buildPassed, 'boolean');
    assert.equal(typeof clientGate.visualPassed, 'boolean');
  });

  it('27. Blindagem Anti-Poluição de hub.db e Expurgo de Projetos Fantasmas (Problem 1)', async () => {
    const { purgeGhostTestProjectsFromProductionDb, isRunningInTestEnvironment } = await import('../src/db.js');
    const { AutonomousRunnerService } = await import('../src/autonomousRunnerService.js');
    const os = await import('node:os');

    // 27.1 isRunningInTestEnvironment detecta ambiente de teste
    assert.equal(isRunningInTestEnvironment(), true);

    // 27.2 isGhostTestRun detecta IDs e caminhos de teste
    assert.equal(AutonomousRunnerService.isGhostTestRun({ id: 'run-rec-1234', project_id: 'proj-1' }), true);
    assert.equal(AutonomousRunnerService.isGhostTestRun({ id: 'run-1', project_id: 'proj-heal-abcd' }), true);
    assert.equal(AutonomousRunnerService.isGhostTestRun({ id: 'run-1', project_id: 'proj-test-temp' }), true);

    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, path, created_at, updated_at)
      VALUES ('proj-prod', 'Production Project', ?, datetime('now'), datetime('now'))
    `).run(root);
    assert.equal(AutonomousRunnerService.isGhostTestRun({ id: 'run-prod', project_id: 'proj-prod' }), false);

    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, path, created_at, updated_at)
      VALUES ('proj-temp', 'Temp Project', ?, datetime('now'), datetime('now'))
    `).run(path.join(os.tmpdir(), 'decohub-test-folder'));
    assert.equal(AutonomousRunnerService.isGhostTestRun({ id: 'run-temp', project_id: 'proj-temp' }), true);

    // 27.3 Expurgo de projetos de teste em banco de dados
    const purgeResult = purgeGhostTestProjectsFromProductionDb(db);
    assert.equal(typeof purgeResult.purgedProjects, 'number');
    assert.equal(typeof purgeResult.purgedRuns, 'number');
  });

  it('28. Limpeza de Dumps de Arquivo (stripRawLineNumberDumps) e Detecção Híbrida de Arquivos (Problem 2)', async () => {
    const { stripRawLineNumberDumps } = await import('../src/antigravityProvider.js');

    // 28.1 stripRawLineNumberDumps remove sequência de 5+ linhas numéricas e preserva texto explicativo
    const rawWithDump = [
      '### Diagnóstico do Problema',
      'Analisei o arquivo e identifiquei a causa:',
      '412: export function problematicFunction() {',
      '413:   const temp = false;',
      '414:   if (!temp) {',
      '415:     return null;',
      '416:   }',
      '417: }',
      'Conclusão: O retorno nulo precisa ser tratado.',
      '1. Primeiro passo de correção',
      '2. Segundo passo de correção'
    ].join('\n');

    const stripped = stripRawLineNumberDumps(rawWithDump);
    assert.ok(stripped.includes('### Diagnóstico do Problema'));
    assert.ok(stripped.includes('Analisei o arquivo e identifiquei a causa:'));
    assert.ok(!stripped.includes('412: export function problematicFunction()'));
    assert.ok(!stripped.includes('417: }'));
    assert.ok(stripped.includes('Conclusão: O retorno nulo precisa ser tratado.'));
    assert.ok(stripped.includes('1. Primeiro passo de correção'));
    assert.ok(stripped.includes('2. Segundo passo de correção'));

    // 28.2 Detecção de arquivos relativos e baseline de arquivos
    const status = MetaChatService.getGitStatusPorcelain(root);
    assert.ok(Array.isArray(status));
    for (const line of status) {
      assert.ok(!line.slice(3).startsWith('ai-dev-hub/'), 'Caminho não deve conter prefixo duplicado ai-dev-hub/');
    }

    // 28.3 diffFileBaseline com mapa de baseline
    const baseline = MetaChatService.captureFileBaseline(root);
    assert.ok(baseline instanceof Map);
    const diff = MetaChatService.diffFileBaseline(root, baseline, []);
    assert.ok(Array.isArray(diff));
  });

  it('29. Consulta de Mensagens do Meta-Chat Suporta Limite de 500 Mensagens', () => {
    const thread = MetaChatService.createThread({ title: 'Thread 500 Limit Check' });
    const messages = MetaChatService.getMessages(thread.id);
    assert.ok(Array.isArray(messages));
    assert.ok(messages.length <= 500);
  });
});
