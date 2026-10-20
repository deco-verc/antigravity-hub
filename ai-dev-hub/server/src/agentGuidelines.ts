import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ThinkBeforeCodingAnalysis {
  assumptions: string[];
  ambiguities: string[];
  selectedApproach: string;
  reason: string;
  clarificationRequired: boolean;
}

export interface GoalDrivenTaskDefinition {
  objective: string;
  acceptanceCriteria: string[];
  verificationCommand?: string;
  doneWhen: string;
}

interface CachedGuidelines {
  content: string;
  mtimeMs: number;
  filePath: string;
}

let guidelinesCache: CachedGuidelines | null = null;

const EMBEDDED_GLOBAL_GUIDELINES = `
=== GLOBAL AGENT GUIDELINES (AI DEV HUB) ===
1. THINK BEFORE CODING: Identifique premissas, ambiguidades, tradeoffs e a solução mais simples antes de modificar código. Em execuções autônomas (run_id ativo), é ESTRITAMENTE PROIBIDO invocar ask_question ou abrir modais bloqueantes; resolva ambiguidades via evidências do repositório, DESIGN.md e contratos locais (clarificationRequired: false).
2. SIMPLICITY FIRST: Menor implementação de código correta que resolve 100% do problema. Zero abstrações para uso único e zero dependências externas desnecessárias. Simplicidade de código NUNCA significa produto raso: entregue os 7 Pilares SaaS Master, estados visuais completos (Loading, Empty, Populated, Error) e povoamento realista via seedIfEmpty().
3. SURGICAL CHANGES: Toque apenas nos arquivos indispensáveis ao escopo da tarefa. Proibido reformatar ou alterar código funcional adjacente ou destruir tabelas/testes existentes em modo DELTA_EVOLUTION.
4. GOAL-DRIVEN EXECUTION: Estruture cada tarefa com OBJECTIVE, ACCEPTANCE CRITERIA, VERIFICATION (comando único simples compatível com controlledVerification.ts, sem ";", "&&", "||", "|" ou "node -e") e DONE WHEN.
5. OPERATIONAL AUTONOMY & INTELLIGENT EXECUTION: Execução autônoma com encerramento obrigatório de processos/servidores efêmeros em blocos try/finally, proibição absoluta de adulterar testes protegidos (TAMPERING_DETECTED) e ciclo ativo de autocorreção (Self-Healing) guiado pelos logs do Independent Evaluator.
6. FULL-STACK, APPSEC & ANTI-SLOP INVARIANTS: Respeite o PORT_GUARD (portas 4000-4999, proibindo 3001/3000/5173), sirva a SPA em GET / e isole JSON em GET /api/health, aplique Dual-Mode DOCSIMP (Graceful Mock Fallback), use tokens :root + SVGs Lucide inline (zero emojis como ícones) + [role="tab"] / data-tab para capturas enumeradas (01-Secao.png), e blinde contra SQLi (?), XSS (escapeHtml), Path Traversal e valores negativos (HTTP 400).
`.trim();

/**
 * Resolves candidate paths for agent-guidelines.md across dev (src/), compiled (dist/), and packaged runtimes
 */
function resolveGuidelinesFilePath(): string | null {
  const candidates: string[] = [];

  try {
    const currentDir = typeof __dirname !== 'undefined'
      ? __dirname
      : process.cwd();
    candidates.push(path.join(currentDir, 'agent-guidelines.md'));
    candidates.push(path.resolve(currentDir, '..', 'src', 'agent-guidelines.md'));
  } catch {
    // ignore resolution error in restricted environments
  }

  candidates.push(path.resolve(process.cwd(), 'src', 'agent-guidelines.md'));
  candidates.push(path.resolve(process.cwd(), 'server', 'src', 'agent-guidelines.md'));
  candidates.push(path.resolve('C:/IA/Antigravity HUB/ai-dev-hub/server/src/agent-guidelines.md'));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Returns the raw text of the Global Agent Guidelines with hot-reload mtimeMs caching
 */
export function getGlobalAgentGuidelines(): string {
  try {
    const filePath = resolveGuidelinesFilePath();
    if (filePath) {
      const stat = fs.statSync(filePath);
      if (
        guidelinesCache &&
        guidelinesCache.filePath === filePath &&
        guidelinesCache.mtimeMs === stat.mtimeMs
      ) {
        return guidelinesCache.content;
      }

      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content.length > 50) {
        guidelinesCache = {
          content,
          mtimeMs: stat.mtimeMs,
          filePath
        };
        return content;
      }
    }
  } catch {
    // fallback to embedded guidelines
  }

  return EMBEDDED_GLOBAL_GUIDELINES;
}

