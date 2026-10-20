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
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "testProtection.test",
          error: err?.message || String(err)
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
});
