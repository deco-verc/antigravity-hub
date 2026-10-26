import fs from 'node:fs';
import path from 'node:path';

export const ALLOWED_VERIFICATION_GRAMMAR_SUMMARY = [
  'npm test',
  'npm run test',
  'npm run typecheck',
  'npm run build',
  'npm run lint',
  'node --test',
  'node --test <arquivo-relativo>',
  'node <arquivo.js>',
  'node --check <arquivo.js>',
  'node -c <arquivo.js>',
  'node -e "process.exit(0)"',
  'tsc --noEmit'
].join(' | ');

export interface VerificationCommandValidationResult {
  valid: boolean;
  code?: string;
  reason?: string;
}

export interface NormalizedVerificationCommandResult {
  validInitially: boolean;
  command: string;
  originalCommand: string;
  recovered: boolean;
  reason?: string;
}

/**
 * Checks whether a given file name corresponds to a test file convention.
 * When isInsideTestDir is true, any code file (except test helpers/fixtures/setups) is considered a test.
 */
export function isTestFileName(fileName: string, isInsideTestDir = false): boolean {
  if (isInsideTestDir) {
    if (/^(?:setup|fixture|fixtures|testSetup|helper|helpers)\.[cm]?[jt]sx?$/i.test(fileName)) {
      return false;
    }
    if (/\.[cm]?[jt]sx?$/i.test(fileName)) {
      return true;
    }
  }
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(fileName) ||
    /[-_](?:test|spec)\.[cm]?[jt]sx?$/i.test(fileName) ||
    /^(?:test|tests|spec|specs)\.[cm]?[jt]sx?$/i.test(fileName) ||
    /\btest_[a-zA-Z0-9_-]+\.py$/i.test(fileName) ||
    /[a-zA-Z0-9_-]+_test\.py$/i.test(fileName)
  );
}

/** Node 24 treats `node --test test/` as a module path. Enumerate real test files explicitly. */
export function resolveVerificationCommand(command: string, projectPath: string): string {
  const trimmed = command.trim();
  // 1. Match node [--import ...] --test [test|tests|__tests__] or bare node --test
  const match = trimmed.match(/^node\s+(?:--import\s+[^\s]+\s+)?--test(?:\s+["']?(test|tests|__tests__)[\\/]?(?:["']|$))?$/);
  if (match) {
    const candidateDir = match[1] || (
      fs.existsSync(path.join(projectPath, 'test')) ? 'test' :
      fs.existsSync(path.join(projectPath, 'tests')) ? 'tests' :
      fs.existsSync(path.join(projectPath, '__tests__')) ? '__tests__' : ''
    );
    const files: string[] = [];
    if (candidateDir) {
      const folder = path.join(projectPath, candidateDir);
      if (fs.existsSync(folder)) {
        if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('TEST_COMMAND_SYMLINK_DENIED');
        const walk = (dir: string) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isSymbolicLink()) throw new Error('TEST_COMMAND_SYMLINK_DENIED');
            const file = path.join(dir, e.name);
            if (e.isDirectory()) walk(file);
            else if (isTestFileName(e.name, true)) files.push(path.relative(projectPath, file).replace(/\\/g, '/'));
          }
        };
        walk(folder);
      }
    }

    // Bare node --test fallback: verify root-level test files (test.js, test.ts, etc.)
    if (!files.length && !match[1] && fs.existsSync(projectPath)) {
      try {
        for (const e of fs.readdirSync(projectPath, { withFileTypes: true })) {
          if (!e.isDirectory() && !e.isSymbolicLink() && isTestFileName(e.name, false)) {
            files.push(e.name);
          }
        }
      } catch {}
    }

    if (files.length) {
      if (files.some(f => !/^[a-zA-Z0-9_ ./-]+$/.test(f))) throw new Error('TEST_FILE_SHELL_CHARACTERS_DENIED');
      const hasTs = files.some(f => /\.[cm]?tsx?$/i.test(f));
      const baseCmd = hasTs ? 'node --import tsx --test ' : 'node --test ';
      return baseCmd + files.sort().map(f => '"' + f + '"').join(' ');
    } else if (match[1]) {
      throw new Error('TEST_DIRECTORY_HAS_NO_TEST_FILES');
    }
  }

  // 2. node --test with explicit test files: if any file is .ts/.tsx and --import tsx is missing, inject --import tsx
  if (/^node\s+--test\s+/.test(trimmed) && !trimmed.includes('--import')) {
    if (/\.[cm]?tsx?\b/i.test(trimmed)) {
      return trimmed.replace(/^node\s+--test/, 'node --import tsx --test');
    }
  }

  return command;
}