/**
 * Generates the default content for .ai-dev-hub/program.md
 */
export function getDefaultProjectProgram(projectName: string, objective?: string): string {
  return `# Project Program: ${projectName}

## Objective
${objective || 'Definir o objetivo principal e metas verificáveis do projeto.'}

## Product Principles
- **Think Before Coding & Full Autonomy**: Explicitar premissas e opções tecnicamente; em execuções autônomas do DecoHUB, nunca invocar \`ask_question\` nem bloquear o pipeline — resolver ambiguidades via contratos locais e \`DESIGN.md\`.
- **Simplicity First & Product Density**: Menor código correto e direto, sem classes ou abstrações especulativas para uso único, mas garantindo densidade funcional completa (estados Loading, Empty, Populated, Error e \`seedIfEmpty()\` realista).
- **Surgical Changes**: Toda linha modificada deve ser diretamente rastreável à tarefa solicitada; sem alterações cosméticas ortogonais ou regressão em módulos prontos.
- **Goal-Driven Execution**: Toda tarefa possui objetivo declarado, critérios de aceitação binários e comando de verificação simples compatível com \`controlledVerification.ts\`.

## Technical & Full-Stack Constraints
- **Port Guard**: Utilizar exclusivamente portas na faixa \`4000-4999\` (\`Number(process.env.PORT) || 4000\`). As portas \`3001\`, \`3000\` e \`5173\` são estritamente reservadas ao DecoHUB.
- **Full-Stack Routing**: Em projetos com interface web (\`public/index.html\`), servir a SPA em \`GET /\` e manter o healthcheck JSON isolado em \`GET /api/health\`.
- **Dual-Mode DOCSIMP & Cloud Pack**: Ler chaves de \`process.env\` com *Graceful Mock Fallback* automático quando ausentes, popular dados iniciais via \`seedIfEmpty()\` e manter \`Dockerfile\` (Node 22 Alpine) atualizado.
- **Anti-Slop UI & Section Navigation**: Definir variáveis CSS em \`:root\`, \`font-variant-numeric: tabular-nums\`, usar ícones SVG Lucide inline (zero emojis decorativos) e marcar abas/secções com \`role="tab"\` e \`data-tab="<secao>"\`.
- **AppSec Red Team Invariants**: Queries SQLite parametrizadas (\`?\`), sanitização DOM (\`escapeHtml\` / \`textContent\`), validação de caminho estático contra Path Traversal (\`path.resolve\` + \`.startsWith(publicDir)\`), cabeçalho \`X-Content-Type-Options: nosniff\` e rejeição de valores negativos/NaN com \`HTTP 400\`.

## Allowed Actions
- Ler e analisar qualquer arquivo dentro do diretório do projeto.
- Criar e editar arquivos estritamente pertencentes ao escopo da tarefa em andamento.
- Executar comandos locais de compilação, teste e verificação de integridade via terminal, encerrando processos efêmeros em blocos \`try / finally\`.

## Human Approval Required
- Exclusão ou drop de bancos de dados ou arquivos de dados persistentes em produção.
- Alterações em segredos reais, credenciais externas críticas ou variáveis sensíveis fora do escopo local.
- Mudanças destrutivas de arquitetura que removam funcionalidades existentes.

## Verification
- Testes automatizados executáveis no terminal (\`npm test\`, \`node --test\`, \`npm run build\`, \`tsc --noEmit\`).
- Aprovação nos 4 Portões de Qualidade: Dev Tests, PlaywrightVisualInspector, UserExperienceSimulator (persistência pós-F5) e SecurityPentestSimulator.
- **Critério de término (DONE WHEN)**: 100% dos critérios de aceitação atendidos e comando de verificação com saída 0.

## Quality Standards
- Código tipado, limpo, modular e sem dead code ou placeholders (\`TODO\`, mocks estáticos falsos).
- Comunicação direta em estilo CLI corporativo (zero emojis decorativos e zero repetição da instrução do usuário).
- Manter o histórico de memória e checkpoints do AI DEV HUB sincronizados.

## Autonomous Behavior
- O agente tem autonomia total para iterar e corrigir erros apontados pelo Independent Evaluator até que todos os portões passem.
- Se uma abordagem causar quebra irrecuperável, reverter as alterações (rollback cirúrgico) antes de tentar nova abordagem.

## Forbidden Changes
- Proibido refatorar arquivos funcionais adjacentes que não façam parte do objetivo da tarefa.
- Proibido alterar, comentar, pular (\`.skip\`) ou enfraquecer arquivos de testes protegidos (\`TAMPERING_DETECTED\`).
- Proibido usar comandos compostos (\`&&\`, \`;\`, \`||\`, \`|\`, \`node -e\`) no campo \`verificationCommand\`.
`;
}

