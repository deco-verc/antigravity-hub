import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  AstSymbolIndexService
} from '../src/astSymbolIndexService.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { db } from '../src/db.js';

describe('FASE 5: AstSymbolIndexService & Proteção Anti-Context-Rot', () => {
  let tempDir: string;
  let srcDir: string;
  let testProjectId = 'test-proj-ast-01';

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-ast-test-'));
    srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // File 1: TypeScript Service with classes, functions, interfaces, types
    fs.writeFileSync(
      path.join(srcDir, 'authService.ts'),
      `export interface UserSession {\n  userId: string;\n  role: 'admin' | 'user';\n  expiresAt: number;\n}\n\nexport type AuthStatus = 'AUTHENTICATED' | 'ANONYMOUS';\n\nexport enum UserRole {\n  ADMIN = 'ADMIN',\n  USER = 'USER'\n}\n\nexport const TOKEN_EXPIRY_MS: number = 3600000;\n\nexport async function loginUser(email: string, pass: string): Promise<UserSession> {\n  return { userId: '1', role: 'admin', expiresAt: Date.now() + TOKEN_EXPIRY_MS };\n}\n\nexport class AuthManager {\n  private secretKey: string = 'secret';\n  public static instance(): AuthManager {\n    return new AuthManager();\n  }\n  public verifyToken(token: string): boolean {\n    return true;\n  }\n}\n`
    );

    // File 2: CommonJS / JS service
    fs.writeFileSync(
      path.join(srcDir, 'calculator.js'),
      `exports.add = function(a, b) {\n  return a + b;\n};\n\nexports.multiply = (a, b) => a * b;\n`
    );
  });

  after(() => {
    try {
      db.prepare('DELETE FROM project_ast_symbols WHERE project_id = ?').run(testProjectId);
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. extractSymbols: Extrai com precisão funções, classes, métodos, interfaces, tipos e enums', () => {
    const code = fs.readFileSync(path.join(srcDir, 'authService.ts'), 'utf8');
    const symbols = AstSymbolIndexService.extractSymbols(code, 'authService.ts');

    assert.ok(symbols.length >= 6, `Deve extrair ao menos 6 símbolos, obteve ${symbols.length}`);

    const ifaceSym = symbols.find(s => s.symbolName === 'UserSession');
    assert.ok(ifaceSym, 'Deve extrair interface UserSession');
    assert.equal(ifaceSym?.symbolType, 'interface');
    assert.equal(ifaceSym?.exports, true);

    const typeSym = symbols.find(s => s.symbolName === 'AuthStatus');
    assert.ok(typeSym, 'Deve extrair type AuthStatus');
    assert.equal(typeSym?.symbolType, 'type');

    const enumSym = symbols.find(s => s.symbolName === 'UserRole');
    assert.ok(enumSym, 'Deve extrair enum UserRole');
    assert.equal(enumSym?.symbolType, 'enum');

    const constSym = symbols.find(s => s.symbolName === 'TOKEN_EXPIRY_MS');
    assert.ok(constSym, 'Deve extrair const TOKEN_EXPIRY_MS');

    const fnSym = symbols.find(s => s.symbolName === 'loginUser');
    assert.ok(fnSym, 'Deve extrair function loginUser');
    assert.equal(fnSym?.symbolType, 'function');
    assert.ok(fnSym?.signature.includes('loginUser(email: string, pass: string)'));

    const classSym = symbols.find(s => s.symbolName === 'AuthManager');
    assert.ok(classSym, 'Deve extrair class AuthManager');
    assert.equal(classSym?.symbolType, 'class');

    const methodSym = symbols.find(s => s.symbolName === 'AuthManager.verifyToken');
    assert.ok(methodSym, 'Deve extrair método público AuthManager.verifyToken');
    assert.equal(methodSym?.symbolType, 'method');
  });

  it('2. updateIndexForFile & querySymbols: Persiste e consulta símbolos em SQLite com integridade', () => {
    const indexed = AstSymbolIndexService.updateIndexForFile(
      testProjectId,
      tempDir,
      'src/authService.ts'
    );

    assert.ok(indexed.length >= 6);

    const queryAll = AstSymbolIndexService.querySymbols({
      projectId: testProjectId
    });
    assert.equal(queryAll.length, indexed.length);

    const queryFunctions = AstSymbolIndexService.querySymbols({
      projectId: testProjectId,
      symbolTypes: ['function']
    });
    assert.ok(queryFunctions.some(f => f.symbolName === 'loginUser'));

    const querySearch = AstSymbolIndexService.querySymbols({
      projectId: testProjectId,
      query: 'AuthManager'
    });
    assert.ok(querySearch.length >= 1);
  });

  it('3. indexProjectFiles: Realiza varredura recursiva de arquivos de projeto e atualiza o índice', async () => {
    const res = await AstSymbolIndexService.indexProjectFiles(testProjectId, tempDir);
    assert.equal(res.indexedFiles, 2, 'Deve ter indexado os 2 arquivos criados');
    assert.ok(res.totalSymbols >= 8, 'Deve conter ao menos 8 símbolos indexados');

    const count = AstSymbolIndexService.getProjectSymbolCount(testProjectId);
    assert.equal(count, res.totalSymbols);
  });

  it('4. generateStructuredSymbolSummary: Gera resumo condensado de assinaturas protegendo contra Context Rot', () => {
    const summary = AstSymbolIndexService.generateStructuredSymbolSummary(testProjectId, {
      projectPath: tempDir,
      maxChars: 4000
    });

    assert.ok(summary.includes('### [ESTRUTURA DE MÓDULOS E SÍMBOLOS EXPORTADOS (AST Symbol Index)]'));
    assert.ok(summary.includes('src/authService.ts'));
    assert.ok(summary.includes('loginUser'));
    assert.ok(summary.includes('UserSession'));
    assert.ok(summary.length < 4000, 'Resumo deve respeitar estritamente o orçamento de caracteres');
  });

  it('5. Integração com buildWorkerPrompt: Injeta o resumo estruturado e preserva o teto de tokens do modelo', () => {
    const { prompt, meta } = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: testProjectId,
      projectName: 'Test Project',
      projectPath: tempDir,
      projectObjective: 'Testar proteção contra context rot',
      taskId: 'task-ast-worker',
      taskTitle: 'Implementar rota de login utilizando AuthService',
      taskDescription: 'Consumir AuthService.loginUser',
      acceptanceCriteria: ['Deve usar UserSession exportado'],
      expectedScopeFiles: ['src/authService.ts'],
      verificationCommand: 'npm test'
    });

    assert.ok(prompt.includes('ESTRUTURA DE MÓDULOS E SÍMBOLOS EXPORTADOS'), 'Prompt deve conter bloco AST Symbol Index');
    assert.ok(prompt.includes('loginUser'), 'Prompt deve conter assinatura da função sem alucinação');
    assert.ok(prompt.length < PromptArchitectureService.MAX_SAFE_PROMPT_CHARS, 'Prompt deve respeitar orçamento de 24.000 chars');
    assert.equal(meta.role, 'WORKER');
  });

  it('6. Atualização Automática: Remove símbolos ao excluir arquivo e atualiza ao modificar código', () => {
    // Atualizar authService.ts com menos símbolos
    const minimalCode = `export function minimalHelper(): void {}\n`;
    fs.writeFileSync(path.join(srcDir, 'authService.ts'), minimalCode);

    const updated = AstSymbolIndexService.updateIndexForFile(testProjectId, tempDir, 'src/authService.ts');
    assert.equal(updated.length, 1);
    assert.equal(updated[0].symbolName, 'minimalHelper');

    // Remover arquivo calculator.js
    fs.unlinkSync(path.join(srcDir, 'calculator.js'));
    AstSymbolIndexService.updateIndexForFile(testProjectId, tempDir, 'src/calculator.js');

    const calcs = AstSymbolIndexService.querySymbols({
      projectId: testProjectId,
      filePaths: ['src/calculator.js']
    });
    assert.equal(calcs.length, 0, 'Símbolos do arquivo excluído devem ter sido removidos');
  });
});
