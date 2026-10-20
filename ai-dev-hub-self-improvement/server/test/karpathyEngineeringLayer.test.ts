import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MemoryManager } from '../src/memoryManager.js';
import { EngineeringContextService } from '../src/engineeringContextService.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { AntigravityProvider } from '../src/antigravityProvider.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { validateSurgicalDiff } from '../src/agentGuidelines.js';

test('Karpathy Native Engineering Layer Suite', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-karpathy-test-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  t.after(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  await t.test('TESTE A — Constituição automática (program.md idempotente)', async () => {
    const projDir = path.join(tmpRoot, 'proj-constitution');
    fs.mkdirSync(projDir, { recursive: true });

    // 1. Initial creation
    const programFirst = MemoryManager.ensureProgramMd(projDir, 'ProjConstitution', 'Construir microsserviço de pagamentos');
    assert.ok(programFirst.includes('Project Program: ProjConstitution'));
    assert.ok(programFirst.includes('Think Before Coding'));
    assert.ok(programFirst.includes('Simplicity First'));
    assert.ok(programFirst.includes('Surgical Changes'));
    assert.ok(programFirst.includes('Goal-Driven Execution'));

    const programDiskPath = path.join(projDir, '.ai-dev-hub', 'program.md');
    assert.ok(fs.existsSync(programDiskPath));

    // Custom user edit to program.md
    fs.appendFileSync(programDiskPath, '\n## Custom User Rule\nRegra customizada pelo desenvolvedor.\n');

    // 2. Re-execution of ensureProgramMd must be idempotent and not overwrite user edits
    const programSecond = MemoryManager.ensureProgramMd(projDir, 'ProjConstitution', 'Novo objetivo diferente');
    assert.ok(programSecond.includes('Regra customizada pelo desenvolvedor.'), 'Não deve sobrescrever edições do usuário');
    assert.equal(programSecond, fs.readFileSync(programDiskPath, 'utf-8'));
  });

  await t.test('TESTE B — Isolamento de contexto entre projetos', async () => {
    const projADir = path.join(tmpRoot, 'proj-alpha');
    const projBDir = path.join(tmpRoot, 'proj-beta');
    fs.mkdirSync(projADir, { recursive: true });
    fs.mkdirSync(projBDir, { recursive: true });

    // Project Alpha
    MemoryManager.ensureProgramMd(projADir, 'Alpha', 'Objetivo Secreto Alpha');
    MemoryManager.updateMemoryFile(projADir, 'decisions.md', '- [Decisão Alpha] Usar SQLite e Node puro');

    // Project Beta
    MemoryManager.ensureProgramMd(projBDir, 'Beta', 'Objetivo Secreto Beta');
    MemoryManager.updateMemoryFile(projBDir, 'decisions.md', '- [Decisão Beta] Usar PostgreSQL e Redis');

    // Prepare context for Alpha
    const contextA = EngineeringContextService.prepareTaskContext({
      projectPath: projADir,
      projectName: 'Alpha',
      projectObjective: 'Objetivo Secreto Alpha',
      task: { title: 'Tarefa Alpha 1' }
    });

    // Prepare context for Beta
    const contextB = EngineeringContextService.prepareTaskContext({
      projectPath: projBDir,
      projectName: 'Beta',
      projectObjective: 'Objetivo Secreto Beta',
      task: { title: 'Tarefa Beta 1' }
    });

    assert.ok(contextA.formattedPromptBlock.includes('Alpha'));
    assert.ok(contextA.formattedPromptBlock.includes('SQLite'));
    assert.ok(!contextA.formattedPromptBlock.includes('Beta'), 'Contexto de Alpha não deve conter dados de Beta');
    assert.ok(!contextA.formattedPromptBlock.includes('PostgreSQL'), 'Contexto de Alpha não deve conter tecnologias de Beta');

    assert.ok(contextB.formattedPromptBlock.includes('Beta'));
    assert.ok(contextB.formattedPromptBlock.includes('PostgreSQL'));
    assert.ok(!contextB.formattedPromptBlock.includes('Alpha'), 'Contexto de Beta não deve conter dados de Alpha');
    assert.notEqual(contextA.contextHash, contextB.contextHash, 'Hashes devem ser distintos');
  });

  await t.test('TESTE C — Supervisor recebe contexto com constituição e decisões', async () => {
    const projDir = path.join(tmpRoot, 'proj-supervisor');
    fs.mkdirSync(projDir, { recursive: true });
    MemoryManager.ensureProgramMd(projDir, 'ProjSupervisor', 'Desenvolver API REST com Node');
    MemoryManager.updateMemoryFile(projDir, 'decisions.md', '- [08/10/2026] Decisão: Proibido adicionar ORM pesado; usar node:sqlite');

    // Instantiate GeminiSupervisorProvider in mock mode
    const supervisor = new GeminiSupervisorProvider('flash');
    assert.ok(supervisor, 'Supervisor instanciado');
  });

  await t.test('TESTE D — Worker recebe contrato com Karpathy e preflight', async () => {
    const projDir = path.join(tmpRoot, 'proj-worker');
    fs.mkdirSync(projDir, { recursive: true });
    MemoryManager.ensureProgramMd(projDir, 'ProjWorker', 'Sistema de Tarefas');
    MemoryManager.updateMemoryFile(projDir, 'decisions.md', '- [08/10/2026] Arquitetura modular sem classes');

    const pkg = EngineeringContextService.prepareTaskContext({
      projectPath: projDir,
      projectName: 'ProjWorker',
      projectObjective: 'Sistema de Tarefas',
      task: {
        title: 'Criar módulo de validação',
        description: 'Validar dados de entrada estritamente',
        criteria: ['Retornar true para email válido', 'Retornar false para email inválido'],
        verificationCommand: 'node test.js',
        expectedScopeFiles: ['src/validator.js', 'test.js']
      }
    });

    assert.equal(pkg.preflightStatus, 'READY');
    assert.ok(pkg.contextHash.length > 0);
    assert.ok(pkg.formattedPromptBlock.includes('THINK BEFORE CODING'));
    assert.ok(pkg.formattedPromptBlock.includes('SIMPLICITY FIRST'));
    assert.ok(pkg.formattedPromptBlock.includes('SURGICAL CHANGES'));
    assert.ok(pkg.formattedPromptBlock.includes('GOAL-DRIVEN'));
    assert.ok(pkg.formattedPromptBlock.includes('Arquitetura modular sem classes'));
  });

  await t.test('TESTE E — Atualização dinâmica de decisões reflete na próxima Task', async () => {
    const projDir = path.join(tmpRoot, 'proj-decisions');
    fs.mkdirSync(projDir, { recursive: true });
    MemoryManager.ensureProgramMd(projDir, 'ProjDecisions', 'App Dinâmico');
    MemoryManager.updateMemoryFile(projDir, 'decisions.md', '- [Decisão Inicial] Adotar JWT');

    const pkgInitial = EngineeringContextService.prepareTaskContext({
      projectPath: projDir,
      projectName: 'ProjDecisions',
      task: { title: 'Task 1' }
    });
    assert.ok(pkgInitial.formattedPromptBlock.includes('JWT'));

    // Dynamic decision update
    MemoryManager.updateMemoryFile(projDir, 'decisions.md', '- [Decisão Inicial] Adotar JWT\n- [Decisão Nova] Migrar de JWT para Session Tokens em Cookies HttpOnly');

    const pkgUpdated = EngineeringContextService.prepareTaskContext({
      projectPath: projDir,
      projectName: 'ProjDecisions',
      task: { title: 'Task 2' }
    });
    assert.ok(pkgUpdated.formattedPromptBlock.includes('Session Tokens em Cookies HttpOnly'));
    assert.notEqual(pkgInitial.contextHash, pkgUpdated.contextHash);
  });

  await t.test('TESTE F — Surgical Changes (validateSurgicalDiff)', async () => {
    const expected = ['src/auth.js', 'src/users.js'];

    // 1. Surgical: only allowed files
    const resSurgical = validateSurgicalDiff(['src/auth.js', 'src/users.js'], expected);
    assert.equal(resSurgical.isSurgical, true);
    assert.equal(resSurgical.unrelatedFiles.length, 0);

    // 2. Non-surgical without justification
    const resUnrelated = validateSurgicalDiff(['src/auth.js', 'src/users.js', 'src/billing.js', 'package.json'], expected);
    assert.equal(resUnrelated.isSurgical, false);
    assert.equal(resUnrelated.unrelatedFiles.length, 2);
    assert.ok(resUnrelated.explanation.includes('fora do escopo esperado'));
  });

  await t.test('TESTE G — Goal-Driven: validação de critérios e comandos', async () => {
    const projDir = path.join(tmpRoot, 'proj-goaldriven');
    fs.mkdirSync(projDir, { recursive: true });

    // Task with empty criteria receives explicit fallback criteria
    const pkg = EngineeringContextService.prepareTaskContext({
      projectPath: projDir,
      projectName: 'ProjGoal',
      task: {
        title: 'Tarefa sem critérios prévios',
        criteria: []
      }
    });

    assert.ok(pkg.taskContract.acceptanceCriteria.length > 0, 'Critérios binários devem ser formulados por garantia contratual');
    assert.ok(pkg.taskContract.verificationCommand.length > 0, 'Comando de verificação deve existir');
    assert.ok(pkg.taskContract.doneWhen.length > 0, 'Done when deve existir');
  });

  await t.test('TESTE H — Gemini Nativo preservado (sem Fable, sem rules automáticas)', async () => {
    const projDir = path.join(tmpRoot, 'proj-native');
    fs.mkdirSync(projDir, { recursive: true });

    const rulesFile = path.join(projDir, '.agents', 'rules', 'decohub-worker.md');
    // Ensure no automatic Fable injection
    assert.ok(!fs.existsSync(rulesFile), 'Nenhum .agents/rules/decohub-worker.md deve ser criado');
  });

  await t.test('TESTE I — Evaluator com verificação objetiva e integridade de escopo', async () => {
    const projDir = path.join(tmpRoot, 'proj-eval');
    fs.mkdirSync(projDir, { recursive: true });

    const contract = IndependentEvaluator.createSuccessContract({
      taskId: 'task-eval-1',
      projectId: 'proj-eval-id',
      projectPath: projDir,
      objective: 'Validação objetiva de teste',
      acceptanceCriteria: ['Passar no teste'],
      verificationCommand: 'node -e "process.exit(0)"',
      protectedEvaluationFiles: []
    });

    assert.equal(contract.objective, 'Validação objetiva de teste');
    assert.equal(contract.verificationSteps.length, 1);

    const evalResult = await IndependentEvaluator.evaluate(contract.id, projDir, {
      status: 'success',
      filesChanged: ['src/feature.js']
    }, {
      expectedScopeFiles: ['src/feature.js']
    });

    assert.equal(evalResult.verdict, 'PASS');
    assert.equal(evalResult.taskIsDone, true);
    assert.equal(evalResult.evidence.scopeValidation?.isSurgical, true);
  });
});
