import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { db } from '../src/db.js';

test('Protection of Acceptance Criteria & Anti-Weakening Guard Suite', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-test-protection-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  t.after(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "testProtection.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:testProtection.test]", err);
      }
    }
  });

  await t.test('1. Assertion counter correctly parses assertions and ignores comments', () => {
    const code = `
      // assert.ok(false);
      /* assert.strictEqual(1, 2); */
      * assert.deepStrictEqual(a, b)
      assert.strictEqual(result.total, 100);
      assert.ok(result.valid);
      assert(result.status === 'ok');
      expect(result.items).toHaveLength(3);
    `;

    const count = IndependentEvaluator.countAssertions(code);
    assert.strictEqual(count, 4, 'Deve contar apenas asserções ativas, ignorando comentários');
  });

  await t.test('2. Skipped and disabled tests detection', () => {
    const codeWithSkip = `
      test('deve calcular soma', () => {
        assert.strictEqual(add(1, 2), 3);
      });
      test.skip('deve calcular juros complexos', () => {
        assert.strictEqual(calc(100), 110);
      });
      xit('deve estornar pagamento', () => {
        assert.ok(true);
      });
      // assert.strictEqual(failingCase(), true);
    `;

    const skipped = IndependentEvaluator.detectSkippedTests(codeWithSkip);
    assert.strictEqual(skipped.length, 3, 'Deve identificar test.skip, xit e asserção comentada');
    assert.ok(skipped.some(s => s.includes('test.skip')));
    assert.ok(skipped.some(s => s.includes('xit')));
    assert.ok(skipped.some(s => s.includes('asserção comentada')));
  });

  await t.test('3. Trivial and tautological assertions detection', () => {
    const codeWithTrivial = `
      test('teste mascarado', () => {
        assert.ok(true);
        expect(true).toBe(true);
        assert.strictEqual(1, 1);
      });
    `;

    const trivial = IndependentEvaluator.detectTrivialAssertions(codeWithTrivial);
    assert.strictEqual(trivial.length, 3, 'Deve identificar todas as asserções tautológicas que não validam nada');
  });

  await t.test('4. NEGATIVE TEST: Worker removes assertions from existing test file -> TAMPERING_DETECTED', () => {
    const projDir = path.join(tmpRoot, 'proj-weakened-assertions');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    // Initialize git repo
    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const originalTestContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');

      test('validar calculo rigoroso', () => {
        assert.strictEqual(1 + 1, 2);
        assert.strictEqual(2 * 3, 6);
        assert.strictEqual(10 / 2, 5);
        assert.ok(true !== false);
      });
    `;
    const testFile = path.join(projDir, 'test', 'calc.test.js');
    fs.writeFileSync(testFile, originalTestContent);
    execSync('git add . && git commit -m "commit inicial com testes rigorosos"', { cwd: projDir, stdio: 'ignore' });

    // Worker modifies file, removing 3 of the 4 assertions
    const weakenedTestContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');

      test('validar calculo rigoroso', () => {
        assert.strictEqual(1 + 1, 2);
      });
    `;
    fs.writeFileSync(testFile, weakenedTestContent);

    const analysis = IndependentEvaluator.detectTestWeakening(projDir, ['test/calc.test.js']);
    assert.strictEqual(analysis.isWeakened, true, 'Deve identificar enfraquecimento de asserções');
    assert.strictEqual(analysis.findings.length, 1);
    assert.strictEqual(analysis.findings[0].assertionsBefore, 4);
    assert.strictEqual(analysis.findings[0].assertionsAfter, 1);
    assert.strictEqual(analysis.findings[0].removedAssertionsCount, 3);
  });

  await t.test('5. NEGATIVE TEST: Worker introduces .skip in failing test -> TAMPERING_DETECTED', () => {
    const projDir = path.join(tmpRoot, 'proj-weakened-skip');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const originalContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');

      test('cenario critico', () => {
        assert.strictEqual(10, 10);
      });
    `;
    const testFile = path.join(projDir, 'test', 'core.test.js');
    fs.writeFileSync(testFile, originalContent);
    execSync('git add . && git commit -m "teste original"', { cwd: projDir, stdio: 'ignore' });

    // Worker adds .skip to bypass failure
    const skippedContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');

      test.skip('cenario critico', () => {
        assert.strictEqual(10, 10);
      });
    `;
    fs.writeFileSync(testFile, skippedContent);

    const analysis = IndependentEvaluator.detectTestWeakening(projDir, ['test/core.test.js']);
    assert.strictEqual(analysis.isWeakened, true, 'Deve detectar inserção de .skip');
    assert.ok(analysis.reason?.includes('.skip'));
  });

  await t.test('6. NEGATIVE TEST: Worker replaces failed test with assert.ok(true) trivialization -> TAMPERING_DETECTED', () => {
    const projDir = path.join(tmpRoot, 'proj-weakened-trivial');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const originalContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');

      test('validar calculo de juros', () => {
        assert.strictEqual(calcularJuros(100), 105);
      });
    `;
    const testFile = path.join(projDir, 'test', 'juros.test.js');
    fs.writeFileSync(testFile, originalContent);
    execSync('git add . && git commit -m "teste original"', { cwd: projDir, stdio: 'ignore' });

    // Worker replaces assertion with assert.ok(true)
    const trivialContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');

      test('validar calculo de juros', () => {
        assert.ok(true);
      });
    `;
    fs.writeFileSync(testFile, trivialContent);

    const analysis = IndependentEvaluator.detectTestWeakening(projDir, ['test/juros.test.js']);
    assert.strictEqual(analysis.isWeakened, true, 'Deve identificar asserção trivializada');
    assert.ok(analysis.findings[0].description.includes('Asserções triviais ou tautológicas'));
  });

  await t.test('7. POSITIVE TEST: Legitimate fix adding new test cases or keeping original intact -> PASS', () => {
    const projDir = path.join(tmpRoot, 'proj-legitimate-fix');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const originalContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');

      test('teste base', () => {
        assert.strictEqual(1, 1);
      });
    `;
    const testFile = path.join(projDir, 'test', 'base.test.js');
    fs.writeFileSync(testFile, originalContent);
    execSync('git add . && git commit -m "base"', { cwd: projDir, stdio: 'ignore' });

    // Worker fixes code and expands tests legitimately
    const enhancedContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');

      test('teste base', () => {
        assert.strictEqual(1, 1);
      });

      test('novo cenario coberto', () => {
        assert.strictEqual(2 + 2, 4);
        assert.strictEqual(3 * 3, 9);
      });
    `;
    fs.writeFileSync(testFile, enhancedContent);

    const analysis = IndependentEvaluator.detectTestWeakening(projDir, ['test/base.test.js']);
    assert.strictEqual(analysis.isWeakened, false, 'Não deve classificar expansão legítima de testes como enfraquecimento');
  });

  await t.test('8. Full IndependentEvaluator.evaluate rejects weakening with TAMPERING_DETECTED', async () => {
    const projDir = path.join(tmpRoot, 'proj-eval-integration');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const originalContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');
      test('teste rigoroso', () => {
        assert.strictEqual(10, 10);
        assert.strictEqual(20, 20);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'rigorous.test.js'), originalContent);
    execSync('git add . && git commit -m "init"', { cwd: projDir, stdio: 'ignore' });

    // Create a success contract in database
    const contract = IndependentEvaluator.createSuccessContract({
      taskId: 'task-test-weakening-guard',
      runId: 'run-test-guard',
      projectId: 'proj-guard',
      projectPath: projDir,
      objective: 'Implementar funcionalidade sem adulterar testes',
      acceptanceCriteria: ['Todos os testes preservados'],
      verificationSteps: [{ step: 1, command: 'node --test test/rigorous.test.js', expectedOutcome: 'PASS' }],
      protectedEvaluationFiles: []
    });

    // Worker weakens the test
    fs.writeFileSync(
      path.join(projDir, 'test', 'rigorous.test.js'),
      `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');
      test.skip('teste rigoroso', () => {
        assert.strictEqual(10, 10);
      });
      `
    );

    const evalResult = await IndependentEvaluator.evaluate(contract.id, projDir, {
      status: 'success',
      filesChanged: ['test/rigorous.test.js']
    });

    assert.strictEqual(evalResult.verdict, 'TAMPERING_DETECTED', 'Evaluator deve rejeitar enfraquecimento com TAMPERING_DETECTED');
    assert.strictEqual(evalResult.taskIsDone, false, 'Tarefa não pode ser marcada como concluída');
    assert.ok(evalResult.evidence.tamperingDetected, 'Evidência de adulteração deve estar true');
  });

  await t.test('9. POSITIVE TEST: Test file migration from JavaScript to TypeScript (.js -> .ts) with preserved assertions -> PASS', () => {
    const projDir = path.join(tmpRoot, 'proj-ts-migration');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const originalJsContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');
      test('teste legado em JS', () => {
        const port = 8080;
        assert.strictEqual(port, 8080);
        const status = 'healthy';
        assert.strictEqual(status, 'healthy');
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'types.test.js'), originalJsContent);
    execSync('git add . && git commit -m "add legacy js test"', { cwd: projDir, stdio: 'ignore' });

    // Worker migrates test/types.test.js to test/types.test.ts with typed assertions preserved
    fs.unlinkSync(path.join(projDir, 'test', 'types.test.js'));
    const migratedTsContent = `
      import assert from 'node:assert/strict';
      import { test } from 'node:test';
      test('teste migrado para TypeScript', () => {
        const port: number = 8080;
        assert.strictEqual(port, 8080);
        const status: string = 'healthy';
        assert.strictEqual(status, 'healthy');
        const active: boolean = true;
        assert.strictEqual(active, true);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'types.test.ts'), migratedTsContent);

    const analysis = IndependentEvaluator.detectTestWeakening(projDir, ['test/types.test.js', 'test/types.test.ts']);
    assert.strictEqual(analysis.isWeakened, false, 'Migração válida para TypeScript não deve disparar TAMPERING_DETECTED');
    assert.strictEqual(analysis.findings.length, 0, 'Zero violações quando asserções forem preservadas');
  });

  await t.test('10. POSITIVE TEST: Initial scaffolding milestone task creating package.json, tsconfig.json and .gitignore -> PASS', async () => {
    const projDir = path.join(tmpRoot, 'proj-scaffolding-m1');
    fs.mkdirSync(projDir, { recursive: true });

    // Create root scaffolding files
    fs.writeFileSync(
      path.join(projDir, 'package.json'),
      JSON.stringify({ name: 'youtube-viral-search-2', version: '1.0.0', type: 'module' }, null, 2)
    );
    fs.writeFileSync(
      path.join(projDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', strict: true } }, null, 2)
    );
    fs.writeFileSync(path.join(projDir, '.gitignore'), 'node_modules\ndist\n.env\n');

    const contract = IndependentEvaluator.createSuccessContract({
      taskId: 'task-scaffold-01',
      runId: 'run-scaffold',
      projectId: 'proj-scaffold',
      projectPath: projDir,
      objective: 'Configurar estrutura de pastas, dependências rigorosas e tsconfig strict de YoutubeViralSearch2',
      acceptanceCriteria: [
        'Configurar package.json com dependências e tsconfig strict',
        'Configurar .gitignore inicial'
      ],
      verificationSteps: [
        {
          step: 1,
          name: 'Verificar arquivos de estrutura inicial',
          command: 'node -e "process.exit(0)"',
          expectedOutcome: 'PASS'
        }
      ],
      protectedEvaluationFiles: []
    });

    const evalResult = await IndependentEvaluator.evaluate(contract.id, projDir, {
      status: 'success',
      filesChanged: ['package.json', 'tsconfig.json', '.gitignore']
    });

    assert.notStrictEqual(evalResult.verdict, 'INCONCLUSIVE', 'Scaffolding legítimo não deve ser reprovado como INCONCLUSIVE');
    assert.strictEqual(evalResult.verdict, 'PASS', 'Tarefa de scaffolding deve ser aprovada');
    assert.strictEqual(evalResult.taskIsDone, true, 'taskIsDone deve ser true');
    assert.ok(evalResult.evidence.filesChanged?.includes('package.json'));
  });

  await t.test('11. POSITIVE TEST: checkTampering allows protected test file migration to TypeScript (.js -> .ts) with equal or more assertions', () => {
    const projDir = path.join(tmpRoot, 'proj-check-tamper-ts-ok');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const jsContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');
      test('teste legado', () => {
        assert.strictEqual(1, 1);
        assert.strictEqual(2, 2);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'core.test.js'), jsContent);
    execSync('git add . && git commit -m "commit initial test"', { cwd: projDir, stdio: 'ignore' });

    const contract = IndependentEvaluator.createSuccessContract({
      taskId: 'task-prot-migration-ok',
      projectId: 'proj-prot-mig-ok',
      projectPath: projDir,
      objective: 'Migrar testes para TypeScript mantendo proteções',
      acceptanceCriteria: ['Testes migrados com rigor'],
      protectedEvaluationFiles: ['test/core.test.js']
    });

    // Worker migrates file: deletes .js, creates .ts with same/more assertions
    fs.unlinkSync(path.join(projDir, 'test', 'core.test.js'));
    const tsContent = `
      import assert from 'node:assert/strict';
      import { test } from 'node:test';
      test('teste migrado', () => {
        assert.strictEqual(1, 1);
        assert.strictEqual(2, 2);
        assert.strictEqual(3, 3);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'core.test.ts'), tsContent);

    const check = IndependentEvaluator.checkTampering(contract, projDir, ['test/core.test.js', 'test/core.test.ts']);
    assert.strictEqual(check.tampered, false, 'Migração para TypeScript preservando asserções não deve ser considerada tampering');
    assert.strictEqual(check.tamperedFiles.length, 0);
  });

  await t.test('12. NEGATIVE TEST: checkTampering flags tampering if protected test file is migrated to TypeScript but assertions are dropped', () => {
    const projDir = path.join(tmpRoot, 'proj-check-tamper-ts-weakened');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const jsContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');
      test('teste rigoroso protegido', () => {
        assert.strictEqual(10, 10);
        assert.strictEqual(20, 20);
        assert.strictEqual(30, 30);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'strict.test.js'), jsContent);
    execSync('git add . && git commit -m "commit initial strict test"', { cwd: projDir, stdio: 'ignore' });

    const contract = IndependentEvaluator.createSuccessContract({
      taskId: 'task-prot-migration-weak',
      projectId: 'proj-prot-mig-weak',
      projectPath: projDir,
      objective: 'Adulterar testes na migração',
      acceptanceCriteria: ['N/A'],
      protectedEvaluationFiles: ['test/strict.test.js']
    });

    // Worker migrates but drops assertions from 3 to 1
    fs.unlinkSync(path.join(projDir, 'test', 'strict.test.js'));
    const tsContentWeak = `
      import assert from 'node:assert/strict';
      import { test } from 'node:test';
      test('teste enfraquecido', () => {
        assert.strictEqual(10, 10);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'strict.test.ts'), tsContentWeak);

    const check = IndependentEvaluator.checkTampering(contract, projDir, ['test/strict.test.js', 'test/strict.test.ts']);
    assert.strictEqual(check.tampered, true, 'checkTampering deve barrar migração que derrubou asserções de 3 para 1');
    assert.ok(check.tamperedFiles.includes('test/strict.test.js'));
  });

  await t.test('13. POSITIVE TEST: detectTestWeakening parses git rename lines (R  old -> new) gracefully', () => {
    const projDir = path.join(tmpRoot, 'proj-rename-syntax');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const jsContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');
      test('teste', () => {
        const sum = 1 + 2;
        assert.strictEqual(sum, 3);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'sample.test.js'), jsContent);
    execSync('git add . && git commit -m "init"', { cwd: projDir, stdio: 'ignore' });

    // Staged rename via git mv
    execSync('git mv test/sample.test.js test/sample.test.ts', { cwd: projDir, stdio: 'ignore' });

    const analysis = IndependentEvaluator.detectTestWeakening(projDir, []);
    assert.strictEqual(analysis.isWeakened, false, 'Staged git rename não deve causar erro de parsing nem falso positivo de teste removido');
  });

  await t.test('14. POSITIVE TEST: countAssertions correctly handles multiline expect, expectType, assertType, and runner context', () => {
    const code = `
      // Multiline expect
      expect(
        calculateBreakdown('v123')
      ).toEqual({
        title: 'Viral Video',
        views: 1000000
      });

      // TypeScript type testing assertions
      expectType<VideoBreakdown>(breakdown);
      assertType<VideoMetadata>(meta);

      // Node:test runner context assertions
      t.assert.strictEqual(status, 'completed');
      t.is(count, 42);

      // Chai / BDD Should
      video.should.have.property('id');
    `;

    const count = IndependentEvaluator.countAssertions(code);
    assert.strictEqual(count, 6, 'Deve contar todas as asserções multiline, de tipo e de contexto runner');
  });

  await t.test('15. POSITIVE TEST: Migration to alternate naming (.test.js -> .spec.ts or .ts) without git rename staging is smoothly resolved', () => {
    const projDir = path.join(tmpRoot, 'proj-alt-name-mig');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const jsContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');
      test('teste legado', () => {
        assert.strictEqual(1, 1);
        assert.strictEqual(2, 2);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'types.test.js'), jsContent);
    execSync('git add . && git commit -m "initial commit"', { cwd: projDir, stdio: 'ignore' });

    // Worker creates test/types.ts directly and unlinks types.test.js
    fs.unlinkSync(path.join(projDir, 'test', 'types.test.js'));
    const tsContent = `
      import assert from 'node:assert/strict';
      import { test } from 'node:test';
      test('teste migrado para types.ts', () => {
        assert.strictEqual(1, 1);
        assert.strictEqual(2, 2);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'types.ts'), tsContent);

    const analysis = IndependentEvaluator.detectTestWeakening(projDir, ['test/types.test.js', 'test/types.ts']);
    assert.strictEqual(analysis.isWeakened, false, 'Migração para test/types.ts com asserções preservadas deve ser aceita');
    assert.strictEqual(analysis.findings.length, 0);
  });

  await t.test('16. POSITIVE TEST: TypeScript migration with type casts/annotations preserved does not fail line-by-line comparison', () => {
    const projDir = path.join(tmpRoot, 'proj-ts-types-mig');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const jsContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');
      test('validar video', () => {
        assert.strictEqual(video.id, 'abc');
        assert.strictEqual(video.duration, 120);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'video.test.js'), jsContent);
    execSync('git add . && git commit -m "js version"', { cwd: projDir, stdio: 'ignore' });

    // Worker creates video.test.ts with TypeScript type annotations and casts on assertion lines
    fs.unlinkSync(path.join(projDir, 'test', 'video.test.js'));
    const tsContent = `
      import assert from 'node:assert/strict';
      import { test } from 'node:test';
      test('validar video typed', () => {
        assert.strictEqual((video.id as string), "abc");
        assert.strictEqual(Number(video.duration), 120);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'video.test.ts'), tsContent);

    const analysis = IndependentEvaluator.detectTestWeakening(projDir, ['test/video.test.js', 'test/video.test.ts']);
    assert.strictEqual(analysis.isWeakened, false, 'Não deve falhar como adulteração de linha original em migração TS');
    assert.strictEqual(analysis.findings.length, 0);
  });

  await t.test('17. NEGATIVE TEST: Migrated file with reduced assertions accurately reports reduction rather than stating file was removed', () => {
    const projDir = path.join(tmpRoot, 'proj-reduced-mig');
    fs.mkdirSync(path.join(projDir, 'test'), { recursive: true });

    execSync('git init -b main', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: projDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: projDir, stdio: 'ignore' });

    const jsContent = `
      const assert = require('node:assert/strict');
      const { test } = require('node:test');
      test('muitas assercoes', () => {
        assert.strictEqual(1, 1);
        assert.strictEqual(2, 2);
        assert.strictEqual(3, 3);
        assert.strictEqual(4, 4);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'multi.test.js'), jsContent);
    execSync('git add . && git commit -m "4 assertions"', { cwd: projDir, stdio: 'ignore' });

    // Worker creates multi.test.ts but only with 2 assertions
    fs.unlinkSync(path.join(projDir, 'test', 'multi.test.js'));
    const tsContent = `
      import assert from 'node:assert/strict';
      import { test } from 'node:test';
      test('poucas assercoes', () => {
        assert.strictEqual(1, 1);
        assert.strictEqual(2, 2);
      });
    `;
    fs.writeFileSync(path.join(projDir, 'test', 'multi.test.ts'), tsContent);

    const analysis = IndependentEvaluator.detectTestWeakening(projDir, ['test/multi.test.js', 'test/multi.test.ts']);
    assert.strictEqual(analysis.isWeakened, true, 'Deve detectar redução de asserções');
    assert.strictEqual(analysis.findings.length, 1);
    const finding = analysis.findings[0];
    assert.strictEqual(finding.assertionsBefore, 4);
    assert.strictEqual(finding.assertionsAfter, 2);
    assert.ok(finding.description.includes('Migração de teste com redução indevida de asserções em test/multi.test.ts'), 'Deve descrever com precisão que o arquivo migrado existe com redução');
    assert.ok(!finding.description.includes('foi removido'), 'Não deve reportar falsamente que o arquivo foi removido');
  });
});
