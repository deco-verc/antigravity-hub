// server/src/deltaFeatureEngine.ts
// Motor de Evolução Cirúrgica (Delta Feature Mode), Inventário Real e Kit Cloud Deploy para DecoHUB

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from './db.js';
import { Logger } from './logger.js';
import { type PlannedTask } from './geminiSupervisorProvider.js';
import { ProjectLivingSpecService } from './projectLivingSpecService.js';

export interface ProjectInventory {
  isExisting: boolean;
  reason: string;
  sourceFiles: string[];
  testFiles: string[];
  publicFiles: string[];
  tables: string[];
  endpoints: Array<{ method: string; path: string }>;
  uiComponents: string[];
  ports: number[];
  hasSeed: boolean;
  hasDockerfile: boolean;
  completedRunCount: number;
  summary: string;
}

export interface DeltaPlanOptions {
  briefing: string;
  projectContext: {
    id?: string;
    name: string;
    path: string;
    objective: string;
  };
  inventory?: ProjectInventory;
  runId?: string | null;
}

export class DeltaFeatureEngine {
  static isExistingStructuredProject(projectPath: string, projectId?: string): { isExisting: boolean; reason: string; completedRunCount: number } {
    return this.isExistingProject(projectPath, projectId);
  }

  /**
   * Verifica se o projeto já possui código implementado em src/, public/ ou na raiz do projeto.
   */
  static hasImplementedCode(projectPath?: string, projectId?: string): boolean {
    if (!projectPath) return false;
    const resolvedPath = path.resolve(projectPath);
    if (!fs.existsSync(resolvedPath)) return false;

    const srcDir = path.join(resolvedPath, 'src');
    const publicDir = path.join(resolvedPath, 'public');

    let srcFilesCount = 0;
    if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
      try {
        const files = fs.readdirSync(srcDir, { recursive: true });
        srcFilesCount = files.filter(f => /\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(String(f))).length;
      } catch {}
    }

    let publicFilesCount = 0;
    if (fs.existsSync(publicDir) && fs.statSync(publicDir).isDirectory()) {
      try {
        const pubEntries = fs.readdirSync(publicDir, { recursive: true });
        publicFilesCount = pubEntries.filter(f => /\.(html|js|css|json|svg)$/i.test(String(f))).length;
      } catch {}
    }

    let rootFilesCount = 0;
    try {
      const rootEntries = fs.readdirSync(resolvedPath);
      rootFilesCount = rootEntries.filter(f => /\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(String(f))).length;
    } catch {}