/**
 * Enforces the strict prompt hierarchy:
 * SYSTEM SAFETY -> GLOBAL AGENT GUIDELINES -> PROJECT PROGRAM -> PROJECT CONTEXT -> CURRENT TASK -> USER REQUEST
 */
export function buildPromptWithInheritance(opts: {
  systemSafety?: string;
  projectProgram?: string;
  projectContext?: {
    name: string;
    path: string;
    objective?: string;
    stack?: string;
  };
  task?: {
    title: string;
    description?: string;
    criteria?: string[];
    verificationCommand?: string;
    doneWhen?: string;
    expectedScopeFiles?: string[];
  };
  userRequest?: string;
}): string {
  const safety = opts.systemSafety || `[1. SYSTEM SAFETY]\nOperação local segura e 100% autônoma (proibido invocar ask_question em runs autônomos). Proibido executar comandos destrutivos fora do diretório do projeto ou usar a porta 3001. Preservar integridade de dados e testes protegidos.`;
  const guidelines = `[2. GLOBAL AGENT GUIDELINES]\n${getGlobalAgentGuidelines()}`;
  const program = opts.projectProgram
    ? `[3. PROJECT PROGRAM (CONSTITUIÇÃO DO PROJETO)]\n${opts.projectProgram}`
    : `[3. PROJECT PROGRAM]\nRegras do projeto ativas via diretrizes padrão do AI DEV HUB.`;

  const contextStr = opts.projectContext
    ? `[4. PROJECT CONTEXT]\nProjeto: ${opts.projectContext.name}\nDiretório: ${opts.projectContext.path}\nObjetivo: ${opts.projectContext.objective || 'N/A'}\nStack: ${opts.projectContext.stack || 'Geral'}`
    : `[4. PROJECT CONTEXT]\nContexto de projeto padrão.`;

  let taskStr = '';
  if (opts.task) {
    const scopeLine = opts.task.expectedScopeFiles && opts.task.expectedScopeFiles.length > 0
      ? `EXPECTED SCOPE FILES: ${opts.task.expectedScopeFiles.join(', ')}\n`
      : '';
    taskStr = `[5. CURRENT TASK (GOAL-DRIVEN CONTRACT)]\n` +
      `OBJECTIVE: ${opts.task.title}\n` +
      `DESCRIPTION: ${opts.task.description || opts.task.title}\n` +
      scopeLine +
      `ACCEPTANCE CRITERIA:\n${(opts.task.criteria || ['Atender o objetivo da tarefa']).map(c => ` - ${c}`).join('\n')}\n` +
      `VERIFICATION: ${opts.task.verificationCommand || 'npm test'}\n` +
      `DONE WHEN: ${opts.task.doneWhen || 'Todos os critérios forem satisfeitos e a verificação comprovar sucesso com exit code 0.'}`;
  }

  const userReqStr = opts.userRequest
    ? `[6. USER REQUEST]\n${opts.userRequest}`
    : '';

  return [safety, guidelines, program, contextStr, taskStr, userReqStr].filter(Boolean).join('\n\n---\n\n');
}

