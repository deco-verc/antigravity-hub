import fs from 'node:fs';

/**
 * Limite estrito de iterações do loop de autocorreção (RLVR Simplicity First).
 */
export const MAX_ALLOWED_ITERATIONS = 5;

/**
 * Taxonomia de falhas identificadas pelo parser.
 */
export const FailureTypes = {
  ASSERTION_FAILURE: 'ASSERTION_FAILURE',
  SYNTAX_ERROR: 'SYNTAX_ERROR',
  TYPE_ERROR: 'TYPE_ERROR',
  MODULE_NOT_FOUND: 'MODULE_NOT_FOUND',
  RUNTIME_EXCEPTION: 'RUNTIME_EXCEPTION',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Faz o parse da saída de execução de testes (stdout/stderr).
 */
export function parseTestOutput(stdout = '', stderr = '') {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);

  let hasFailure = false;
  let failureType = FailureTypes.UNKNOWN;
  let errorMessage = '';
  const failedTests = [];
  let summaryPassCount = null;
  let summaryFailCount = null;
  let linePassCount = 0;
  let lineFailCount = 0;
  const stackLines = [];

  for (const line of lines) {
    const passSummaryMatch = line.match(/^(?:ℹ|#)?\s*(?:pass|ok)\s+(\d+)\s*$/i);
    if (passSummaryMatch) {
      summaryPassCount = (summaryPassCount ?? 0) + parseInt(passSummaryMatch[1], 10);
    } else if (/^\s*(?:✔|ok\s+\d+\b)/.test(line)) {
      linePassCount++;
    }

    const failSummaryMatch = line.match(/^(?:ℹ|#)?\s*fail\s+(\d+)\s*$/i);
    if (failSummaryMatch) {
      const fCount = parseInt(failSummaryMatch[1], 10);
      summaryFailCount = (summaryFailCount ?? 0) + fCount;
      if (fCount > 0) hasFailure = true;
    } else if (/^\s*(?:✖|not ok\s+\d+\b)/.test(line)) {
      lineFailCount++;
      hasFailure = true;
      const testNameMatch = line.match(/(?:✖|not ok\s+\d+\s*-?)\s*(.+)/);
      if (testNameMatch) {
        failedTests.push(testNameMatch[1].trim());
      }
    }

    // Detecção de tipos específicos de erro
    if (line.includes('AssertionError') || line.includes('assert.strictEqual') || line.includes('Expected values to be strictly equal')) {
      failureType = FailureTypes.ASSERTION_FAILURE;
      if (!errorMessage) errorMessage = line.trim();
    } else if (line.includes('SyntaxError')) {
      failureType = FailureTypes.SYNTAX_ERROR;
      if (!errorMessage) errorMessage = line.trim();
    } else if (line.includes('TypeError')) {
      failureType = FailureTypes.TYPE_ERROR;
      if (!errorMessage) errorMessage = line.trim();
    } else if (line.includes('ERR_MODULE_NOT_FOUND') || line.includes('Cannot find module')) {
      failureType = FailureTypes.MODULE_NOT_FOUND;
      if (!errorMessage) errorMessage = line.trim();
    } else if (line.includes('timed out') || line.includes('TIMEOUT')) {
      failureType = FailureTypes.TIMEOUT;
      if (!errorMessage) errorMessage = line.trim();
    }

    if (line.trim().startsWith('at ') || /\b\w*Error:/.test(line)) {
      stackLines.push(line.trim());
      if (!errorMessage && /\b\w*Error:/.test(line)) {
        errorMessage = line.trim();
      }
    }
  }

  const passCount = summaryPassCount !== null ? summaryPassCount : linePassCount;
  const failCount = summaryFailCount !== null ? summaryFailCount : lineFailCount;

  if (failCount > 0 || failureType !== FailureTypes.UNKNOWN || /\b\w*Error:/.test(stderr)) {
    hasFailure = true;
    if (failureType === FailureTypes.UNKNOWN) {
      failureType = FailureTypes.RUNTIME_EXCEPTION;
    }
  }

  return {
    hasFailure,
    failureType: hasFailure ? failureType : 'NONE',
    errorMessage: errorMessage || (hasFailure ? 'Falha detectada na execução de testes.' : ''),
    failedTests,
    passCount,
    failCount,
    stackTrace: stackLines.slice(0, 10).join('\n')
  };
}

/**
 * Diagnostica a causa raiz e sugere ação de remediação pontual.
 */
export function diagnoseFailure(parsedOutput) {
  if (!parsedOutput.hasFailure) {
    return {
      diagnosis: 'Nenhuma falha detectada.',
      remediation: 'Nenhuma ação necessária.',
      canSelfHeal: false
    };
  }

  switch (parsedOutput.failureType) {
    case FailureTypes.ASSERTION_FAILURE:
      return {
        diagnosis: `Falha de asserção em teste unitário: ${parsedOutput.errorMessage}`,
        remediation: 'Ajustar implementação do componente para atender aos contratos da especificação sem enfraquecer o teste.',
        canSelfHeal: true
      };
    case FailureTypes.SYNTAX_ERROR:
      return {
        diagnosis: `Erro sintático de código: ${parsedOutput.errorMessage}`,
        remediation: 'Corrigir token, delimitador ou sintaxe no arquivo afetado.',
        canSelfHeal: true
      };
    case FailureTypes.TYPE_ERROR:
      return {
        diagnosis: `Erro de tipo / acesso a propriedade nula: ${parsedOutput.errorMessage}`,
        remediation: 'Adicionar checagem defensiva de tipos ou valores nulos/indefinidos.',
        canSelfHeal: true
      };
    case FailureTypes.MODULE_NOT_FOUND:
      return {
        diagnosis: `Módulo ou caminho de importação incorreto: ${parsedOutput.errorMessage}`,
        remediation: 'Verificar caminho relativo ou extensão (.js) no import.',
        canSelfHeal: true
      };
    case FailureTypes.TIMEOUT:
      return {
        diagnosis: 'Execução do teste excedeu o tempo limite permitido.',
        remediation: 'Otimizar loop assíncrono ou eliminar bloqueio de I/O.',
        canSelfHeal: false
      };
    default:
      return {
        diagnosis: `Exceção em tempo de execução: ${parsedOutput.errorMessage || 'Erro desconhecido'}`,
        remediation: 'Inspecionar stacktrace e aplicar patch corretivo pontual.',
        canSelfHeal: true
      };
  }
}

/**
 * Valida a integridade dos arquivos de teste para garantir a inviolabilidade da suíte.
 */
export function verifyTestSuiteIntegrity(testFilePaths, originalSnapshots) {
  const violations = [];

  for (const filePath of testFilePaths) {
    if (!fs.existsSync(filePath)) {
      violations.push(`Arquivo de teste apagado ou movido: ${filePath}`);
      continue;
    }
    const currentContent = fs.readFileSync(filePath, 'utf8').trim();
    if (currentContent.length === 0) {
      violations.push(`Arquivo de teste esvaziado: ${filePath}`);
      continue;
    }
    const original = originalSnapshots.get(filePath);
    if (original) {
      if (currentContent.length < original.trim().length * 0.5) {
        violations.push(`Arquivo de teste significativamente reduzido ou truncado: ${filePath}`);
        continue;
      }
      const origAssertions = (original.match(/\bassert\b/g) || []).length;
      const currAssertions = (currentContent.match(/\bassert\b/g) || []).length;
      if (origAssertions > 0 && currAssertions < origAssertions) {
        violations.push(`Remoção de asserções detectada no arquivo de teste: ${filePath}`);
      }
    }
  }

  return {
    intact: violations.length === 0,
    violations
  };
}

/**
 * Executa o loop fechado de autocorreção (RLVR Self-Healing Debug Loop).
 */
export async function runSelfHealingLoop({
  runTestFn,
  applyPatchFn,
  snapshotFn = null,
  rollbackFn = null,
  protectedTestFiles = [],
  maxIterations = MAX_ALLOWED_ITERATIONS
}) {
  if (typeof runTestFn !== 'function') {
    throw new Error('runTestFn deve ser uma função executável.');
  }
  if (typeof applyPatchFn !== 'function') {
    throw new Error('applyPatchFn deve ser uma função de aplicação de patch.');
  }

  const effectiveMaxIterations = Math.min(Math.max(1, maxIterations), MAX_ALLOWED_ITERATIONS);

  const testSnapshots = new Map();
  for (const tf of protectedTestFiles) {
    if (fs.existsSync(tf)) {
      testSnapshots.set(tf, fs.readFileSync(tf, 'utf8'));
    }
  }

  if (snapshotFn) {
    snapshotFn();
  }

  const history = [];

  for (let iteration = 1; iteration <= effectiveMaxIterations; iteration++) {
    const testResult = runTestFn();
    const parsed = parseTestOutput(testResult.stdout, testResult.stderr);

    if (testResult.exitCode === 0 && !parsed.hasFailure) {
      history.push({
        iteration,
        status: 'PASS',
        message: 'Testes passaram com sucesso.'
      });
      return {
        success: true,
        converged: true,
        iterations: iteration,
        rolledBack: false,
        reason: iteration === 1 ? 'ALL_TESTS_PASSED_INITIAL' : 'SELF_HEALED_SUCCESSFULLY',
        history
      };
    }

    const diagnosis = diagnoseFailure(parsed);
    history.push({
      iteration,
      status: 'FAIL',
      diagnosis: diagnosis.diagnosis,
      failureType: parsed.failureType,
      remediation: diagnosis.remediation
    });

    if (iteration === effectiveMaxIterations) {
      break;
    }

    if (!diagnosis.canSelfHeal) {
      if (rollbackFn) rollbackFn();
      return {
        success: false,
        converged: false,
        iterations: iteration,
        rolledBack: Boolean(rollbackFn),
        reason: `UNRECOVERABLE_FAILURE: ${parsed.failureType}`,
        history
      };
    }

    const patchApplied = await applyPatchFn(diagnosis, iteration);
    if (!patchApplied) {
      if (rollbackFn) rollbackFn();
      return {
        success: false,
        converged: false,
        iterations: iteration,
        rolledBack: Boolean(rollbackFn),
        reason: 'PATCH_FAILED_TO_APPLY',
        history
      };
    }

    if (protectedTestFiles.length > 0) {
      const integrity = verifyTestSuiteIntegrity(protectedTestFiles, testSnapshots);
      if (!integrity.intact) {
        if (rollbackFn) rollbackFn();
        return {
          success: false,
          converged: false,
          iterations: iteration,
          rolledBack: true,
          reason: `TEST_INTEGRITY_VIOLATION: ${integrity.violations.join('; ')}`,
          history
        };
      }
    }
  }

  if (rollbackFn) {
    rollbackFn();
  }

  return {
    success: false,
    converged: false,
    iterations: effectiveMaxIterations,
    rolledBack: Boolean(rollbackFn),
    reason: 'MAX_ITERATIONS_REACHED_WITHOUT_CONVERGENCE',
    history
  };
}

if (process.argv[1] && (process.argv[1].endsWith('selfHealingLoop.js') || process.argv[1].endsWith('selfHealingLoop'))) {
  console.log('[AutoAdapt] Módulo de Self-Healing Loop (IMP-01) carregado com sucesso.');
  console.log(`[AutoAdapt] Limite estrito de iterações: ${MAX_ALLOWED_ITERATIONS}`);
  process.exitCode = 0;
}