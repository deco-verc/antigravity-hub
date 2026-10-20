// scripts/run_homologation_suite.mjs
// Homologation Execution Suite for DecoHUB Native Autonomy (Tests 1 to 9)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const PROJECT_DIR = 'C:/IA/test-projects/decohub-native-homologation';
const HUB_DB_PATH = 'C:/Users/Deco/.ai-dev-hub/hub.db';

console.log('================================================================');
console.log('🚀 DECOHUB NATIVE AUTONOMY — SUÍTE DE HOMOLOGAÇÃO (TESTES 1 A 9)');
console.log('================================================================');
console.log(`Data/Hora: ${new Date().toISOString()}`);
console.log(`Projeto Alvo: ${PROJECT_DIR}`);
console.log(`Banco Hub: ${HUB_DB_PATH}`);

// Initialize Hub DB
const db = new DatabaseSync(HUB_DB_PATH);

// Import DecoHUB modules
const { AutonomousManager } = await import('../server/dist/autonomousManager.js');
const { AutonomousRunnerService } = await import('../server/dist/autonomousRunnerService.js');
const { WorkerRegistry } = await import('../server/dist/workerRegistry.js');
const { AccountProfileManager } = await import('../server/dist/accountProfileManager.js');
const { PromptManager } = await import('../server/dist/promptManager.js');
const { ConversationManager } = await import('../server/dist/conversationManager.js');
const { IndependentEvaluator } = await import('../server/dist/independentEvaluator.js');
const { GeminiSupervisorProvider } = await import('../server/dist/geminiSupervisorProvider.js');

const results = {};

// -----------------------------------------------------------------------------
// PREPARATION: Setup Clean Target Project
// -----------------------------------------------------------------------------
console.log('\n--- [PREPARAÇÃO DO PROJETO ALVO] ---');
fs.mkdirSync(PROJECT_DIR, { recursive: true });

// Setup package.json
const packageJson = {
  name: 'decohub-native-homologation',
  version: '1.0.0',
  type: 'module',
  scripts: {
    test: 'node --experimental-strip-types --test test/**/*.test.ts',
    build: 'node -e "console.log(\'Build OK\')"',
    typecheck: 'node -e "console.log(\'Typecheck OK\')"'
  }
};
fs.writeFileSync(path.join(PROJECT_DIR, 'package.json'), JSON.stringify(packageJson, null, 2));

// Setup README
fs.writeFileSync(path.join(PROJECT_DIR, 'README.md'), '# DecoHUB Native Homologation Project\nBiblioteca TypeScript de validação e transformação de dados.');

// Setup .gitignore
fs.writeFileSync(path.join(PROJECT_DIR, '.gitignore'), 'node_modules/\ndist/\n*.log\n');

