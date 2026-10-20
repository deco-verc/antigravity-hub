import fs from 'node:fs';
import path from 'node:path';
import { GitManager, GitInfo } from './gitManager.js';
import { SecurityManager } from './security.js';
import { Logger } from './logger.js';

export interface AnalysisResult {
  projectName: string;
  folderPath: string;
  isEmpty: boolean;
  detectedCategories: {
    frontend: string[];
    backend: string[];
    infra: string[];
    ai: string[];
  };
  detectedStack: string[];
  primaryStack: string;
  importantFiles: string[];
  scripts: Record<string, string>;
  hasGit: boolean;
  gitInfo: GitInfo;
  readmeExcerpt?: string;
  summary: string;
  fileTree: string[];
  scannedFilesCount: number;
  packageDetails?: {
    name?: string;
    version?: string;
    description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.venv',
  'venv',
  'env',
  '.env',
  'dist',
  'build',
  '.git',
  'cache',
  '.cache',
  '.next',
  '.nuxt',
  'out',
  'coverage',
  '.turbo',
  'target',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '.ai-dev-hub',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache'
]);

export class ProjectAnalyzer {
  static analyze(projectPath: string): AnalysisResult {
    // 1. Validate path safely
    const val = SecurityManager.validateProjectFolder(projectPath);
    if (!val.isValid || !val.exists) {
      Logger.warn(`Tentativa de analisar pasta inválida ou inexistente: ${projectPath}`);
      throw new Error(val.errorMessage || `Pasta inexistente: ${projectPath}`);
    }

    const resolved = val.resolvedPath;
    const projectName = path.basename(resolved);

    // If folder is empty
    if (val.isEmpty) {
      Logger.info(`Pasta vazia analisada: ${resolved}`);
      return {
        projectName,
        folderPath: resolved,
        isEmpty: true,
        detectedCategories: { frontend: [], backend: [], infra: [], ai: [] },
        detectedStack: ['Pasta Vazia'],
        primaryStack: 'Pasta Vazia',
        importantFiles: [],
        scripts: {},
        hasGit: false,
        gitInfo: {
          isGitRepo: false,
          branch: null,
          lastCommit: null,
          statusSummary: { modified: 0, newFiles: 0, deleted: 0, total: 0 },
          changedFiles: []
        },
        summary: `Projeto: ${projectName}\nStatus: Pasta vazia.\nO AI DEV HUB pode inicializar a memória permanente e a estrutura de tarefas.`,
        fileTree: [],
        scannedFilesCount: 0
      };
    }

    const frontend: Set<string> = new Set();
    const backend: Set<string> = new Set();
    const infra: Set<string> = new Set();
    const ai: Set<string> = new Set();
    const importantFiles: string[] = [];
    const scripts: Record<string, string> = {};
    const fileTree: string[] = [];
    let readmeExcerpt = '';
    let packageDetails: AnalysisResult['packageDetails'] = undefined;
    let scannedFilesCount = 0;

    // Scan top-level and first 2 levels for file tree, strictly skipping ignored heavy dirs
    const scanCounter = { count: 0 };
    this.scanDir(resolved, '', fileTree, 0, 2, scanCounter);
    scannedFilesCount = scanCounter.count;

    // -------------------------------------------------------------
    // 1. INSPECT NODE.JS / JS / TS (package.json)
    // -------------------------------------------------------------
    const pkgPath = path.join(resolved, 'package.json');
    if (fs.existsSync(pkgPath)) {
      importantFiles.push('package.json');
      try {
        const pkgContent = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        packageDetails = {
          name: pkgContent.name,
          version: pkgContent.version,
          description: pkgContent.description,
          dependencies: pkgContent.dependencies,
          devDependencies: pkgContent.devDependencies
        };

        if (pkgContent.scripts) {
          Object.assign(scripts, pkgContent.scripts);
        }

        const allDeps = {
          ...(pkgContent.dependencies || {}),
          ...(pkgContent.devDependencies || {})
        };

        backend.add('Node');

        // Frontend frameworks
        if (allDeps['react'] || allDeps['react-dom']) frontend.add('React');
        if (allDeps['next']) { frontend.add('Next.js'); backend.add('Next.js'); }
        if (allDeps['vue']) frontend.add('Vue');
        if (allDeps['nuxt']) { frontend.add('Nuxt'); backend.add('Nuxt'); }
        if (allDeps['svelte'] || allDeps['@sveltejs/kit']) frontend.add('Svelte');
        if (allDeps['@angular/core']) frontend.add('Angular');
        if (allDeps['vite']) frontend.add('Vite');
        if (allDeps['tailwindcss']) frontend.add('Tailwind CSS');

        // Backend frameworks
        if (allDeps['express']) backend.add('Express');
        if (allDeps['@nestjs/core']) backend.add('NestJS');
        if (allDeps['fastify']) backend.add('Fastify');

        // Infra & Databases
        if (allDeps['prisma'] || allDeps['@prisma/client']) infra.add('Prisma');
        if (allDeps['sqlite3'] || allDeps['better-sqlite3']) infra.add('SQLite');
        if (allDeps['pg'] || allDeps['postgres']) infra.add('Postgres');
        if (allDeps['redis'] || allDeps['ioredis']) infra.add('Redis');
      } catch (err: any) {
        Logger.warn(`Erro ao ler package.json de ${resolved}: ${err.message}`);
        backend.add('Node');
      }
    }

    // Check tsconfig
    if (fs.existsSync(path.join(resolved, 'tsconfig.json'))) {
      importantFiles.push('tsconfig.json');
    }

    // -------------------------------------------------------------
    // 2. INSPECT PYTHON & AI (requirements.txt, pyproject.toml, Pipfile, setup.py, source files)
    // -------------------------------------------------------------
    const pyprojectPath = path.join(resolved, 'pyproject.toml');
    const requirementsPath = path.join(resolved, 'requirements.txt');
    const pipfilePath = path.join(resolved, 'Pipfile');
    const setupPyPath = path.join(resolved, 'setup.py');

    let pyCombined = '';
    const readPyConfig = (f: string) => {
      try {
        if (fs.existsSync(f)) {
          importantFiles.push(path.basename(f));
          return fs.readFileSync(f, 'utf-8').toLowerCase();
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "analyzer",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:analyzer]", err);
      }
    }
      return '';
    };

