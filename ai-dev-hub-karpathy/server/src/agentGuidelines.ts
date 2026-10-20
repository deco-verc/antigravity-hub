import fs from 'node:fs';
import path from 'node:path';

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

/**
 * Returns the raw text of the Global Agent Guidelines
 */
export function getGlobalAgentGuidelines(): string {
  const localFile = path.join(__dirname, 'agent-guidelines.md');
  if (fs.existsSync(localFile)) {
    try {
      return fs.readFileSync(localFile, 'utf-8');
    } catch {
      // fallback to embedded
    }
  }

  return `
=== GLOBAL AGENT GUIDELINES (AI DEV HUB) ===
1. THINK BEFORE CODING: Identifique premissas, ambiguidades, tradeoffs e a solução mais simples antes de modificar código. Não masque incertezas.
2. SIMPLICITY FIRST: Menor implementação correta. Zero abstrações para uso único. Nenhuma dependência externa desnecessária. Nada especulativo.
3. SURGICAL CHANGES: Toque apenas no indispensável. Proibido reformatar ou refatorar código adjacente. Rastreabilidade total de cada linha no diff.
4. GOAL-DRIVEN EXECUTION: Estruture cada tarefa com OBJECTIVE, ACCEPTANCE CRITERIA, VERIFICATION (comando executável) e DONE WHEN.
`.trim();
}

/**
 * Generates the default content for .ai-dev-hub/program.md
 */
export function getDefaultProjectProgram(projectName: string, objective?: string): string {
  return `# Project Program: ${projectName}

## Objective
${objective || 'Definir o objetivo principal e metas verificáveis do projeto.'}

## Product Principles
- **Think Before Coding**: Explicitar premissas e opções antes de escrever código; não presumir decisões críticas em silêncio.
- **Simplicity First**: Menor código correto que resolve o problema; sem classes, factories ou interfaces especulativas para uso único.
- **Surgical Changes**: Toda linha modificada deve ser diretamente rastreável à tarefa solicitada; sem alterações cosméticas ortogonais.
- **Goal-Driven Execution**: Toda tarefa possui objetivo declarado, critérios de aceitação binários e comando de teste automatizado.

## Technical Constraints
- Respeitar padrões de arquitetura e convenções da stack do projeto.
- Não introduzir dependências externas no package.json sem justificativa aceita.
- Garantir que todos os testes automatizados existentes continuem passando com código de saída 0.

## Allowed Actions
- Ler e analisar qualquer arquivo dentro do diretório do projeto.
- Criar e editar arquivos estritamente pertencentes ao escopo da tarefa em andamento.
- Executar comandos locais de compilação, teste, formatação e verificação de integridade via terminal.

## Human Approval Required
- Exclusão ou drop de bancos de dados ou arquivos de dados persistentes.
- Alterações em segredos, credenciais, tokens ou variáveis sensíveis de produção.
- Mudanças drásticas de arquitetura ou substituição de bibliotecas centrais do projeto.

## Verification
- Testes automatizados executáveis no terminal (ex: \`npm test\`, \`npm run build\`, etc.).
- Verificação de ausência de erros em tempo de execução no console.
- **Critério de término (DONE WHEN)**: 100% dos critérios de aceitação atendidos e comando de verificação com saída 0.

## Quality Standards
- Código tipado, limpo, modular e sem dead code introduzido.
- Tratamento explícito e seguro de erros operacionais.
- Manter o histórico de memória e checkpoints do AI DEV HUB sincronizados.

## Autonomous Behavior
- O agente tem autonomia para iterar e corrigir erros apontados pelo comando de verificação até que todos passem.
- Se uma abordagem causar quebra irrecuperável, reverter as alterações (rollback cirúrgico) antes de tentar nova abordagem.

## Forbidden Changes
- Proibido refatorar arquivos funcionais adjacentes que não façam parte do objetivo da tarefa.
- Proibido alterar harness de testes para falsear aprovações sem resolver a causa raiz.
- Proibido formatar globalmente repositórios ou alterar convenções de estilo estabelecidas.
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
  };
  userRequest?: string;
}): string {
  const safety = opts.systemSafety || `[1. SYSTEM SAFETY]\nOperação local segura. Proibido executar comandos destrutivos sem isolamento. Preservar integridade de dados e permissões do usuário.`;
  const guidelines = `[2. GLOBAL AGENT GUIDELINES]\n${getGlobalAgentGuidelines()}`;
  const program = opts.projectProgram
    ? `[3. PROJECT PROGRAM (CONSTITUIÇÃO DO PROJETO)]\n${opts.projectProgram}`
    : `[3. PROJECT PROGRAM]\nRegras do projeto ativas via diretrizes padrão do AI DEV HUB.`;

  const contextStr = opts.projectContext
    ? `[4. PROJECT CONTEXT]\nProjeto: ${opts.projectContext.name}\nDiretório: ${opts.projectContext.path}\nObjetivo: ${opts.projectContext.objective || 'N/A'}\nStack: ${opts.projectContext.stack || 'Geral'}`
    : `[4. PROJECT CONTEXT]\nContexto de projeto padrão.`;

  let taskStr = '';
  if (opts.task) {
    taskStr = `[5. CURRENT TASK (GOAL-DRIVEN CONTRACT)]\n` +
      `OBJECTIVE: ${opts.task.title}\n` +
      `DESCRIPTION: ${opts.task.description || opts.task.title}\n` +
      `ACCEPTANCE CRITERIA:\n${(opts.task.criteria || ['Atender o objetivo da tarefa']).map(c => ` - ${c}`).join('\n')}\n` +
      `VERIFICATION: ${opts.task.verificationCommand || 'Executar testes e comandos de validação no terminal da pasta do projeto.'}\n` +
      `DONE WHEN: Todos os critérios forem satisfeitos e a verificação comprovar sucesso com zero erros.`;
  }

  const userReqStr = opts.userRequest
    ? `[6. USER REQUEST]\n${opts.userRequest}`
    : '';

  return [safety, guidelines, program, contextStr, taskStr, userReqStr].filter(Boolean).join('\n\n---\n\n');
}

/**
 * Checks whether an implementation diff was truly surgical or touched unrelated files
 */
export function validateSurgicalDiff(
  modifiedFiles: string[],
  expectedScopeFiles: string[]
): { isSurgical: boolean; unrelatedFiles: string[]; explanation: string } {
  if (expectedScopeFiles.length === 0 || modifiedFiles.length === 0) {
    return {
      isSurgical: true,
      unrelatedFiles: [],
      explanation: 'Escopo sem restrições específicas ou nenhum arquivo alterado.'
    };
  }

  const normalize = (f: string) => f.replace(/\\/g, '/').toLowerCase().trim();
  const normalizedExpected = expectedScopeFiles.map(normalize);
  
  const unrelated: string[] = [];

  for (const mod of modifiedFiles) {
    const normMod = normalize(mod);
    const isMatched = normalizedExpected.some(exp => normMod.includes(exp) || exp.includes(normMod));
    if (!isMatched) {
      unrelated.push(mod);
    }
  }

  const isSurgical = unrelated.length === 0;
  return {
    isSurgical,
    unrelatedFiles: unrelated,
    explanation: isSurgical
      ? `✓ Alteração cirúrgica: todos os ${modifiedFiles.length} arquivos alterados pertencem ao escopo esperado.`
      : `⚠️ Alerta de alteração não cirúrgica: ${unrelated.length} arquivo(s) fora do escopo esperado foram alterados: ${unrelated.join(', ')}`
  };
}
