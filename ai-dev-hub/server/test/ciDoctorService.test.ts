import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { CiDoctorService, FailureDiagnosis } from '../src/ciDoctorService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { ObservabilityService } from '../src/observability/observabilityService.js';

describe('FASE 3: CI Doctor Subagent & IndependentEvaluator Micro-Patch Auto-Healing', () => {
  let tempDir: string;
  let srcDir: string;
  let testDir: string;
  let mathImplFile: string;
  let mathTestFile: string;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-cidoctor-test-'));
    srcDir = path.join(tempDir, 'src');
    testDir = path.join(tempDir, 'test');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });

    // Initialize git repository to avoid git status warnings
    try {
      execSync('git init -b main', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });
    } catch {}

    // Implementation file with a deliberate defect (- instead of +)
    mathImplFile = path.join(srcDir, 'math.cjs');
    fs.writeFileSync(
      mathImplFile,
      `exports.add = function add(a, b) {\n  return a - b;\n};\n`
    );

    // Test file expecting add(2, 3) to be 5
    mathTestFile = path.join(testDir, 'math.test.cjs');
    fs.writeFileSync(
      mathTestFile,
      `const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { add } = require('../src/math.cjs');\n\ntest('adds numbers correctly', () => {\n  assert.equal(add(2, 3), 5);\n});\n`
    );

    try {
      execSync('git add -A && git commit -m "initial"', { cwd: tempDir, stdio: 'ignore' });
    } catch {}
  });

  after(() => {
    CiDoctorService.clearHealers();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. diagnoseFailure: Extrai arquivo, linha, asserção e snippet de saída de teste Node/V8', () => {
    const mockOutput = `
✖ adds numbers correctly (1.892ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + -1
  - 5
      at TestContext.<anonymous> (${mathTestFile.replace(/\\/g, '/')}:6:10)
      at add (${mathImplFile.replace(/\\/g, '/')}:2:10)
`;

    const diagnosis = CiDoctorService.diagnoseFailure(mockOutput, tempDir);
    assert.ok(diagnosis, 'Diagnóstico deve ser gerado com sucesso');
    assert.ok(diagnosis.assertionMessage.includes('Expected values to be strictly equal') || diagnosis.assertionMessage.includes('-1'));
    assert.equal(diagnosis.targetImplementationFile?.toLowerCase(), mathImplFile.toLowerCase(), 'Deve identificar o arquivo de implementação no stack');
    assert.ok(diagnosis.snippet, 'Snippet de código cirúrgico deve ser gerado');
    assert.ok(diagnosis.snippet.includes('return a - b'), 'Snippet deve conter a linha defeituosa');
    assert.ok(diagnosis.snippet.length < 3500, 'Snippet deve ter contexto estritamente cirúrgico (< 1.000 tokens)');
  });

  it('2. diagnoseFailure: Identifica asserções em formato Jest/Vitest', () => {
    const jestOutput = `
FAIL test/math.test.cjs
  ● adds numbers correctly

    expect(received).toBe(expected) // Object.is equality

    Expected: 5
    Received: -1

      4 | test('adds numbers correctly', () => {
    > 5 |   expect(add(2, 3)).toBe(5);
        |                     ^
      6 | });

      at Object.<anonymous> (${mathTestFile.replace(/\\/g, '/')}:5:21)
`;

    const diagnosis = CiDoctorService.diagnoseFailure(jestOutput, tempDir);
    assert.ok(diagnosis, 'Diagnóstico de saída Jest deve ser gerado');
    assert.ok(diagnosis.assertionMessage.length > 0);
    assert.equal(diagnosis.failedFile?.toLowerCase(), mathTestFile.toLowerCase());
  });

  it('3. attemptQuickHeal: Corrige falha de operador aritmético via micro-patch e valida código 0', async () => {
    // Ensure defective state
    fs.writeFileSync(
      mathImplFile,
      `exports.add = function add(a, b) {\n  return a - b;\n};\n`
    );

    const mockOutput = `
✖ adds numbers correctly
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  -1 !== 5
      at TestContext.<anonymous> (${mathTestFile.replace(/\\/g, '/')}:6:10)
      at add (${mathImplFile.replace(/\\/g, '/')}:2:10)
`;

    const diagnosis = CiDoctorService.diagnoseFailure(mockOutput, tempDir);
    assert.ok(diagnosis);

    const verificationCommand = 'node --test test/math.test.cjs';

    const healResult = await CiDoctorService.attemptQuickHeal({
      projectPath: tempDir,
      task: {
        id: 'task-test-1',
        title: 'Fix math addition',
        protectedEvaluationFiles: [path.relative(tempDir, mathTestFile)]
      },
      failureDiagnosis: diagnosis,
      verificationCommand
    });

    assert.equal(healResult.healed, true, 'CI Doctor deve auto-reparar o teste');
    assert.ok(healResult.patchApplied, 'Deve detalhar o micro-patch aplicado');

    // Confirm implementation file was updated on disk
    const fixedContent = fs.readFileSync(mathImplFile, 'utf-8');
    assert.ok(fixedContent.includes('return a + b;'), 'Arquivo em disco deve conter o operador correto (+)');
  });

  it('4. Proteção de Testes: CI Doctor recusa alterar suíte protegida quando não há implementação alvo', async () => {
    const mockOutput = `
✖ protected test failed
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  false !== true
      at TestContext.<anonymous> (${mathTestFile.replace(/\\/g, '/')}:6:10)
`;

    const diagnosis: FailureDiagnosis = {
      failedFile: mathTestFile,
      relativeFilePath: path.relative(tempDir, mathTestFile),
      line: 6,
      column: 10,
      assertionMessage: 'AssertionError: false !== true',
      rawOutput: mockOutput,
      isTestFile: true,
      targetImplementationFile: undefined // Only test file in stack
    };

    const healResult = await CiDoctorService.attemptQuickHeal({
      projectPath: tempDir,
      task: {
        id: 'task-test-protected',
        protectedEvaluationFiles: [path.relative(tempDir, mathTestFile)]
      },
      failureDiagnosis: diagnosis,
      verificationCommand: 'node --test test/math.test.cjs'
    });

    assert.equal(healResult.healed, false, 'Não deve permitir alterar testes protegidos');
    assert.ok(healResult.error?.includes('protegida') || healResult.error?.includes('protegidas'), 'Deve indicar violação de integridade de teste protegido');
  });

  it('5. Integração com IndependentEvaluator: Auto-repara teste com falha e eleva veredicto para PASS', async () => {
    // Put defect back into mathImplFile
    fs.writeFileSync(
      mathImplFile,
      `exports.add = function add(a, b) {\n  return a - b;\n};\n`
    );

    let ciDoctorEventReceived = false;
    const unsubscribe = ObservabilityService.addListener((event: any) => {
      if (event.event === 'CI_DOCTOR_HEALED') {
        ciDoctorEventReceived = true;
      }
    });

    const verificationCommand = 'node --test test/math.test.cjs';

    const contract = IndependentEvaluator.createSuccessContract({
      taskId: 'task-eval-ci-doctor',
      projectId: 'project-cidoctor',
      projectPath: tempDir,
      objective: 'Implementar e validar função add em math.cjs',
      acceptanceCriteria: ['add(2, 3) deve retornar 5'],
      verificationCommand,
      verificationSteps: [
        {
          name: 'Teste de unidade add()',
          command: verificationCommand,
          checkType: 'command',
          expectedExitCode: 0
        }
      ],
      protectedEvaluationFiles: [path.relative(tempDir, mathTestFile)]
    });

    const builderReport = {
      status: 'success',
      filesChanged: [path.relative(tempDir, mathImplFile)],
      implemented: ['Implementada função add'],
      problems: [],
      decisions: []
    };

    const evalResult = await IndependentEvaluator.evaluate(
      contract.id,
      tempDir,
      builderReport as any,
      { expectedScopeFiles: [path.relative(tempDir, mathImplFile)] }
    );

    unsubscribe();

    assert.equal(evalResult.verdict, 'PASS', 'Veredicto deve ser elevado para PASS após auto-reparo do CI Doctor');
    assert.equal(evalResult.taskIsDone, true, 'taskIsDone deve ser true');
    assert.equal(evalResult.evidence.ciDoctorHealed, true, 'evidence.ciDoctorHealed deve ser true');
    assert.ok(evalResult.evidence.ciDoctorPatchApplied, 'Deve conter registro do patch aplicado');
    assert.ok(ciDoctorEventReceived, 'ObservabilityService deve ter emitido o evento CI_DOCTOR_HEALED');

    // Confirm file on disk is healed
    const currentImpl = fs.readFileSync(mathImplFile, 'utf-8');
    assert.ok(currentImpl.includes('return a + b;'), 'Função em disco deve estar corrigida');
  });

  it('6. Custom Healers: Permite registro extensível de healers especializados', async () => {
    let customCalled = false;
    CiDoctorService.registerHealer('string-greeter', (diag, content) => {
      customCalled = true;
      if (content.includes('hello')) {
        return content.replace('hello', 'Hello World');
      }
      return null;
    });

    const sampleFile = path.join(srcDir, 'sample.cjs');
    fs.writeFileSync(sampleFile, 'exports.greeting = "hello";\n');

    const diag: FailureDiagnosis = {
      failedFile: sampleFile,
      relativeFilePath: 'src/sample.cjs',
      line: 1,
      assertionMessage: 'Greeting mismatch',
      rawOutput: 'failed',
      isTestFile: false
    };

    // Fast test of custom healer execution
    await CiDoctorService.attemptQuickHeal({
      projectPath: tempDir,
      task: { id: 'task-custom' },
      failureDiagnosis: diag,
      verificationCommand: 'node -e "process.exit(0)"' // immediate success
    });

    assert.equal(customCalled, true, 'Custom healer hook deve ter sido executado');
  });
});
