import fs from 'node:fs';
import path from 'node:path';

const TARGET_EXTENSIONS = ['.js', '.mjs', '.ts'];
const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next'];

let totalDotCatchesFixed = 0;
let totalTryCatchesFixed = 0;

function getContext(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const fileName = path.basename(filePath, path.extname(filePath));
  
  let service = 'app';
  if (normalized.includes('/server/')) {
    service = 'server';
  } else if (normalized.includes('/services/')) {
    service = 'services';
  } else if (normalized.includes('/routes/')) {
    service = 'routes';
  }

  return {
    service,
    file: fileName
  };
}

function createCatchLogger(ctx, errVar = 'error') {
  return [
    ' {',
    '      if (typeof logger !== "undefined" && logger.warn) {',
    '        logger.warn({',
    '          event: "' + ctx.service + '.handled_exception",',
    '          file: "' + ctx.file + '",',
    '          error: ' + errVar + '?.message || String(' + errVar + ')',
    '        });',
    '      } else {',
    '        console.warn("[WARN][' + ctx.service + ':' + ctx.file + ']", ' + errVar + ');',
    '      }',
    '    }'
  ].join('\n');
}

function processSourceCode(content, filePath) {
  const ctx = getContext(filePath);
  let modified = content;

  // 1. Corrige promessas silenciosas: .catch(() => {}) ou .catch((err) => {})
  const dotCatchRegex = /\.catch\s*\(\s*(?:\((?:[a-zA-Z0-9_$]+)?\)|[a-zA-Z0-9_$]+)?\s*=>\s*\{(?:\s*;\s*)?\}\s*\)/g;
  
  if (dotCatchRegex.test(modified)) {
    modified = modified.replace(dotCatchRegex, () => {
      totalDotCatchesFixed++;
      return '.catch((err) =>' + createCatchLogger(ctx, 'err') + ')';
    });
  }

  // 2. Corrige blocos try/catch vazios: catch (err) {} ou catch {}
  const emptyCatchRegex = /catch\s*(?:\(([a-zA-Z0-9_$]+)\))?\s*\{\s*\}/g;
  
  if (emptyCatchRegex.test(modified)) {
    modified = modified.replace(emptyCatchRegex, (_, varName) => {
      totalTryCatchesFixed++;
      const errIdentifier = varName || 'err';
      return 'catch (' + errIdentifier + ')' + createCatchLogger(ctx, errIdentifier);
    });
  }

  return modified;
}

function walkAndFix(currentDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.includes(entry.name)) {
        walkAndFix(fullPath);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (TARGET_EXTENSIONS.includes(ext) && entry.name !== 'fix-silent-errors.mjs') {
        try {
          const original = fs.readFileSync(fullPath, 'utf8');
          const transformed = processSourceCode(original, fullPath);

          if (original !== transformed) {
            fs.writeFileSync(fullPath, transformed, 'utf8');
            console.log('Corrigido: ' + fullPath);
          }
        } catch (readErr) {
          console.error('Erro ao ler ' + fullPath + ':', readErr.message);
        }
      }
    }
  }
}

const targetDirectory = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

console.log('Iniciando varredura em: ' + targetDirectory);
walkAndFix(targetDirectory);

console.log('--- Resumo das Correções ---');
console.log('Concluído! .catch(() => {}) corrigidos: ' + totalDotCatchesFixed);
console.log('Concluído! try/catch vazios corrigidos: ' + totalTryCatchesFixed);