function parseCommandTokens(command: string): { ok: boolean; tokens: string[]; reason?: string } {
  if (/[;&|<>`$\r\n]/.test(command)) {
    return { ok: false, tokens: [], reason: 'COMMAND_REVIEW_REQUIRED: composição de shell não é uma operação automática' };
  }
  const parts = command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+/g);
  if (!parts || parts.join(' ').replace(/\s+/g, ' ') !== command.trim().replace(/\s+/g, ' ')) {
    return { ok: false, tokens: [], reason: 'COMMAND_REVIEW_REQUIRED: argumentos inválidos' };
  }
  return {
    ok: true,
    tokens: parts.map(p => (/^['"]/.test(p) ? p.slice(1, -1) : p))
  };
}

function checkInsideProject(root: string, file: string): { ok: boolean; target?: string; reason?: string } {
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, reason: 'COMMAND_REVIEW_REQUIRED: caminho fora do projeto' };
  }
  let segment = root;
  for (const part of relative.split(path.sep)) {
    segment = path.join(segment, part);
    if (fs.existsSync(segment) && fs.lstatSync(segment).isSymbolicLink()) {
      return { ok: false, reason: 'COMMAND_REVIEW_REQUIRED: link de filesystem não autorizado' };
    }
  }
  return { ok: true, target };
}

/**
 * Validates whether a verification command complies with controlledVerification.ts grammar and policy.
 */
export function validateVerificationCommand(
  command: string | undefined | null,
  projectPath: string,
  options?: { allowUncreatedFiles?: boolean }
): VerificationCommandValidationResult {
  const allowUncreatedFiles = options?.allowUncreatedFiles ?? false;
  const raw = typeof command === 'string' ? command.trim() : '';
  if (!raw) {
    return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: comando de verificação vazio' };
  }

  if (/^(?:node\s+-e\b|exit\s+0|true\b|echo\b|powershell\b|pwsh\b|cmd\b|sh\b|bash\b)/i.test(raw)) {
    if (/^node\s+-e\s+["']process\.exit\(0\);?["']/i.test(raw)) {
      return { valid: true };
    }
    return {
      valid: false,
      code: 'COMMAND_REVIEW_REQUIRED',
      reason: 'COMMAND_REVIEW_REQUIRED: comando inline, trivial ou shell explícito não é permitido no avaliador controlado'
    };
  }

  const root = path.resolve(projectPath);
  if (!allowUncreatedFiles && (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink())) {
    return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: diretório indisponível' };
  }

  let resolvedCmd = raw;
  try {
    resolvedCmd = resolveVerificationCommand(raw, root);
  } catch (err: any) {
    if (allowUncreatedFiles && err?.message === 'TEST_DIRECTORY_HAS_NO_TEST_FILES') {
      resolvedCmd = 'node --test';
    } else {
      return {
        valid: false,
        code: 'COMMAND_REVIEW_REQUIRED',
        reason: `COMMAND_REVIEW_REQUIRED: ${err?.message || 'falha ao resolver comando de teste'}`
      };
    }
  }

  const parsed = parseCommandTokens(resolvedCmd);
  if (!parsed.ok) {
    return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: parsed.reason };
  }

  let words = parsed.tokens;
  if (
    words[0] === 'npm' &&
    ((words.length === 2 && words[1] === 'test') ||
      (words.length === 3 && words[1] === 'run' && ['test', 'typecheck', 'build', 'lint'].includes(words[2])))
  ) {
    const scriptName = words.at(-1)!;
    const pkgCheck = checkInsideProject(root, 'package.json');
    if (!pkgCheck.ok) {
      return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: pkgCheck.reason };
    }
    if (fs.existsSync(pkgCheck.target!)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgCheck.target!, 'utf8'));
        if (pkg.scripts?.['pre' + scriptName] || pkg.scripts?.['post' + scriptName]) {
          return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: lifecycle do npm exige revisão' };
        }
        if (typeof pkg.scripts?.[scriptName] !== 'string') {
          return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: script do projeto ausente' };
        }
        let scriptCmd = pkg.scripts[scriptName];
        try {
          scriptCmd = resolveVerificationCommand(scriptCmd, root);
        } catch (err: any) {
          if (allowUncreatedFiles && err?.message === 'TEST_DIRECTORY_HAS_NO_TEST_FILES') {
            scriptCmd = 'node --test';
          } else {
            return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: `COMMAND_REVIEW_REQUIRED: ${err?.message}` };
          }
        }
        // Suporte a scripts compostos com && (ex: "npm run build && node --test" ou "tsc && node --test")
        if (scriptCmd.includes('&&') && !/[;<|>|`$\r\n]/.test(scriptCmd.replace(/&&/g, ''))) {
          const subParts = scriptCmd.split('&&').map(s => s.trim()).filter(Boolean);
          const allPartsValid = subParts.every(sub => {
            const subRes = validateVerificationCommand(sub, root, { allowUncreatedFiles });
            return subRes.valid;
          });
          if (allPartsValid && subParts.length > 0) {
            return { valid: true };
          }
        }
        const scriptParsed = parseCommandTokens(scriptCmd);
        if (!scriptParsed.ok) {
          return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: scriptParsed.reason };
        }
        words = scriptParsed.tokens;
      } catch {
        return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: package.json inválido' };
      }
    } else if (allowUncreatedFiles) {
      return { valid: true };
    } else {
      return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: package.json ausente no projeto' };
    }
  }

  if (words[0] === 'node') {
    const args = words.slice(1);
    if (args.includes('--test')) {
      const allowedFlags = ['--test', '--test-isolation=none', '--test-concurrency=1'];
      let safe = true;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (allowedFlags.includes(arg)) continue;
        if (arg === '--import' || arg === '--loader' || arg === '-r' || arg === '--require') {
          const next = args[++i];
          if (!next || !/^(?:tsx(?:\/esm)?|ts-node(?:\/register)?|[a-zA-Z0-9_./\\-]+)$/.test(next)) {
            safe = false;
            break;
          }
          if (next.startsWith('.') || next.includes('/') || next.includes('\\')) {
            const insideRes = checkInsideProject(root, next);
            if (!insideRes.ok) {
              safe = false;
              break;
            }
          }
          continue;
        }
        if (arg.startsWith('-')) {
          safe = false;
          break;
        }
        const insideRes = checkInsideProject(root, arg);
        if (!insideRes.ok) {
          safe = false;
          break;
        }
        if (!allowUncreatedFiles && !fs.existsSync(insideRes.target!)) {
          return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: `COMMAND_REVIEW_REQUIRED: arquivo de teste ausente no disco (${arg})` };
        }
      }
      if (safe) {
        return { valid: true };
      }
      return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: flags de testes fora da allowlist' };
    } else if (args[0] === '--check' || args[0] === '-c') {
      const file = args[1];
      if (!file || file.startsWith('-') || !/\.[cm]?js$/i.test(file)) {
        return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: somente arquivos JS locais são permitidos para validação de sintaxe' };
      }
      const insideRes = checkInsideProject(root, file);
      if (!insideRes.ok) {
        return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: insideRes.reason };
      }
      if (!allowUncreatedFiles && !fs.existsSync(insideRes.target!)) {
        return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: `COMMAND_REVIEW_REQUIRED: arquivo ausente (${file})` };
      }
      return { valid: true };
    } else if (args[0] === '-e' && args[1] && /^\s*process\.exit\(0\)\s*;?\s*$/.test(args[1])) {
      return { valid: true };
    } else {
      const file = args[0];
      if (!file || file.startsWith('-') || !/\.[cm]?js$/.test(file)) {
        return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: somente arquivos Node locais são permitidos' };
      }
      const insideRes = checkInsideProject(root, file);
      if (!insideRes.ok) {
        return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: insideRes.reason };
      }
      if (!allowUncreatedFiles && !fs.existsSync(insideRes.target!)) {
        return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: `COMMAND_REVIEW_REQUIRED: script Node ausente no disco (${file})` };
      }
      if (args.slice(1).some(a => !/^[-a-zA-Z0-9_.]+$/.test(a) || a.startsWith('--'))) {
        return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: argumento de script fora da allowlist' };
      }
      return { valid: true };
    }
  } else if (words[0] === 'tsc') {
    const allowedTscArgs = ['--noEmit', '-p', '--project', '-b', '--build'];
    const extraArgs = words.slice(1);
    const isValidTsc = extraArgs.length === 0 || extraArgs.every(a => allowedTscArgs.includes(a) || /^[a-zA-Z0-9_./\\-]+\.json$/i.test(a));
    if (!isValidTsc) {
      return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: argumentos do tsc fora da allowlist' };
    }
    const insideRes = checkInsideProject(root, 'node_modules/typescript/bin/tsc');
    if (!insideRes.ok) {
      return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: insideRes.reason };
    }
    return { valid: true };
  } else if (words[0] === 'npx') {
    const subTool = words[1];
    if (subTool === 'tsc') {
      const allowedTscArgs = ['--noEmit', '-p', '--project', '-b', '--build'];
      const extraArgs = words.slice(2);
      const isValidTsc = extraArgs.length === 0 || extraArgs.every(a => allowedTscArgs.includes(a) || /^[a-zA-Z0-9_./\\-]+\.json$/i.test(a));
      if (!isValidTsc) {
        return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: argumentos do npx tsc fora da allowlist' };
      }
      return { valid: true };
    } else if (subTool === 'tsx') {
      const extraArgs = words.slice(2);
      if (extraArgs.includes('--test')) {
        return { valid: true };
      }
    }
  }

  return {
    valid: false,
    code: 'COMMAND_REVIEW_REQUIRED',
    reason: 'COMMAND_REVIEW_REQUIRED: ferramenta ou script não reconhecido como operação delimitada'
  };
}

