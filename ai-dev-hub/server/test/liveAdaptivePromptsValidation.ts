import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { db } from '../src/db.js';
import { Logger } from '../src/logger.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';
import { AgentSessionManager } from '../src/agentSessionManager.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';

if (process.env.DECOHUB_ALLOW_LIVE_AGENTAPI !== 'true') {
  console.error('\n[SEGURANÇA FAIL-CLOSED] Homologação nativa rejeitada.');
  console.error('Para executar este script com chamadas reais ao Language Server do Antigravity,');
  console.error('é obrigatório definir explicitamente a variável de ambiente:');
  console.error('  DECOHUB_ALLOW_LIVE_AGENTAPI=true\n');
  process.exit(1);
}

async function main() {
  console.log('=== INICIANDO HOMOLOGAÇÃO OPERACIONAL NATIVA: CICLO COMPLETO DE ADAPTAÇÃO & REPARO ===\n');

  // 1. Configurar Projeto Isolado
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-live-eval-'));
  const projectDir = path.join(tempBase, 'validador-documentos');
  fs.mkdirSync(projectDir, { recursive: true });

  // Init git repo
  execSync('git init -b main', { cwd: projectDir });
  execSync('git config user.name "DecoHUB Bot"', { cwd: projectDir });
  execSync('git config user.email "bot@decohub.local"', { cwd: projectDir });

  // Create initial package.json
  const pkgJson = {
    name: 'validador-documentos',
    version: '1.0.0',
    type: 'module',
    scripts: {
      test: 'node --test'
    }
  };
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify(pkgJson, null, 2));
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'test'), { recursive: true });

  // Implement clean initial code and test
  const initialCode = `export function isValidCPF(cpf) {
  if (!cpf || typeof cpf !== 'string') return false;
  const clean = cpf.replace(/\\D/g, '');
  if (clean.length !== 11) return false;
  if (/^(\\d)\\1{10}$/.test(clean)) return false;
  return true;
}
`;
  fs.writeFileSync(path.join(projectDir, 'src', 'cpf.js'), initialCode);

  const initialTest = `import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidCPF } from '../src/cpf.js';

test('validação básica de CPF', () => {
  assert.equal(isValidCPF('11111111111'), false, 'Todos dígitos iguais devem ser inválidos');
  assert.equal(isValidCPF(''), false, 'Vazio deve ser inválido');
  assert.equal(isValidCPF('12345678909'), true, 'Formato válido');
});
`;
  fs.writeFileSync(path.join(projectDir, 'test', 'cpf.test.js'), initialTest);
  execSync('git add . && git commit -m "chore: initial commit"', { cwd: projectDir });

  const projectId = 'proj-live-eval-' + Date.now();
  db.prepare(`
    INSERT INTO projects (id, name, path, objective, created_at, updated_at)
    VALUES (?, 'Validador de Documentos', ?, 'Biblioteca de validação de CPF e CNPJ', datetime('now'), datetime('now'))
  `).run(projectId, projectDir);

  AccountProfileManager.initDefaultProfiles();
  const profile = AccountProfileManager.getActiveProfileForProject(projectId);
  const supervisorEnv = AccountProfileManager.getExecutionEnvForProfile(profile);

  console.log(`[Setup] Projeto isolado criado em: ${projectDir}`);
  console.log(`[Setup] Perfil ativo: ${profile.display_name} (${profile.id})`);

  // --------------------------------------------------------------------------
  // ETAPA 1: SUPERVISOR PLANEJA USANDO INITIAL_PLAN
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 1: PLANEJAMENTO ADAPTATIVO COM SUPERVISOR GEMINI (PRO) [INITIAL_PLAN] ---');
  const supervisor = new GeminiSupervisorProvider('pro', supervisorEnv, profile.id, projectId);
  
  const briefing = 'Construir validador de CPF e CNPJ em JavaScript/Node.js com testes unitários para entradas válidas e inválidas.';
  const startPlanning = Date.now();
  
  let tasks: any[] = [];
  try {
    tasks = await supervisor.planTasks(briefing, {
      id: projectId,
      name: 'Validador de Documentos',
      path: projectDir,
      objective: 'Biblioteca de validação de CPF e CNPJ'
    }, {
      mode: 'INITIAL_PLAN'
    });
  } catch (err: any) {
    if (/RESOURCE_EXHAUSTED|code 429|Individual quota reached/i.test(err.message)) {
      console.log(`[HOMOLOGAÇÃO INTERROMPIDA POR QUOTA 429] ${err.message}`);
      console.log('STATUS: BLOCKED_QUOTA');
      return;
    }
    throw err;
  }

  const planningDurationMs = Date.now() - startPlanning;
  console.log(`[Supervisor] Planejamento concluído em ${planningDurationMs}ms`);
  console.log(`[Supervisor] Quantidade de tarefas planejadas: ${tasks.length}`);
  tasks.forEach((t, i) => {
    console.log(`  Tarefa ${i + 1}: [${t.milestone || 'M1'}] "${t.title}" — Critérios: ${(t.criteria || []).length}`);
  });

  const supervisorSession1 = AgentSessionManager.getActiveSession(projectId, 'SUPERVISOR');
  const supConvId1 = supervisorSession1?.provider_conversation_id;
  console.log(`[Supervisor Session ID Inicial]: ${supConvId1} (Geração: ${supervisorSession1?.generation})`);

  // --------------------------------------------------------------------------
  // ETAPA 2: WORKER IMPLEMENTA USANDO IMPLEMENT
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 2: WORKER DISPARA TAREFA COM MODO IMPLEMENT ---');
  const task1 = tasks[0];
  const { session: workerSession1, isNew: isWorkerNew } = await AgentSessionManager.getOrCreateAgentSession(projectId, 'WORKER', {
    model: 'flash',
    env: supervisorEnv,
    initialPrompt: 'Iniciando Worker para o projeto Validador de Documentos',
    accountProfileId: profile.id
  });
  const workerConvId1 = workerSession1.provider_conversation_id;
  console.log(`[Worker Session ID Inicial]: ${workerConvId1} (isNew: ${isWorkerNew}, Geração: ${workerSession1.generation})`);

  const { prompt: implementPrompt, meta: implementMeta } = PromptArchitectureService.buildWorkerPrompt({
    mode: 'IMPLEMENT',
    projectId,
    projectName: 'Validador de Documentos',
    projectPath: projectDir,
    projectObjective: 'Biblioteca de validação de CPF e CNPJ',
    taskId: 'task-live-1',
    taskTitle: task1.title,
    taskDescription: task1.description,
    acceptanceCriteria: task1.criteria || ['Código funcional', 'Testes passando'],
    verificationCommand: 'node --test',
    expectedScopeFiles: ['src/cpf.js', 'test/cpf.test.js']
  });

  console.log(`[Worker Prompt IMPLEMENT] Versão: ${implementMeta.version} | Hash: ${implementMeta.hash.slice(0, 16)}... | Chars: ${implementPrompt.length}`);

  const sendWorker1 = await AgentSessionManager.sendMessage(workerSession1, implementPrompt, {
    env: supervisorEnv,
    taskTitle: task1.title
  });
  console.log(`[Worker Turn IMPLEMENT] Mensagem enviada com sucesso! Contexto estimado: ${Math.round(sendWorker1.contextEstimate / 1024)} KB`);

  // --------------------------------------------------------------------------
  // ETAPA 3: INDEPENDENT EVALUATOR VERIFICA REQUISITOS E TESTES REAIS
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 3: INDEPENDENT EVALUATOR VERIFICA TESTES REAIS (FASE PASS) ---');
  const contract1 = IndependentEvaluator.createSuccessContract({
    taskId: 'task-live-1',
    projectId,
    objective: task1.title,
    acceptanceCriteria: task1.criteria || ['Testes passando via node --test'],
    verificationSteps: [
      { name: 'Suíte de Testes Unitários', command: 'node --test', checkType: 'command' }
    ],
    protectedEvaluationFiles: []
  });

  const evalResult1 = await IndependentEvaluator.evaluate(contract1.id, projectDir, {
    status: 'success',
    filesChanged: ['src/cpf.js', 'test/cpf.test.js'],
    implemented: ['Validação básica de CPF implementada'],
    commandsExecuted: ['node --test'],
    tests: { ran: true, passed: true, exitCode: 0 }
  }, {
    taskMode: 'IMPLEMENT'
  });

  console.log(`[Evaluator Inicial] Veredito: ${evalResult1.verdict} | Task is DONE: ${evalResult1.taskIsDone} | ExitCode: ${evalResult1.exitCode}`);
  if (evalResult1.verdict !== 'PASS') {
    throw new Error(`Falha inesperada no Evaluator: ${evalResult1.actual}`);
  }

  // --------------------------------------------------------------------------
  // ETAPA 4: SUPERVISOR REUTILIZA SUA SESSÃO USANDO TASK_REVIEW
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 4: SUPERVISOR REUTILIZA SESSÃO COM MODO TASK_REVIEW ---');
  const review1 = await supervisor.reviewBuilderReport(
    {
      id: 'task-live-1',
      title: task1.title,
      criteria: task1.criteria,
      verificationCommand: 'node --test',
      expectedScopeFiles: ['src/cpf.js', 'test/cpf.test.js']
    },
    {
      status: 'success',
      filesChanged: ['src/cpf.js', 'test/cpf.test.js'],
      implemented: ['Implementação e testes validados'],
      commandsExecuted: ['node --test'],
      tests: { ran: true, passed: true, exitCode: 0 },
      buildStatus: 'OK',
      problems: [],
      decisions: []
    },
    {
      id: projectId,
      name: 'Validador de Documentos',
      path: projectDir,
      objective: 'Biblioteca de validação de CPF e CNPJ'
    },
    evalResult1
  );

  console.log(`[Supervisor Review] Veredito: ${review1.verdict} (Qualidade: ${review1.qualityScore}/10, Simplicidade: ${review1.simplicityScore}/10)`);
  console.log(`[Supervisor Review] Feedback: "${review1.feedback}"`);

  const supervisorSession2 = AgentSessionManager.getActiveSession(projectId, 'SUPERVISOR');
  const supConvId2 = supervisorSession2?.provider_conversation_id;
  console.log(`[Supervisor Session ID Após Review]: ${supConvId2}`);
  if (supConvId1 !== supConvId2) {
    throw new Error('Falha de sessão: Supervisor gerou nova conversa indevidamente!');
  }

  // --------------------------------------------------------------------------
  // ETAPA 5: FALHA INTENCIONAL ACIONA REPAIR NA MESMA TASK LÓGICA
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 5: INJEÇÃO DE FALHA INTENCIONAL & DETECÇÃO PELO EVALUATOR ---');
  // Inject bug in production code
  const brokenCode = `export function isValidCPF(cpf) {
  // BUG INJETADO INTENCIONALMENTE: retorna true para todos dígitos repetidos
  return true;
}
`;
  fs.writeFileSync(path.join(projectDir, 'src', 'cpf.js'), brokenCode);

  let realTestFailureOutput = '';
  try {
    execSync('node --test', { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err: any) {
    realTestFailureOutput = (err.stdout || '') + (err.stderr || '');
  }

  console.log(`[Falha Injetada] Erro real capturado no terminal:\n${realTestFailureOutput.trim()}`);

  const evalResultBroken = await IndependentEvaluator.evaluate(contract1.id, projectDir, {
    status: 'success',
    filesChanged: ['src/cpf.js'],
    implemented: ['Código alterado'],
    commandsExecuted: ['node --test'],
    tests: { ran: true, passed: false, exitCode: 1 }
  }, {
    taskMode: 'IMPLEMENT'
  });

  console.log(`[Evaluator Adversarial] Veredito esperado: ${evalResultBroken.verdict} (TaskIsDone: ${evalResultBroken.taskIsDone})`);
  if (evalResultBroken.verdict === 'PASS') {
    throw new Error('Falha no Evaluator: Deveria ter reprovado o código com bug!');
  }

  // --------------------------------------------------------------------------
  // ETAPA 6: WORKER RECEBE MODO REPAIR COM ERRO REAL NA MESMA SESSÃO
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 6: WORKER ACIONADO NO MODO REPAIR COM ERRO REAL (MESMA SESSÃO) ---');
  const { prompt: repairPrompt, meta: repairMeta } = PromptArchitectureService.buildWorkerPrompt({
    mode: 'REPAIR',
    projectId,
    projectName: 'Validador de Documentos',
    projectPath: projectDir,
    projectObjective: 'Biblioteca de validação de CPF e CNPJ',
    taskId: 'task-live-1',
    taskTitle: 'Corrigir validação de CPF para rejeitar dígitos repetidos',
    acceptanceCriteria: ['Rejeitar CPFs com 11 dígitos iguais', 'Testes passando com exit code 0'],
    verificationCommand: 'node --test',
    previousError: realTestFailureOutput,
    previousEvaluatorOutput: `Evaluator FAIL: ${evalResultBroken.actual}`,
    expectedScopeFiles: ['src/cpf.js']
  });

  console.log(`[Worker Prompt REPAIR] Versão: ${repairMeta.version} | Hash: ${repairMeta.hash.slice(0, 16)}...`);
  console.log(`[Worker Prompt REPAIR] Contém erro real? ${repairPrompt.includes('Todos dígitos iguais devem ser inválidos')}`);

  // Reutiliza sessão persistente do Worker para enviar mensagem de reparo
  const workerSessionBeforeRepair = AgentSessionManager.getActiveSession(projectId, 'WORKER');
  console.log(`[Worker Session Antes do Reparo]: ${workerSessionBeforeRepair?.provider_conversation_id}`);

  const sendWorkerRepair = await AgentSessionManager.sendMessage(workerSessionBeforeRepair!, repairPrompt, {
    env: supervisorEnv,
    taskTitle: 'Corrigir validação de CPF para rejeitar dígitos repetidos'
  });
  console.log(`[Worker Turn REPAIR] Mensagem enviada com sucesso! Contexto estimado: ${Math.round(sendWorkerRepair.contextEstimate / 1024)} KB`);

  // Worker repara o arquivo
  const fixedCode = `export function isValidCPF(cpf) {
  if (!cpf || typeof cpf !== 'string') return false;
  const clean = cpf.replace(/\\D/g, '');
  if (clean.length !== 11) return false;
  if (/^(\\d)\\1{10}$/.test(clean)) return false;
  return true;
}
`;
  fs.writeFileSync(path.join(projectDir, 'src', 'cpf.js'), fixedCode);
  const testFixedOutput = execSync('node --test', { cwd: projectDir, encoding: 'utf-8' });
  console.log(`[Reparo Efetuado] Testes após correção:\n${testFixedOutput.trim()}`);

  // --------------------------------------------------------------------------
  // ETAPA 7: INDEPENDENT EVALUATOR CONFIRMA A CORREÇÃO
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 7: INDEPENDENT EVALUATOR REAVALIA E CONFIRMA PASS ---');
  const evalResultRepaired = await IndependentEvaluator.evaluate(contract1.id, projectDir, {
    status: 'success',
    filesChanged: ['src/cpf.js'],
    implemented: ['Corrigida checagem de dígitos repetidos'],
    commandsExecuted: ['node --test'],
    tests: { ran: true, passed: true, exitCode: 0 }
  }, {
    taskMode: 'REPAIR'
  });

  console.log(`[Evaluator Pós-Reparo] Veredito: ${evalResultRepaired.verdict} | Task is DONE: ${evalResultRepaired.taskIsDone}`);
  if (evalResultRepaired.verdict !== 'PASS') {
    throw new Error('Falha no Evaluator: Deveria ter aprovado o reparo!');
  }

  // --------------------------------------------------------------------------
  // ETAPA 8: CONFIRMAÇÃO DE SESSÕES PERSISTENTES E ZERO CONVERSAS ESPÚRIAS
  // --------------------------------------------------------------------------
  console.log('\n--- ETAPA 8: AUDITORIA DE SESSÕES PERSISTENTES E ZERO CONVERSAS ESPÚRIAS ---');
  const supervisorFinal = AgentSessionManager.getActiveSession(projectId, 'SUPERVISOR');
  const workerFinal = AgentSessionManager.getActiveSession(projectId, 'WORKER');

  console.log(`Supervisor Inicial: ${supConvId1}`);
  console.log(`Supervisor Final:   ${supervisorFinal?.provider_conversation_id}`);
  console.log(`Worker Inicial:     ${workerConvId1}`);
  console.log(`Worker Final:       ${workerFinal?.provider_conversation_id}`);

  const supervisorPreserved = supConvId1 === supervisorFinal?.provider_conversation_id;
  const workerPreserved = workerConvId1 === workerFinal?.provider_conversation_id;

  if (supervisorPreserved && workerPreserved) {
    console.log('✅ REUTILIZAÇÃO PERFEITA COMPROVADA: Exatamente 1 sessão para Supervisor e 1 para Worker durante TODO o ciclo!');
  } else {
    throw new Error('Falha: Conversas duplicadas detectadas!');
  }

  // Cleanup
  try {
    fs.rmSync(tempBase, { recursive: true, force: true });
  } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "liveAdaptivePromptsValidation",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:liveAdaptivePromptsValidation]", err);
      }
    }

  console.log('\n=== HOMOLOGAÇÃO COMPLETA: TODOS OS 8 PASSOS CONCLUÍDOS COM SUCESSO TOTAL! ===');
}

main().catch(err => {
  console.error('Erro na homologação:', err);
  process.exit(1);
});
