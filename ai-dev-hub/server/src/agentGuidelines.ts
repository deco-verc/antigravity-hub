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
2. SIMPLICITY FIRST & PREVENÇÃO DE IMPORTS ALUCINADOS: Menor implementação de código correta que resolve 100% do problema. Zero abstrações para uso único e zero dependências externas desnecessárias. É PROIBIDO importar bibliotecas externas não declaradas no package.json do projeto; use utilitários nativos do Node.js 22+ (node:crypto.randomUUID() em vez de uuid, node:sqlite ou driver configurado, fetch() nativo em vez de axios, e extensão .js em imports relativos ESM). Simplicidade de código NUNCA significa produto raso: entregue os 7 Pilares SaaS Master, estados visuais completos (Loading, Empty, Populated, Error) e povoamento realista via seedIfEmpty().
3. SURGICAL CHANGES, SURGICAL BOUNDARY & ANTI-BLOWUP: Toque apenas nos arquivos indispensáveis ao escopo da tarefa (allowedScope/expectedFiles). Para arquivos com mais de 50 linhas, aplique modificações pontuais e cirúrgicas (Search & Replace / Patches direcionados), sendo PROIBIDO reescrever o arquivo inteiro do zero a menos que seja arquivo novo; preserve interfaces, comentários e funções adjacentes. Expressamente PROIBIDO: (a) Modificar arquivos fora do allowedScope (exceto whitelist de suporte como src/services/ e src/utils/); (b) Aplicar refatorações cosméticas, limpezas de comentários ou reestruturações em arquivos adjacentes; (c) Destruir dados ou esquemas de banco existentes (sempre usar migrações aditivas e CREATE TABLE IF NOT EXISTS); (d) Deixar processos filhos ou servidores locais abertos no terminal sem encerramento determinístico em bloco try / finally (PORT LEAK GUARD / EADDRINUSE).
4. PROTOCOLO DO WORKER (FAZER - CIRURGIÃO GUIADO POR TESTES & FLUXO TDD RED-GREEN):
   - ZERO GUESSWORK: Antes de implementar novas rotas ou serviços, consulte obrigatoriamente os tipos em src/types/ e os schemas em src/db/ para consistência nominal estrita de campos.
   - FLUXO OBRIGATÓRIO TDD:
     * PASSO 1 (RED): Crie ou atualize o arquivo de teste unitário focado em test/ refletindo os critérios de aceitação da tarefa. Execute o comando de teste no terminal para comprovar a falha inicial esperada.
     * PASSO 2 (GREEN): Escreva estritamente a menor quantidade de código funcional necessária nos arquivos de expectedFiles para fazer o teste passar e o compilador TypeScript sair limpo (tsc --noEmit).
     * PASSO 3 (PROVA): Antes de submeter o relatório ao Reviewer, execute internamente a compilação dos arquivos tocados (npx tsc --noEmit) corrigindo qualquer erro de tipagem/import no mesmo turno. Em seguida, execute o verificationCommand da tarefa no terminal e inclua o resultado literal no relatório final com exit code 0. É expressamente PROIBIDO declarar conclusão sem evidência de terminal.