export function hasAnyTestFilesOnDisk(projectPath: string): boolean {
  if (!fs.existsSync(projectPath)) return false;
  const scan = (dir: string, depth: number, insideTestDir = false): boolean => {
    if (depth > 6) return false;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!['.git', 'node_modules', 'dist', 'build', '.ai-dev-hub', '.decohub-data'].includes(entry.name)) {
            const isTestFolder = insideTestDir || ['test', 'tests', '__tests__'].includes(entry.name.toLowerCase());
            if (scan(path.join(dir, entry.name), depth + 1, isTestFolder)) return true;
          }
        } else if (entry.isFile() && isTestFileName(entry.name, insideTestDir)) {
          return true;
        }
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "verificationCommand",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:verificationCommand]", err);
      }
    }
    return false;
  };
  return scan(projectPath, 0, false);
}

export function findCandidateJsFile(projectPath: string, scopeFiles?: string[]): string | null {
  if (!fs.existsSync(projectPath)) return null;

  // 1. Verifica arquivos de escopo explícitos fornecidos
  if (Array.isArray(scopeFiles)) {
    for (const file of scopeFiles) {
      if (typeof file === 'string' && /\.[cm]?[jt]sx?$/i.test(file)) {
        const full = path.resolve(projectPath, file);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return path.relative(projectPath, full).replace(/\\/g, '/');
        }
      }
    }
  }

  // 2. Pontos de entrada padrões comuns
  const candidates = [
    'src/index.ts',
    'src/index.js',
    'src/main.ts',
    'src/main.js',
    'src/app.ts',
    'src/app.js',
    'src/server.ts',
    'src/server.js',
    'index.ts',
    'index.js',
    'main.ts',
    'main.js',
    'app.ts',
    'app.js',
    'server.ts',
    'server.js'
  ];
  for (const c of candidates) {
    const full = path.resolve(projectPath, c);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return c;
    }
  }

  // 3. Varredura recursiva leve (profundidade máxima 3)
  const scan = (dir: string, depth: number): string | null => {
    if (depth > 3) return null;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!['.git', 'node_modules', 'dist', 'build', '.ai-dev-hub', '.decohub-data'].includes(entry.name)) {
            const found = scan(path.join(dir, entry.name), depth + 1);
            if (found) return found;
          }
        } else if (entry.isFile() && /\.[cm]?[jt]sx?$/i.test(entry.name)) {
          return path.relative(projectPath, path.join(dir, entry.name)).replace(/\\/g, '/');
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  return scan(projectPath, 0);
}

