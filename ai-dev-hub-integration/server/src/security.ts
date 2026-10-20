import path from 'node:path';
import fs from 'node:fs';

const ALLOWED_MEMORY_FILES = new Set([
  'project.md',
  'architecture.md',
  'decisions.md',
  'tasks.md',
  'changes.md',
  'session-summary.md'
]);

export interface ValidatedPathResult {
  isValid: boolean;
  resolvedPath: string;
  exists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  errorMessage?: string;
}

export class SecurityManager {
  static validateProjectFolder(inputPath: string): ValidatedPathResult {
    if (!inputPath || typeof inputPath !== 'string') {
      return {
        isValid: false,
        resolvedPath: '',
        exists: false,
        isDirectory: false,
        isEmpty: false,
        errorMessage: 'O caminho da pasta não pode ser vazio.'
      };
    }

    // Check for null byte injection
    if (inputPath.includes('\0')) {
      return {
        isValid: false,
        resolvedPath: '',
        exists: false,
        isDirectory: false,
        isEmpty: false,
        errorMessage: 'Caractere nulo inválido no caminho.'
      };
    }

    try {
      const resolved = path.resolve(inputPath.trim());

      // Prevent selecting just root drive (e.g. C:\ or /)
      const parsed = path.parse(resolved);
      if (parsed.root === resolved) {
        return {
          isValid: false,
          resolvedPath: resolved,
          exists: true,
          isDirectory: true,
          isEmpty: false,
          errorMessage: 'Não é permitido registrar a raiz da unidade de disco como um projeto.'
        };
      }

      if (!fs.existsSync(resolved)) {
        return {
          isValid: false,
          resolvedPath: resolved,
          exists: false,
          isDirectory: false,
          isEmpty: false,
          errorMessage: `A pasta não existe no disco: ${resolved}`
        };
      }

      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return {
          isValid: false,
          resolvedPath: resolved,
          exists: true,
          isDirectory: false,
          isEmpty: false,
          errorMessage: `O caminho especificado aponta para um arquivo, não para uma pasta: ${resolved}`
        };
      }

      // Check if directory is empty
      let isEmpty = false;
      try {
        const files = fs.readdirSync(resolved);
        isEmpty = files.length === 0;
      } catch {
        isEmpty = false;
      }

      return {
        isValid: true,
        resolvedPath: resolved,
        exists: true,
        isDirectory: true,
        isEmpty
      };
    } catch (err: any) {
      return {
        isValid: false,
        resolvedPath: '',
        exists: false,
        isDirectory: false,
        isEmpty: false,
        errorMessage: `Erro ao validar caminho: ${err.message}`
      };
    }
  }

  static sanitizeMemoryFilename(filename: string): string {
    const base = path.basename(filename);
    if (!ALLOWED_MEMORY_FILES.has(base)) {
      throw new Error(`Arquivo de memória não autorizado: "${filename}". Apenas arquivos em .ai-dev-hub/ são permitidos.`);
    }
    return base;
  }
}
