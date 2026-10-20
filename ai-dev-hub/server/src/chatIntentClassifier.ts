// server/src/chatIntentClassifier.ts
// Semantic intent classification layer separating conversational exploration, state inspection, execution, and ambiguity.

export type ChatIntentType = 'CONVERSATION' | 'STATE_QUERY' | 'EXECUTION_INSTRUCTION' | 'AMBIGUOUS';

export type ChatSubType =
  | 'IDEA_EXPLORATION'
  | 'ARCHITECTURE_DISCUSSION'
  | 'ERROR_QUERY'
  | 'LOG_QUERY'
  | 'REVIEW_QUERY'
  | 'PROGRESS_QUERY'
  | 'REMAINING_TASKS_QUERY'
  | 'STATUS_INQUIRY'
  | 'EXPLANATION_REQUEST'
  | 'CAPABILITY_OR_PROPOSAL'
  | 'AMBIGUOUS_COMPLAINT'
  | 'AMBIGUOUS_UNCERTAIN'
  | 'FIX_AND_CONTINUE'
  | 'BUILD_TASK'
  | 'CONTINUE_COMMAND'
  | 'REPLAN_COMMAND'
  | 'GENERAL_CONVERSATION';

export interface ChatIntentResult {
  intent: ChatIntentType;
  subType: ChatSubType;
  confidence: number;
  explanation: string;
}