5. PROTOCOLO DO REVIEWER (REVISAR - TECH LEAD DE DIAGNÓSTICO FACTUAL):
   (1) Se a tarefa for de planejamento (sem arquivos alterados), avalie apenas a lógica e aprove com APPROVED se cobrir os requisitos;
   (2) Se a tarefa for de código implementado:
       - Verifique se os arquivos alterados estão dentro de allowedScope ou pertencem à whitelist de suporte (src/services/, src/utils/, etc.);
       - Rode o comando de verificação da tarefa;
       - Se falhar, NÃO emita rejeições genéricas: aponte [Arquivo:Linha], [Log do Erro] e [Ação Corretiva Exata].
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

  try {
    if (typeof __dirname !== 'undefined') {
      candidates.push(path.resolve(__dirname, 'agent-guidelines.md'));
    }
  } catch {}
  candidates.push(path.resolve(process.cwd(), 'src', 'agent-guidelines.md'));
  candidates.push(path.resolve(process.cwd(), 'server', 'src', 'agent-guidelines.md'));

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
- **Simplicity First & Prevenção de Imports Alucinados**: Menor código correto e direto, sem classes ou abstrações especulativas para uso único. É PROIBIDO importar pacotes externos não declarados no \`package.json\` do projeto (preferir \`node:crypto.randomUUID()\`, \`node:sqlite\`, \`fetch()\` nativo e extensões \`.js\` em ESM).
- **Surgical Changes, Surgical Boundary & Anti-Blowup**: Toda linha modificada deve ser diretamente rastreável à tarefa solicitada. Para arquivos com >50 linhas, aplicar modificações pontuais (Search & Replace / Patches direcionados), sendo PROIBIDO reescrever o arquivo inteiro do zero; preservar interfaces e comentários pré-existentes. Proibido: (1) Modificar arquivos fora do allowedScope (exceto whitelist como src/services/ e src/utils/); (2) Refatorações cosméticas em arquivos adjacentes; (3) Destruição de dados/esquemas existentes; (4) Deixar portas presas (PORT LEAK GUARD / EADDRINUSE) encerrando servidores sempre em blocos \`try / finally\`.
- **Zero Guesswork (Contratos e Tipos Reais)**: Consultar sempre os tipos definidos em \`src/types\` e os schemas em \`src/db\` antes de implementar rotas/serviços, garantindo paridade nominal de campos.
- **Goal-Driven Execution & Protocolo do Worker (Fluxo Obrigatório TDD Red-Green & Auto-Validação Pré-Handover)**:
  * PASSO 1 (RED): Crie ou atualize o teste unitário focado em \`test/\` refletindo os critérios de aceitação. Execute o teste no terminal para comprovar a falha inicial esperada.
  * PASSO 2 (GREEN): Escreva estritamente a menor quantidade de código funcional necessária nos arquivos de \`expectedFiles\` para fazer o teste passar e o compilador TypeScript sair limpo (\`tsc --noEmit\`).
  * PASSO 3 (PROVA): Execute internamente a checagem de compilação dos arquivos tocados (\`npx tsc --noEmit\`) corrigindo erros no mesmo turno, rode o \`verificationCommand\` da tarefa no terminal e inclua o resultado literal no relatório final com exit code 0. É proibido inventar conclusões sem evidência de terminal.
- **Reviewer Audit Protocol (Revisar - Tech Lead de diagnóstico factual)**:
  1. Se a tarefa for de planejamento (sem arquivos alterados), avalie apenas a lógica e aprove com \`APPROVED\` se cobrir os requisitos.
  2. Se a tarefa for de código implementado:
     - Verifique se os arquivos alterados estão dentro de \`allowedScope\` ou pertencem à whitelist de suporte (\`src/services/\`, \`src/utils/\`, etc.).
     - Rode o comando de verificação da tarefa.
     - Se falhar, NÃO emita rejeições genéricas: aponte \`[Arquivo:Linha]\`, \`[Log do Erro]\` e \`[Ação Corretiva Exata]\`.
- **Systematic Debugging & Anti-Retrabalho**: Em tarefas rejeitadas (\`CHANGES_REQUESTED\`), é terminantemente proibido tentar palpites ou refatorações cosméticas aleatórias. O Worker deve isolar a linha/asserção falha, aplicar a menor intervenção e reexecutar o teste específico para comprovar o reparo com código 0.

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
- **Prova Binária Obrigatória (DONE WHEN)**: 100% dos critérios de aceitação atendidos e comando de verificação executado com saída real 0 comprovada no relatório final.

## Quality Standards
- Código tipado, limpo, modular e sem dead code ou placeholders (\`TODO\`, mocks estáticos falsos).
- Comunicação direta em estilo CLI corporativo (zero emojis decorativos e zero repetição da instrução do usuário).
- Manter o histórico de memória e checkpoints do AI DEV HUB sincronizados.

## Autonomous Behavior
- O agente tem autonomia total para iterar e corrigir erros apontados pelo Independent Evaluator até que todos os portões passem.
- Se uma abordagem causar quebra irrecuperável, reverter as alterações (rollback cirúrgico) antes de tentar nova abordagem.
- Em retrabalho, seguir estritamente o Systematic Debugging sem refatorações aleatórias fora do ponto de falha.

## Forbidden Changes
- Proibido declarar tarefas como concluídas baseando-se apenas em texto ou suposição sem comprovação do comando no terminal.
- Proibido refatorar arquivos funcionais adjacentes que não façam parte do objetivo da tarefa.
- Proibido alterar, comentar, pular (\`.skip\`) ou enfraquecer arquivos de testes protegidos (\`TAMPERING_DETECTED\`).
- Proibido usar comandos compostos (\`&&\`, \`;\`, \`||\`, \`|\`, \`node -e\`) no campo \`verificationCommand\`.
- Proibido aplicar alterações cosméticas ou chutes no código durante ciclo de retrabalho.
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
      `DONE WHEN: ${opts.task.doneWhen || 'Todos os critérios forem satisfeitos e a verificação comprovar sucesso com exit code 0.'}\n\n` +
      `[PROTOCOLO DO WORKER (FLUXO OBRIGATÓRIO TDD RED-GREEN, SURGICAL BOUNDARY & ANTI-BLOWUP)]:\n` +
      `* ZERO GUESSWORK & PREVENÇÃO DE IMPORTS ALUCINADOS: Consulte obrigatoriamente os tipos em src/types/ e os schemas em src/db/ antes de codificar. PROIBIDO importar pacotes externos não declarados no package.json (preferir node:crypto.randomUUID, node:sqlite, fetch nativo).\n` +
      `* SURGICAL BOUNDARY & ANTI-BLOWUP: Para arquivos existentes com >50 linhas, utilize modificações pontuais/cirúrgicas, sendo PROIBIDO reescrever o arquivo inteiro do zero. Proibido alterar arquivos fora de expectedScopeFiles (exceto whitelist src/services/, src/utils/) ou aplicar refatorações cosméticas em código adjacente.\n` +
      `* PORT LEAK GUARD: Encerre sempre servidores e processos locais em blocos try / finally { server.close() }, prevenindo EADDRINUSE.\n` +
      `* PASSO 1 (RED): Crie ou atualize o teste unitário focado em test/ refletindo os critérios de aceitação. Execute o comando de teste para comprovar a falha inicial esperada.\n` +
      `* PASSO 2 (GREEN): Escreva estritamente a menor quantidade de código funcional necessária nos arquivos de expectedFiles para fazer o teste passar e o compilador TypeScript sair limpo (tsc --noEmit).\n` +
      `* PASSO 3 (PROVA): Execute internamente a validação de compilação dos arquivos tocados (npx tsc --noEmit), execute o verificationCommand no terminal e inclua o resultado literal no relatório final com exit code 0. É expressamente PROIBIDO declarar conclusão sem evidência real de terminal.`;
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
    normMod.startsWith('ai-dev-hub/') ||
    normMod.startsWith('.agents/') ||
    normMod.startsWith('agents/') ||
    normMod === 'design.md' ||
    normMod === 'package-lock.json' ||
    normMod === '.env.example' ||
    normMod === 'dockerfile' ||
    normMod === '.dockerignore'
  );
}

/**
 * Checks if a file belongs to the allowed support whitelist (src/services/, src/utils/, etc.)
 */
export function isAllowedSupportWhitelist(normMod: string): boolean {
  const norm = String(normMod || '').replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase().trim();
  return (
    norm.startsWith('src/services/') ||
    norm.startsWith('src/utils/') ||
    norm.startsWith('src/lib/') ||
    norm.startsWith('src/models/') ||
    norm.startsWith('src/helpers/') ||
    norm.startsWith('src/types/') ||
    norm.startsWith('src/config/') ||
    norm.startsWith('src/database/') ||
    norm.startsWith('src/db/') ||
    norm.startsWith('server/src/services/') ||
    norm.startsWith('server/src/utils/') ||
    norm.startsWith('server/src/lib/') ||
    norm.startsWith('server/src/models/') ||
    norm.startsWith('server/src/helpers/') ||
    norm.startsWith('server/src/types/') ||
    norm.startsWith('server/src/config/') ||
    norm.startsWith('server/src/database/') ||
    norm.startsWith('server/src/db/') ||
    norm.startsWith('services/') ||
    norm.startsWith('utils/') ||
    norm.startsWith('lib/') ||
    norm.startsWith('models/') ||
    norm.startsWith('helpers/') ||
    norm.startsWith('types/') ||
    norm.startsWith('config/') ||
    norm.startsWith('database/') ||
    norm.startsWith('db/') ||
    norm.startsWith('test/') ||
    norm.startsWith('tests/') ||
    /(test|spec)\.[cm]?[jt]sx?$/i.test(norm)
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
  expectedScopeFiles: string[],
  options?: { allowSupportWhitelist?: boolean }
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

    if (options?.allowSupportWhitelist && isAllowedSupportWhitelist(normMod)) {
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
      ? `[APROVADO] Alteração cirúrgica: todos os ${modifiedFiles.length} arquivos alterados pertencem ao escopo esperado (${normalizedExpected.join(', ')}).`
      : `[AVISO] Alerta de alteração não cirúrgica: ${unrelated.length} arquivo(s) fora do escopo esperado foram alterados: ${unrelated.join(', ')}. Escopo esperado: [${normalizedExpected.join(', ')}]. Arquivos modificados: [${modifiedFiles.join(', ')}].`
  };
}