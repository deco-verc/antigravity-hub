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

/** Node 24 treats `node --test test/` as a module path. Enumerate real test files explicitly. */
export function resolveVerificationCommand(command: string, projectPath: string): string {
  const match = command.trim().match(/^node\s+--test\s+["']?(test|tests)[\\/]?["']?$/);
  if (!match) return command;
  const folder = path.join(projectPath, match[1]);
  const files: string[] = [];
  if (fs.existsSync(folder)) {
    if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('TEST_COMMAND_SYMLINK_DENIED');
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink()) throw new Error('TEST_COMMAND_SYMLINK_DENIED');
        const file = path.join(dir, e.name);
        if (e.isDirectory()) walk(file);
        else if (/\.(test|spec)\.[cm]?js$/i.test(e.name)) files.push(path.relative(projectPath, file).replace(/\\/g, '/'));
      }
    };
    walk(folder);
  }
  if (!files.length) throw new Error('TEST_DIRECTORY_HAS_NO_TEST_FILES');
  if (files.some(f => !/^[a-zA-Z0-9_ ./-]+$/.test(f))) throw new Error('TEST_FILE_SHELL_CHARACTERS_DENIED');
  return 'node --test ' + files.sort().map(f => '"' + f + '"').join(' ');
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
    if (args[0] === '--test') {
      if (args.slice(1).some(a => a.startsWith('-'))) {
        return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: 'COMMAND_REVIEW_REQUIRED: flags de testes fora da allowlist' };
      }
      for (const file of args.slice(1)) {
        const insideRes = checkInsideProject(root, file);
        if (!insideRes.ok) {
          return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: insideRes.reason };
        }
        if (!allowUncreatedFiles && !fs.existsSync(insideRes.target!)) {
          return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: `COMMAND_REVIEW_REQUIRED: arquivo de teste ausente no disco (${file})` };
        }
      }
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
  } else if (words[0] === 'tsc' && words.slice(1).every(a => a === '--noEmit')) {
    const insideRes = checkInsideProject(root, 'node_modules/typescript/bin/tsc');
    if (!insideRes.ok) {
      return { valid: false, code: 'COMMAND_REVIEW_REQUIRED', reason: insideRes.reason };
    }
    return { valid: true };
  }

  return {
    valid: false,
    code: 'COMMAND_REVIEW_REQUIRED',
    reason: 'COMMAND_REVIEW_REQUIRED: ferramenta ou script não reconhecido como operação delimitada'
  };
}

function hasAnyTestFilesOnDisk(projectPath: string): boolean {
  if (!fs.existsSync(projectPath)) return false;
  const scan = (dir: string, depth: number): boolean => {
    if (depth > 6) return false;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!['.git', 'node_modules', 'dist', 'build', '.ai-dev-hub', '.decohub-data'].includes(entry.name)) {
            if (scan(path.join(dir, entry.name), depth + 1)) return true;
          }
        } else if (entry.isFile() && /\.(test|spec)\.[cm]?js$/i.test(entry.name)) {
          return true;
        }
      }
    } catch {}
    return false;
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
  options?: { allowUncreatedFiles?: boolean; requireCanonicalEvidenceOnDisk?: boolean }
): NormalizedVerificationCommandResult {
  const allowUncreatedFiles = options?.allowUncreatedFiles ?? true;
  const requireCanonicalEvidenceOnDisk = options?.requireCanonicalEvidenceOnDisk ?? false;
  const raw = typeof command === 'string' ? command.trim() : '';

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
      if (/^(?:npm\s+(?:test|run\s+(?:test|typecheck|build|lint))|node\s+--test\b|tsc\s+--noEmit)/i.test(seg)) {
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

  return {
    validInitially: false,
    command: raw,
    originalCommand: raw,
    recovered: false,
    reason: initialValidation.reason
  };
}

