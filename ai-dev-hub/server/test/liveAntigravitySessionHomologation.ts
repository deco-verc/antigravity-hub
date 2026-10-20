import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';
import { execSync, execFileSync } from 'child_process';

// ---------------------------------------------------------------------------
// CONFIGURAÇÃO DE AMBIENTE ISOLADO (ZERO POLUIÇÃO DE PRODUÇÃO)
// ---------------------------------------------------------------------------
if (process.env.DECOHUB_ALLOW_LIVE_AGENTAPI !== 'true') {
  console.error('\n[SEGURANÇA FAIL-CLOSED] Homologação nativa rejeitada.');
  console.error('Para executar este script com chamadas reais ao Language Server do Antigravity,');
  console.error('é obrigatório definir explicitamente a variável de ambiente:');
  console.error('  DECOHUB_ALLOW_LIVE_AGENTAPI=true\n');
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-live-homolog-'));
const isolatedDataDir = path.join(tmpDir, 'data');
fs.mkdirSync(isolatedDataDir, { recursive: true });
process.env.AI_DEV_HUB_DATA_DIR = isolatedDataDir;

const projectDir = path.join(tmpDir, 'project-calculadora-live');
fs.mkdirSync(projectDir, { recursive: true });

// Setup Git repo for project
execSync('git init', { cwd: projectDir, stdio: 'pipe' });
execSync('git config user.name "AI Homologation Worker"', { cwd: projectDir, stdio: 'pipe' });
execSync('git config user.email "worker@decohub.local"', { cwd: projectDir, stdio: 'pipe' });

fs.writeFileSync(
  path.join(projectDir, 'package.json'),
  JSON.stringify({ name: 'calculadora-modular-live', version: '1.0.0', type: 'commonjs' }, null, 2)
);

const aiDevHubDir = path.join(projectDir, '.ai-dev-hub');
fs.mkdirSync(aiDevHubDir, { recursive: true });
fs.writeFileSync(
  path.join(aiDevHubDir, 'project.md'),
  '# Calculadora Modular Live\n\nBiblioteca modular de operações matemáticas e financeiras.\n'
);

execSync('git add .', { cwd: projectDir, stdio: 'pipe' });
execSync('git commit -m "chore: initial project structure"', { cwd: projectDir, stdio: 'pipe' });

// Dynamic import of DecoHUB modules with isolated env
async function runLiveHomologation() {
  console.log('========================================================================');
  console.log('  DECOHUB — HOMOLOGAÇÃO REAL NATIVA DE SESSÕES & CONVERSAS ANTIGRAVITY  ');
  console.log('  Execução 100% Real: Modelos Gemini Pro e Flash via Language Server     ');
  console.log('========================================================================\n');

  console.log(`[ISOLAMENTO] Diretório temporário: ${tmpDir}`);
  console.log(`[ISOLAMENTO] Banco SQLite isolado: ${path.join(isolatedDataDir, 'hub.db')}`);
  console.log(`[ISOLAMENTO] Repositório do projeto: ${projectDir}\n`);

  const { db, initDatabase } = await import('../src/db.js');
  initDatabase();

  const { AgentSessionManager } = await import('../src/agentSessionManager.js');
  const { getLanguageServerExe } = await import('../src/antigravityProvider.js');

  const exePath = getLanguageServerExe();
  assert.ok(fs.existsSync(exePath), `language_server.exe não encontrado em ${exePath}`);
  console.log(`[RUNTIME] Language Server binário confirmado: ${exePath}\n`);

  const projectId = `proj-live-${Date.now()}`;
  const projectName = 'Calculadora Modular Live';
  const projectObjective = 'Desenvolver biblioteca com operações matemáticas, financeiras e testes rigorosos';

  db.prepare(`
    INSERT INTO projects (id, name, path, objective, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(projectId, projectName, projectDir, projectObjective);

  // ---------------------------------------------------------------------------
  // INTERCEPTAÇÃO & AUDITORIA DE CHAMADAS AO PROVIDER ANTIGRAVITY
  // ---------------------------------------------------------------------------
  const cliAudit: {
    newConversationCalls: Array<{ role: string; model: string; title: string; convId: string; timestamp: string }>;
    sendMessageCalls: Array<{ convId: string; taskTitle?: string; preview: string; timestamp: string }>;
  } = {
    newConversationCalls: [],
    sendMessageCalls: []
  };

  const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');

  function getCleanEnv(): NodeJS.ProcessEnv {
    const clean: NodeJS.ProcessEnv = { ...process.env };
    delete clean.ELECTRON_RUN_AS_NODE;
    delete clean.ELECTRON_NO_ASAR;
    delete clean.ELECTRON_OZONE_PLATFORM_HINT;
    delete clean.ELECTRON_ENABLE_LOGGING;
    return clean;
  }

  // Helper to wait for agent turn completion in transcript.jsonl
  async function waitForTurnCompletion(convId: string, initialLineCount: number, timeoutMs = 90000): Promise<{
    durationMs: number;
    linesCount: number;
    finalContent: string;
    hasToolCalls: boolean;
  }> {
    const transcriptPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
    const t0 = Date.now();
    let stableChecks = 0;
    let lastSeenCount = 0;

    while (Date.now() - t0 < timeoutMs) {
      if (fs.existsSync(transcriptPath)) {
        try {
          const raw = fs.readFileSync(transcriptPath, 'utf-8');
          const lines = raw.trim().split('\n').filter(Boolean);
          if (lines.length > initialLineCount) {
            const lastLine = JSON.parse(lines[lines.length - 1]);
            const hasActiveToolCalls = Boolean(lastLine.tool_calls && Array.isArray(lastLine.tool_calls) && lastLine.tool_calls.length > 0);

            if (lastLine.type === 'PLANNER_RESPONSE' && lastLine.status === 'DONE' && lastLine.content && !hasActiveToolCalls) {
              if (lines.length === lastSeenCount) {
                stableChecks++;
                if (stableChecks >= 2) {
                  return {
                    durationMs: Date.now() - t0,
                    linesCount: lines.length,
                    finalContent: String(lastLine.content),
                    hasToolCalls: lines.some((l, idx) => idx >= initialLineCount && l.includes('"tool_calls"'))
                  };
                }
              } else {
                lastSeenCount = lines.length;
                stableChecks = 0;
              }
            } else {
              stableChecks = 0;
            }
          }
        } catch {}
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    throw new Error(`Timeout esperando agente ${convId.slice(0, 8)} após ${timeoutMs}ms.`);
  }

  function getTranscriptLinesCount(convId: string): number {
    const transcriptPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return 0;
    try {
      return fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  // Custom provider overrides that call the real language_server.exe while logging every invocation
  AgentSessionManager.setProviderCreateOverride((params) => {
    const cleanEnv = getCleanEnv();
    const out = execFileSync(
      exePath,
      ['agentapi', 'new-conversation', `--model=${params.model}`, `--title=${params.title}`, params.prompt],
      { encoding: 'utf-8', timeout: 60000, env: cleanEnv }
    );
    const parsed = JSON.parse(out);
    const convId = parsed?.response?.newConversation?.conversationId;
    if (!convId) throw new Error(`Falha no new-conversation: ${out}`);

    const role = params.title.includes('Supervisor') ? 'SUPERVISOR' : 'WORKER';
    cliAudit.newConversationCalls.push({
      role,
      model: params.model,
      title: params.title,
      convId,
      timestamp: new Date().toISOString()
    });

    console.log(`  [AUDIT-CLI] 🆕 new-conversation DISPARADO: "${params.title}" (Model: ${params.model}) -> ConvId: ${convId}`);
    return convId;
  });

  AgentSessionManager.setProviderSendMessageOverride((convId, prompt) => {
    const cleanEnv = getCleanEnv();
    execFileSync(
      exePath,
      ['agentapi', 'send-message', convId, prompt],
      { encoding: 'utf-8', timeout: 45000, env: cleanEnv }
    );

    cliAudit.sendMessageCalls.push({
      convId,
      preview: prompt.slice(0, 100).replace(/\n/g, ' '),
      timestamp: new Date().toISOString()
    });

    console.log(`  [AUDIT-CLI] 🔁 send-message REUTILIZADO na sessão ${convId.slice(0, 8)}... (${prompt.slice(0, 60).replace(/\n/g, ' ')}...)`);
  });

  // =========================================================================
  // ETAPA 1: SUPERVISOR NATIVO (GEMINI PRO) — CRIAÇÃO DA SESSÃO PERSISTENTE
  // =========================================================================
  console.log('\n--- ETAPA 1: CRIAÇÃO DA SESSÃO PERSISTENTE DO SUPERVISOR (GEMINI PRO) ---');
  const t0_sup_create = Date.now();
  const { session: supervisorSession, isNew: isSupNew } = await AgentSessionManager.getOrCreateAgentSession(
    projectId,
    'SUPERVISOR',
    {
      model: 'pro',
      initialPrompt: `Você é o Supervisor do DecoHUB para o projeto "${projectName}". Diretório: ${projectDir}. Objetivo: ${projectObjective}. Responda apenas com: SUPERVISOR_ATIVO.`
    }
  );

  assert.strictEqual(isSupNew, true, 'Supervisor inicial deve ser isNew = true');
  assert.strictEqual(supervisorSession.generation, 1, 'Supervisor deve iniciar na Geração 1');
  assert.strictEqual(supervisorSession.role, 'SUPERVISOR');
  const supervisorConvId = supervisorSession.provider_conversation_id;
  console.log(`  ✔ Sessão Supervisor criada com sucesso: ID=${supervisorSession.id}, ConvId=${supervisorConvId}`);
  console.log(`  ✔ Título no Antigravity: "Supervisor — ${projectName}"`);

  // Aguardar resposta inicial do Supervisor
  const supInitRes = await waitForTurnCompletion(supervisorConvId, 0, 90000);
  console.log(`  ✔ Supervisor respondeu no runtime: "${supInitRes.finalContent.slice(0, 60)}" (${supInitRes.durationMs}ms)`);

  // =========================================================================
  // ETAPA 2: WORKER NATIVO (GEMINI FLASH) — CRIAÇÃO DA SESSÃO PERSISTENTE
  // =========================================================================
  console.log('\n--- ETAPA 2: CRIAÇÃO DA SESSÃO PERSISTENTE DO WORKER (GEMINI FLASH) ---');
  const { session: workerSession, isNew: isWorkerNew } = await AgentSessionManager.getOrCreateAgentSession(
    projectId,
    'WORKER',
    {
      model: 'flash',
      initialPrompt: `Você é o Worker do DecoHUB para o projeto "${projectName}". Diretório exclusivo de trabalho: "${projectDir}". Responda apenas: WORKER_ATIVO.`
    }
  );

  assert.strictEqual(isWorkerNew, true, 'Worker inicial deve ser isNew = true');
  assert.strictEqual(workerSession.generation, 1, 'Worker deve iniciar na Geração 1');
  assert.strictEqual(workerSession.role, 'WORKER');
  const workerConvId = workerSession.provider_conversation_id;
  console.log(`  ✔ Sessão Worker criada com sucesso: ID=${workerSession.id}, ConvId=${workerConvId}`);
  console.log(`  ✔ Título no Antigravity: "Worker — ${projectName}"`);

  // Aguardar resposta inicial do Worker
  const workerInitRes = await waitForTurnCompletion(workerConvId, 0, 90000);
  console.log(`  ✔ Worker respondeu no runtime: "${workerInitRes.finalContent.slice(0, 60)}" (${workerInitRes.durationMs}ms)`);

  // Verificação de unicidade das conversas criadas
  assert.notStrictEqual(supervisorConvId, workerConvId, 'Supervisor e Worker devem ter sessões distintas');
  assert.strictEqual(cliAudit.newConversationCalls.length, 2, 'Rigorosamente 2 chamadas new-conversation realizadas até agora');

  // =========================================================================
  // ETAPA 3: EXECUÇÃO REAL DO WORKER — TAREFA 1 (math.js)
  // =========================================================================
  console.log('\n--- ETAPA 3: EXECUÇÃO REAL DO WORKER — TAREFA 1 (math.js) ---');
  const initialLinesTask1 = getTranscriptLinesCount(workerConvId);

  const promptTask1 = [
    `Você é o Worker do DecoHUB. Execute agora a TAREFA 1 no projeto.`,
    `DIRETÓRIO DO PROJETO: ${projectDir}`,
    `INSTRUÇÃO: Crie o arquivo "math.js" na raiz do projeto com as funções:`,
    `- add(a, b): retorna a + b`,
    `- subtract(a, b): retorna a - b`,
    `- multiply(a, b): retorna a * b`,
    `- divide(a, b): retorna a / b (lança erro se b === 0)`,
    `Exporte todas as funções usando module.exports = { add, subtract, multiply, divide };`,
    `Utilize suas ferramentas de edição de arquivo para criar o código real imediatamente. Seja conciso.`
  ].join('\n');

  const sendRes1 = await AgentSessionManager.sendMessage(workerSession, promptTask1, {
    taskTitle: 'Tarefa 1: Implementar math.js'
  });
  assert.strictEqual(sendRes1.success, true);
  console.log(`  ✔ Tarefa 1 enviada via send-message na sessão persistente ${workerConvId.slice(0, 8)}`);

  console.log('  ⏳ Aguardando Gemini Flash raciocinar, executar tool_calls e criar math.js...');
  const resTask1 = await waitForTurnCompletion(workerConvId, initialLinesTask1, 90000);
  console.log(`  ✔ Gemini Flash concluiu a Tarefa 1 em ${resTask1.durationMs}ms!`);
  console.log(`  ✔ Tool calls detectadas no transcript: ${resTask1.hasToolCalls}`);

  const mathFile = path.join(projectDir, 'math.js');
  assert.ok(fs.existsSync(mathFile), `math.js DEVE ter sido criado fisicamente pelo Worker em ${mathFile}`);
  const mathContent = fs.readFileSync(mathFile, 'utf-8');
  console.log(`  ✔ Conteúdo físico gerado em math.js:\n${mathContent.trim()}`);

  // Validação funcional do código gerado
  execSync(`node -e "
    const m = require('./math.js');
    if (m.add(2, 3) !== 5) throw new Error('add falhou');
    if (m.subtract(10, 4) !== 6) throw new Error('subtract falhou');
    if (m.multiply(3, 7) !== 21) throw new Error('multiply falhou');
    if (m.divide(20, 4) !== 5) throw new Error('divide falhou');
    console.log('Math.js validado com sucesso!');
  "`, { cwd: projectDir, stdio: 'pipe' });
  console.log('  ✔ Teste de integridade de math.js executado e aprovado com sucesso!');

  // Confirmar que nenhuma nova conversa foi criada
  assert.strictEqual(cliAudit.newConversationCalls.length, 2, 'Tarefa 1 NÃO disparou new-conversation');

  // =========================================================================
  // ETAPA 4: EXECUÇÃO REAL DO WORKER — TAREFA 2 (finance.js NA MESMA SESSÃO)
  // =========================================================================
  console.log('\n--- ETAPA 4: EXECUÇÃO REAL DO WORKER — TAREFA 2 (finance.js NA MESMA SESSÃO) ---');
  // Re-obter sessão do Worker (comprovar idempotência e reutilização)
  const { session: workerSessionReuse1, isNew: isWorkerReuseNew1 } = await AgentSessionManager.getOrCreateAgentSession(
    projectId,
    'WORKER'
  );
  assert.strictEqual(isWorkerReuseNew1, false, 'getOrCreateAgentSession deve retornar isNew = false');
  assert.strictEqual(workerSessionReuse1.provider_conversation_id, workerConvId, 'Deve reutilizar exatamente o mesmo ConvId');

  const initialLinesTask2 = getTranscriptLinesCount(workerConvId);

  const promptTask2 = [
    `Você é o Worker do DecoHUB. Execute agora a TAREFA 2 na mesma sessão técnica.`,
    `DIRETÓRIO DO PROJETO: ${projectDir}`,
    `INSTRUÇÃO: Crie o arquivo "finance.js" na raiz do projeto com a função:`,
    `- compoundInterest(principal, annualRate, months): calcula juros compostos com fórmula: principal * Math.pow(1 + annualRate / 100, months / 12)`,
    `Exporte usando module.exports = { compoundInterest };`,
    `Utilize suas ferramentas de edição de arquivo para criar o código real imediatamente. Seja conciso.`
  ].join('\n');

  const sendRes2 = await AgentSessionManager.sendMessage(workerSessionReuse1, promptTask2, {
    taskTitle: 'Tarefa 2: Implementar finance.js'
  });
  assert.strictEqual(sendRes2.success, true);
  console.log(`  ✔ Tarefa 2 enviada via send-message na MESMA sessão persistente ${workerConvId.slice(0, 8)}`);

  console.log('  ⏳ Aguardando Gemini Flash raciocinar, executar tool_calls e criar finance.js...');
  const resTask2 = await waitForTurnCompletion(workerConvId, initialLinesTask2, 90000);
  console.log(`  ✔ Gemini Flash concluiu a Tarefa 2 em ${resTask2.durationMs}ms!`);

  const financeFile = path.join(projectDir, 'finance.js');
  assert.ok(fs.existsSync(financeFile), `finance.js DEVE ter sido criado fisicamente pelo Worker em ${financeFile}`);
  const financeContent = fs.readFileSync(financeFile, 'utf-8');
  console.log(`  ✔ Conteúdo físico gerado em finance.js:\n${financeContent.trim()}`);

  // Validação funcional de finance.js
  execSync(`node -e "
    const f = require('./finance.js');
    const val = f.compoundInterest(1000, 10, 12);
    if (Math.round(val) !== 1100) throw new Error('compoundInterest falhou: ' + val);
    console.log('Finance.js validado com sucesso!');
  "`, { cwd: projectDir, stdio: 'pipe' });
  console.log('  ✔ Teste de integridade de finance.js executado e aprovado com sucesso!');

  assert.strictEqual(cliAudit.newConversationCalls.length, 2, 'Tarefa 2 NÃO disparou new-conversation');

  // =========================================================================
  // ETAPA 5: EXECUÇÃO REAL DO WORKER — TAREFA 3 (test.js NA MESMA SESSÃO)
  // =========================================================================
  console.log('\n--- ETAPA 5: EXECUÇÃO REAL DO WORKER — TAREFA 3 (test.js NA MESMA SESSÃO) ---');
  const { session: workerSessionReuse2, isNew: isWorkerReuseNew2 } = await AgentSessionManager.getOrCreateAgentSession(
    projectId,
    'WORKER'
  );
  assert.strictEqual(isWorkerReuseNew2, false, 'isNew deve ser false');
  assert.strictEqual(workerSessionReuse2.provider_conversation_id, workerConvId, 'ConvId deve ser rigorosamente o mesmo');

  const initialLinesTask3 = getTranscriptLinesCount(workerConvId);

  const promptTask3 = [
    `Você é o Worker do DecoHUB. Execute agora a TAREFA 3 na mesma sessão técnica.`,
    `DIRETÓRIO DO PROJETO: ${projectDir}`,
    `INSTRUÇÃO: Crie o arquivo "test.js" na raiz do projeto que importe math.js e finance.js e valide todas as funções com assert do Node.js. Ao final de todas as asserções, o arquivo deve imprimir exatamente "TESTES_PASSARAM".`,
    `Utilize suas ferramentas de edição de arquivo para criar o arquivo real imediatamente.`
  ].join('\n');

  const sendRes3 = await AgentSessionManager.sendMessage(workerSessionReuse2, promptTask3, {
    taskTitle: 'Tarefa 3: Implementar test.js'
  });
  assert.strictEqual(sendRes3.success, true);
  console.log(`  ✔ Tarefa 3 enviada via send-message na MESMA sessão persistente ${workerConvId.slice(0, 8)}`);

  console.log('  ⏳ Aguardando Gemini Flash raciocinar, executar tool_calls e criar test.js...');
  const resTask3 = await waitForTurnCompletion(workerConvId, initialLinesTask3, 90000);
  console.log(`  ✔ Gemini Flash concluiu a Tarefa 3 em ${resTask3.durationMs}ms!`);

  const testFile = path.join(projectDir, 'test.js');
  assert.ok(fs.existsSync(testFile), `test.js DEVE ter sido criado fisicamente pelo Worker em ${testFile}`);
  const testContent = fs.readFileSync(testFile, 'utf-8');
  console.log(`  ✔ Conteúdo físico gerado em test.js:\n${testContent.trim()}`);

  const testOutput = execSync('node test.js', { cwd: projectDir, encoding: 'utf-8' });
  console.log(`  ✔ Saída da execução de test.js:\n${testOutput.trim()}`);
  assert.ok(testOutput.includes('TESTES_PASSARAM'), 'test.js deve executar e imprimir TESTES_PASSARAM');

  assert.strictEqual(cliAudit.newConversationCalls.length, 2, 'Tarefa 3 NÃO disparou new-conversation');

  // =========================================================================
  // ETAPA 6: REVISÃO DO SUPERVISOR NA MESMA SESSÃO (GEMINI PRO)
  // =========================================================================
  console.log('\n--- ETAPA 6: REVISÃO DO SUPERVISOR NA MESMA SESSÃO (GEMINI PRO) ---');
  const { session: supSessionReuse, isNew: isSupReuseNew } = await AgentSessionManager.getOrCreateAgentSession(
    projectId,
    'SUPERVISOR'
  );
  assert.strictEqual(isSupReuseNew, false, 'Supervisor deve ser isNew = false');
  assert.strictEqual(supSessionReuse.provider_conversation_id, supervisorConvId, 'Supervisor deve reutilizar o mesmo ConvId');

  const initialLinesSupReview = getTranscriptLinesCount(supervisorConvId);

  const promptSupReview = [
    `Você é o Supervisor do DecoHUB. As 3 tarefas foram implementadas com sucesso pelo Worker:`,
    `- math.js: operações básicas`,
    `- finance.js: cálculo de juros compostos`,
    `- test.js: suíte de testes aprovada com 100% de sucesso`,
    `Confirme a conclusão e aprovação da entrega incluindo no seu texto a palavra APROVADO_COM_SUCESSO.`
  ].join('\n');

  await AgentSessionManager.sendMessage(supSessionReuse, promptSupReview, {
    taskTitle: 'Revisão do Supervisor'
  });
  console.log(`  ✔ Prompt de revisão enviado ao Supervisor na MESMA sessão ${supervisorConvId.slice(0, 8)}`);

  console.log('  ⏳ Aguardando Gemini Pro raciocinar e emitir parecer...');
  const resSupReview = await waitForTurnCompletion(supervisorConvId, initialLinesSupReview, 60000);
  console.log(`  ✔ Gemini Pro respondeu a revisão em ${resSupReview.durationMs}ms:`);
  console.log(`    "${resSupReview.finalContent.slice(0, 100)}..."`);
  assert.ok(
    resSupReview.finalContent.includes('APROVADO_COM_SUCESSO') || resSupReview.finalContent.toLowerCase().includes('aprovad'),
    'Supervisor deve aprovar a entrega'
  );

  assert.strictEqual(cliAudit.newConversationCalls.length, 2, 'Revisão do Supervisor NÃO disparou new-conversation');

  // =========================================================================
  // ETAPA 7: REINICIALIZAÇÃO DO BACKEND & RECUPERAÇÃO DAS SESSÕES
  // =========================================================================
  console.log('\n--- ETAPA 7: REINICIALIZAÇÃO DO BACKEND & RECUPERAÇÃO DAS SESSÕES ---');
  console.log('  Simulando queda/reinício do backend: limpando locks e recarregando serviço...');

  // Reset in-memory caches
  (AgentSessionManager as any)._lockMap = new Map();

  const recoveredSup = AgentSessionManager.getActiveSession(projectId, 'SUPERVISOR');
  const recoveredWorker = AgentSessionManager.getActiveSession(projectId, 'WORKER');

  assert.ok(recoveredSup, 'Supervisor deve ser recuperado do SQLite');
  assert.ok(recoveredWorker, 'Worker deve ser recuperado do SQLite');
  assert.strictEqual(recoveredSup!.provider_conversation_id, supervisorConvId, 'Supervisor recuperado tem o MESMO ConvId');
  assert.strictEqual(recoveredWorker!.provider_conversation_id, workerConvId, 'Worker recuperado tem o MESMO ConvId');
  console.log(`  ✔ Supervisor recuperado: ID=${recoveredSup!.id}, ConvId=${recoveredSup!.provider_conversation_id} (Geração ${recoveredSup!.generation})`);
  console.log(`  ✔ Worker recuperado:     ID=${recoveredWorker!.id}, ConvId=${recoveredWorker!.provider_conversation_id} (Geração ${recoveredWorker!.generation})`);

  // Testar envio pós-reboot na sessão recuperada do Worker
  const initialLinesWorkerReboot = getTranscriptLinesCount(workerConvId);
  await AgentSessionManager.sendMessage(recoveredWorker!, 'Confirme que continua ativo pós-reboot com a palavra RESILIENTE.', {
    taskTitle: 'Teste Pós-Reboot'
  });
  const resWorkerReboot = await waitForTurnCompletion(workerConvId, initialLinesWorkerReboot, 90000);
  console.log(`  ✔ Worker respondeu após reboot na mesma sessão em ${resWorkerReboot.durationMs}ms: "${resWorkerReboot.finalContent.slice(0, 60)}"`);

  assert.strictEqual(cliAudit.newConversationCalls.length, 2, 'Reboot e chamada pós-reboot NÃO dispararam new-conversation');

  // =========================================================================
  // ETAPA 8: ROTAÇÃO CONTROLADA — ISOLAMENTO POR PAPEL
  // =========================================================================
  console.log('\n--- ETAPA 8: ROTAÇÃO CONTROLADA — ISOLAMENTO POR PAPEL ---');
  console.log('  Disparando rotação controlada EXCLUSIVAMENTE para o Worker...');

  const { newSession: workerGen2, handoffFile } = await AgentSessionManager.rotateSession(
    projectId,
    'WORKER',
    'ROTACAO_HOMOLOGACAO_CONTROLADA'
  );

  assert.strictEqual(workerGen2.generation, 2, 'Novo Worker deve ser Geração 2');
  assert.strictEqual(workerGen2.status, 'ACTIVE', 'Novo Worker deve estar ACTIVE');
  assert.notStrictEqual(workerGen2.provider_conversation_id, workerConvId, 'Worker Gen 2 deve possuir novo ConvId');
  console.log(`  ✔ Worker rotacionado para Geração 2: ID=${workerGen2.id}, ConvId=${workerGen2.provider_conversation_id}`);
  console.log(`  ✔ Arquivo de handoff gerado: ${handoffFile}`);
  assert.ok(fs.existsSync(handoffFile), 'Arquivo de handoff deve existir em disco');

  // Verificar que a sessão anterior do Worker foi devidamente arquivada
  const oldWorkerRecord = AgentSessionManager.getSessionById(workerSession.id);
  assert.strictEqual(oldWorkerRecord!.status, 'ARCHIVED', 'Sessão anterior do Worker deve estar ARCHIVED');

  // CRITICAL CHECK: Supervisor NÃO PODE ter sido rotacionado!
  const currentSupAfterWorkerRotation = AgentSessionManager.getActiveSession(projectId, 'SUPERVISOR');
  assert.strictEqual(currentSupAfterWorkerRotation!.id, supervisorSession.id, 'Supervisor continua o mesmo');
  assert.strictEqual(currentSupAfterWorkerRotation!.generation, 1, 'Supervisor continua na Geração 1');
  assert.strictEqual(currentSupAfterWorkerRotation!.provider_conversation_id, supervisorConvId, 'Supervisor ConvId intocado');
  console.log(`  ✔ CRITICAL CHECK APROVADO: Supervisor permaneceu INTOCADO na Geração 1 (${supervisorConvId.slice(0, 8)})!`);

  // Total de chamadas new-conversation deve ser exatamente 3 agora (Supervisor Gen 1, Worker Gen 1, Worker Gen 2)
  assert.strictEqual(cliAudit.newConversationCalls.length, 3, 'Exatamente 3 new-conversation no ciclo completo');

  // =========================================================================
  // ETAPA 9: AUDITORIA FINAL DE SESSÕES & MODELO FRONTEND CONVERSA ÚNICA
  // =========================================================================
  console.log('\n--- ETAPA 9: AUDITORIA FINAL & MODELO DE CONVERSA ÚNICA ---');
  const auditReport = AgentSessionManager.auditSessions(projectId);

  console.log(`  ✔ Total de sessões ativas: ${auditReport.activeSessionsCount} (Esperado: 2 -> Supervisor Gen 1 e Worker Gen 2)`);
  console.log(`  ✔ Total de sessões arquivadas: ${auditReport.archivedSessionsCount} (Esperado: 1 -> Worker Gen 1)`);
  console.log(`  ✔ Total de registros legado: ${auditReport.unassociatedLegacyCount}`);

  assert.strictEqual(auditReport.activeSessionsCount, 2, 'Rigorosamente 2 sessões ativas (1 Supervisor, 1 Worker)');
  assert.strictEqual(auditReport.archivedSessionsCount, 1, 'Rigorosamente 1 sessão arquivada');

  // Validar unicidade no banco de dados
  const activeDbSessions = db.prepare("SELECT role, generation, provider_conversation_id FROM agent_sessions WHERE project_id = ? AND status = 'ACTIVE'").all(projectId) as any[];
  assert.strictEqual(activeDbSessions.length, 2);
  const activeRoles = activeDbSessions.map(s => s.role).sort();
  assert.deepStrictEqual(activeRoles, ['SUPERVISOR', 'WORKER']);

  // Validar modelo frontend: todas as sessões apontam para o mesmo logical_conversation_id
  const allProjectSessions = db.prepare('SELECT DISTINCT logical_conversation_id FROM agent_sessions WHERE project_id = ?').all(projectId) as any[];
  assert.strictEqual(allProjectSessions.length, 1, 'Todas as sessões vinculam-se a uma única conversa lógica contínua');
  assert.strictEqual(allProjectSessions[0].logical_conversation_id, projectId);

  // Commits de evidência no repositório de teste
  execSync('git add .', { cwd: projectDir, stdio: 'pipe' });
  execSync('git commit -m "feat: complete live implementation of math, finance and test suites by Gemini Worker"', { cwd: projectDir, stdio: 'pipe' });
  const gitLog = execSync('git log --oneline', { cwd: projectDir, encoding: 'utf-8' }).trim();
  console.log(`  ✔ Histórico Git do projeto gerado:\n${gitLog}`);

  console.log('\n========================================================================');
  console.log('  🎉 HOMOLOGAÇÃO REAL NATIVA CONCLUÍDA COM 100% DE SUCESSO!            ');
  console.log('========================================================================\n');

  console.log('RESUMO FACTUAL DE EVIDÊNCIAS:');
  console.log(`- SUPERVISOR_CONV_ID: ${supervisorConvId}`);
  console.log(`- WORKER_CONV_ID (Gen 1): ${workerConvId}`);
  console.log(`- WORKER_CONV_ID (Gen 2): ${workerGen2.provider_conversation_id}`);
  console.log(`- TAREFAS EXECUTADAS PELO WORKER REAL: 3 (math.js, finance.js, test.js)`);
  console.log(`- REUTILIZAÇÕES VIA SEND-MESSAGE: ${cliAudit.sendMessageCalls.length}`);
  console.log(`- TOTAL NEW-CONVERSATION DISPARADOS: ${cliAudit.newConversationCalls.length} (Supervisor Gen 1, Worker Gen 1, Worker Gen 2)`);
  console.log(`- NOVA CONVERSA DISPARADA POR TASK ADICIONAL: 0`);
  console.log(`- CONTINUIDADE PÓS-REINÍCIO: CONFIRMADA`);
  console.log(`- ISOLAMENTO DA ROTAÇÃO: CONFIRMADO (Supervisor não foi afetado)`);
  console.log(`- CONVERSA LÓGICA NO FRONTEND: ÚNICA (${projectId})`);

  return {
    projectId,
    supervisorConvId,
    workerConvId,
    workerConvIdGen2: workerGen2.provider_conversation_id,
    cliAudit,
    tmpDir,
    projectDir
  };
}

runLiveHomologation().catch(err => {
  console.error('\n❌ ERRO NA HOMOLOGAÇÃO REAL:', err);
  process.exit(1);
});
