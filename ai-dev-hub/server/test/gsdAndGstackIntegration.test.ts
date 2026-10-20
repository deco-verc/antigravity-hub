import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { EngineeringContextService } from '../src/engineeringContextService.js';
import { DagAutoHealer, TaskGraphNode } from '../src/dagAutoHealer.js';
import { SkillSlashCommandService } from '../src/skillSlashCommandService.js';

test('GSD & GStack Architectural Integration Test Suite', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-gsd-gstack-test-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  t.after(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "gsdAndGstackIntegration.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:gsdAndGstackIntegration.test]", err);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 1. GSD Atomic XML Task Specification
  // ---------------------------------------------------------------------------
  await t.test('1. GSD Atomic XML Task Structure: buildWorkerPrompt & expansion prompt', () => {
    const { prompt } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: 'p1',
      projectName: 'GSD Test App',
      projectPath: tmpRoot,
      projectObjective: 'Testar contratos atomicos XML GSD',
      taskId: 'task-xml-1',
      taskTitle: 'Criar Endpoint de Faturamento',
      taskDescription: 'Implementar endpoint POST /api/billing com persistencia no SQLite.',
      acceptanceCriteria: [
        'Endpoint POST /api/billing responde 201 Created',
        'Tabela billing_records mantem historico no SQLite'
      ],
      verificationCommand: 'npm run test:billing',
      expectedScopeFiles: ['src/billing.ts', 'src/db.ts'],
      doneWhen: 'Execução cirúrgica sem regressão'
    });

    // Validar bloco <gsd_atomic_task>
    assert.ok(prompt.includes('<gsd_atomic_task type="auto" mode="IMPLEMENT">'), 'Deve conter tag raiz gsd_atomic_task com modo');
    assert.ok(prompt.includes('</gsd_atomic_task>'), 'Deve fechar tag raiz gsd_atomic_task');
    assert.ok(prompt.includes('<name>Criar Endpoint de Faturamento</name>'), 'Deve conter tag <name>');
    assert.ok(prompt.includes('<files>src/billing.ts, src/db.ts</files>'), 'Deve conter tag <files> com arquivos de escopo');
    assert.ok(prompt.includes('<action>Implementar endpoint POST /api/billing com persistencia no SQLite.</action>'), 'Deve conter tag <action>');
    assert.ok(prompt.includes('<verify>npm run test:billing</verify>'), 'Deve conter tag <verify> com comando deterministico');
    assert.ok(prompt.includes('<done>Execução cirúrgica sem regressão</done>'), 'Deve conter tag <done>');

    // Validar diretrizes GSD no prompt de expansao da Onda 2
    const { prompt: expansionPrompt } = PromptArchitectureService.buildMajorTaskExpansionPrompt({
      project: { id: 'p1', name: 'GSD App', path: tmpRoot },
      majorTask: {
        id: 'major-1',
        code: 'GT-01',
        title: 'Construir Infraestrutura SaaS',
        objective: 'Orquestrar banco e rotas',
        expectedOutcome: 'Rotas prontas'
      } as any,
      stages: [],
      allRequirements: []
    });

    assert.ok(expansionPrompt.includes('PADRÃO GSD ATOMIC SPECIFICATION & ANTI-CONTEXT-ROT'), 'Prompt de expansão deve exigir contratos atomicos GSD');
    assert.ok(expansionPrompt.includes('expectedFiles sem colisão desnecessária'), 'Prompt de expansão deve instruir arquivos disjuntos');
  });

  // ---------------------------------------------------------------------------
  // 2. GSD Fresh Subagent Context Envelope & Anti-Context-Rot
  // ---------------------------------------------------------------------------
  await t.test('2. GSD Fresh Subagent Context Envelope: extrai assinaturas e mede contexto', () => {
    const srcDir = path.join(tmpRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Criar arquivos de exemplo com funcoes, classes, interfaces e rotas
    fs.writeFileSync(
      path.join(srcDir, 'authService.ts'),
      [
        'export interface UserCredentials { username: string; token: string; }',
        'export const TOKEN_EXPIRY_MS = 3600000;',
        'export class AuthService {',
        '  async authenticate(creds: UserCredentials): Promise<boolean> { return true; }',
        '}',
        'export function generateSessionId(): string { return "session-123"; }',
        'fastify.post("/api/auth/login", async (req, reply) => {});',
        'CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT);'
      ].join('\n')
    );

    const envelope = EngineeringContextService.buildFreshSubagentContextEnvelope({
      projectPath: tmpRoot,
      scopeFiles: ['src/authService.ts'],
      maxTokenBudget: 4000
    });

    assert.strictEqual(envelope.signatures.length, 1);
    assert.strictEqual(envelope.signatures[0].file, 'src/authService.ts');
    assert.ok(envelope.totalSignaturesCount >= 4, `Deve extrair multiplas assinaturas (obteve ${envelope.totalSignaturesCount})`);
    assert.ok(envelope.estimatedTokens > 0, 'Deve calcular tokens estimados');
    assert.ok(envelope.contextUtilizationRatio < 0.4, 'Taxa de utilizacao deve ser confortavel (< 40%)');
    assert.strictEqual(envelope.contextRotRisk, 'SAFE', 'Risco de context rot deve ser SAFE');
    assert.ok(envelope.summaryBlock.includes('GSD FRESH SUBAGENT CONTEXT ENVELOPE'), 'Deve formatar bloco de envelope');
    assert.ok(envelope.summaryBlock.includes('AuthService'), 'Deve incluir nome da classe extraida');

    // Integracao com prepareTaskContext
    const pkg = EngineeringContextService.prepareTaskContext({
      projectPath: tmpRoot,
      projectName: 'GSD Test App',
      projectObjective: 'Testar envelope de contexto',
      task: {
        id: 'task-sub-1',
        title: 'Ajustar Autenticacao',
        description: 'Usar AuthService',
        criteria: ['Sessao valida'],
        verificationCommand: 'npm test',
        expectedScopeFiles: ['src/authService.ts']
      }
    });

    assert.ok(pkg.freshContextEnvelope, 'EngineeringPackage deve expor freshContextEnvelope');
    assert.strictEqual(pkg.freshContextEnvelope.contextRotRisk, 'SAFE');
    assert.ok(typeof pkg.contextUtilizationRatio === 'number');
  });

  // ---------------------------------------------------------------------------
  // 3. GSD Wave Grouping & File-Lock Wave Shift
  // ---------------------------------------------------------------------------
  await t.test('3. GSD Wave Grouping & File-Lock Wave Shift: isola colisoes de arquivos em ondas', () => {
    // Cenário A: DAG linear sem conflito de arquivo
    const linearTasks = [
      { id: 't1', dependencies: [] },
      { id: 't2', dependencies: ['t1'] },
      { id: 't3', dependencies: ['t2'] }
    ];
    const wavesLinear = DagAutoHealer.computeExecutionWaves(linearTasks);
    assert.strictEqual(wavesLinear[0].waveIndex, 1);
    assert.strictEqual(wavesLinear[1].waveIndex, 2);
    assert.strictEqual(wavesLinear[2].waveIndex, 3);

    // Cenário B: Duas tarefas independentes com arquivos disjuntos -> mesma onda 1
    const disjointTasks = [
      { id: 'tA', dependencies: [], expectedFiles: ['src/orders.ts'] },
      { id: 'tB', dependencies: [], expectedFiles: ['src/products.ts'] }
    ];
    const wavesDisjoint = DagAutoHealer.computeExecutionWaves(disjointTasks);
    assert.strictEqual(wavesDisjoint[0].waveIndex, 1, 'Task A deve estar na Wave 1');
    assert.strictEqual(wavesDisjoint[1].waveIndex, 1, 'Task B com arquivos disjuntos deve estar na Wave 1');

    // Cenário C: Duas tarefas independentes tocando o MESMO arquivo -> File-Lock Wave Shift
    const conflictingTasks = [
      { id: 'tAlpha', dependencies: [], expectedFiles: ['src/database.ts'] },
      { id: 'tBeta', dependencies: [], expectedFiles: ['src/database.ts'] }
    ];
    const wavesConflict = DagAutoHealer.computeExecutionWaves(conflictingTasks);
    assert.strictEqual(wavesConflict[0].waveIndex, 1, 'Primeira tarefa fica na Wave 1');
    assert.strictEqual(wavesConflict[1].waveIndex, 2, 'Segunda tarefa colidindo no mesmo arquivo deve ser deslocada para Wave 2');

    // Cenário D: autoHealAndNormalizeTaskGraph anexa waveIndex
    const rawTasks: Partial<TaskGraphNode>[] = [
      {
        id: 'raw-1',
        title: 'Criar Modelos',
        description: 'Tabelas basicas',
        criteria: ['Pronto'],
        dependencies: [],
        expectedFiles: ['src/models.ts']
      },
      {
        id: 'raw-2',
        title: 'Criar Rotas',
        description: 'Rotas de API',
        criteria: ['Rotas OK'],
        dependencies: ['raw-1'],
        expectedFiles: ['src/routes.ts']
      }
    ];

    const healed = DagAutoHealer.autoHealAndNormalizeTaskGraph(rawTasks, 'Test Run');
    assert.strictEqual(healed.length, 2);
    assert.strictEqual((healed[0] as any).waveIndex, 1);
    assert.strictEqual((healed[1] as any).waveIndex, 2);
  });

  // ---------------------------------------------------------------------------
  // 4. GStack Cognitive Gears & Slash Commands (/plan-ceo, /plan-eng, /ship)
  // ---------------------------------------------------------------------------
  await t.test('4. GStack Cognitive Gears & Slash Commands: catalog, parsing, playbooks & /ship', async () => {
    const catalog = SkillSlashCommandService.getSlashCommandsCatalog();

    // 1. Catalog presence
    const ceoCmd = catalog.find(c => c.command === '/plan-ceo');
    const engCmd = catalog.find(c => c.command === '/plan-eng');
    const shipCmd = catalog.find(c => c.command === '/ship');

    assert.ok(ceoCmd, 'Comando /plan-ceo deve constar no catálogo');
    assert.strictEqual(ceoCmd.category, 'Architecture');
    assert.strictEqual(ceoCmd.executionType, 'AUTONOMOUS_DELTA');
    assert.ok(ceoCmd.aliases.includes('/founder-review'));

    assert.ok(engCmd, 'Comando /plan-eng deve constar no catálogo');
    assert.strictEqual(engCmd.category, 'Architecture');
    assert.strictEqual(engCmd.executionType, 'AUTONOMOUS_DELTA');
    assert.ok(engCmd.aliases.includes('/arch-lock'));

    assert.ok(shipCmd, 'Comando /ship deve constar no catálogo');
    assert.strictEqual(shipCmd.category, 'Docs & Workflow');
    assert.strictEqual(shipCmd.executionType, 'IMMEDIATE_TOOL');
    assert.ok(shipCmd.aliases.includes('/release'));

    // 2. Parsing commands & aliases
    const parseCeo = SkillSlashCommandService.parseCommand('/plan-ceo foco em onboarding');
    assert.ok(parseCeo);
    assert.strictEqual(parseCeo.def.command, '/plan-ceo');
    assert.strictEqual(parseCeo.args, 'foco em onboarding');

    const parseFounder = SkillSlashCommandService.parseCommand('/founder-review');
    assert.ok(parseFounder);
    assert.strictEqual(parseFounder.def.command, '/plan-ceo');

    const parseEng = SkillSlashCommandService.parseCommand('/plan-eng modulo de pagamentos');
    assert.ok(parseEng);
    assert.strictEqual(parseEng.def.command, '/plan-eng');

    const parseArchLock = SkillSlashCommandService.parseCommand('/arch-lock');
    assert.ok(parseArchLock);
    assert.strictEqual(parseArchLock.def.command, '/plan-eng');

    const parseShip = SkillSlashCommandService.parseCommand('/ship v1.2.0');
    assert.ok(parseShip);
    assert.strictEqual(parseShip.def.command, '/ship');
    assert.strictEqual(parseShip.args, 'v1.2.0');

    // 3. Playbooks curation
    const ceoPlaybook = SkillSlashCommandService.generateCuratedPlaybook(ceoCmd!, 'delighters');
    assert.ok(ceoPlaybook.includes('FOUNDER MODE & 10-STAR PRODUCT'), 'Playbook CEO deve focar em 10-Star Product');
    assert.ok(ceoPlaybook.includes('AUTONOMIA TOTAL & VALOR DE NEGÓCIO'), 'Playbook CEO deve prezar autonomia e ROI');

    const engPlaybook = SkillSlashCommandService.generateCuratedPlaybook(engCmd!, 'contracts');
    assert.ok(engPlaybook.includes('ARCHITECTURE & CONTRACT LOCK'), 'Playbook Eng deve travar arquitetura e contratos');
    assert.ok(engPlaybook.includes('EDGE CASES & ERROR RESILIENCE'), 'Playbook Eng deve tratar edge cases');

    // 4. Execution of /ship command
    // Prepare project directory with package.json and Dockerfile
    const shipProjDir = path.join(tmpRoot, 'ship-project');
    fs.mkdirSync(shipProjDir, { recursive: true });
    fs.writeFileSync(
      path.join(shipProjDir, 'package.json'),
      JSON.stringify({ name: 'ship-app', version: '2.4.0' }, null, 2)
    );
    fs.writeFileSync(path.join(shipProjDir, 'Dockerfile'), 'FROM node:22-alpine\n');
    fs.writeFileSync(path.join(shipProjDir, '.env.example'), 'PORT=4000\n');

    const shipResult = await SkillSlashCommandService.handleSlashCommand({
      projectId: 'ship-proj-1',
      projectPath: shipProjDir,
      projectName: 'Ship App Demo',
      command: '/ship',
      args: 'v2.4.0',
      fullMessage: '/ship v2.4.0'
    });

    assert.strictEqual(shipResult.execution.status, 'completed');
    assert.strictEqual(shipResult.execution.command, '/ship');
    assert.strictEqual(shipResult.execution.version, 'v2.4.0');
    assert.ok(shipResult.replyContent.includes('Relatório de Prontidão de Release (`/ship`) — v2.4.0'));

    // Check that .ai-dev-hub/RELEASE_READY.md was generated
    const releaseDocPath = path.join(shipProjDir, '.ai-dev-hub', 'RELEASE_READY.md');
    assert.ok(fs.existsSync(releaseDocPath), 'Arquivo RELEASE_READY.md deve ser criado');
    const releaseDoc = fs.readFileSync(releaseDocPath, 'utf-8');
    assert.ok(releaseDoc.includes('# RELEASE READINESS AUDIT: v2.4.0'));
    assert.ok(releaseDoc.includes('Portões de Homologação (4-Gates)'));
    assert.ok(releaseDoc.includes('Containerização (Dockerfile):** Presente'));
    assert.ok(releaseDoc.includes('Configuração de Ambiente (.env.example):** Presente'));
  });
});