    return srcFilesCount > 0 || publicFilesCount > 0 || rootFilesCount > 0;
  }

  /**
   * Identifica se a instrução do usuário é uma especificação arquitetural extensa ou estruturada
   * que requer decomposição em etapas modulares pelo Supervisor (e NUNCA intervenção cirúrgica de 1 etapa).
   */
  static isArchitecturalBriefing(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();

    // Se tiver mais de 800 caracteres, é uma especificação detalhada de construção/arquitetura
    if (trimmed.length >= 800) return true;

    // Seções explícitas de arquitetura e blueprint
    const hasRoleOrObjective = /#\s*(?:ROLE|OBJECTIVE|OBJETIVO)/i.test(trimmed);
    const hasStackSection = /(?:#+\s*(?:\d+\.\s*)?STACK|STACK\s+OBRIGAT[ÓO]RIA|TECH\s*STACK)/i.test(trimmed);
    const hasBlueprintSection = /(?:#+\s*(?:\d+\.\s*)?BLUEPRINT|DIRET[ÓO]RIOS\s+E\s+ARQUIVOS|ÁRVORE\s+MODULAR|ESTRUTURA\s+DE\s+PASTAS)/i.test(trimmed);
    const hasModulesSection = /(?:#+\s*(?:\d+\.\s*)?ESPECIFICA[ÇC][ÃA]O|M[ÓO]DULOS\s+DO\s+SISTEMA)/i.test(trimmed);
    const hasNumberedPhases = /^(?:##?\s*(?:ETAPA|FASE|PROJETO:)|OBJETIVO DO PRODUTO:)/im.test(trimmed);

    // Menções explícitas a múltiplos caminhos de código em /src/
    const srcPaths = trimmed.match(/(?:\/src\/|src\/)[a-zA-Z0-9_\-\./]+\.(?:ts|js|tsx|jsx)/gi);
    const hasMultipleSrcFiles = Boolean(srcPaths && srcPaths.length >= 2);

    const tsMatches = trimmed.match(/[a-zA-Z0-9_\-]+\.(?:ts|js|tsx|jsx)\b/g);
    const hasMultipleTsFiles = Boolean(tsMatches && tsMatches.length >= 3);

    return Boolean(
      hasRoleOrObjective ||
      hasStackSection ||
      hasBlueprintSection ||
      hasModulesSection ||
      hasNumberedPhases ||
      hasMultipleSrcFiles ||
      hasMultipleTsFiles
    );
  }

  /**
   * Identifica se a instrução do usuário é estritamente um pedido de bugfix, correção
   * ou ajuste cirúrgico pontual de app já existente.
   *
   * Regra Estrita:
   * (a) O projeto JÁ deve possuir código implementado em src/, public/ ou raiz; E
   * (b) A mensagem deve ser curta (< 800 caracteres) e pedir explicitamente conserto/ajuste.
   * Se for especificação arquitetural, JAMAIS retorna true!
   */
  static isSurgicalOrBugfixPrompt(text: string, projectPath?: string, projectId?: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();

    // Bloqueio categórico: especificações arquiteturais extensas ou estruturadas
    if (trimmed.length >= 800 || this.isArchitecturalBriefing(trimmed)) {
      return false;
    }

    // Se o caminho do projeto foi informado e não há código prévio, não pode ser cirúrgico
    if (projectPath && !this.hasImplementedCode(projectPath, projectId)) {
      return false;
    }

    const lower = trimmed.toLowerCase();

    // Verbos e termos explícitos de conserto/ajuste pontual
    const explicitFixRegex = /(?:não faz nada|nao faz nada|não funciona|nao funciona|quando clico|clicar|ao clicar|botão|botao|corrija|corrigir|consertar|conserte|ajuste|ajustar|melhore|melhorar|exclua|excluir|apagar|apague|limpar|limpe|zerar|resetar|erro|falha|bug|crash|quebrou|travado|parou|não carrega|nao carrega|500 internal|404 not found|console|logs?)/i;

    // Ajuste contextual específico de banco ou api
    const contextualFixRegex = /(?:erro|falha|bug|problema|ajustar|consertar|corrigir|limpar|resetar)\s+(?:no\s+|na\s+|de\s+|do\s+)?(?:banco|database|sqlite|\.db|api|rota|endpoint)/i;

    return explicitFixRegex.test(lower) || contextualFixRegex.test(lower);
  }

  /**
   * Gera um plano cirúrgico enxuto de 1 a no máximo 3 tarefas diretas focadas no bugfix/ajuste,
   * injetando automaticamente os logs da porta aberta, inventário de arquivos e variáveis do .env.
   */
  static planSurgicalIteration(params: {
    briefing?: string;
    userInstruction?: string;
    projectPath: string;
    projectName?: string;
    projectId?: string;
    runtimeLogs?: string[];
  }): PlannedTask[] {
    const briefing = (params.briefing || params.userInstruction || '').trim();
    const projectPath = path.resolve(params.projectPath);
    const pName = params.projectName || path.basename(projectPath);

    Logger.info(`[DeltaFeatureEngine] Gerando plano SURGICAL_ITERATION (1 tarefa direta) para "${pName}"...`);

    // 1. Ler logs recentes da porta se disponíveis
    let portLogs = params.runtimeLogs || [];
    if (portLogs.length === 0) {
      const logFile = path.join(projectPath, '.ai-dev-hub', 'logs', 'port-runtime.log');
      if (fs.existsSync(logFile)) {
        try {
          portLogs = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean).slice(-100);
        } catch {}
      }
    }
    const portLogsContext = portLogs.length > 0
      ? `\n\n### Logs Reais da Porta Aberta do Aplicativo:\n\`\`\`text\n${portLogs.slice(-40).join('\n')}\n\`\`\``
      : '';

    // 2. Coletar nomes de chaves de ambiente presentes no .env
    const envKeysPresent: string[] = [];
    const envFile = path.join(projectPath, '.env');
    if (fs.existsSync(envFile)) {
      try {
        const envContent = fs.readFileSync(envFile, 'utf-8');
        for (const line of envContent.split('\n')) {
          const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
          if (match) envKeysPresent.push(match[1]);
        }
      } catch {}
    }
    const envContext = envKeysPresent.length > 0
      ? `\n- **Chaves de Ambiente no .env:** ${envKeysPresent.join(', ')}`
      : '';

    // 3. Inventário de arquivos em src/ e public/
    const listFiles = (sub: string) => {
      const d = path.join(projectPath, sub);
      if (!fs.existsSync(d)) return [];
      try {
        return fs.readdirSync(d, { recursive: true }).map(String).filter(f => /\.(ts|js|tsx|jsx|html|css|json)$/i.test(f)).map(f => `${sub}/${f}`);
      } catch {
        return [];
      }
    };
    const candidateDirs = ['src', 'public', 'app', 'pages', 'components', 'lib', 'routes', 'controllers', 'database', 'config', 'services'];
    const activeDirs = candidateDirs.filter(d => fs.existsSync(path.join(projectPath, d)));
    const allFiles: string[] = [];
    for (const d of activeDirs) {
      allFiles.push(...listFiles(d));
    }
    const rootCandidates = ['server.js', 'server.ts', 'server.mjs', 'server.cjs', 'app.js', 'app.ts', 'index.js', 'index.ts', 'main.js', 'main.ts'];
    for (const rc of rootCandidates) {
      if (fs.existsSync(path.join(projectPath, rc))) {
        allFiles.push(rc);
      }
    }
    const fileInventoryContext = allFiles.length > 0
      ? `\n- **Arquivos do Projeto:** ${allFiles.slice(0, 15).join(', ')}${allFiles.length > 15 ? ` (+${allFiles.length - 15} arquivos)` : ''}`
      : '';

    const wantsResetDb = /(?:exclua|excluir|apagar|apague|limpar|limpe|zerar|resetar).*(?:banco|database|sqlite|\.db)/i.test(briefing);

    const taskTitle = `Intervenção Cirúrgica: Diagnosticar e Corrigir — ${briefing.length > 60 ? briefing.slice(0, 57) + '...' : briefing}`;

    const taskDescription =
      `Instrução cirúrgica direta enviada pelo usuário no projeto ${pName}:\n` +
      `"${briefing}"\n\n` +
      `**Contexto e Evidências do Ambiente:**${fileInventoryContext}${envContext}${portLogsContext}\n\n` +
      `**Plano de Execução Focado (Zero Replanejamento):**\n` +
      `1. Analise os arquivos reais da aplicação em \`src/\`, \`public/\`, \`app/\` ou na raiz, localizando a causa-raiz exata da falha ou do comportamento inesperado.\n` +
      (wantsResetDb ? `2. Como solicitado, certifique-se de que a estrutura/schema do SQLite seja recriada limpa e sem dados corrompidos.\n` : `2. Preserve a base de dados existente e faça alterações aditivas seguras.\n`) +
      `3. Corrija o backend e o frontend de ponta a ponta: forneça feedback visual imediato no botão/interface (loading spinner, erro detalhado caso a API Key falhe) e garanta que as rotas da API leiam as chaves do .env e gravem os dados com consistência.\n` +
      `4. Assegure que a suíte de testes e o build continuem executando com exit code 0.`;

    const scopeDirs = activeDirs.length > 0 ? activeDirs.map(d => `${d}/`) : ['src/', 'public/'];
    const expectedScopeList = Array.from(new Set([
      ...scopeDirs,
      'src/',
      'public/',
      'app/',
      'pages/',
      ...rootCandidates.filter(rc => fs.existsSync(path.join(projectPath, rc)) || allFiles.includes(rc))
    ]));

    const task1: PlannedTask = {
      title: taskTitle,
      description: taskDescription,
      milestone: 'Intervenção Cirúrgica',
      orderIndex: 1,
      dependencies: [],
      criteria: [
        'Diagnóstico e correção da falha/solicitação reportada pelo desenvolvedor',
        'Frontend com feedback visual de carregamento e exibição de erro real quando ocorrer falha',
        'Backend integrando corretamente as variáveis de ambiente e persistindo dados limpos',
        'Testes e build compilando com código 0'
      ],
      verificationCommand: 'npm test',
      doneWhen: 'Comportamento reportado corrigido e validado com sucesso.',
      expectedFiles: expectedScopeList,
      expectedScopeFiles: expectedScopeList
    };

    return [task1];
  }

  /**
   * Identifica se um projeto já possui estrutura de código prévia ou run concluído,
   * caracterizando o modo de evolução cirúrgica (DELTA_EVOLUTION) em vez de greenfield (INITIAL_PLAN).
   */
  static isExistingProject(projectPath: string, projectId?: string): { isExisting: boolean; reason: string; completedRunCount: number } {
    let completedRunCount = 0;

    if (projectId) {
      try {
        const row: any = db.prepare("SELECT COUNT(*) as count FROM autonomous_runs WHERE project_id = ? AND status = 'completed'").get(projectId);
        completedRunCount = row?.count || 0;
        if (completedRunCount > 0) {
          return {
            isExisting: true,
            reason: `Projeto possui ${completedRunCount} run(s) anterior(es) concluído(s) com sucesso no DecoHUB.`,
            completedRunCount
          };
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "deltaFeatureEngine",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:deltaFeatureEngine]", err);
      }
    }
    }

    if (!fs.existsSync(projectPath)) {
      return { isExisting: false, reason: 'Diretório do projeto não existe no disco.', completedRunCount: 0 };
    }

    const hasPackageJson = fs.existsSync(path.join(projectPath, 'package.json'));
    const srcDir = path.join(projectPath, 'src');
    const hasSrc = fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory();
    const publicDir = path.join(projectPath, 'public');
    const hasPublic = fs.existsSync(publicDir) && fs.statSync(publicDir).isDirectory();
    const testDir = path.join(projectPath, 'test');
    const testsDir = path.join(projectPath, 'tests');
    const hasTests = (fs.existsSync(testDir) && fs.statSync(testDir).isDirectory()) || (fs.existsSync(testsDir) && fs.statSync(testsDir).isDirectory());

    let srcFilesCount = 0;
    if (hasSrc) {
      try {
        const files = fs.readdirSync(srcDir, { recursive: true });
        srcFilesCount = files.filter(f => /\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(String(f))).length;
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "deltaFeatureEngine",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:deltaFeatureEngine]", err);
      }
    }
    }

    let testFilesCount = 0;
    if (hasTests) {
      try {
        const testEntries = [
          ...(fs.existsSync(testDir) && fs.statSync(testDir).isDirectory() ? fs.readdirSync(testDir, { recursive: true }) : []),
          ...(fs.existsSync(testsDir) && fs.statSync(testsDir).isDirectory() ? fs.readdirSync(testsDir, { recursive: true }) : [])
        ];
        testFilesCount = testEntries.filter(f => /\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(String(f))).length;
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "deltaFeatureEngine",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:deltaFeatureEngine]", err);
      }
    }
    }

    let publicFilesCount = 0;
    if (hasPublic) {
      try {
        const pubEntries = fs.readdirSync(publicDir, { recursive: true });
        publicFilesCount = pubEntries.filter(f => /\.(html|js|css|json|svg)$/i.test(String(f))).length;
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "deltaFeatureEngine",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:deltaFeatureEngine]", err);
      }
    }
    }

    if (hasPackageJson && ((hasSrc && srcFilesCount >= 1) || (hasPublic && publicFilesCount >= 1) || (hasTests && testFilesCount >= 1))) {
      return {
        isExisting: true,
        reason: `Projeto possui package.json, estrutura em src/ com ${srcFilesCount} arquivos de código e ${testFilesCount >= 1 ? 'suíte de testes configurada' : 'sem testes prévios'}.`,
        completedRunCount
      };
    }

    return {
      isExisting: false,
      reason: 'Projeto greenfield (sem código estruturado prévio).',
      completedRunCount: 0
    };
  }

  /**
   * Escaneia a árvore real de arquivos do projeto para coletar um inventário técnico fiel:
   * tabelas SQLite existentes, endpoints de rotas, arquivos de teste, componentes visuais e portas.
   */
  static scanProjectInventory(projectPath: string, projectId?: string): ProjectInventory {
    const detection = this.isExistingProject(projectPath, projectId);

    const sourceFiles: string[] = [];
    const testFiles: string[] = [];
    const publicFiles: string[] = [];
    const tables = new Set<string>();
    const endpoints: Array<{ method: string; path: string }> = [];
    const uiComponents: string[] = [];
    const ports = new Set<number>();
    let hasSeed = false;
    let hasDockerfile = false;

    if (!fs.existsSync(projectPath)) {
      return {
        isExisting: false,
        reason: detection.reason,
        sourceFiles: [],
        testFiles: [],
        publicFiles: [],
        tables: [],
        endpoints: [],
        uiComponents: [],
        ports: [],
        hasSeed: false,
        hasDockerfile: false,
        completedRunCount: 0,
        summary: 'Diretório não existe.'
      };
    }

    // 1. Scan de Arquivos
    const scanDir = (relDir: string, targetArray: string[], filterRegex: RegExp) => {
      const fullDir = path.join(projectPath, relDir);
      if (fs.existsSync(fullDir)) {
        try {
          const entries = fs.readdirSync(fullDir, { recursive: true });
          for (const entry of entries) {
            const relEntry = path.join(relDir, String(entry)).replace(/\\/g, '/');
            const fullEntry = path.join(projectPath, relEntry);
            if (fs.existsSync(fullEntry) && fs.statSync(fullEntry).isFile() && filterRegex.test(relEntry)) {
              targetArray.push(relEntry);
            }
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "deltaFeatureEngine",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:deltaFeatureEngine]", err);
      }
    }
      }
    };

    scanDir('src', sourceFiles, /\.(js|ts|jsx|tsx|mjs|cjs)$/i);
    scanDir('test', testFiles, /\.(js|ts|test\.[jt]s|spec\.[jt]s)$/i);
    scanDir('tests', testFiles, /\.(js|ts|test\.[jt]s|spec\.[jt]s)$/i);
    scanDir('public', publicFiles, /\.(html|css|js|svg|png|ico)$/i);

    // 2. Extração de Tabelas SQLite
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi;
    for (const rel of [...sourceFiles, ...testFiles]) {
      const full = path.join(projectPath, rel);
      try {
        const content = fs.readFileSync(full, 'utf-8');
        let match: RegExpExecArray | null;
        while ((match = tableRegex.exec(content)) !== null) {
          tables.add(match[1]);
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "deltaFeatureEngine",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:deltaFeatureEngine]", err);
      }
    }
    }

    // Também verifica schema.sql se houver
    const schemaSqlPath = path.join(projectPath, 'src', 'db', 'schema.sql');
    if (fs.existsSync(schemaSqlPath)) {
      try {
        const content = fs.readFileSync(schemaSqlPath, 'utf-8');
        let match: RegExpExecArray | null;
        while ((match = tableRegex.exec(content)) !== null) {
          tables.add(match[1]);
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "deltaFeatureEngine",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:deltaFeatureEngine]", err);
      }
    }
    }

    // 3. Extração de Endpoints REST
    const endpointRegex = /(?:router|app)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/gi;
    const urlCheckRegex = /req\.url(?:\.split|\.startsWith|\s*===)\s*\(?['"]([^'"]+)['"]/gi;

    for (const rel of sourceFiles) {
      const full = path.join(projectPath, rel);
      try {
        const content = fs.readFileSync(full, 'utf-8');
        let match: RegExpExecArray | null;
        while ((match = endpointRegex.exec(content)) !== null) {
          endpoints.push({ method: match[1].toUpperCase(), path: match[2] });
        }
        while ((match = urlCheckRegex.exec(content)) !== null) {
          endpoints.push({ method: 'ALL', path: match[1] });
        }

        // Verifica portas
        const portMatch = /(?:PORT[^\n\r\d]*|port[^\n\r\d]*|\|\|\s*)(\d{4,5})\b/gi;
        let pMatch: RegExpExecArray | null;
        while ((pMatch = portMatch.exec(content)) !== null) {
          const p = Number(pMatch[1]);
          if (p >= 1000 && p <= 65535) ports.add(p);
        }

        // Verifica rotina de seed
        if (/seedIfEmpty|seedDatabase|populateInitialData/i.test(content)) {
          hasSeed = true;
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "deltaFeatureEngine",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:deltaFeatureEngine]", err);
      }
    }
    }

    // 4. Componentes UI / Views
    for (const p of publicFiles) {
      if (/\.(html|jsx|tsx|vue|svelte)$/i.test(p)) {
        uiComponents.push(p);
      }
    }

    hasDockerfile = fs.existsSync(path.join(projectPath, 'Dockerfile'));

    // Deduplica endpoints
    const uniqueEndpoints = Array.from(
      new Map(endpoints.map(e => [`${e.method}:${e.path}`, e])).values()
    );

    const summary = [
      `PROJETO EXISTENTE: ${detection.isExisting ? 'SIM' : 'NÃO'} (${detection.reason})`,
      `ARQUIVOS DE CÓDIGO (${sourceFiles.length}): ${sourceFiles.slice(0, 10).join(', ')}${sourceFiles.length > 10 ? '...' : ''}`,
      `SUÍTE DE TESTES (${testFiles.length}): ${testFiles.join(', ')}`,
      `TABELAS EXISTENTES (${tables.size}): ${Array.from(tables).join(', ') || 'Nenhuma detectada'}`,
      `ENDPOINTS DA API (${uniqueEndpoints.length}): ${uniqueEndpoints.slice(0, 8).map(e => `${e.method} ${e.path}`).join(' | ')}${uniqueEndpoints.length > 8 ? '...' : ''}`,
      `UI / TELAS: ${uiComponents.join(', ') || 'Nenhuma detectada'}`,
      `PORTAS DETECTADAS: ${Array.from(ports).join(', ') || 'Padrão não explícito'}`,
      `SMART SEEDER: ${hasSeed ? 'Presente' : 'Ausente (Necessário adicionar seedIfEmpty)'}`,
      `DOCKERFILE: ${hasDockerfile ? 'Presente' : 'Ausente (Necessário gerar Kit Cloud)'}`
    ].join('\n');

    return {
      isExisting: detection.isExisting,
      reason: detection.reason,
      sourceFiles,
      testFiles,
      publicFiles,
      tables: Array.from(tables),
      endpoints: uniqueEndpoints,
      uiComponents,
      ports: Array.from(ports),
      hasSeed,
      hasDockerfile,
      completedRunCount: detection.completedRunCount,
      summary
    };
  }

  /**
   * Gera um plano cirúrgico enxuto de 2 a 5 tarefas focadas exclusivamente na nova funcionalidade solicitada,
   * garantindo migrações aditivas (sem DROP/apagar tabelas) e preservação estrita de todos os testes existentes.
   */
  static planDeltaEvolution(options: DeltaPlanOptions): PlannedTask[] {
    const briefing = options.briefing.trim();
    const inventory = options.inventory || this.scanProjectInventory(options.projectContext.path, options.projectContext.id);

    Logger.info(`[DeltaFeatureEngine] Gerando plano de evolução cirúrgica (Delta Mode) para "${options.projectContext.name}"...`);

    const existingTablesDesc = inventory.tables.length > 0
      ? `Tabelas existentes no banco (PRESERVAR OBRIGATORIAMENTE): ${inventory.tables.join(', ')}.`
      : 'Preservar estrutura existente do banco.';

    const existingTestsDesc = inventory.testFiles.length > 0
      ? `Testes existentes (${inventory.testFiles.join(', ')}). 100% da suíte DEVE continuar passando com exit code 0!`
      : 'Executar testes automatizados.';

    // Extrai o foco da nova feature do briefing
    const featureName = briefing.length > 60 ? briefing.slice(0, 57) + '...' : briefing;

    const plannedTasks: PlannedTask[] = [
      {
        title: `Delta-1: Domínio, Migração Aditiva & Backend - ${featureName}`,
        description: `Implementar a camada de domínio, esquema de banco de dados aditivo e rotas da API REST para a nova funcionalidade: "${briefing}".\n${existingTablesDesc}\nPROIBIDO destruir dados ou dropar tabelas existentes. Use CREATE TABLE IF NOT EXISTS ou migração aditiva.`,
        milestone: 'Delta Feature Backend',
        orderIndex: 1,
        dependencies: [],
        criteria: [
          `Atualizar ou estender o banco de dados de forma estritamente aditiva (CREATE TABLE IF NOT EXISTS) sem apagar dados anteriores`,
          `Criar ou estender endpoints da API REST com validação de input e código HTTP adequado (200/201 para sucesso, 400 para dados inválidos)`,
          `Integrar rotinas de serviço/repositório com persistência consistente`,
          `Garantir que a porta da aplicação respeite a faixa 4000-4999 (PORT_GUARD) e que a rota GET / continue servindo public/index.html`
        ],
        verificationCommand: 'npm test',
        doneWhen: 'Endpoints e regras de negócio da nova feature operacionais e validados.',
        expectedFiles: ['src/'],
        expectedScopeFiles: ['src/']
      },
      {
        title: `Delta-2: Interface, Componentes Visuais & Integração - ${featureName}`,
        description: `Integrar a nova funcionalidade na interface web existente (public/index.html ou componentes em src/), seguindo os mesmos Design Tokens de DESIGN.md.\nAtualizar botões, formulários, tabelas ou modais da nova feature garantindo zero emojis como ícones (usar SVG), estados de feedback (toast/empty/loading) e fiação completa com as novas rotas da API.`,
        milestone: 'Delta Feature UI',
        orderIndex: 2,
        dependencies: [`Delta-1: Domínio, Migração Aditiva & Backend - ${featureName}`],
        criteria: [
          `Adicionar os novos controles, modais ou seções na UI existente mantendo a consistência visual de DESIGN.md`,
          `Garantir que os botões e abas de navegação utilizem atributos role="tab" e data-tab="<secao>" respeitando DESIGN.md e permitindo captura visual automatizada`,
          `Garantir que a rota raiz GET / entregue a SPA completa com public/index.html (zero JSON na raiz)`,
          `Usar ícones SVG limpos e tabular-nums em métricas e contadores`,
          `Conectar botões e formulários às rotas da API REST criadas na Delta-1 com feedback visual imediato e sem botões mortos`
        ],
        verificationCommand: 'npm test',
        doneWhen: 'Interface atualizada com a nova funcionalidade perfeitamente integrada e responsiva.',
        expectedFiles: ['public/', 'src/'],
        expectedScopeFiles: ['public/', 'src/']
      },
      {
        title: `Delta-3: Testes de Regressão & Validação E2E - ${featureName}`,
        description: `Blindar a estabilidade do sistema garantindo que 100% dos testes existentes continuam verdes e adicionando novos testes automatizados específicos para a feature "${featureName}".\n${existingTestsDesc}\nTambém garantir que a rotina seedIfEmpty() e os artefatos de deploy (Dockerfile) estejam íntegros.`,
        milestone: 'Delta Quality & Cloud Readiness',
        orderIndex: 3,
        dependencies: [`Delta-2: Interface, Componentes Visuais & Integração - ${featureName}`],
        criteria: [
          `100% dos testes anteriores continuam passando sem regressões (Preservação Estrita de Testes)`,
          `Novos testes unitários/integração adicionados na pasta test/ cobrindo as novas regras de negócio e rotas`,
          `Garantir rotina seedIfEmpty() populando dados realistas se o banco estiver vazio na primeira abertura`,
          `Garantir Dockerfile limpo em Node 22 Alpine com HEALTHCHECK em /api/health e porta 4000-4999`
        ],
        verificationCommand: 'npm test',
        doneWhen: '100% da suíte de testes passando com exit code 0 e feature homologada para produção.',
        expectedFiles: ['test/', 'src/'],
        expectedScopeFiles: ['test/', 'src/']
      }
    ];

    // FASE 23C: Sincronização viva de especificações em DELTA_EVOLUTION (CONTEUDO.md e BACKEND.md)
    try {
      ProjectLivingSpecService.appendDeltaFeatureToSpecs(
        options.projectContext.path,
        briefing,
        plannedTasks
      );
    } catch (specErr: any) {
      Logger.warn(`[DeltaFeatureEngine] Falha não bloqueante ao sincronizar specs vivas: ${specErr.message}`);
    }

    return plannedTasks;
  }

  /**
   * Gera ou garante os artefatos de deploy em nuvem (Dockerfile e .dockerignore)
   * padronizados com Node 22 Alpine, healthcheck em /api/health e volume de dados.
   */
  static generateCloudDeployPack(projectPath: string, options?: { port?: number; dbPath?: string }): { dockerfile: string; dockerignore: string; created: boolean } {
    const port = options?.port || 4000;
    const dockerfilePath = path.join(projectPath, 'Dockerfile');
    const dockerignorePath = path.join(projectPath, '.dockerignore');

    const dockerfileContent = [
      `# DecoHUB Production Cloud Container`,
      `# Multi-stage lightweight Node 22 Alpine`,
      `FROM node:22-alpine AS runtime`,
      ``,
      `WORKDIR /app`,
      ``,
      `# Instala dependências de produção`,
      `COPY package*.json ./`,
      `RUN npm ci --omit=dev || npm install --omit=dev`,
      ``,
      `# Copia código-fonte e ativos públicos`,
      `COPY src/ ./src/`,
      `COPY public/ ./public/`,
      `COPY DESIGN.md ./DESIGN.md`,
      ``,
      `# Cria diretório de persistência de dados SQLite`,
      `RUN mkdir -p /app/data && chown -R node:node /app`,
      `VOLUME ["/app/data"]`,
      ``,
      `# Configuração de Ambiente e Port Guard`,
      `ENV NODE_ENV=production`,
      `ENV PORT=${port}`,
      `EXPOSE ${port}`,
      ``,
      `# Healthcheck oficial do container`,
      `HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\`,
      `  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${port}/api/health || exit 1`,
      ``,
      `USER node`,
      `CMD ["npm", "start"]`,
      ``
    ].join('\n');

    const dockerignoreContent = [
      `node_modules/`,
      `.git/`,
      `.ai-dev-hub/`,
      `coverage/`,
      `test/`,
      `tests/`,
      `data/*.db`,
      `data/*.db-journal`,
      `data/*.db-wal`,
      `.env`,
      `.DS_Store`,
      `*.log`,
      ``
    ].join('\n');

    let created = false;
    if (!fs.existsSync(dockerfilePath)) {
      fs.writeFileSync(dockerfilePath, dockerfileContent, 'utf-8');
      created = true;
    }
    if (!fs.existsSync(dockerignorePath)) {
      fs.writeFileSync(dockerignorePath, dockerignoreContent, 'utf-8');
      created = true;
    }

    return {
      dockerfile: dockerfileContent,
      dockerignore: dockerignoreContent,
      created
    };
  }
}
