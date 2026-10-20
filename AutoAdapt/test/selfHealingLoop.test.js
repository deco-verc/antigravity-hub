import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseTestOutput,
  diagnoseFailure,
  verifyTestSuiteIntegrity,
  runSelfHealingLoop,
  FailureTypes,
  MAX_ALLOWED_ITERATIONS
} from '../src/selfHealingLoop.js';

describe('Self-Healing Loop (IMP-01) — Verificador e Autocorreção Fechada', () => {

  describe('Parsing de Saídas de Teste (parseTestOutput)', () => {
    it('deve identificar execução com 100% de sucesso', () => {
      const stdout = '✔ Teste 1 (1ms)\n✔ Teste 2 (2ms)\nℹ pass 2\nℹ fail 0';
      const parsed = parseTestOutput(stdout, '');
      assert.strictEqual(parsed.hasFailure, false);
      assert.strictEqual(parsed.failureType, 'NONE');
      assert.ok(parsed.passCount >= 2);
      assert.strictEqual(parsed.failCount, 0);
    });

    it('deve detectar falha de asserção (AssertionError)', () => {
      const stdout = '✖ Teste Contrato (3ms)\nAssertionError [ERR_ASSERTION]: Expected values to be strictly equal';
      const parsed = parseTestOutput(stdout, '');
      assert.strictEqual(parsed.hasFailure, true);
      assert.strictEqual(parsed.failureType, FailureTypes.ASSERTION_FAILURE);
      assert.ok(parsed.failedTests.includes('Teste Contrato (3ms)'));
    });

    it('deve detectar erro de sintaxe (SyntaxError)', () => {
      const stderr = 'SyntaxError: Unexpected token "{" at Object.<anonymous>';
      const parsed = parseTestOutput('', stderr);
      assert.strictEqual(parsed.hasFailure, true);
      assert.strictEqual(parsed.failureType, FailureTypes.SYNTAX_ERROR);
    });

    it('deve detectar erro de tipo (TypeError)', () => {
      const stderr = 'TypeError: Cannot read properties of null (reading "map")';
      const parsed = parseTestOutput('', stderr);
      assert.strictEqual(parsed.hasFailure, true);
      assert.strictEqual(parsed.failureType, FailureTypes.TYPE_ERROR);
    });

    it('deve detectar módulo não encontrado (ERR_MODULE_NOT_FOUND)', () => {
      const stderr = 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module "./foo.js"';
      const parsed = parseTestOutput('', stderr);
      assert.strictEqual(parsed.hasFailure, true);
      assert.strictEqual(parsed.failureType, FailureTypes.MODULE_NOT_FOUND);
    });
  });

  describe('Diagnóstico de Falhas (diagnoseFailure)', () => {
    it('deve diagnosticar falha de asserção com recomendação cirúrgica', () => {
      const parsed = {
        hasFailure: true,
        failureType: FailureTypes.ASSERTION_FAILURE,
        errorMessage: 'Expected 1 to equal 2'
      };
      const diag = diagnoseFailure(parsed);
      assert.strictEqual(diag.canSelfHeal, true);
      assert.ok(diag.diagnosis.includes('Falha de asserção'));
      assert.ok(diag.remediation.includes('Ajustar implementação'));
    });

    it('deve indicar que timeouts não devem ser autocorrigo sem intervenção', () => {
      const parsed = {
        hasFailure: true,
        failureType: FailureTypes.TIMEOUT,
        errorMessage: 'timed out'
      };
      const diag = diagnoseFailure(parsed);
      assert.strictEqual(diag.canSelfHeal, false);
    });
  });

  describe('Proteção e Inviolabilidade da Suíte de Testes', () => {
    it('deve aprovar quando os arquivos de teste estão intactos', () => {
      const tmpFile = path.join(os.tmpdir(), `test-protect-${Date.now()}.js`);
      fs.writeFileSync(tmpFile, 'describe("test", () => {});', 'utf8');
      const snapshots = new Map([[tmpFile, 'describe("test", () => {});']]);

      try {
        const integrity = verifyTestSuiteIntegrity([tmpFile], snapshots);
        assert.strictEqual(integrity.intact, true);
        assert.strictEqual(integrity.violations.length, 0);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('deve reprovar tentativa de esvaziar ou truncar arquivo de teste', () => {
      const tmpFile = path.join(os.tmpdir(), `test-protect-trunc-${Date.now()}.js`);
      fs.writeFileSync(tmpFile, 'x', 'utf8'); // truncado
      const snapshots = new Map([[tmpFile, 'describe("suite completa", () => { it("test1", ()=>{}); it("test2", ()=>{}); });']]);

      try {
        const integrity = verifyTestSuiteIntegrity([tmpFile], snapshots);
        assert.strictEqual(integrity.intact, false);
        assert.ok(integrity.violations[0].includes('truncado'));
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('Execução do Loop de Autocorreção (runSelfHealingLoop)', () => {
    it('deve convergir na 1ª iteração se os testes já passarem de início', async () => {
      const result = await runSelfHealingLoop({
        runTestFn: () => ({ stdout: '✔ pass 5', stderr: '', exitCode: 0 }),
        applyPatchFn: () => true
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.converged, true);
      assert.strictEqual(result.iterations, 1);
      assert.strictEqual(result.reason, 'ALL_TESTS_PASSED_INITIAL');
    });

    it('deve se autocorriger na 2ª iteração após aplicação de patch bem-sucedido', async () => {
      let callCount = 0;
      let patchApplied = false;

      const result = await runSelfHealingLoop({
        runTestFn: () => {
          callCount++;
          if (callCount === 1) {
            return {
              stdout: '✖ Falha no teste',
              stderr: 'AssertionError: Expected 10 to equal 20',
              exitCode: 1
            };
          }
          return { stdout: '✔ pass 10', stderr: '', exitCode: 0 };
        },
        applyPatchFn: (diag, iter) => {
          patchApplied = true;
          return true;
        }
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.converged, true);
      assert.strictEqual(result.iterations, 2);
      assert.strictEqual(patchApplied, true);
      assert.strictEqual(result.reason, 'SELF_HEALED_SUCCESSFULLY');
    });

    it('deve respeitar estritamente o limite de 5 iterações e acionar rollback', async () => {
      let rollbackCalled = false;
      let attempts = 0;

      const result = await runSelfHealingLoop({
        runTestFn: () => {
          attempts++;
          return {
            stdout: '',
            stderr: 'AssertionError: Regressão persistente',
            exitCode: 1
          };
        },
        applyPatchFn: () => true,
        rollbackFn: () => {
          rollbackCalled = true;
        },
        maxIterations: 10 // Pede 10, mas deve ser travado no máximo 5
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.converged, false);
      assert.strictEqual(result.iterations, MAX_ALLOWED_ITERATIONS);
      assert.strictEqual(attempts, MAX_ALLOWED_ITERATIONS);
      assert.strictEqual(result.rolledBack, true);
      assert.strictEqual(rollbackCalled, true);
      assert.strictEqual(result.reason, 'MAX_ITERATIONS_REACHED_WITHOUT_CONVERGENCE');
    });

    it('deve abortar e reverter se o patch violar a integridade dos testes', async () => {
      const tmpTestFile = path.join(os.tmpdir(), `test-tamper-${Date.now()}.js`);
      fs.writeFileSync(tmpTestFile, 'describe("protegido", () => {});', 'utf8');

      let rollbackCalled = false;

      try {
        const result = await runSelfHealingLoop({
          runTestFn: () => ({ stdout: '', stderr: 'AssertionError: falha', exitCode: 1 }),
          applyPatchFn: () => {
            // Simula tentativa de apagar o arquivo de teste para "passar"
            fs.unlinkSync(tmpTestFile);
            return true;
          },
          rollbackFn: () => {
            rollbackCalled = true;
          },
          protectedTestFiles: [tmpTestFile]
        });

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.converged, false);
        assert.strictEqual(result.rolledBack, true);
        assert.strictEqual(rollbackCalled, true);
        assert.ok(result.reason.includes('TEST_INTEGRITY_VIOLATION'));
      } finally {
        if (fs.existsSync(tmpTestFile)) fs.unlinkSync(tmpTestFile);
      }
    });
  });
});