    pyCombined += ' ' + readPyConfig(requirementsPath);
    pyCombined += ' ' + readPyConfig(pyprojectPath);
    pyCombined += ' ' + readPyConfig(pipfilePath);
    pyCombined += ' ' + readPyConfig(setupPyPath);

    // Also inspect python source files for imports if no config or in top files
    const pythonFiles = fileTree.filter(f => f.endsWith('.py')).slice(0, 5);
    for (const pyf of pythonFiles) {
      try {
        const fullPy = path.join(resolved, pyf);
        if (fs.existsSync(fullPy)) {
          const content = fs.readFileSync(fullPy, 'utf-8').slice(0, 2000).toLowerCase();
          pyCombined += ' ' + content;
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "analyzer",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:analyzer]", err);
      }
    }
    }

    if (pyCombined.trim()) {
      backend.add('Python');

      // Python backends
      if (pyCombined.includes('fastapi')) backend.add('FastAPI');
      if (pyCombined.includes('django')) backend.add('Django');
      if (pyCombined.includes('flask')) backend.add('Flask');

      // Python databases / infra
      if (pyCombined.includes('sqlite') || pyCombined.includes('sqlite3')) infra.add('SQLite');
      if (pyCombined.includes('psycopg2') || pyCombined.includes('asyncpg') || pyCombined.includes('postgresql')) infra.add('Postgres');
      if (pyCombined.includes('redis')) infra.add('Redis');

      // AI & ML
      if (pyCombined.includes('torch') || pyCombined.includes('pytorch')) ai.add('PyTorch');
      if (pyCombined.includes('transformers') || pyCombined.includes('huggingface')) ai.add('Transformers');
      if (pyCombined.includes('cuda') || pyCombined.includes('torch.cuda')) ai.add('CUDA');
      if (pyCombined.includes('chatterbox')) ai.add('Chatterbox');
      if (pyCombined.includes('whisper') || pyCombined.includes('openai-whisper')) ai.add('Whisper');
      if (pyCombined.includes('tts') || pyCombined.includes('coqui-tts') || pyCombined.includes('elevenlabs') || pyCombined.includes('soundfile')) ai.add('TTS');
    }

    // -------------------------------------------------------------
    // 3. INSPECT INFRASTRUCTURE & CONTAINERS
    // -------------------------------------------------------------
    if (fs.existsSync(path.join(resolved, 'Dockerfile'))) {
      importantFiles.push('Dockerfile');
      infra.add('Docker');
    }
    if (
      fs.existsSync(path.join(resolved, 'docker-compose.yml')) ||
      fs.existsSync(path.join(resolved, 'docker-compose.yaml')) ||
      fs.existsSync(path.join(resolved, 'compose.yaml'))
    ) {
      importantFiles.push('docker-compose.yml');
      infra.add('Docker Compose');
    }
    if (fs.existsSync(path.join(resolved, 'prisma', 'schema.prisma'))) {
      importantFiles.push('prisma/schema.prisma');
      infra.add('Prisma');
    }

    // -------------------------------------------------------------
    // 4. INSPECT README
    // -------------------------------------------------------------
    const readmeCandidates = ['README.md', 'readme.md', 'README.txt', 'README'];
    for (const r of readmeCandidates) {
      const rPath = path.join(resolved, r);
      if (fs.existsSync(rPath)) {
        importantFiles.push(r);
        try {
          const raw = fs.readFileSync(rPath, 'utf-8');
          readmeExcerpt = raw.slice(0, 1000).trim();
          break;
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "analyzer",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:analyzer]", err);
      }
    }
      }
    }

    // -------------------------------------------------------------
    // 5. INSPECT GIT
    // -------------------------------------------------------------
    const gitInfo = GitManager.getGitInfo(resolved);

    // Combine detected stack
    const detectedCategories = {
      frontend: Array.from(frontend),
      backend: Array.from(backend),
      infra: Array.from(infra),
      ai: Array.from(ai)
    };

    const allDetected = [
      ...detectedCategories.frontend,
      ...detectedCategories.backend,
      ...detectedCategories.infra,
      ...detectedCategories.ai
    ];

    const detectedStack = allDetected.length > 0 ? allDetected : ['Geral'];
    const primaryStack = detectedStack.join(' + ');

    // Summary text
    const summaryLines: string[] = [
      `Projeto: ${projectName}`,
      `Stack Detectada: ${primaryStack}`,
      `Repositório Git: ${gitInfo.isGitRepo ? `Sim (Branch: ${gitInfo.branch || 'principal'})` : 'Não inicializado'}`,
      `Arquivos Importantes: ${importantFiles.join(', ') || 'Nenhum identificado'}`,
      `Arquivos Escaneados: ~${scannedFilesCount} arquivos`
    ];

    if (gitInfo.lastCommit) {
      summaryLines.push(`Último commit: "${gitInfo.lastCommit.message}" (${gitInfo.lastCommit.hash}) por ${gitInfo.lastCommit.author}`);
    }

    if (Object.keys(scripts).length > 0) {
      summaryLines.push(`Scripts disponíveis: ${Object.keys(scripts).join(', ')}`);
    }

    Logger.info(`Projeto analisado: ${projectName}`, {
      detectedStack,
      hasGit: gitInfo.isGitRepo,
      scannedFilesCount
    });

    return {
      projectName,
      folderPath: resolved,
      isEmpty: false,
      detectedCategories,
      detectedStack,
      primaryStack,
      importantFiles,
      scripts,
      hasGit: gitInfo.isGitRepo,
      gitInfo,
      readmeExcerpt,
      summary: summaryLines.join('\n'),
      fileTree,
      scannedFilesCount,
      packageDetails
    };
  }

  private static scanDir(
    dir: string,
    relativePath: string,
    result: string[],
    depth: number,
    maxDepth: number,
    counter: { count: number }
  ) {
    if (depth > maxDepth || result.length >= 100) return;

    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (IGNORED_DIRS.has(item.name)) continue;
        if (item.name.startsWith('.') && item.name !== '.env.example') continue;

        counter.count++;
        const rel = relativePath ? `${relativePath}/${item.name}` : item.name;

        if (item.isDirectory()) {
          result.push(`${rel}/`);
          this.scanDir(path.join(dir, item.name), rel, result, depth + 1, maxDepth, counter);
        } else {
          result.push(rel);
        }

        if (result.length >= 100) break;
      }
    } catch {
      // Permission or read error handled safely
    }
  }
}
