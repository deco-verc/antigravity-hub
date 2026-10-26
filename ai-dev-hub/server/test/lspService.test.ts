import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LspService } from '../src/lspService.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';

describe('FASE 2: LspService & Integração de Diagnósticos Sintáticos em Tempo Real', () => {
  let tempDir: string;
  let validTsFile: string;
  let invalidTsFile: string;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-lsp-test-'));

    validTsFile = path.join(tempDir, 'validModule.ts');
    fs.writeFileSync(validTsFile, `
export function addNumbers(a: number, b: number): number {
  return a + b;
}
export const result = addNumbers(10, 20);
`.trim());

    invalidTsFile = path.join(tempDir, 'invalidSyntax.ts');
    fs.writeFileSync(invalidTsFile, `
export function brokenFunction( {
  return ;;;
const x: number = "texto invalido";
`.trim());

    LspService.setProjectPath(tempDir);
  });

  after(() => {
    LspService.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. LspService: Arquivo válido retorna zero erros de sintaxe', async () => {
    const diags = await LspService.getDiagnostics(validTsFile);
    const errors = diags.filter(d => d.severity === 'error');
    assert.equal(errors.length, 0, 'Arquivo válido não deve possuir erros de sintaxe impeditivos');
  });

  it('2. LspService: Arquivo com sintaxe quebrada retorna erros com linha, mensagem e severidade', async () => {
    const diags = await LspService.getDiagnostics(invalidTsFile);
    assert.ok(diags.length > 0, 'Deve identificar erros sintáticos no arquivo quebrado');
    const firstError = diags.find(d => d.severity === 'error');
    assert.ok(firstError, 'Deve possuir ao menos 1 erro de severidade "error"');
    assert.ok(typeof firstError.line === 'number' && firstError.line >= 1);
    assert.ok(typeof firstError.message === 'string' && firstError.message.length > 0);
  });

  it('3. LspService: getDefinition navega para a definição correta do símbolo', async () => {
    const def = await LspService.getDefinition(validTsFile, 4, 25);
    assert.ok(def, 'Deve retornar a localização da definição');
    assert.ok(def.includes('validModule.ts'));
  });

  it('4. LspService: findReferences localiza as referências do símbolo no arquivo', async () => {
    const refs = await LspService.findReferences(validTsFile, 1, 17);
    assert.ok(Array.isArray(refs));
    assert.ok(refs.length >= 1, 'Deve encontrar ao menos a própria declaração como referência');
  });

  it('5. WorkerRegistry: Workers criados possuem capability "lsp" por padrão', () => {
    const worker = WorkerRegistry.createWorker({
      name: 'Builder com Suporte LSP',
      environment: 'local'
    });

    assert.ok(worker.capabilities.includes('lsp'), 'Worker deve possuir capability lsp por padrão');
    const lspWorkers = WorkerRegistry.getLspCapableWorkers();
    assert.ok(lspWorkers.some(w => w.id === worker.id));
    assert.equal(WorkerRegistry.hasCapability(worker.id, 'lsp'), true);
  });

  it('6. PromptArchitectureService: Worker prompt incorpora instrução lsp_diagnostics e regras permanentes', () => {
    const built = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: 'proj-lsp',
      projectName: 'Projeto LSP',
      projectPath: tempDir,
      projectObjective: 'Testar integração LSP',
      taskId: 'task-lsp-1',
      taskTitle: 'Implementar validação sintática',
      acceptanceCriteria: ['Validar com LSP'],
      lspDiagnosticsSnippet: '[LSP_ERROR] file.ts:12 - Identifier expected'
    });

    assert.ok(built.prompt.includes('lsp_diagnostics'), 'Prompt do worker deve mencionar a ferramenta lsp_diagnostics');
    assert.ok(built.prompt.includes('Identifier expected'), 'Snippet factual de diagnóstico deve estar presente no prompt');
    assert.ok(built.prompt.includes('INSPEÇÃO SINTÁTICA E DIAGNÓSTICO LSP'), 'Regra permanente de LSP deve estar presente');
  });

  it('7. LspService: getDiagnosticsDirect com esModuleInterop não emite erro falso TS1259 em import default de assert/strict', () => {
    const testFile = path.join(tempDir, 'assertTest.ts');
    fs.writeFileSync(testFile, `
import assert from "node:assert/strict";
export function testSomething(): void {
  assert.equal(1 + 1, 2);
}
`.trim());

    const diags = LspService.getDiagnosticsDirect(testFile);
    const ts1259Error = diags.find(d => d.code === 1259 || /esModuleInterop/i.test(d.message));
    assert.strictEqual(ts1259Error, undefined, 'Não deve emitir erro TS1259 de esModuleInterop no motor de diagnósticos diretos');
  });

  it('8. LspService: getDiagnosticsDirect com ESM não emite erro falso TS1343 em import.meta.url', () => {
    const metaFile = path.join(tempDir, 'metaTest.ts');
    fs.writeFileSync(metaFile, `
export const currentUrl = import.meta.url;
export function getUrl(): string {
  return currentUrl;
}
`.trim());

    const diags = LspService.getDiagnosticsDirect(metaFile);
    const ts1343Error = diags.find(d => d.code === 1343 || /import\.meta/i.test(d.message));
    assert.strictEqual(ts1343Error, undefined, 'Não deve emitir erro TS1343 de import.meta no motor de diagnósticos diretos');
  });

  it('9. LspService: getDiagnosticsDirect com allowImportingTsExtensions não emite erro falso TS5097 em import relativo .ts', () => {
    const helperFile = path.join(tempDir, 'helper.ts');
    fs.writeFileSync(helperFile, 'export const helperConst = 42;');

    const consumerFile = path.join(tempDir, 'consumer.ts');
    fs.writeFileSync(consumerFile, `
import { helperConst } from "./helper.ts";
export const total = helperConst + 10;
`.trim());

    const diags = LspService.getDiagnosticsDirect(consumerFile);
    const ts5097Error = diags.find(d => d.code === 5097 || /allowImportingTsExtensions/i.test(d.message));
    assert.strictEqual(ts5097Error, undefined, 'Não deve emitir erro TS5097 de allowImportingTsExtensions');
  });
});
