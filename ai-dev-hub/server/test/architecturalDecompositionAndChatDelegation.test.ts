import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { DeltaFeatureEngine } from '../src/deltaFeatureEngine.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { ProjectChatService } from '../src/projectChatService.js';
import { ProjectOperationsService } from '../src/projectOperationsService.js';

const SAMPLE_WHATSAPP_BRIEFING = `
# ROLE & OBJECTIVE
Você é um Arquiteto de Software Sênior especialista em sistemas de automação de Direct Response no WhatsApp, Node.js, TypeScript, SQLite (\`better-sqlite3\`) e na biblioteca \`@whiskeysockets/baileys\`.

Sua missão é projetar e especificar de ponta a ponta um sistema monolítico modular auto-hospedado (rodando em uma VPS Ubuntu no Google Cloud) que recebe Webhooks da plataforma de pagamentos **Cakto** e executa automaticamente um funil completo de **Recuperação de Pix + Entrega Imediata -> Upsell 1 -> Upsell 2 / Downsell** via WhatsApp.

---

# 1. STACK TECNOLÓGICA & DOCUMENTAÇÕES DE REFERÊNCIA

## Stack Obrigatória
- **Runtime & Linguagem:** Node.js (LTS) + TypeScript (Strict Mode).
- **Servidor HTTP (Webhooks):** Fastify ou Express (focado em responder \`200 OK\` em menos de 100ms).
- **Motor WhatsApp:** \`@whiskeysockets/baileys\` (Conexão via WebSocket puro, usando *Pairing Code* de 8 dígitos ou QR Code no terminal, com \`useMultiFileAuthState\`).
- **Banco de Dados & Fila:** \`better-sqlite3\` rodando localmente com \`PRAGMA journal_mode = WAL;\` ativado para concorrência simultânea de leitura (Worker) e escrita (Webhooks).
- **Processamento de Áudio:** \`ffmpeg\` para envio de áudios como PTT nativo (nota de voz gravada na hora, formato \`.ogg\` com codec \`libopus\`, \`ptt: true\`).
- **Infraestrutura Alvo:** VPS Google Cloud (\`e2-micro\` Ubuntu LTS), gerenciada por PM2 e com Caddy Server fazendo Reverse Proxy HTTPS automático.

---

# 2. BLUEPRINT DE DIRETÓRIOS E ARQUIVOS DO PROJETO

- **/data/** (Ignorada no Git - Persistência Local)
  - **/data/auth_info/**: Arquivos JSON das chaves criptográficas da sessão do Baileys.
  - **/data/database/**: Arquivo \`funnel.db\` (e arquivos \`-wal\` e \`-shm\` do SQLite).
  - **/data/media/**: PDFs de entrega, imagens de prova social e áudios de pitch convertidos em \`.ogg\` (codec Opus).
- **/src/config/**
  - \`env.ts\`: Carregamento e validação de variáveis de ambiente (porta HTTP, \`CAKTO_WEBHOOK_SECRET\`, número do WhatsApp para *Pairing Code*, caminhos de diretórios).
  - \`catalog.ts\`: Mapa declarativo de produtos e ofertas da Cakto (\`product_id\` / \`offer_id\`), definindo o tipo (\`MAIN\`, \`UPSELL_1\`, \`UPSELL_2\`, \`DOWNSELL\`), arquivos de mídia locais da entrega, mensagens e árvore de próximos passos (delays e links de checkout).
- **/src/database/**
  - \`connection.ts\`: Inicialização do \`better-sqlite3\`, ativação obrigatória do modo \`WAL\` (\`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;\`).
  - \`repositories.ts\`: Funções utilitárias e queries preparadas atômicas (\`db.transaction\`) para manipulação de clientes, pedidos e fila.
- **/src/whatsapp/**
  - \`socket.ts\`: Lifecycle da conexão Baileys (\`makeWASocket\`, \`useMultiFileAuthState\`, reconexão com backoff e pairing code).
  - \`dispatcher.ts\`: Módulo de envio de mensagens com simulação de presença humana (\`composing\`, \`recording\`) e envio de áudios PTT nativos.
- **/src/webhooks/**
  - \`server.ts\`: Servidor HTTP Fastify/Express expondo \`POST /webhook/cakto\`.
  - \`adapters.ts\`: Normalizador do payload da Cakto (\`purchase_approved\`, \`pix_generated\`, \`boleto_generated\`).
- **/src/engine/**
  - \`state-machine.ts\`: Cérebro da máquina de estados do funil de conversão.
  - \`worker.ts\`: Loop anti-banimento a cada 5s em fila indiana.
- **/src/index.ts**: Ponto de entrada do sistema.
- **Caddyfile**
- **ecosystem.config.js**
- **setup.sh**
`.trim();

