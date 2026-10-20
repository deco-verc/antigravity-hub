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
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "metaChatSelfEvolution.test",
          error: err?.message || String(err)
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
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "metaChatSelfEvolution.test",
          error: err?.message || String(err)
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
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "metaChatSelfEvolution.test",
          error: err?.message || String(err)
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

    const res = await MetaChatService.handleUserMessage(promptWithDirective);

    assert.equal(res.selfHealed, false);
    assert.equal(res.typecheck.passed, true);
    assert.ok(res.filesChanged.some(f => f.includes('__metaChatTestUtil.ts')));

    // Limpeza do arquivo criado pela diretiva
    if (fs.existsSync(testHelperPath)) {
      try { fs.unlinkSync(testHelperPath); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "metaChatSelfEvolution.test",
          error: err?.message || String(err)
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
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "metaChatSelfEvolution.test",
          error: err?.message || String(err)
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
});
