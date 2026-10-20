import fs from 'node:fs';
import path from 'node:path';

export interface TestSelectionPlan {
  mode: 'FOCUSED' | 'FULL_SUITE';
  matchedTests: string[];
  suggestedCommand: string;
  fullSuiteCommand: string;
  requiresFullSuite: boolean;
  reason: string;
  confidence: 'HIGH' | 'MEDIUM' | 'FALLBACK';
}

const BROAD_IMPACT_PATTERNS = [
  /package\.json$/i,
  /tsconfig.*\.json$/i,
  /(?:^|[\\/])db\.[cm]?[jt]s$/i,
  /(?:^|[\\/])schema\.[cm]?[jt]s$/i,
  /(?:^|[\\/])routes\.[cm]?[jt]s$/i,
  /(?:^|[\\/])index\.[cm]?[jt]s$/i,
  /(?:^|[\\/])types\.[cm]?[jt]s$/i
];

export class TestSelector {
  /**
   * Discovers existing test files in a project.
   */
  static findProjectTestFiles(projectPath: string): string[] {
    const root = path.resolve(projectPath);
    const testFiles: string[] = [];

    const testDirs = ['test', 'tests', '__tests__', 'src'];
    const visited = new Set<string>();

    const walk = (dir: string) => {
      if (!fs.existsSync(dir) || visited.has(dir)) return;
      visited.add(dir);

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'dist-desktop') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
            const rel = path.relative(root, fullPath).replace(/\\/g, '/');
            testFiles.push(rel);
          }
        }
      } catch {}
    };

    for (const d of testDirs) {
      walk(path.join(root, d));
    }

    return testFiles.sort();
  }

  /**
   * Analyzes changed files and plans the optimal verification test strategy.
   * Prioritizes focused tests (< 1s) for fast iteration while strictly requiring
   * the full suite on broad impact or delivery gates.
   */
  static planVerification(
    projectPath: string,
    filesChanged: string[] = [],
    options?: { isFinalGate?: boolean; defaultTestCommand?: string }
  ): TestSelectionPlan {
    const root = path.resolve(projectPath);
    let fullSuiteCommand = options?.defaultTestCommand || 'npm test';

    // Inspect package.json to resolve project's default test command
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts?.test) {
          fullSuiteCommand = 'npm test';
        }
      } catch {}
    }

    // 1. Mandatory Full Suite Gates
    if (options?.isFinalGate) {
      return {
        mode: 'FULL_SUITE',
        matchedTests: [],
        suggestedCommand: fullSuiteCommand,
        fullSuiteCommand,
        requiresFullSuite: true,
        reason: 'Portão final de homologação/entrega exige validação completa de regressão.',
        confidence: 'HIGH'
      };
    }

    if (!filesChanged || filesChanged.length === 0) {
      return {
        mode: 'FULL_SUITE',
        matchedTests: [],
        suggestedCommand: fullSuiteCommand,
        fullSuiteCommand,
        requiresFullSuite: true,
        reason: 'Nenhum arquivo modificado especificado; executando suíte completa defensiva.',
        confidence: 'FALLBACK'
      };
    }

    // 2. Broad Impact Check: Changes to central schemas, configs, routers or many files (> 5)
    const hasBroadImpact = filesChanged.some(f => BROAD_IMPACT_PATTERNS.some(p => p.test(f)));
    if (hasBroadImpact || filesChanged.length > 5) {
      return {
        mode: 'FULL_SUITE',
        matchedTests: [],
        suggestedCommand: fullSuiteCommand,
        fullSuiteCommand,
        requiresFullSuite: true,
        reason: `Alterações com impacto estrutural amplo detectadas (${filesChanged.length} arquivos ou arquivos centrais modificados).`,
        confidence: 'HIGH'
      };
    }

    // 3. Find test files in project
    const availableTests = this.findProjectTestFiles(root);
    if (availableTests.length === 0) {
      return {
        mode: 'FULL_SUITE',
        matchedTests: [],
        suggestedCommand: fullSuiteCommand,
        fullSuiteCommand,
        requiresFullSuite: true,
        reason: 'Nenhum arquivo de teste específico encontrado no projeto; recorrendo ao script padrão.',
        confidence: 'FALLBACK'
      };
    }

    // 4. Map changed source files to candidate test files
    const matchedTests = new Set<string>();

    for (const changed of filesChanged) {
      const normalizedChanged = changed.replace(/\\/g, '/');
      const basename = path.basename(normalizedChanged).replace(/\.[^.]+$/, '');

      // Check if changed file is itself a test file
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(normalizedChanged)) {
        const found = availableTests.find(t => t.toLowerCase() === normalizedChanged.toLowerCase() || t.endsWith(normalizedChanged));
        if (found) matchedTests.add(found);
        continue;
      }

      // Match source file to corresponding test file (e.g. updateService.ts -> updateService.test.ts)
      for (const t of availableTests) {
        const testBasename = path.basename(t).replace(/\.(?:test|spec)\.[^.]+$/, '');
        if (testBasename.toLowerCase() === basename.toLowerCase()) {
          matchedTests.add(t);
        }
      }
    }

    const matchedList = Array.from(matchedTests).sort();

    // 5. Build focused test command if matches found
    if (matchedList.length > 0) {
      // Check if project is Node native runner or npm script
      let suggestedCommand = '';
      if (matchedList.every(t => t.endsWith('.ts'))) {
        suggestedCommand = `node --import tsx --test ${matchedList.map(t => `"${t}"`).join(' ')}`;
      } else {
        suggestedCommand = `node --test ${matchedList.map(t => `"${t}"`).join(' ')}`;
      }

      return {
        mode: 'FOCUSED',
        matchedTests: matchedList,
        suggestedCommand,
        fullSuiteCommand,
        requiresFullSuite: false,
        reason: `Mapeamento cirúrgico identificou ${matchedList.length} teste(s) diretamente relacionado(s) às alterações.`,
        confidence: 'HIGH'
      };
    }

    // 6. Safe Fallback: when in doubt, never skip tests!
    return {
      mode: 'FULL_SUITE',
      matchedTests: [],
      suggestedCommand: fullSuiteCommand,
      fullSuiteCommand,
      requiresFullSuite: true,
      reason: 'Não foi possível associar um teste específico com alta confiança aos arquivos alterados; acionando suíte completa.',
      confidence: 'FALLBACK'
    };
  }
}