test('Decompositor Arquitetural: Extrai stack real do briefing (Fim do Next.js hardcoded)', () => {
  const stack = HierarchicalOrchestrationService.extractTechStackFromBriefing(SAMPLE_WHATSAPP_BRIEFING);
  
  assert.ok(stack.framework.includes('Baileys'), 'Framework deve incluir Baileys');
  assert.ok(stack.framework.includes('SQLite WAL'), 'Framework deve incluir SQLite WAL');
  assert.ok(stack.framework.includes('Node.js'), 'Framework deve incluir Node.js');
  assert.ok(!stack.framework.includes('Next.js'), 'NÃO deve conter Next.js');
  assert.ok(!stack.framework.includes('React'), 'NÃO deve conter React');
  assert.ok(stack.architecture.includes('Fila Anti-Ban'), 'Arquitetura deve refletir Fila Anti-Ban e Máquina de Estados');
});

test('Classificador: Briefing arquitetural extenso JAMAIS é classificado como cirúrgico', () => {
  const tmpEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-empty-test-'));

  try {
    const isArchitectural = DeltaFeatureEngine.isArchitecturalBriefing(SAMPLE_WHATSAPP_BRIEFING);
    assert.equal(isArchitectural, true, 'Briefing extenso deve ser classificado como arquitetural');

    const isSurgical = DeltaFeatureEngine.isSurgicalOrBugfixPrompt(SAMPLE_WHATSAPP_BRIEFING, tmpEmptyDir);
    assert.equal(isSurgical, false, 'Briefing arquitetural NUNCA pode ser classificado como cirúrgico');

    const hasCode = DeltaFeatureEngine.hasImplementedCode(tmpEmptyDir);
    assert.equal(hasCode, false, 'Diretório vazio não deve possuir código implementado');
  } finally {
    fs.rmSync(tmpEmptyDir, { recursive: true, force: true });
  }
});

