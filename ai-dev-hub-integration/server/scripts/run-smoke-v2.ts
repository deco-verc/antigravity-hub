// server/scripts/run-smoke-v2.ts
// Smoke test for Fable Worker V2 Flash prompt variant

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { PromptManager } from '../src/promptManager.js';
import { ConversationManager } from '../src/conversationManager.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { db } from '../src/db.js';
import { Logger } from '../src/logger.js';

async function main() {
  const projectPath = 'C:\\IA\\test-projects\\decohub-fable-test-smoke';
  const profileId = 'acc-pro-1';
  const requestedModel = 'flash';
  const promptId = 'fable-worker-v2-flash';

  console.log('\n======================================================');
  console.log('🚀 INICIANDO SMOKE TEST: Fable Worker V2 Flash');
  console.log('======================================================\n');

  // 1. Load prompt and verify deterministic hash
  const loaded = PromptManager.loadBasePrompt(promptId);
  console.log(`[1] PROMPT_LOADED: prompt_id=${promptId}`);
  console.log(`    prompt_hash=${loaded.hash}`);
  console.log(`    bytes=${loaded.content.length}`);

  const expectedHash = 'ba62b672b47835f28494a0009c02cb3dbf3097a4c3a4efead88fde06c52a1713';
  if (loaded.hash !== expectedHash) {
    throw new Error(`HASH_MISMATCH: esperado ${expectedHash}, obtido ${loaded.hash}`);
  }

  // 2. Build Worker instructions
  const workerId = `worker-smoke-v2-${Date.now()}`;
  const runId = `run-smoke-v2-${Date.now()}`;
  const taskId = `task-smoke-clamp-${Date.now()}`;

  const workerInstructions = PromptManager.buildWorkerInstructions({
    promptId,
    runtime: {
      projectPath,
      runId,
      taskId,
      workerId,
      accountProfileId: profileId,
      requestedModel,
      actualModel: null,
      workspaceGitRoot: projectPath,
      runtimeCwd: projectPath
    },
    project: {
      projectName: 'Fable Smoke Test',
      projectPath,
      objective: 'Implement clamp utility in src/index.js and verify with npm test'
    }
  });

  // 3. Ensure project rules file (.agents/rules/decohub-worker.md)
  const ruleFilePath = PromptManager.ensureProjectRulesFile(projectPath, workerInstructions.fullRuleContent);
  console.log(`[2] WORKSPACE_RULE: ${ruleFilePath}`);

  // 4. Validate isolation
  const isolation = PromptManager.validateWorkspacePromptIsolation(projectPath, promptId);
  console.log(`[3] PROMPT_ISOLATION: valid=${isolation.valid} (V2 rule verified)`);
  if (!isolation.valid) {
    throw new Error(`ISOLATION_FAILED: ${isolation.reason}`);
  }

  // 5. Get isolated execution env for profile
  const profile = AccountProfileManager.getProfile(profileId) || AccountProfileManager.getGlobalActiveProfile();
  const isolatedEnv = profile ? AccountProfileManager.getExecutionEnvForProfile(profile) : process.env;
  const antigravityProvider = new AntigravityProvider(isolatedEnv);

  // 6. Register worker in database
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO workers (
      id, name, account_profile_id, status, environment,
      current_task_id, current_run_id, conversation_id, created_at, updated_at
    ) VALUES (?, 'Smoke Worker V2', ?, 'READY', 'local', NULL, NULL, NULL, ?, ?)
  `).run(workerId, profileId, nowIso, nowIso);

  // 7. Get or create persistent conversation
  const convResult = ConversationManager.getOrCreateConversation({
    projectId: 'proj-fable-smoke-v2',
    accountProfileId: profileId,
    role: 'worker',
    workerId,
    runId,
    model: requestedModel,
    env: isolatedEnv,
    promptId: workerInstructions.promptId,
    promptHash: workerInstructions.promptHash,
    initialPrompt: workerInstructions.bootstrapInstructions
  });

  console.log(`[4] CONVERSATION: id=${convResult.conversationId} (isNew=${convResult.isNew})`);

  // 8. Dispatch Task Contract
  console.log(`[5] DISPATCHING TASK: ${taskId}...`);
  const startTime = Date.now();

  const sendResult = await antigravityProvider.sendTask(convResult.conversationId, {
    task: {
      id: taskId,
      title: 'Implement clamp function in src/index.js',
      description: 'Implement clamp(val, min, max) in src/index.js and export it. It must restrict val to [min, max]. Run npm test to verify test/smoke.test.js passes.',
      milestone: 'MVP',
      verificationCommand: 'npm test',
      doneWhen: 'npm test passes with exit code 0'
    },
    context: {
      projectName: 'Fable Smoke Test',
      projectPath,
      objective: 'Implement clamp in src/index.js and satisfy test/smoke.test.js',
      stack: 'JavaScript/Node.js',
      programMd: null
    },
    requirements: [
      `Editar exclusivamente arquivos dentro de "${projectPath}"`,
      'Implementar a função clamp(val, min, max) e exportá-la em src/index.js',
      'Executar npm test e garantir 100% de aprovação'
    ],
    acceptanceCriteria: [
      'clamp(5, 0, 10) retorna 5',
      'clamp(-5, 0, 10) retorna 0',
      'clamp(15, 0, 10) retorna 10',
      'npm test passa com código 0'
    ],
    constraints: [`Não modificar arquivos fora de "${projectPath}"`],
    expectedScopeFiles: ['src/index.js'],
    supervisorInstructions: 'Aplique Action Bias e Minimum Sufficient Context: inspecione src/index.js, implemente clamp, execute npm test e termine.'
  }, {
    projectId: 'proj-fable-smoke-v2',
    accountProfileId: profileId,
    workerId,
    runId,
    model: requestedModel,
    promptId: workerInstructions.promptId,
    promptHash: workerInstructions.promptHash
  });

  const effectiveConvId = sendResult.sessionId;
  console.log(`[6] TASK_DISPATCHED: effectiveSession=${effectiveConvId}`);

  // 9. Await live agent results
  console.log(`[7] AGENT_EXECUTING: aguardando conclusão (timeout 180s)...`);
  const agentResult = await antigravityProvider.getResult(effectiveConvId, 180000, projectPath);
  const durationMs = Date.now() - startTime;
  console.log(`    Duração: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`    Status do Builder: ${agentResult.status}`);
  console.log(`    Arquivos alterados: ${agentResult.filesChanged?.join(', ') || 'Nenhum'}`);

  // 10. Run direct ground truth verification
  console.log(`[8] GROUND_TRUTH_VERIFICATION: executando npm test em ${projectPath}...`);
  try {
    const testOut = execSync('npm test', { cwd: projectPath, encoding: 'utf-8' });
    console.log(testOut.trim());
    console.log('\n✅ SMOKE TEST PASSED: Fable Worker V2 Flash executou com sucesso, testes passaram!');
  } catch (err: any) {
    console.error('❌ Falha nos testes:', err.stdout || err.message);
    process.exit(1);
  }

  // 11. Cleanup worker status
  db.prepare(`UPDATE workers SET status = 'READY', current_task_id = NULL, current_run_id = NULL WHERE id = ?`).run(workerId);
}

main().catch(err => {
  console.error('[Smoke Error]', err);
  process.exit(1);
});
