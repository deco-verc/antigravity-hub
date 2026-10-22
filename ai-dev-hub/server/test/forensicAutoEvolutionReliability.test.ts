import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { db } from '../src/db.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { EngineeringContextService } from '../src/engineeringContextService.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { DagAutoHealer } from '../src/dagAutoHealer.js';

describe('Forensic Auto-Evolution & Reliability Hardening Suite', () => {
  const tempProjectsDir = path.join(os.tmpdir(), `decohub-forensic-test-${Date.now()}`);

  it('1. IndependentEvaluator: tarefas puras de backend/testes NÃO disparam isFrontendTask mesmo com public/index.html presente', async () => {
    const projectDir = path.join(tempProjectsDir, 'backend-project');
    const publicDir = path.join(projectDir, 'public');
    const srcDir = path.join(projectDir, 'src');
    const testDir = path.join(projectDir, 'test');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });

    const projectId = 'proj-backend-01';
    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, path, status, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, 'Backend Project', ?, 'active', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(projectId, projectDir);

    // Cria public/index.html prévio
    fs.writeFileSync(path.join(publicDir, 'index.html'), '<!DOCTYPE html><html><body><h1>App</h1></body></html>');
    // Cria arquivo de teste de backend
    fs.writeFileSync(path.join(testDir, 'api.test.ts'), 'export const dummy = true;');

    const contract = IndependentEvaluator.createSuccessContract({
      taskId: 'task-backend-int-01',
      runId: 'run-test-01',
      projectId,
      projectPath: projectDir,
      objective: 'Implementar testes de integração dos contratos REST, rotas de ecossistema e audit logs',
      acceptanceCriteria: ['Testes de integração REST cobrindo endpoints com sucesso'],
      verificationSteps: [
        { name: 'Arquivo de Teste Presente', checkType: 'file_exists', targetPath: 'test/api.test.ts' }
      ]
    });

    const builderReport = {
      status: 'success' as const,
      filesChanged: ['test/api.test.ts'],
      implemented: ['Testes de integração REST'],
      commandsExecuted: ['node -e "process.exit(0)"'],
      tests: { ran: true, passed: true, exitCode: 0 },
      buildStatus: 'OK',
      problems: [],
      decisions: []
    };

    const evalResult = await IndependentEvaluator.evaluate(contract.id, projectDir, builderReport, {
      expectedScopeFiles: ['test/api.test.ts']
    });

    // A avaliação deve passar sem que o Playwright Visual Inspector gere falha ou rode indevidamente
    assert.equal(evalResult.verdict, 'PASS');
    assert.equal(evalResult.taskIsDone, true);
    // Não deve conter evidência de inspeção visual Playwright em tarefa puramente de backend
    assert.equal(evalResult.evidence?.visualInspection, undefined);
  });

  it('2. IndependentEvaluator: tarefas com alteração de UI disparam isFrontendTask e visual inspection', async () => {
    const projectDir = path.join(tempProjectsDir, 'frontend-project');
    const publicDir = path.join(projectDir, 'public');
    fs.mkdirSync(publicDir, { recursive: true });

    fs.writeFileSync(path.join(publicDir, 'index.html'), '<!DOCTYPE html><html><head><style>:root{--bg:#000;}</style></head><body><button role="tab" data-tab="home">Home</button></body></html>');
    fs.writeFileSync(path.join(publicDir, 'app.js'), 'console.log("ready");');

    const contract = IndependentEvaluator.createSuccessContract({
      taskId: 'task-frontend-ui-02',
      runId: 'run-test-02',
      projectId: 'proj-02',
      projectPath: projectDir,
      objective: 'Construir interface e tela de dashboard com tokens e botões',
      acceptanceCriteria: ['Dashboard renderizado com sucesso'],
      verificationCommand: 'node -e "process.exit(0)"'
    });

    const builderReport = {
      status: 'success' as const,
      filesChanged: ['public/index.html', 'public/app.js'],
      implemented: ['Dashboard interface'],
      commandsExecuted: ['node -e "process.exit(0)"'],
      tests: { ran: true, passed: true, exitCode: 0 },
      buildStatus: 'OK',
      problems: [],
      decisions: []
    };

    const evalResult = await IndependentEvaluator.evaluate(contract.id, projectDir, builderReport, {
      expectedScopeFiles: ['public/index.html', 'public/app.js']
    });

    // Tarefa de frontend deve ter gerado visualInspection nas evidências
    assert.ok(evalResult.evidence?.visualInspection !== undefined, 'Deve conter visualInspection para tarefas de UI');
  });

  it('3. EngineeringContextService: detecta convenções de módulo Node/TS e previne erros de LSP', () => {
    const projectDir = path.join(tempProjectsDir, 'ts-conventions-project');
    fs.mkdirSync(projectDir, { recursive: true });

    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'ts-proj', type: 'module' }, null, 2)
    );
    fs.writeFileSync(
      path.join(projectDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { module: 'NodeNext', outDir: './dist' } }, null, 2)
    );

    const conventions = EngineeringContextService.detectTypeScriptModuleConventions(projectDir);
    assert.ok(conventions.includes('DIRETRIZES DE MÓDULOS NODE.JS & TYPESCRIPT'));
    assert.ok(conventions.includes("import * as fs from \"node:fs\";"));
    assert.ok(conventions.includes("import * as path from \"node:path\";"));
    assert.ok(conventions.includes("import * as http from \"node:http\";"));
    assert.ok(conventions.includes("import assert from \"node:assert/strict\";"));
    assert.ok(conventions.includes("npm run build"));
  });

  it('4. EngineeringContextService.prepareTaskContext: injeta Princípio 7 de interoperabilidade Node/TS', () => {
    const projectDir = path.join(tempProjectsDir, 'karpathy-pkg-project');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'karpathy-proj', type: 'module' }, null, 2)
    );

    const pkg = EngineeringContextService.prepareTaskContext({
      projectPath: projectDir,
      projectName: 'KarpathyProject',
      projectObjective: 'Testar injeção de diretrizes',
      task: {
        title: 'Criar endpoints de teste',
        verificationCommand: 'npm test'
      }
    });

    assert.ok(pkg.formattedPromptBlock.includes('7. NODE/TYPESCRIPT & ESM INTEROP:'));
    assert.ok(pkg.formattedPromptBlock.includes('import * as fs from "node:fs"'));
  });

  it('5. PromptArchitectureService.buildWorkerPrompt: injeta convenções canônicas nos modos IMPLEMENT e TEST', () => {
    const implementPrompt = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: 'proj-1',
      projectName: 'ProjectTest',
      projectPath: '/test',
      taskTitle: 'Implementar CRUD',
      verificationCommand: 'npm test'
    });

    assert.ok(implementPrompt.prompt.includes('import * as fs from "node:fs"'));
    assert.ok(implementPrompt.prompt.includes('import * as path from "node:path"'));

    const testPrompt = PromptArchitectureService.buildWorkerPrompt({
      mode: 'TEST',
      projectId: 'proj-1',
      projectName: 'ProjectTest',
      projectPath: '/test',
      taskTitle: 'Implementar testes de integração',
      verificationCommand: 'npm test'
    });

    assert.ok(testPrompt.prompt.includes('CONVENÇÃO CANÔNICA DE IMPORTS TYPESCRIPT / NODE.JS'));
    assert.ok(testPrompt.prompt.includes("import * as fs from 'node:fs';"));
    assert.ok(testPrompt.prompt.includes("import assert from 'node:assert/strict';"));
  });

  it('6. DagAutoHealer: hierarquia de camadas preserva ordem topológica estrita (Setup -> DB -> Domínio -> API -> UI -> E2E -> Auditoria/Entrega)', () => {
    const tasks = [
      { id: 't-audit', title: 'Executar auditoria de segurança, blindagem contra Path Traversal e entrega final', dependencies: ['t-e2e'] },
      { id: 't-e2e', title: 'Implementar testes de ponta a ponta (E2E) simulando jornada completa do usuário', dependencies: ['t-ui'] },
      { id: 't-ui', title: 'Construir interface e tela de dashboard do usuário', dependencies: ['t-api'] },
      { id: 't-api', title: 'Implementar rotas de API e endpoints REST de entidades', dependencies: ['t-domain'] },
      { id: 't-domain', title: 'Implementar testes unitários do motor de domínio e regras de cálculo', dependencies: ['t-db'] },
      { id: 't-db', title: 'Criar schema de banco de dados e migrations SQLite', dependencies: ['t-init'] },
      { id: 't-init', title: 'Scaffold e setup inicial do projeto com package.json', dependencies: [] }
    ];

    const healed = DagAutoHealer.autoHealAndNormalizeTaskGraph(tasks);
    assert.equal(healed.length, 7);

    // As ondas devem ser estritamente crescentes
    const initTask = healed.find(t => t.id === 't-init');
    const dbTask = healed.find(t => t.id === 't-db');
    const domainTask = healed.find(t => t.id === 't-domain');
    const apiTask = healed.find(t => t.id === 't-api');
    const uiTask = healed.find(t => t.id === 't-ui');
    const e2eTask = healed.find(t => t.id === 't-e2e');
    const auditTask = healed.find(t => t.id === 't-audit');

    assert.ok((initTask?.waveIndex || 0) < (dbTask?.waveIndex || 0));
    assert.ok((dbTask?.waveIndex || 0) < (domainTask?.waveIndex || 0));
    assert.ok((domainTask?.waveIndex || 0) < (apiTask?.waveIndex || 0));
    assert.ok((apiTask?.waveIndex || 0) < (uiTask?.waveIndex || 0));
    assert.ok((uiTask?.waveIndex || 0) < (e2eTask?.waveIndex || 0));
    assert.ok((e2eTask?.waveIndex || 0) < (auditTask?.waveIndex || 0));
  });
});