export class ChatIntentClassifier {
  /**
   * Classify user natural language input into structured intent
   */
  static classify(rawContent: string): ChatIntentResult {
    const content = (rawContent || '').trim();
    const cleanLower = content
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents for robust matching
      .replace(/[^\w\s\?!\.:;\-,]/g, '')
      .replace(/\s+/g, ' ');

    const hasQuestionMark = /\?+\s*$/.test(content);

    // 0. Slash Commands (e.g., /frontend, /image, /rea, /karpathy, /style, /skills)
    if (content.startsWith('/')) {
      const isInspection = /^\/(image|shot|screenshot|print|ux|pentest|docs|find|triage|pr-label|skills|help)\b/i.test(content);
      return {
        intent: isInspection ? 'STATE_QUERY' : 'EXECUTION_INSTRUCTION',
        subType: isInspection ? 'STATUS_INQUIRY' : 'BUILD_TASK',
        confidence: 1.0,
        explanation: `Slash command detectado: ${content.split(/\s+/)[0]}`
      };
    }

    // 1. Explicit Directives to halt or focus purely on explanation / inspection
    // E.g.: "Não faça mais nada; explique o erro", "Pare e me mostre os logs"
    if (
      /^(nao faca mais nada|nao faca nada ainda|apenas|so)\s*[,;.]*\s*.*(me\s+)?(explique|detalhe|qual foi|qual e|mostre)/i.test(cleanLower) ||
      /explique\s+(o\s+)?(erro|problema|falha|bloqueio)/i.test(cleanLower)
    ) {
      if (/log|registro/i.test(cleanLower)) {
        return {
          intent: 'STATE_QUERY',
          subType: 'LOG_QUERY',
          confidence: 0.98,
          explanation: 'Solicitação explícita para inspecionar logs sem executar alterações.'
        };
      }
      return {
        intent: 'STATE_QUERY',
        subType: 'ERROR_QUERY',
        confidence: 0.98,
        explanation: 'Solicitação explícita para explicar o erro sem executar alterações.'
      };
    }

    if (
      /^(olhe|analise|veja|inspecione|verifique|leia|avalie)\s+.*(e\s+)?(me\s+)?(diga|explique|conte|mostre)\s+(o\s+que|qual|como)/i.test(cleanLower) ||
      /^(olhe|analise|veja|inspecione|verifique)\s+.*(o\s+que\s+(esta|deu)\s+errado|qual\s+o\s+problema|qual\s+o\s+erro)/i.test(cleanLower)
    ) {
      return {
        intent: 'STATE_QUERY',
        subType: 'ERROR_QUERY',
        confidence: 0.95,
        explanation: 'Diretiva de inspeção solicitando análise e explicação sem execução de alterações.'
      };
    }

    if (/^pare\s+(e\s+)?(me\s+)?(mostre|exiba|veja)\s+(os\s+|a\s+)?logs?/i.test(cleanLower)) {
      return {
        intent: 'STATE_QUERY',
        subType: 'LOG_QUERY',
        confidence: 0.98,
        explanation: 'Comando para interromper execução e consultar logs.'
      };
    }

    // 2. Specific Queries about Logs / Logging
    // E.g.: "Onde eu vejo a log?", "Mostre os logs desta execução", "onde ficam os logs"
    if (
      /^(onde|como)\s+(eu\s+)?(vejo|acho|encontro|acesso|olho)\s+(a|o|os|as)?\s*logs?/i.test(cleanLower) ||
      /^(onde|como)\s+(ficam|estao)\s+(os\s+|a\s+)?logs?/i.test(cleanLower) ||
      /^(mostre|exiba|ver|abrir)\s+(os\s+|a\s+)?logs?/i.test(cleanLower) ||
      /^logs?\s+(desta|dessa|da)\s+execucao/i.test(cleanLower) ||
      /^ver\s+logs?$/i.test(cleanLower)
    ) {
      return {
        intent: 'STATE_QUERY',
        subType: 'LOG_QUERY',
        confidence: 0.95,
        explanation: 'Consulta sobre localização ou conteúdo dos logs do sistema.'
      };
    }

    // 3. Specific Queries about Errors / Failures / Crashes
    // E.g.: "Qual foi o erro?", "o que deu errado?", "qual e o erro?"
    if (
      /^qual\s+(foi|e|o)\s+(o\s+)?(erro|problema|falha|defeito|bloqueio)/i.test(cleanLower) ||
      /^o\s+que\s+(deu|houve|aconteceu\s+de)\s+(errado|ruim)/i.test(cleanLower) ||
      /^(me\s+)?(explique|descreva)\s+(o\s+)?(erro|problema|falha)/i.test(cleanLower) ||
      /^qual\s+o\s+motivo\s+da\s+falha/i.test(cleanLower)
    ) {
      return {
        intent: 'STATE_QUERY',
        subType: 'ERROR_QUERY',
        confidence: 0.95,
        explanation: 'Consulta sobre a causa ou descrição do erro atual.'
      };
    }

    // 4. Queries about Independent Review or Supervisor Rejection
    // E.g.: "Por que o Review rejeitou a microtarefa?", "por que foi reprovado?", "justificativa da revisão"
    if (
      /^por\s+que\s+(o\s+)?(review|revisor|supervisor|evaluator|avaliador)\s+(rejeitou|reprovou|bloqueou|negou)/i.test(cleanLower) ||
      /^por\s+que\s+(foi\s+)?(rejeitado|reprovado|bloqueado)/i.test(cleanLower) ||
      /^qual\s+(a\s+)?justificativa\s+(da\s+)?(revisao|do\s+review)/i.test(cleanLower)
    ) {
      return {
        intent: 'STATE_QUERY',
        subType: 'REVIEW_QUERY',
        confidence: 0.95,
        explanation: 'Consulta sobre o motivo de rejeição da revisão independente.'
      };
    }

    // 5. Queries about Remaining Tasks / Backlog
    // E.g.: "O que falta para terminar o projeto?", "quantas tarefas faltam?", "o que ainda falta?"
    if (
      /^(o\s+que|quanto|quantas\s+tarefas)\s+(falta|resta|ainda\s+falta)\s+(para\s+terminar|para\s+concluir|para\s+finalizar|no\s+projeto)/i.test(cleanLower) ||
      /^o\s+que\s+falta\s+para\s+terminar/i.test(cleanLower) ||
      /^o\s+que\s+ainda\s+falta/i.test(cleanLower)
    ) {
      return {
        intent: 'STATE_QUERY',
        subType: 'REMAINING_TASKS_QUERY',
        confidence: 0.95,
        explanation: 'Consulta sobre tarefas pendentes e trabalho restante para conclusão do projeto.'
      };
    }

    // 6. Queries about Progress / Current Status
    // E.g.: "Como está o andamento?", "qual o status?", "como está o projeto?"
    if (
      /^como\s+esta\s+(o\s+)?(andamento|progresso|projeto|status|desenvolvimento)/i.test(cleanLower) ||
      /^qual\s+(o\s+|e\s+o\s+)?(status|progresso|estado\s+atual)/i.test(cleanLower) ||
      /^o\s+que\s+esta\s+sendo\s+feito/i.test(cleanLower) ||
      /^como\s+estamos/i.test(cleanLower)
    ) {
      return {
        intent: 'STATE_QUERY',
        subType: 'PROGRESS_QUERY',
        confidence: 0.95,
        explanation: 'Consulta sobre o progresso e estado operacional do projeto.'
      };
    }

    // 7. Architectural Discussions & High-Level Design
    // E.g.: "O que você acha dessa arquitetura?", "o que acha da arquitetura?"
    if (
      /^(o\s+que\s+voce\s+acha|qual\s+(a\s+)?sua\s+opiniao|como\s+voce\s+avalia)\s+(dessa|da|desta)?\s*(arquitetura|estrutura|stack|padrao|design)/i.test(cleanLower) ||
      /^arquitetura\s+(do\s+projeto|sugerida|proposta)/i.test(cleanLower)
    ) {
      return {
        intent: 'CONVERSATION',
        subType: 'ARCHITECTURE_DISCUSSION',
        confidence: 0.95,
        explanation: 'Discussão técnica e avaliação de arquitetura de software.'
      };
    }

    // 8. Idea Exploration, Alternatives, and Feature Proposals
    // E.g.: "Será que vale a pena adicionar autenticação?", "Como poderíamos melhorar esse aplicativo?"
    if (
      /^(sera\s+que\s+vale\s+a\s+pena|vale\s+a\s+pena|seria\s+bom|o\s+que\s+acha\s+de)\s+(adicionar|usar|implementar|colocar|integrar)/i.test(cleanLower) ||
      /^(como\s+podemos|como\s+poderiamos|como\s+melhorar)\s+(melhorar|evoluir|otimizar)?\s*(esse|este|o)?\s*(aplicativo|app|projeto|sistema|software)/i.test(cleanLower) ||
      /^(quais\s+alternativas|quais\s+opcoes|sugestoes\s+de\s+melhoria)/i.test(cleanLower)
    ) {
      return {
        intent: 'CONVERSATION',
        subType: 'IDEA_EXPLORATION',
        confidence: 0.95,
        explanation: 'Exploração de ideias, alternativas e sugestões de melhoria.'
      };
    }

    // 9. Conversational Inquiries about Past Actions / Inactions
    // E.g.: "Você já corrigiu o erro?", "Por que você não corrigiu o erro?"
    if (
      /^(voce\s+)?ja\s+(corrigiu|arrumou|resolveu|consertou)\s+(o\s+)?(erro|problema|falha)/i.test(cleanLower) ||
      /^o\s+erro\s+ja\s+(foi|esta)\s+(corrigido|resolvido)/i.test(cleanLower)
    ) {
      return {
        intent: 'CONVERSATION',
        subType: 'STATUS_INQUIRY',
        confidence: 0.9,
        explanation: 'Pergunta conversacional sobre se o erro já foi solucionado.'
      };
    }

    if (
      /^por\s+que\s+(voce\s+)?nao\s+(corrigiu|arrumou|resolveu|consertou)\s+(o\s+)?(erro|problema|falha)/i.test(cleanLower) ||
      /^por\s+que\s+ainda\s+nao\s+(foi|esta)\s+(corrigido|resolvido)/i.test(cleanLower)
    ) {
      return {
        intent: 'CONVERSATION',
        subType: 'EXPLANATION_REQUEST',
        confidence: 0.9,
        explanation: 'Pergunta conversacional solicitando explicação do motivo de não ter corrigido ainda.'
      };
    }

    if (
      /^(me\s+)?(explique|descreva|detalhe|conte|fale\s+sobre|esclareca)\b/i.test(cleanLower)
    ) {
      return {
        intent: 'CONVERSATION',
        subType: 'EXPLANATION_REQUEST',
        confidence: 0.95,
        explanation: 'Solicitação conversacional de explicação conceitual ou arquitetural sem instrução de execução.'
      };
    }

    // 10. Ambiguous Queries & Emotional Expressions (Complaints, Uncertainty)
    // E.g.: "Isso está errado.", "Precisamos resolver isso.", "Vamos resolver esse erro.", "E agora?", "e agora?"
    if (
      /^(isso|este|esta)\s+(esta|parece|ficou)\s+(errado|ruim|estranho|quebrado|com\s+problema)[.!]?$/i.test(cleanLower) ||
      /^(precisamos|temos\s+que|vamos)\s+(resolver|arrumar|corrigir|ver)\s+(isso|esse\s+problema|o\s+erro|esse\s+erro)[.!]?$/i.test(cleanLower)
    ) {
      return {
        intent: 'AMBIGUOUS',
        subType: 'AMBIGUOUS_COMPLAINT',
        confidence: 0.92,
        explanation: 'Constatação ambígua de erro ou insatisfação sem instrução técnica delimitada.'
      };
    }

    if (/^e\s+agora\s*[\?!.]*$/i.test(cleanLower) || /^o\s+que\s+fazer\s*[\?!.]*$/i.test(cleanLower)) {
      return {
        intent: 'AMBIGUOUS',
        subType: 'AMBIGUOUS_UNCERTAIN',
        confidence: 0.92,
        explanation: 'Expressão de incerteza que requer esclarecimento e opções orientadas pelo contexto.'
      };
    }

    if (
      /^(pode|podemos|consegue|conseguimos|voce\s+pode)\s+(corrigir|arrumar|consertar|continuar|prosseguir|resolver|fazer|ver)/i.test(cleanLower) ||
      /^da\s+pra\s+(corrigir|arrumar|consertar|continuar|prosseguir|resolver)/i.test(cleanLower) ||
      /^vamos\s+(corrigir|arrumar|consertar|continuar|tentar|resolver|ver)/i.test(cleanLower) ||
      /^e\s+possivel\s+(corrigir|arrumar|consertar|continuar|resolver)/i.test(cleanLower) ||
      /^sera\s+que\s+(da|podemos|conseguimos)/i.test(cleanLower)
    ) {
      return {
        intent: 'AMBIGUOUS',
        subType: 'CAPABILITY_OR_PROPOSAL',
        confidence: 0.88,
        explanation: 'Pergunta de alinhamento ou capacidade que requer esclarecimento antes de executar.'
      };
    }

    // 11. Execution Instructions: Explicit commands to fix, continue, implement, build
    // E.g.: "Corrija a causa do erro identificado.", "Corrija o erro e continue", "Implemente o filtro por categoria."
    if (
      /^(corrija|arrume|conserte|resolva)\s+(a\s+causa\s+do|o)\s+(erro|problema|falha)/i.test(cleanLower) && !hasQuestionMark ||
      /^(corrija|arrume|conserte|resolva)\s+(o\s+)?(erro|problema|falha)\s+(e\s+)?(continue|retome|prossiga)/i.test(cleanLower)
    ) {
      return {
        intent: 'EXECUTION_INSTRUCTION',
        subType: 'FIX_AND_CONTINUE',
        confidence: 0.96,
        explanation: 'Comando imperativo para corrigir falhas e dar prosseguimento à execução.'
      };
    }

    if (/^(continuar|retomar|desbloquear|avancar|prosseguir)[.!]?$/i.test(cleanLower)) {
      return {
        intent: 'EXECUTION_INSTRUCTION',
        subType: 'CONTINUE_COMMAND',
        confidence: 0.96,
        explanation: 'Comando imperativo de continuidade do Run.'
      };
    }

    if (/^(replanejar|novo requisito|alterar requisito|defeito):/i.test(cleanLower)) {
      return {
        intent: 'EXECUTION_INSTRUCTION',
        subType: 'REPLAN_COMMAND',
        confidence: 0.98,
        explanation: 'Diretiva explícita de replanejamento com alteração de requisitos.'
      };
    }

    if (
      /^(implemente|desenvolva|crie|construa|adicione|monte|escreva|execute\s+os\s+testes|execute\s+testes)\b/i.test(cleanLower) &&
      !hasQuestionMark
    ) {
      return {
        intent: 'EXECUTION_INSTRUCTION',
        subType: 'BUILD_TASK',
        confidence: 0.94,
        explanation: 'Comando imperativo de desenvolvimento ou implementação de funcionalidade.'
      };
    }

    // 12. Social greetings and inquiries
    if (
      /^(oi|ola|bom dia|boa tarde|boa noite|valeu|obrigado|obrigada|show|beleza|entendi|ok|opa|ola!|oi!)[.!]?$/i.test(cleanLower) ||
      /^(tudo bem|como vai|quem e voce|o que voce faz|como funciona)[.!?]?$/i.test(cleanLower)
    ) {
      return {
        intent: 'CONVERSATION',
        subType: 'GENERAL_CONVERSATION',
        confidence: 0.95,
        explanation: 'Interação social ou conversacional geral.'
      };
    }

    // 13. Question heuristic: questions without imperative build verbs default to CONVERSATION
    if (hasQuestionMark) {
      if (/erro|falha|problema|quebrou/i.test(cleanLower)) {
        return {
          intent: 'STATE_QUERY',
          subType: 'ERROR_QUERY',
          confidence: 0.85,
          explanation: 'Dúvida formulada sobre falhas ou problemas.'
        };
      }
      if (/log|registro/i.test(cleanLower)) {
        return {
          intent: 'STATE_QUERY',
          subType: 'LOG_QUERY',
          confidence: 0.85,
          explanation: 'Dúvida formulada sobre logs do sistema.'
        };
      }
      return {
        intent: 'CONVERSATION',
        subType: 'IDEA_EXPLORATION',
        confidence: 0.8,
        explanation: 'Pergunta conversacional sem comando imperativo de modificação.'
      };
    }

    // Default fallback: If declarative instruction without question, treat as EXECUTION_INSTRUCTION
    return {
      intent: 'EXECUTION_INSTRUCTION',
      subType: 'BUILD_TASK',
      confidence: 0.65,
      explanation: 'Instrução declarativa tratada como diretiva de execução.'
    };
  }
}