test('Decompositor Arquitetural: Gera 6 etapas modulares coesas com arquivos mapeados exatos', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-arch-tasks-test-'));

  try {
    const tasks = HierarchicalOrchestrationService.generateMultiPassPlannedTasks(
      SAMPLE_WHATSAPP_BRIEFING,
      'WhatsappEntrega',
      tmpDir
    );

    assert.equal(tasks.length, 6, 'Deve conter exatamente 6 etapas modulares coesas');
    
    // Etapa 1: Configuração e Catálogo
    assert.equal(tasks[0].code, 'TK-1');
    assert.ok(tasks[0].title.includes('Configuração Base') && tasks[0].title.includes('Catálogo'));
    assert.ok(tasks[0].expectedFiles?.includes('src/config/env.ts'));
    assert.ok(tasks[0].expectedFiles?.includes('src/config/catalog.ts'));

    // Etapa 2: SQLite WAL e Schemas
    assert.equal(tasks[1].code, 'TK-2');
    assert.ok(tasks[1].title.includes('SQLite') && tasks[1].title.includes('WAL'));
    assert.ok(tasks[1].expectedFiles?.includes('src/database/connection.ts'));
    assert.ok(tasks[1].expectedFiles?.includes('src/database/schema.sql'));

    // Etapa 3: Baileys e Dispatcher
    assert.equal(tasks[2].code, 'TK-3');
    assert.ok(tasks[2].title.includes('Baileys'));
    assert.ok(tasks[2].expectedFiles?.includes('src/whatsapp/socket.ts'));
    assert.ok(tasks[2].expectedFiles?.includes('src/whatsapp/dispatcher.ts'));

    // Etapa 4: Webhooks Cakto
    assert.equal(tasks[3].code, 'TK-4');
    assert.ok(tasks[3].title.includes('Webhooks Cakto'));
    assert.ok(tasks[3].expectedFiles?.includes('src/webhooks/server.ts'));
    assert.ok(tasks[3].expectedFiles?.includes('src/webhooks/adapters.ts'));

    // Etapa 5: Máquina de Estados
    assert.equal(tasks[4].code, 'TK-5');
    assert.ok(tasks[4].title.includes('Máquina de Estados'));
    assert.ok(tasks[4].expectedFiles?.includes('src/engine/state-machine.ts'));

    // Etapa 6: Worker Anti-Ban e Infra GCP
    assert.equal(tasks[5].code, 'TK-6');
    assert.ok(tasks[5].title.includes('Worker') && tasks[5].title.includes('Anti-Banimento'));
    assert.ok(tasks[5].expectedFiles?.includes('src/engine/worker.ts'));
    assert.ok(tasks[5].expectedFiles?.includes('src/index.ts'));
    assert.ok(tasks[5].expectedFiles?.includes('Caddyfile'));
    assert.ok(tasks[5].expectedFiles?.includes('ecosystem.config.js'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ProjectChatService: Gera proposta interativa com stack fiel e 6 etapas no pendingPlan', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-chat-proposal-test-'));

  try {
    const proposal = await ProjectChatService.generateInteractivePlanProposal({
      projectId: 'test-proj-chat-1',
      projectPath: tmpDir,
      projectName: 'WhatsappEntrega',
      briefing: SAMPLE_WHATSAPP_BRIEFING
    });

    assert.equal(proposal.pendingPlan.proposedTasks.length, 6);
    assert.equal(proposal.pendingPlan.stack.framework, 'Node.js • TypeScript • Baileys • SQLite WAL • Fastify/Express');
    assert.ok(proposal.replyContent.includes('**6 etapas coesas**'));
    assert.ok(proposal.replyContent.includes('[TK-1]'));
    assert.ok(proposal.replyContent.includes('[TK-6]'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Chat Delegation: Posta mensagens de delegação e conclusão com papéis supervisor e worker', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-delegation-test-'));
  const testProjectId = 'test-delegation-proj-' + Date.now();
  const testRunId = 'test-run-' + Date.now();
  const testTaskId = 'test-task-' + Date.now();

  try {
    // Insere projeto mock no banco para satisfazer foreign key de messages
    const nowIso = new Date().toISOString();
    db.prepare('INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(testProjectId, 'Test Delegation Project', tmpDir, nowIso, nowIso);

    // 1. Testa postTaskDelegationToChat
    const delRes = await ProjectOperationsService.postTaskDelegationToChat({
      projectId: testProjectId,
      runId: testRunId,
      taskId: testTaskId,
      taskIndex: 1,
      totalTasks: 6,
      taskTitle: 'Configuração Base e Catálogo',
      expectedFiles: ['package.json', 'src/config/env.ts'],
      scopeSummary: 'Estruturação inicial do projeto e validação de envs'
    });

    assert.equal(delRes.posted, true);
    
    // Verifica mensagem salva no banco
    const delMsg: any = db.prepare('SELECT * FROM messages WHERE id = ?').get(delRes.messageId);
    assert.ok(delMsg);
    assert.equal(delMsg.agent_role, 'supervisor');
    assert.ok(delMsg.content.includes('🧠 **Delegando Etapa [1/6] para o Worker:**'));
    assert.ok(delMsg.content.includes('`src/config/env.ts`'));

    // Testa idempotência (não duplica se chamado novamente)
    const delRes2 = await ProjectOperationsService.postTaskDelegationToChat({
      projectId: testProjectId,
      runId: testRunId,
      taskId: testTaskId,
      taskIndex: 1,
      totalTasks: 6,
      taskTitle: 'Configuração Base e Catálogo'
    });
    assert.equal(delRes2.posted, false);

    // 2. Testa postTaskCompletionToChat
    const compRes = await ProjectOperationsService.postTaskCompletionToChat({
      projectId: testProjectId,
      projectPath: tmpDir,
      runId: testRunId,
      taskId: testTaskId,
      taskIndex: 1,
      totalTasks: 6,
      taskTitle: 'Configuração Base e Catálogo',
      filesChanged: ['src/config/env.ts'],
      implemented: ['Módulo de variáveis de ambiente com validação estrita'],
      reviewerVerdict: 'APPROVED'
    });

    assert.equal(compRes.posted, true);

    const compMsg: any = db.prepare('SELECT * FROM messages WHERE id = ?').get(compRes.messageId);
    assert.ok(compMsg);
    assert.equal(compMsg.agent_role, 'worker');
    assert.ok(compMsg.content.includes('🛠️ **Etapa [1/6] Concluída pelo Worker:**'));
    assert.ok(compMsg.content.includes('Aprovado — avançando para a Etapa [2/6].'));

    // Testa idempotência
    const compRes2 = await ProjectOperationsService.postTaskCompletionToChat({
      projectId: testProjectId,
      projectPath: tmpDir,
      runId: testRunId,
      taskId: testTaskId,
      taskIndex: 1,
      totalTasks: 6,
      taskTitle: 'Configuração Base e Catálogo'
    });
    assert.equal(compRes2.posted, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Limpeza de mensagens criadas no teste
    db.prepare('DELETE FROM messages WHERE project_id = ?').run(testProjectId);
  }
});
