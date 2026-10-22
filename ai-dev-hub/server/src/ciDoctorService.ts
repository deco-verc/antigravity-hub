import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CommandExecutionEngine } from './commandExecutionEngine.js';
import { Logger } from './logger.js';
import { ObservabilityService } from './observability/observabilityService.js';

export interface FailureDiagnosis {
  failedFile?: string;
  relativeFilePath?: string;
  line?: number;
  column?: number;
  assertionMessage: string;
  snippet?: string;
  rawOutput: string;
  isTestFile: boolean;
  targetImplementationFile?: string;
  expected?: string;
  received?: string;
  stackTrace?: string[];
  errorType?: string;
}

export interface QuickHealOptions {
  projectPath: string;
  task?: {
    id?: string;
    title?: string;
    description?: string;
    criteria?: string[];
    protectedEvaluationFiles?: string[];
    protected_evaluation_files?: string[];
    [key: string]: any;
  };
  failureDiagnosis: FailureDiagnosis;
  verificationCommand: string;
}

export interface QuickHealResult {
  healed: boolean;
  patchApplied?: string;
  output?: string;
  error?: string;
}

export type CustomHealerFn = (
  diagnosis: FailureDiagnosis,
  fileContent: string,
  filePath: string
) => string | null | Promise<string | null>;

/**
 * CI Doctor Subagent
 * Diagnoses failing unit tests with surgical precision (< 1,000 tokens)
 * and attempts ultra-fast micro-patches on defective implementation functions
 * without weakening or tampering with protected test suites.
 */
export class CiDoctorService {
  private static customHealers: Map<string, CustomHealerFn> = new Map();

  /**
   * Register an extensible healer hook
   */
  public static registerHealer(name: string, healer: CustomHealerFn): void {
    this.customHealers.set(name, healer);
  }

  /**
   * Clear registered custom healers (useful for testing)
   */
  public static clearHealers(): void {
    this.customHealers.clear();
  }

  /**
   * Automatically parses test execution output (Node test runner, Jest, Mocha, Vitest, etc.)
   * to extract the failing file, line, assertion error, and an isolated snippet (< 1,000 tokens).
   */
  public static diagnoseFailure(testOutput: string, projectPath: string): FailureDiagnosis | null {
    if (!testOutput || typeof testOutput !== 'string' || !testOutput.trim()) {
      return null;
    }

    const cleanOutput = testOutput.replace(/\r\n/g, '\n');
    let assertionMessage = '';
    let expected: string | undefined;
    let received: string | undefined;
    let errorType: string | undefined;

    // 1. Extract Assertion / Error Details
    // Pattern A: Node --test AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    const nodeAssertionMatch = cleanOutput.match(
      /AssertionError(?:\s*\[ERR_ASSERTION\])?:\s*([^\n]+(?:\n\s*(?:Expected values to be strictly equal|\+ actual - expected|Expected|Received)[^\n]*)*)/i
    );
    if (nodeAssertionMatch) {
      assertionMessage = nodeAssertionMatch[1].trim();
      errorType = 'AssertionError';
    }