/**
 * Validates a verification command and, if invalid, recovers a canonical unambiguous command
 * supported by controlledVerification.ts ('npm test' or 'node --test').
 */
export function normalizeOrRecoverVerificationCommand(
  command: string | undefined | null,
  projectPath: string,
  options?: { allowUncreatedFiles?: boolean; requireCanonicalEvidenceOnDisk?: boolean; scopeFiles?: string[] }
): NormalizedVerificationCommandResult {
  const allowUncreatedFiles = options?.allowUncreatedFiles ?? true;
  const requireCanonicalEvidenceOnDisk = options?.requireCanonicalEvidenceOnDisk ?? false;
  const raw = typeof command === 'string' ? command.trim() : '';

  // 1. Checagem de npm test / npm run test sem package.json ou sem script test no disco
  const isNpmTest = /^(?:npm\s+test|npm\s+run\s+test)$/i.test(raw);
  if (isNpmTest && fs.existsSync(projectPath)) {
    const pkgPath = path.join(projectPath, 'package.json');
    let hasNpmTestScript = false;
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        hasNpmTestScript = typeof pkg.scripts?.test === 'string';
      } catch {
        hasNpmTestScript = false;
      }
    }

    if (!hasNpmTestScript) {
      if (hasAnyTestFilesOnDisk(projectPath)) {
        return {
          validInitially: false,
          command: 'node --test',
          originalCommand: raw,
          recovered: true,
          reason: 'package.json ou script test ausente no projeto; recuperado para node --test'
        };
      }
      const candidateJs = findCandidateJsFile(projectPath, options?.scopeFiles);
      if (candidateJs) {
        return {
          validInitially: false,
          command: `node --check "${candidateJs}"`,
          originalCommand: raw,
          recovered: true,
          reason: 'package.json ou script test ausente no projeto; recuperado para validação de sintaxe com node --check'
        };
      }
      return {
        validInitially: false,
        command: 'node -e "process.exit(0)"',
        originalCommand: raw,
        recovered: true,
        reason: 'package.json ou script test ausente no projeto; recuperado para validação segura de arquivos criados'
      };
    } else {
      return {
        validInitially: true,
        command: 'npm test',
        originalCommand: raw,
        recovered: false
      };
    }
  }

  // 1.5 Auto-promoção de comandos triviais quando há testes válidos no projeto
  const isTrivialCommand = !raw || /^(?:node\s+-e\s+["']\s*process\.exit\(0\);?["']|exit\s+0|true\b|echo\b)/i.test(raw);
  if (isTrivialCommand) {
    if (fs.existsSync(projectPath)) {
      const pkgPath = path.join(projectPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (typeof pkg.scripts?.test === 'string') {
            return {
              validInitially: false,
              command: 'npm test',
              originalCommand: raw,
              recovered: true,
              reason: 'Comando trivial ou vazio auto-promovido para o executor de testes canônico do projeto (npm test)'
            };
          }
        } catch {}
      }
    }
    const npmTestValid = validateVerificationCommand('npm test', projectPath, { allowUncreatedFiles: false }).valid;
    if (npmTestValid) {
      return {
        validInitially: false,
        command: 'npm test',
        originalCommand: raw,
        recovered: true,
        reason: 'Comando trivial ou vazio auto-promovido para o executor de testes canônico do projeto (npm test)'
      };
    }
    if (hasAnyTestFilesOnDisk(projectPath)) {
      return {
        validInitially: false,
        command: 'node --test',
        originalCommand: raw,
        recovered: true,
        reason: 'Comando trivial ou vazio auto-promovido para testes encontrados em disco (node --test)'
      };
    }
  }

  const initialValidation = validateVerificationCommand(raw, projectPath, { allowUncreatedFiles });
  if (initialValidation.valid) {
    let normalizedCmd = raw;
    const dirMatch = raw.match(/^node\s+--test\s+["']?(test|tests)[\\/]?["']?$/);
    if (dirMatch) {
      const folder = path.join(projectPath, dirMatch[1]);
      if (!fs.existsSync(folder)) {
        normalizedCmd = 'node --test';
      }
    }
    return {
      validInitially: true,
      command: normalizedCmd,
      originalCommand: raw,
      recovered: normalizedCmd !== raw,
      reason: normalizedCmd !== raw ? 'Diretório de testes ainda não existe; normalizado para node --test' : undefined
    };
  }

  // Attempt extraction from compound commands (e.g. "node --check a.js && npm test" or "node --check a.js && node --test test/a.test.js")
  if (raw && /[;&|]/.test(raw)) {
    const segments = raw
      .split(/&&|\|\||;|\|/)
      .map(s => s.trim())
      .filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (/^(?:npm\s+(?:test|run\s+(?:test|typecheck|build|lint))|node\s+--test\b|node\s+(?:--check|-c)\b|tsc\s+--noEmit)/i.test(seg)) {
        const segValidation = validateVerificationCommand(seg, projectPath, { allowUncreatedFiles });
        if (segValidation.valid) {
          return {
            validInitially: false,
            command: seg,
            originalCommand: raw,
            recovered: true,
            reason: initialValidation.reason
          };
        }
      }
    }
  }

  // Check if canonical 'npm test' is valid on disk
  if (fs.existsSync(projectPath)) {
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (typeof pkg.scripts?.test === 'string') {
          return {
            validInitially: false,
            command: 'npm test',
            originalCommand: raw,
            recovered: true,
            reason: initialValidation.reason || 'Recuperado para npm test definido no package.json do projeto'
          };
        }
      } catch {}
    }
  }
  const npmTestValid = validateVerificationCommand('npm test', projectPath, { allowUncreatedFiles: false }).valid;
  if (npmTestValid) {
    return {
      validInitially: false,
      command: 'npm test',
      originalCommand: raw,
      recovered: true,
      reason: initialValidation.reason
    };
  }

  // Check if test files exist on disk or if uncreated files are allowed (planning phase)
  if (!requireCanonicalEvidenceOnDisk || hasAnyTestFilesOnDisk(projectPath)) {
    return {
      validInitially: false,
      command: 'node --test',
      originalCommand: raw,
      recovered: true,
      reason: initialValidation.reason
    };
  }

  const candidateJs = findCandidateJsFile(projectPath, options?.scopeFiles);
  if (candidateJs) {
    return {
      validInitially: false,
      command: `node --check "${candidateJs}"`,
      originalCommand: raw,
      recovered: true,
      reason: initialValidation.reason
    };
  }

  return {
    validInitially: false,
    command: 'node -e "process.exit(0)"',
    originalCommand: raw,
    recovered: true,
    reason: initialValidation.reason
  };
}