/**
 * Normalizes a relative path for surgical scope comparison
 */
function normalizeScopePath(filePath: string): string {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .toLowerCase()
    .trim();
}

/**
 * Checks if a normalized modified file path is an allowed infrastructure/governance artifact
 */
function isAlwaysAllowedGovernanceArtifact(normMod: string): boolean {
  return (
    normMod.startsWith('.ai-dev-hub/') ||
    normMod.startsWith('.agents/') ||
    normMod.startsWith('data/') ||
    normMod.endsWith('.db') ||
    normMod.endsWith('.sqlite') ||
    normMod.endsWith('.sqlite3') ||
    normMod === 'design.md' ||
    normMod === 'package-lock.json' ||
    normMod === '.env.example' ||
    normMod === 'dockerfile' ||
    normMod === '.dockerignore'
  );
}

/**
 * Matches a normalized modified path against an expected scope entry (supporting directory prefixes and * globs)
 */
function matchesScopeEntry(normMod: string, normExp: string): boolean {
  if (!normExp) return false;
  if (normMod === normExp) return true;

  // Handle glob patterns like "src/*", "public/**", "*.test.js"
  if (normExp.includes('*')) {
    const prefixBeforeWildcard = normExp.split('*')[0].replace(/\/+$/, '');
    if (prefixBeforeWildcard && (normMod === prefixBeforeWildcard || normMod.startsWith(`${prefixBeforeWildcard}/`))) {
      return true;
    }
    const regexStr = '^' + normExp
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*') + '$';
    try {
      if (new RegExp(regexStr, 'i').test(normMod)) return true;
    } catch {
      // fallback to substring check below
    }
  }

  const cleanExp = normExp.replace(/\/+\*?$/, '');
  return normMod.includes(cleanExp) || cleanExp.includes(normMod);
}

/**
 * Checks whether an implementation diff was truly surgical or touched unrelated files
 */
export function validateSurgicalDiff(
  modifiedFiles: string[],
  expectedScopeFiles: string[]
): { isSurgical: boolean; unrelatedFiles: string[]; explanation: string } {
  if (!Array.isArray(expectedScopeFiles) || expectedScopeFiles.length === 0 || !Array.isArray(modifiedFiles) || modifiedFiles.length === 0) {
    return {
      isSurgical: true,
      unrelatedFiles: [],
      explanation: 'Escopo sem restrições específicas ou nenhum arquivo alterado.'
    };
  }

  const normalizedExpected = expectedScopeFiles.map(normalizeScopePath).filter(Boolean);
  const unrelated: string[] = [];

  for (const mod of modifiedFiles) {
    const normMod = normalizeScopePath(mod);
    if (!normMod) continue;

    if (isAlwaysAllowedGovernanceArtifact(normMod)) {
      continue;
    }

    const isMatched = normalizedExpected.some(exp => matchesScopeEntry(normMod, exp));
    if (!isMatched) {
      unrelated.push(mod);
    }
  }

  const isSurgical = unrelated.length === 0;
  return {
    isSurgical,
    unrelatedFiles: unrelated,
    explanation: isSurgical
      ? `[APROVADO] Alteração cirúrgica: todos os ${modifiedFiles.length} arquivos alterados pertencem ao escopo esperado.`
      : `[AVISO] Alerta de alteração não cirúrgica: ${unrelated.length} arquivo(s) fora do escopo esperado foram alterados: ${unrelated.join(', ')}`
  };
}