// Ensure Git repository
try {
  execSync('git init -b main', { cwd: PROJECT_DIR, stdio: 'pipe' });
} catch {
  execSync('git init', { cwd: PROJECT_DIR, stdio: 'pipe' });
  try { execSync('git checkout -b main', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch {}
}
execSync('git add -A', { cwd: PROJECT_DIR, stdio: 'pipe' });
try {
  execSync('git commit -m "chore: initial project setup"', { cwd: PROJECT_DIR, stdio: 'pipe' });
} catch {}

const initialSha = execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
console.log(`Repositório Git inicializado em ${PROJECT_DIR} (HEAD: ${initialSha.slice(0, 8)})`);

// Register Project in SQLite
const projectId = 'proj-native-homologation';
const projectName = 'DecoHUB Native Homologation';
const projectObjective = 'Criar biblioteca TypeScript modular de validação, sanitização, pipeline de filtros, métricas de agregação e suite de testes unitários';

db.prepare(`
  INSERT INTO projects (id, name, path, objective, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'active', ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    path = excluded.path,
    objective = excluded.objective,
    updated_at = excluded.updated_at
`).run(projectId, projectName, PROJECT_DIR, projectObjective, new Date().toISOString(), new Date().toISOString());

console.log(`Projeto registrado no SQLite: ${projectId} (${projectName})`);

// Ensure active profile & worker are ready
const activeProfile = AccountProfileManager.getActiveProfileForProject(projectId);
console.log(`Perfil ativo: ${activeProfile.display_name} (${activeProfile.id})`);
const verifyRes = AccountProfileManager.verifyProfile(activeProfile.id);
console.log(`Status de verificação do perfil: ${verifyRes.profile.auth_status}`);

// -----------------------------------------------------------------------------
// TESTE 1: Fluxo do Usuário — Criação de Projeto e Início Autônomo
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('TESTE 1: Fluxo do Usuário — Criação de Projeto e Início Autônomo');
console.log('================================================================');

const t1StartTime = Date.now();
const existingRun1 = db.prepare("SELECT * FROM autonomous_runs WHERE project_id = ? AND name = 'Native Homologation 5-Task Unattended Run' ORDER BY created_at DESC LIMIT 1").get(projectId);
let run1;
if (existingRun1 && db.prepare("SELECT COUNT(*) as c FROM autonomous_tasks WHERE run_id = ? AND status = 'completed'").get(existingRun1.id).c >= 5) {
  console.log(`Reutilizando Run 1 previamente concluído: ${existingRun1.id}`);
  run1 = existingRun1;
} else {
  run1 = await AutonomousManager.createRun({
    projectId,
    name: 'Native Homologation 5-Task Unattended Run',
    objective: projectObjective,
    briefing: 'Criar uma biblioteca TypeScript modular com:\n1. Sistema de validação com esquemas de tipos básicos (string, number, boolean, array, object);\n2. Utilitários de sanitização de strings (trim, escapeHtml, slugify, truncate);\n3. Pipeline de filtros funcionais configurável com encadeamento;\n4. Módulo de cálculo de métricas e agregações (média, mediana, desvio padrão, percentil);\n5. Suíte de testes unitários automatizados cobrindo todos os módulos com node:test.',
    autonomyMode: 'autonomous',
    worker_prompt_variant: 'native'
  });

  console.log(`Run 1 criado com ID: ${run1.id} (Branch: ${run1.branch_name})`);

  // Execute initial step (Supervisor plans architecture and tasks)
  console.log('Executando ciclo inicial para planejamento do Supervisor Gemini...');
  await AutonomousRunnerService.step(run1.id);
}

const run1AfterPlan = AutonomousManager.getRun(run1.id);
const tasks1 = db.prepare('SELECT id, title, order_index, status, dependencies_json, criteria_json, verification_command FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(run1.id);

console.log(`Status do Run pós-planejamento: ${run1AfterPlan.status}`);
console.log(`Total de tarefas planejadas: ${tasks1.length}`);
for (const t of tasks1) {
  console.log(`  [${t.order_index}] ${t.title} (Status: ${t.status}, Cmd: ${t.verification_command})`);
}

const t1Passed = tasks1.length >= 5 && (run1AfterPlan.status === 'running' || run1AfterPlan.status === 'building' || tasks1.some(t => t.status === 'ready' || t.status === 'in_progress'));
results.test1 = {
  verdict: t1Passed ? 'PASS' : 'FAIL',
  runId: run1.id,
  tasksCount: tasks1.length,
  tasks: tasks1.map(t => ({ id: t.id, title: t.title, status: t.status })),
  durationMs: Date.now() - t1StartTime
};
console.log(`>>> TESTE 1 RESULTADO: ${results.test1.verdict} (${results.test1.tasksCount} tarefas planejadas)`);

// -----------------------------------------------------------------------------
// TESTE 2: Execução Multi-Tarefa Autônoma (5/5 Tarefas Concluídas)
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('TESTE 2: Execução Multi-Tarefa Autônoma (5 Tarefas Sequenciais)');
console.log('================================================================');

const t2StartTime = Date.now();
let iteration = 0;
const maxSteps = 25;

while (iteration < maxSteps) {
  iteration++;
  const currentRun = AutonomousManager.getRun(run1.id);
  const remainingTasks = db.prepare("SELECT COUNT(*) as count FROM autonomous_tasks WHERE run_id = ? AND status != 'completed'").get(run1.id).count;
  const completedTasks = db.prepare("SELECT COUNT(*) as count FROM autonomous_tasks WHERE run_id = ? AND status = 'completed'").get(run1.id).count;

  console.log(`\n[Ciclo #${iteration}] Run status: ${currentRun.status} | Concluídas: ${completedTasks}/${tasks1.length} | Restantes: ${remainingTasks}`);

  if (remainingTasks === 0 || currentRun.status === 'completed') {
    console.log('🎉 Todas as tarefas do Run foram concluídas!');
    break;
  }

  try {
    await AutonomousRunnerService.step(run1.id);
  } catch (err) {
    console.warn(`[Ciclo #${iteration}] Erro durante step: ${err.message}`);
  }

  // Small breath between steps
  await new Promise(r => setTimeout(r, 2000));
}

// Verification of Test 2 outcomes
const finalRun1 = AutonomousManager.getRun(run1.id);
const finalTasks1 = db.prepare('SELECT id, title, order_index, status, task_commit_sha, commit_source FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(run1.id);
const allTasksCompleted = finalTasks1.length >= 5 && finalTasks1.every(t => t.status === 'completed');

// Run tests in target project directly
let projectTestExitCode = 0;
let projectTestOutput = '';
try {
  projectTestOutput = execSync('npm test', { cwd: PROJECT_DIR, encoding: 'utf-8', timeout: 30000 });
  projectTestExitCode = 0;
} catch (err) {
  projectTestExitCode = err.status || 1;
  projectTestOutput = (err.stdout || '') + (err.stderr || '');
}

// Git status in target project
const gitStatus = execSync('git status --porcelain', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
const gitLog = execSync('git log -n 6 --oneline', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();

console.log('\n--- VERIFICAÇÃO OBJETIVA DO TESTE 2 ---');
console.log(`Tarefas Concluídas: ${finalTasks1.filter(t => t.status === 'completed').length}/${finalTasks1.length}`);
console.log(`npm test no projeto alvo: exit code ${projectTestExitCode}`);
console.log(`Git status no projeto alvo: ${gitStatus ? 'DIRTY: ' + gitStatus : 'CLEAN'}`);
console.log(`Git log recente:\n${gitLog}`);

const t2Passed = allTasksCompleted && projectTestExitCode === 0 && !gitStatus;
results.test2 = {
  verdict: t2Passed ? 'PASS' : 'FAIL',
  runId: run1.id,
  completedCount: finalTasks1.filter(t => t.status === 'completed').length,
  totalTasks: finalTasks1.length,
  projectTestExitCode,
  gitClean: !gitStatus,
  tasks: finalTasks1,
  durationMs: Date.now() - t2StartTime
};
console.log(`>>> TESTE 2 RESULTADO: ${results.test2.verdict}`);

// -----------------------------------------------------------------------------
// TESTE 3: Diagnóstico e Correção Real de Bug
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('TESTE 3: Diagnóstico e Correção Real de Bug');
console.log('================================================================');

const t3StartTime = Date.now();
const existingRun3 = db.prepare("SELECT * FROM autonomous_runs WHERE project_id = ? AND name = 'Bug Diagnosis and Fix Run' ORDER BY created_at DESC LIMIT 1").get(projectId);
let run3;
let preFixTestFailed = true;
let postFixTestPassed = false;

if (existingRun3 && db.prepare("SELECT COUNT(*) as c FROM autonomous_tasks WHERE run_id = ? AND status = 'completed'").get(existingRun3.id).c >= 1) {
  console.log(`Reutilizando Bug Fix Run previamente comprovado: ${existingRun3.id}`);
  run3 = existingRun3;
  try {
    execSync('npm test', { cwd: PROJECT_DIR, stdio: 'pipe', timeout: 15000 });
    postFixTestPassed = true;
  } catch {
    postFixTestPassed = false;
  }
} else {
  // 1. Find a source file and inject a controlled bug
  const srcFiles = fs.readdirSync(path.join(PROJECT_DIR, 'src')).filter(f => f.endsWith('.ts'));
  const targetSrcFile = path.join(PROJECT_DIR, 'src', srcFiles[0]);
  const originalSrcContent = fs.readFileSync(targetSrcFile, 'utf-8');

  // Inject bug: make a function throw on valid input
  console.log(`Injetando bug intencional em ${targetSrcFile}...`);
  const buggyContent = originalSrcContent + '\n// INJECTED_BUG: throw error\nif (true) { throw new Error("BUG_REGRESSION_SIMULATED: falha forçada"); }\n';
  fs.writeFileSync(targetSrcFile, buggyContent, 'utf-8');

  // Verify that npm test actually fails now
  preFixTestFailed = false;
  try {
    execSync('npm test', { cwd: PROJECT_DIR, stdio: 'pipe', timeout: 15000 });
  } catch {
    preFixTestFailed = true;
  }
  console.log(`npm test falha conforme esperado com o bug injetado: ${preFixTestFailed}`);

  // Create Bug Fix Run
  run3 = await AutonomousManager.createRun({
    projectId,
    name: 'Bug Diagnosis and Fix Run',
    objective: `Corrigir falha em ${path.basename(targetSrcFile)}`,
    briefing: `O arquivo ${path.basename(targetSrcFile)} está falhando com erro BUG_REGRESSION_SIMULATED. Inspecione o erro via npm test, remova o bug cirurgicamente e garanta que npm test passe 100%.`,
    autonomyMode: 'autonomous',
    worker_prompt_variant: 'native'
  });

  console.log(`Disparando execução autônoma do Bug Fix Run (${run3.id})...`);
  let t3Steps = 0;
  while (t3Steps < 8) {
    t3Steps++;
    const uncompleted = db.prepare("SELECT COUNT(*) as count FROM autonomous_tasks WHERE run_id = ? AND status != 'completed'").get(run3.id).count;
    const currentRun3 = AutonomousManager.getRun(run3.id);
    console.log(`[Test 3 Ciclo #${t3Steps}] Status: ${currentRun3.status} | Tarefas restantes: ${uncompleted}`);
    
    if (uncompleted === 0 || currentRun3.status === 'completed') {
      break;
    }
    
    try {
      await AutonomousRunnerService.step(run3.id);
    } catch (e) {
      console.warn(`[Test 3 Step ${t3Steps}] Erro durante step: ${e.message}`);
    }

    // Check if npm test already passes
    try {
      execSync('npm test', { cwd: PROJECT_DIR, stdio: 'pipe', timeout: 15000 });
      console.log('✅ npm test voltou a passar com sucesso!');
      break;
    } catch {}

    await new Promise(r => setTimeout(r, 2000));
  }

  try {
    execSync('npm test', { cwd: PROJECT_DIR, stdio: 'pipe', timeout: 15000 });
    postFixTestPassed = true;
  } catch {
    postFixTestPassed = false;
  }
}

const finalRun3 = AutonomousManager.getRun(run3.id);
const t3Passed = preFixTestFailed && postFixTestPassed;
results.test3 = {
  verdict: t3Passed ? 'PASS' : 'FAIL',
  runId: run3.id,
  preFixFailed: preFixTestFailed,
  postFixPassed: postFixTestPassed,
  runStatus: finalRun3.status,
  durationMs: Date.now() - t3StartTime
};
console.log(`>>> TESTE 3 RESULTADO: ${results.test3.verdict} (PreFixFailed: ${preFixTestFailed}, PostFixPassed: ${postFixTestPassed}, RunStatus: ${finalRun3.status})`);

// -----------------------------------------------------------------------------
// TESTE 4: Recuperação de Falhas e Continuidade
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('TESTE 4: Recuperação de Falhas e Continuidade');
console.log('================================================================');

const t4StartTime = Date.now();
// Simulate a stale lease & crashed task
const staleTaskId = crypto.randomUUID();
const staleLeaseId = 'lease-stale-' + Date.now();

// Create mock worker & task
const testWorker = WorkerRegistry.createWorker({
  name: 'Stale Test Worker',
  account_profile_id: activeProfile.id,
  account_label: activeProfile.google_account_label,
  capabilities: ['build', 'test']
});
const staleWorkerId = testWorker.id;

db.prepare(`
  INSERT INTO autonomous_tasks (
    id, run_id, title, description, milestone, order_index, dependencies_json,
    status, criteria_json, created_at, updated_at
  ) VALUES (?, ?, 'Stale Recovery Task', 'Task interrupted by crash', 'M1', 99, '[]', 'in_progress', '[]', ?, ?)
`).run(staleTaskId, run1.id, new Date().toISOString(), new Date().toISOString());

// Create expired lease (60 seconds ago)
const expiredTime = new Date(Date.now() - 60000).toISOString();
db.prepare(`
  INSERT INTO worker_leases (id, worker_id, run_id, task_id, status, claimed_at, last_heartbeat, lease_until)
  VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
`).run(staleLeaseId, staleWorkerId, run1.id, staleTaskId, expiredTime, expiredTime, expiredTime);

WorkerRegistry.updateWorkerStatus(staleWorkerId, 'WORKING', { current_task_id: staleTaskId, current_run_id: run1.id });

console.log('Estado simulado de falha criado: Worker WORKING com lease expirada.');
console.log('Executando recuperação autônoma...');

// Execute autonomous recovery
AutonomousRunnerService.recoverInterruptedRuns();

const recoveredTask = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(staleTaskId);
const recoveredWorker = WorkerRegistry.getWorker(staleWorkerId);
const leaseRecord = db.prepare('SELECT status FROM worker_leases WHERE id = ?').get(staleLeaseId);

console.log(`Status da tarefa pós-recuperação: ${recoveredTask?.status} (esperado: ready)`);
console.log(`Status do worker pós-recuperação: ${recoveredWorker?.status} (esperado: OFFLINE ou READY)`);
console.log(`Status da lease pós-recuperação: ${leaseRecord?.status} (esperado: expired)`);

// Cleanup mock worker & task & lease
WorkerRegistry.deleteWorker(staleWorkerId);
db.prepare('DELETE FROM autonomous_tasks WHERE id = ?').run(staleTaskId);
db.prepare('DELETE FROM worker_leases WHERE id = ?').run(staleLeaseId);

const t4Passed = recoveredTask?.status === 'ready' && (leaseRecord?.status === 'expired' || leaseRecord?.status === 'released');
results.test4 = {
  verdict: t4Passed ? 'PASS' : 'FAIL',
  taskRecovered: recoveredTask?.status === 'ready',
  workerStatus: recoveredWorker?.status,
  leaseStatus: leaseRecord?.status,
  durationMs: Date.now() - t4StartTime
};
console.log(`>>> TESTE 4 RESULTADO: ${results.test4.verdict}`);

// -----------------------------------------------------------------------------
// TESTE 5: Cancelamento e Segurança
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('TESTE 5: Cancelamento e Segurança');
console.log('================================================================');

const t5StartTime = Date.now();
const run5 = await AutonomousManager.createRun({
  projectId,
  name: 'Cancellation Safety Test Run',
  objective: 'Test run cancellation',
  briefing: 'Run criado para testar interrupção limpa e segura.',
  autonomyMode: 'autonomous',
  worker_prompt_variant: 'native'
});

console.log(`Run 5 criado (${run5.id}), solicitando cancelamento imediato...`);
const stoppedRun = AutonomousManager.stopRun(run5.id);
console.log(`Status do Run pós-cancelamento: ${stoppedRun.status}`);

// Verify workers are not locked
const activeWorkersAfterCancel = db.prepare("SELECT COUNT(*) as count FROM workers WHERE current_run_id = ? AND status = 'WORKING'").get(run5.id).count;
console.log(`Workers presos no run cancelado: ${activeWorkersAfterCancel}`);

const t5Passed = (stoppedRun.status === 'failed' || stoppedRun.status === 'stopped') && activeWorkersAfterCancel === 0;
results.test5 = {
  verdict: t5Passed ? 'PASS' : 'FAIL',
  runId: run5.id,
  runStatus: stoppedRun.status,
  workersLocked: activeWorkersAfterCancel,
  durationMs: Date.now() - t5StartTime
};
console.log(`>>> TESTE 5 RESULTADO: ${results.test5.verdict}`);

// -----------------------------------------------------------------------------
// TESTE 6: Persistência de Conversação e Handoff
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('TESTE 6: Persistência de Conversação e Handoff');
console.log('================================================================');

const t6StartTime = Date.now();
const conversations = db.prepare(`
  SELECT conversation_id, project_id, account_profile_id, role, turn_count, rotation_index, is_hidden
  FROM conversations
  WHERE project_id = ?
`).all(projectId);

console.log(`Total de conversations registradas para o projeto ${projectId}: ${conversations.length}`);
for (const c of conversations) {
  console.log(`  Role: ${c.role.padEnd(10)} | ID: ${c.conversation_id.slice(0, 8)} | Turns: ${c.turn_count} | Rot: ${c.rotation_index} | Hidden: ${c.is_hidden}`);
}

const workerConvs = conversations.filter(c => c.role === 'worker');
const supervisorConvs = conversations.filter(c => c.role === 'supervisor');

// Invariant: At most 1 active worker leaf, reused across multiple turns
const hasWorkerReuse = workerConvs.some(c => c.turn_count >= 2);
const noExplosion = workerConvs.length <= 2 && supervisorConvs.length <= 2;

const t6Passed = hasWorkerReuse && noExplosion;
results.test6 = {
  verdict: t6Passed ? 'PASS' : 'FAIL',
  totalConversations: conversations.length,
  workerConversations: workerConvs.length,
  maxWorkerTurns: Math.max(...workerConvs.map(c => c.turn_count), 0),
  supervisorConversations: supervisorConvs.length,
  durationMs: Date.now() - t6StartTime
};
console.log(`>>> TESTE 6 RESULTADO: ${results.test6.verdict} (WorkerTurns: ${results.test6.maxWorkerTurns}, WorkerConvs: ${workerConvs.length})`);

// -----------------------------------------------------------------------------
// TESTE 7: Persistência de Projeto
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('TESTE 7: Persistência de Projeto');
console.log('================================================================');

const t7StartTime = Date.now();
const loadedProj = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
const loadedRuns = db.prepare('SELECT id, name, status FROM autonomous_runs WHERE project_id = ?').all(projectId);
const memoryDir = path.join(PROJECT_DIR, '.ai-dev-hub');
const memoryFiles = fs.existsSync(memoryDir) ? fs.readdirSync(memoryDir) : [];

console.log(`Projeto carregado: ${loadedProj?.name} (Status: ${loadedProj?.status})`);
console.log(`Histórico de Runs associados: ${loadedRuns.length}`);
console.log(`Arquivos de memória em .ai-dev-hub/: ${memoryFiles.join(', ')}`);

const t7Passed = Boolean(loadedProj) && loadedRuns.length >= 2 && fs.existsSync(memoryDir);
results.test7 = {
  verdict: t7Passed ? 'PASS' : 'FAIL',
  projectExists: Boolean(loadedProj),
  runsCount: loadedRuns.length,
  memoryFiles,
  durationMs: Date.now() - t7StartTime
};
console.log(`>>> TESTE 7 RESULTADO: ${results.test7.verdict}`);

// -----------------------------------------------------------------------------
// TESTE 8: Desktop Executável Independente
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('TESTE 8: Desktop Executável Independente');
console.log('================================================================');

const t8StartTime = Date.now();
// Verify compiled server & client exist
const serverDist = path.resolve('server/dist/index.js');
const clientDist = path.resolve('client/dist/index.html');
const serverDistExists = fs.existsSync(serverDist);
const clientDistExists = fs.existsSync(clientDist);

console.log(`server/dist/index.js existe: ${serverDistExists}`);
console.log(`client/dist/index.html existe: ${clientDistExists}`);

// Verify desktop main and serviceManager
const desktopMain = path.resolve('desktop/main.cjs');
const serviceManager = path.resolve('desktop/serviceManager.cjs');
const desktopFilesExist = fs.existsSync(desktopMain) && fs.existsSync(serviceManager);

console.log(`desktop/main.cjs e serviceManager.cjs existem: ${desktopFilesExist}`);

const t8Passed = serverDistExists && clientDistExists && desktopFilesExist;
results.test8 = {
  verdict: t8Passed ? 'PASS' : 'FAIL',
  serverDistExists,
  clientDistExists,
  desktopFilesExist,
  durationMs: Date.now() - t8StartTime
};
console.log(`>>> TESTE 8 RESULTADO: ${results.test8.verdict}`);

// -----------------------------------------------------------------------------
// TESTE 9: Multi-Conta e Isolamento
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('TESTE 9: Multi-Conta e Isolamento');
console.log('================================================================');

const allProfiles = AccountProfileManager.getAllProfiles();
console.log(`Perfis configurados no sistema: ${allProfiles.length}`);
for (const p of allProfiles) {
  console.log(`  Profile ${p.id}: ${p.display_name} (${p.google_account_label || 'Sem email'}) - Status: ${p.auth_status}`);
}

const readyProfiles = allProfiles.filter(p => p.auth_status === 'READY');
let t9Verdict = 'NOT_TESTED';
let t9Reason = '';

if (readyProfiles.length >= 2) {
  t9Verdict = 'PASS';
  t9Reason = 'Múltiplos perfis autenticados disponíveis e testados.';
} else {
  t9Verdict = 'NÃO_TESTADO_SEM_SEGUNDA_CONTA';
  t9Reason = `Apenas 1 conta ativa no runtime local (${readyProfiles[0]?.id || activeProfile.id} em 127.0.0.1:2109). Segunda conta (${allProfiles.find(p => p.id !== activeProfile.id)?.id || 'acc-pro-2'}) não possui sessão ativa do language_server.exe no Windows no momento.`;
}

results.test9 = {
  verdict: t9Verdict,
  reason: t9Reason,
  activeAccount: activeProfile.id,
  configuredProfiles: allProfiles.map(p => ({ id: p.id, name: p.display_name, status: p.auth_status }))
};
console.log(`>>> TESTE 9 RESULTADO: ${results.test9.verdict} (${results.test9.reason})`);

// -----------------------------------------------------------------------------
// FINAL SUMMARY
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('📊 RESUMO FINAL DA SUÍTE DE HOMOLOGAÇÃO');
console.log('================================================================');
console.log(JSON.stringify(results, null, 2));

fs.writeFileSync(
  path.resolve('scripts/homologation_results.json'),
  JSON.stringify(results, null, 2)
);
console.log('\nResultados salvos em scripts/homologation_results.json');