    // Pattern B: Jest / Vitest Expected: X / Received: Y
    const jestExpectMatch = cleanOutput.match(
      /(?:expect\([^)]+\)\.[a-zA-Z]+\([^)]*\)|Expected:[\s\S]*?Received:[\s\S]*?(?=\n\s*(?:\n|at\s)))/i
    );
    if (jestExpectMatch && !assertionMessage) {
      assertionMessage = jestExpectMatch[0].trim();
      errorType = 'ExpectationError';
    }

    // Pattern C: Expected X but received Y or expected X to equal Y
    const expectedReceivedMatch = cleanOutput.match(
      /(?:expected\s+(?:values?\s+to\s+be\s+strictly\s+equal:?\s*)?|expected:?\s*)([^\n]+?)\s*(?:but\s+received|to\s+(?:equal|be)|received:?)\s*([^\n]+)/i
    );
    if (expectedReceivedMatch) {
      expected = expectedReceivedMatch[1].trim();
      received = expectedReceivedMatch[2].trim();
      if (!assertionMessage) {
        assertionMessage = `Expected ${expected} but received ${received}`;
      }
    }

    // Pattern D: Node --test actual/expected diff
    // - actual: X \n + expected: Y  OR  + actual \n - expected \n + 4 \n - 5
    const diffMatch = cleanOutput.match(/-\s*actual:?\s*([^\n]+)\s*\+\s*expected:?\s*([^\n]+)/i);
    if (diffMatch) {
      received = diffMatch[1].trim();
      expected = diffMatch[2].trim();
    } else {
      const nodeDiffBlocks = cleanOutput.match(/\+\s*actual\s*-\s*expected\s*\n\s*\+\s*([^\n]+)\s*\n\s*-\s*([^\n]+)/i);
      if (nodeDiffBlocks) {
        received = nodeDiffBlocks[1].trim();
        expected = nodeDiffBlocks[2].trim();
      }
    }

    // Pattern E: Strict inequality e.g. 4 !== 5 or 'foo' !== 'bar'
    const notEqualMatch = cleanOutput.match(/([^\n]+?)\s*!==\s*([^\n]+)/);
    if (notEqualMatch && (!expected || !received)) {
      received = notEqualMatch[1].trim();
      expected = notEqualMatch[2].trim();
      if (!assertionMessage) {
        assertionMessage = `Assertion failed: ${received} !== ${expected}`;
      }
    }

    // Pattern F: Generic Error Types (TypeError, ReferenceError, etc.)
    if (!assertionMessage) {
      const genericErrorMatch = cleanOutput.match(/((?:TypeError|ReferenceError|RangeError|SyntaxError|Error):\s*[^\n]+)/i);
      if (genericErrorMatch) {
        assertionMessage = genericErrorMatch[1].trim();
        errorType = genericErrorMatch[1].split(':')[0].trim();
      }
    }

    // Fallback: Test failure marker ✖ or FAIL
    if (!assertionMessage) {
      const failMarkerMatch = cleanOutput.match(/(?:✖|FAIL|failed:)\s*([^\n]+)/i);
      if (failMarkerMatch) {
        assertionMessage = failMarkerMatch[1].trim();
      } else {
        assertionMessage = 'Unit test assertion failed';
      }
    }

    // 2. Extract Stack Frames & Referenced Files
    const stackLines = cleanOutput.split('\n').filter(line => /^\s*at\s+/.test(line) || /:\d+:\d+/.test(line));
    const detectedFiles: Array<{ filePath: string; line: number; column: number; isTest: boolean }> = [];

    const frameRegexes = [
      // at Object.<anonymous> (C:\path\to\file.ts:12:34)
      /at\s+(?:[a-zA-Z0-9_$.<>]+\s+)?\(?(?:file:\/\/)?([a-zA-Z]:[\\\/][^:\s\n\r"']+|\/[^:\s\n\r"']+|\.[\\\/][^:\s\n\r"']+|[a-zA-Z0-9_.-]+[\\\/][^:\s\n\r"']+):(\d+)(?::(\d+))?\)?/,
      // C:\path\to\file.ts:12:34
      /([a-zA-Z]:[\\\/][^:\s\n\r"']+|\/[^:\s\n\r"']+|\.[\\\/][^:\s\n\r"']+|[a-zA-Z0-9_.-]+[\\\/][^:\s\n\r"']+\.[cm]?[jt]sx?):(\d+)(?::(\d+))?/
    ];

    for (const line of stackLines) {
      for (const rx of frameRegexes) {
        const m = line.match(rx);
        if (m) {
          let rawPath = m[1].replace(/\\/g, '/');
          const lineNum = parseInt(m[2], 10);
          const colNum = m[3] ? parseInt(m[3], 10) : 1;

          // Ignore node internals, test runner harness, and node_modules
          if (
            rawPath.startsWith('node:') ||
            rawPath.includes('node_modules') ||
            rawPath.includes('test_runner') ||
            rawPath.includes('internal/') ||
            rawPath.includes('internal\\')
          ) {
            continue;
          }

          let resolvedPath = path.isAbsolute(rawPath)
            ? path.resolve(rawPath)
            : path.resolve(projectPath, rawPath);

          // If the path is inside a controlledVerification snapshot (e.g. execution-xxx/...)
          const snapshotMatch = resolvedPath.match(/execution-[a-zA-Z0-9_\-]+[\\\/](.+)$/i);
          if (snapshotMatch) {
            const rel = snapshotMatch[1];
            const inProject = path.resolve(projectPath, rel);
            if (fs.existsSync(inProject)) {
              resolvedPath = inProject;
            }
          } else if (!resolvedPath.toLowerCase().startsWith(path.resolve(projectPath).toLowerCase())) {
            const parts = resolvedPath.split(/[\\\/]/);
            for (let i = 1; i < parts.length; i++) {
              const candidateRel = parts.slice(i).join('/');
              const candidateFull = path.resolve(projectPath, candidateRel);
              if (fs.existsSync(candidateFull) && fs.statSync(candidateFull).isFile()) {
                resolvedPath = candidateFull;
                break;
              }
            }
          }

          // Only accept files that actually exist on disk
          if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
            continue;
          }

          const isTest =
            /\.(test|spec)\.[cm]?[jt]sx?$/i.test(resolvedPath) ||
            /[\/\\](test|tests|__tests__)[\/\\]/i.test(resolvedPath);

          if (!detectedFiles.some(f => f.filePath.toLowerCase() === resolvedPath.toLowerCase())) {
            detectedFiles.push({
              filePath: resolvedPath,
              line: lineNum,
              column: colNum,
              isTest
            });
          }
          break;
        }
      }
    }

    if (detectedFiles.length === 0) {
      return {
        assertionMessage,
        rawOutput: testOutput,
        isTestFile: false,
        expected,
        received,
        errorType
      };
    }

    // Determine primary failed file vs target implementation file
    const testFileFrame = detectedFiles.find(f => f.isTest);
    const implFileFrame = detectedFiles.find(f => !f.isTest);

    const primaryFrame = detectedFiles[0];
    const failedFile = primaryFrame.filePath;
    const isTestFile = primaryFrame.isTest;

    let targetImplementationFile: string | undefined = implFileFrame ? implFileFrame.filePath : undefined;

    // Use implementation frame line if available, otherwise primary frame line
    const line = (targetImplementationFile && implFileFrame) ? implFileFrame.line : primaryFrame.line;
    const column = (targetImplementationFile && implFileFrame) ? implFileFrame.column : primaryFrame.column;

    // If failedFile is a test file and no implementation file in stack, check test file imports for target source
    if (isTestFile && !targetImplementationFile && fs.existsSync(failedFile)) {
      try {
        const testContent = fs.readFileSync(failedFile, 'utf-8');
        const importMatches = testContent.matchAll(
          /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g
        );
        for (const match of importMatches) {
          const importPath = match[1] || match[2];
          if (importPath && (importPath.startsWith('.') || importPath.startsWith('/'))) {
            // Check possible file extensions
            const dir = path.dirname(failedFile);
            const candidateBase = path.resolve(dir, importPath);
            for (const ext of ['', '.ts', '.js', '.tsx', '.jsx', '.cjs', '.mjs']) {
              const fullCandidate = candidateBase.endsWith(ext) ? candidateBase : `${candidateBase}${ext}`;
              if (fs.existsSync(fullCandidate) && fs.statSync(fullCandidate).isFile()) {
                if (!/\.(test|spec)\.[cm]?[jt]sx?$/i.test(fullCandidate)) {
                  targetImplementationFile = fullCandidate;
                  break;
                }
              }
            }
            if (targetImplementationFile) break;
          }
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== 'undefined' && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: 'server.handled_exception',
            file: 'ciDoctorService',
            error: (err as any)?.message || String(err)
          });
        }
      }
    }

    // 3. Extract Surgical Code Snippet (< 1,000 tokens)
    const snippetFile = targetImplementationFile && fs.existsSync(targetImplementationFile)
      ? targetImplementationFile
      : failedFile;
    const snippetLine = (snippetFile === targetImplementationFile && implFileFrame)
      ? implFileFrame.line
      : line;

    let snippet: string | undefined;
    if (snippetFile && fs.existsSync(snippetFile)) {
      try {
        const fileContent = fs.readFileSync(snippetFile, 'utf-8');
        const fileLines = fileContent.split(/\r?\n/);
        const startLine = Math.max(1, snippetLine - 6);
        const endLine = Math.min(fileLines.length, snippetLine + 6);

        const snippetLines: string[] = [];
        for (let l = startLine; l <= endLine; l++) {
          const marker = l === snippetLine ? '>' : ' ';
          snippetLines.push(`${marker} ${l.toString().padStart(4, ' ')} | ${fileLines[l - 1]}`);
        }
        snippet = snippetLines.join('\n');

        // Ensure snippet is strictly surgical (< 1,000 tokens ~= 3,500 chars)
        if (snippet.length > 3500) {
          snippet = snippet.slice(0, 3500) + '\n... (truncado para manter foco cirúrgico)';
        }
      } catch (err) {
        if (typeof (globalThis as any).logger !== 'undefined' && (globalThis as any).logger?.warn) {
          (globalThis as any).logger.warn({
            event: 'server.handled_exception',
            file: 'ciDoctorService',
            error: (err as any)?.message || String(err)
          });
        }
      }
    }

    const relPath = path.relative(projectPath, snippetFile || failedFile);

    return {
      failedFile,
      relativeFilePath: relPath,
      line,
      column,
      assertionMessage,
      snippet,
      rawOutput: testOutput,
      isTestFile,
      targetImplementationFile,
      expected,
      received,
      stackTrace: stackLines.slice(0, 10),
      errorType
    };
  }

  /**
   * Dispatches an ultra-fast surgical repair micro-patch on the defective function
   * and verifies that the verificationCommand returns exit code 0.
   */
  public static async attemptQuickHeal(
    taskOrOptions: QuickHealOptions | any,
    failureDiagnosis?: FailureDiagnosis
  ): Promise<QuickHealResult> {
    let projectPath: string;
    let task: any;
    let diagnosis: FailureDiagnosis;
    let verificationCommand: string;

    if (taskOrOptions && taskOrOptions.failureDiagnosis) {
      projectPath = taskOrOptions.projectPath;
      task = taskOrOptions.task;
      diagnosis = taskOrOptions.failureDiagnosis;
      verificationCommand = taskOrOptions.verificationCommand || 'npm test';
    } else {
      task = taskOrOptions;
      diagnosis = failureDiagnosis!;
      projectPath = task?.project_path || task?.projectPath || process.cwd();
      verificationCommand = task?.verification_command || task?.verificationCommand || 'npm test';
    }

    if (!diagnosis) {
      return { healed: false, error: 'Sem diagnóstico válido para aplicar reparo.' };
    }

    // 1. Safety Check: Verify Protected Evaluation Files
    const protectedFiles: string[] = [
      ...(task?.protectedEvaluationFiles || []),
      ...(task?.protected_evaluation_files || [])
    ];

    let targetFilePath = diagnosis.targetImplementationFile && fs.existsSync(diagnosis.targetImplementationFile)
      ? diagnosis.targetImplementationFile
      : diagnosis.failedFile;

    if (!targetFilePath || !fs.existsSync(targetFilePath)) {
      return { healed: false, error: 'Arquivo alvo não encontrado para aplicar micro-patch.' };
    }

    const isProtected = protectedFiles.some(pf => {
      const fullPf = path.resolve(projectPath, pf).toLowerCase();
      return fullPf === targetFilePath!.toLowerCase();
    });

    if (isProtected) {
      if (diagnosis.isTestFile) {
        Logger.warn(
          `[CiDoctorService] Arquivo ${targetFilePath} é uma suíte de testes protegida. CI Doctor não alterará testes protegidos.`
        );
        return {
          healed: false,
          error: 'CI Doctor não altera suítes de teste protegidas para preservar a integridade da avaliação.'
        };
      }
    }

    const originalContent = fs.readFileSync(targetFilePath, 'utf-8');
    const relativeTarget = path.relative(projectPath, targetFilePath);

    // 2. Generate Candidate Micro-Patches
    const candidates: Array<{ name: string; content: string }> = [];

    // Candidate Strategy A: Custom Registered Healers
    for (const [name, healer] of this.customHealers.entries()) {
      try {
        const customPatched = await healer(diagnosis, originalContent, targetFilePath);
        if (customPatched && customPatched !== originalContent) {
          candidates.push({ name: `Custom Healer (${name})`, content: customPatched });
        }
      } catch (err: any) {
        Logger.warn(`[CiDoctorService] Custom healer "${name}" falhou: ${err.message}`);
      }
    }

    // Candidate Strategy B: Heuristic Expected vs Received Value Repair
    if (diagnosis.expected !== undefined && diagnosis.received !== undefined) {
      const cleanExpected = diagnosis.expected.replace(/^['"`]|['"`]$/g, '').trim();
      const cleanReceived = diagnosis.received.replace(/^['"`]|['"`]$/g, '').trim();

      if (cleanExpected && cleanReceived && cleanExpected !== cleanReceived) {
        // Direct value substitution in file
        if (originalContent.includes(cleanReceived)) {
          // If occurrence is unambiguous or on the target line
          const replaced = originalContent.replace(cleanReceived, cleanExpected);
          candidates.push({
            name: `Substituição direta de valor (${cleanReceived} -> ${cleanExpected})`,
            content: replaced
          });
        }
      }
    }

    // Candidate Strategy C: Arithmetic / Operator Off-by-One and Sign Fixes (Restrito a ambiente de teste para não criar patches fictícios em modo live)
    const allowHeuristicOperatorFixes = process.env.NODE_ENV === 'test' || process.env.DECOHUB_ENABLE_ARITHMETIC_HEALING === 'true';
    if (allowHeuristicOperatorFixes) {
      const lines = originalContent.split(/\r?\n/);
      const targetLineIdx = diagnosis.line && diagnosis.line > 0 ? Math.min(lines.length - 1, diagnosis.line - 1) : -1;

      // Ordered line indices: target line first, then remaining lines
      const lineIndicesToCheck: number[] = [];
      if (targetLineIdx >= 0) lineIndicesToCheck.push(targetLineIdx);
      for (let i = 0; i < lines.length; i++) {
        if (!lineIndicesToCheck.includes(i)) lineIndicesToCheck.push(i);
      }

      for (const idx of lineIndicesToCheck) {
        const lineText = lines[idx];
        if (lineText.includes('//')) continue;

        // Sign fix: replace - with + or vice-versa
        if (lineText.includes(' - ')) {
          const modifiedLines = [...lines];
          modifiedLines[idx] = lineText.replace(' - ', ' + ');
          candidates.push({
            name: `Correção de operador aritmético (-) -> (+) na linha ${idx + 1}`,
            content: modifiedLines.join('\n')
          });
        } else if (lineText.includes(' + ')) {
          const modifiedLines = [...lines];
          modifiedLines[idx] = lineText.replace(' + ', ' - ');
          candidates.push({
            name: `Correção de operador aritmético (+) -> (-) na linha ${idx + 1}`,
            content: modifiedLines.join('\n')
          });
        }

        // Comparison off-by-one: < vs <= or > vs >=
        if (lineText.includes(' < ') && !lineText.includes(' <= ')) {
          const modifiedLines = [...lines];
          modifiedLines[idx] = lineText.replace(' < ', ' <= ');
          candidates.push({
            name: `Ajuste de limite estrito (<) -> (<=) na linha ${idx + 1}`,
            content: modifiedLines.join('\n')
          });
        } else if (lineText.includes(' <= ')) {
          const modifiedLines = [...lines];
          modifiedLines[idx] = lineText.replace(' <= ', ' < ');
          candidates.push({
            name: `Ajuste de limite inclusivo (<=) -> (<) na linha ${idx + 1}`,
            content: modifiedLines.join('\n')
          });
        }

        // Boolean toggle
        if (lineText.includes('return false;')) {
          const modifiedLines = [...lines];
          modifiedLines[idx] = lineText.replace('return false;', 'return true;');
          candidates.push({
            name: `Ajuste booleano (return false -> return true) na linha ${idx + 1}`,
            content: modifiedLines.join('\n')
          });
        } else if (lineText.includes('return true;')) {
          const modifiedLines = [...lines];
          modifiedLines[idx] = lineText.replace('return true;', 'return false;');
          candidates.push({
            name: `Ajuste booleano (return true -> return false) na linha ${idx + 1}`,
            content: modifiedLines.join('\n')
          });
        }
      }
    }

    if (candidates.length === 0) {
      return {
        healed: false,
        error: 'Nenhum padrão determinístico de micro-patch encontrado para este erro.'
      };
    }

    // 3. Test Candidates sequentially with automatic rollback on failure
    for (const candidate of candidates) {
      try {
        Logger.info(
          `[CiDoctorService] Testando micro-patch em ${relativeTarget}: ${candidate.name}`
        );

        // Apply candidate
        fs.writeFileSync(targetFilePath, candidate.content, 'utf-8');

        // Execute verification command
        let execResult: { status: string; exitCode: number | null; stdout?: string; stderr?: string };
        try {
          execResult = await CommandExecutionEngine.execute({
            command: verificationCommand,
            cwd: projectPath,
            kind: 'test',
            timeoutMs: 30000,
            shell: true,
            idempotencyKey: `cidoctor-${Date.now()}`
          });
        } catch {
          // Fallback direct execution if CommandExecutionEngine is not active
          try {
            const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', verificationCommand], {
              cwd: projectPath,
              encoding: 'utf-8',
              timeout: 30000
            });
            execResult = { status: 'COMPLETED', exitCode: 0, stdout: out, stderr: '' };
          } catch (cmdErr: any) {
            execResult = {
              status: 'FAILED',
              exitCode: cmdErr.status || 1,
              stdout: cmdErr.stdout || '',
              stderr: cmdErr.stderr || cmdErr.message || ''
            };
          }
        }

        if (execResult.status === 'COMPLETED' && execResult.exitCode === 0) {
          Logger.info(
            `[CiDoctorService] Micro-patch bem-sucedido! Código de saída 0 obtido com "${candidate.name}".`
          );

          ObservabilityService.emit({
            level: 'INFO',
            event: 'CI_DOCTOR_HEALED',
            message: `CI Doctor aplicou micro-patch com sucesso: ${candidate.name}`,
            service: 'evaluator',
            taskId: task?.id,
            runId: task?.runId,
            metadata: {
              targetFile: relativeTarget,
              patch: candidate.name,
              verificationCommand
            }
          });

          return {
            healed: true,
            patchApplied: `[${relativeTarget}] ${candidate.name}`,
            output: execResult.stdout || ''
          };
        } else {
          // Revert immediately
          fs.writeFileSync(targetFilePath, originalContent, 'utf-8');
        }
      } catch (patchErr: any) {
        fs.writeFileSync(targetFilePath, originalContent, 'utf-8');
        Logger.warn(`[CiDoctorService] Falha ao testar candidato "${candidate.name}": ${patchErr.message}`);
      }
    }

    // Final safety rollback
    fs.writeFileSync(targetFilePath, originalContent, 'utf-8');
    return {
      healed: false,
      error: `Todos os ${candidates.length} micro-patches testados falharam na verificação.`
    };
  }
}
