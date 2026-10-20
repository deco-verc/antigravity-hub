/**
 * AI DEV HUB — Security & Policy Engine
 * Deterministic Approval Matrix (GREEN, YELLOW, ORANGE, RED)
 * Enforces safety outside of LLM prompts.
 */

export type RiskLevel = 'green' | 'yellow' | 'orange' | 'red';

export interface ActionEvaluation {
  riskLevel: RiskLevel;
  actionType: string;
  description: string;
  requiresHumanApproval: boolean;
  canSupervisorDecide: boolean;
  isHardBlocked: boolean;
  ruleMatched: string;
}

export class PolicyEngine {
  // Regex patterns for RED (strictly blocked without explicit human approval)
  private static RED_PATTERNS = [
    { pattern: /(?:drop\s+database|rmdir\s+\/s|rm\s+-rf\s+[\/\*]|del\s+\/s\s+\/q)/i, rule: 'Destruição de banco ou remoção em massa de arquivos' },
    { pattern: /(?:git\s+push\s+(?:origin\s+)?(?:main|master|prod|production)|git\s+push\s+--force)/i, rule: 'Push direto para branch de produção ou força bruta' },
    { pattern: /(?:vercel\s+--prod|netlify\s+deploy\s+--prod|aws\s+s3\s+sync.*prod|terraform\s+apply)/i, rule: 'Deploy direto para produção' },
    { pattern: /(?:stripe|payment|credit_card|buy|purchase|checkout|billing)/i, rule: 'Operação financeira, compra ou pagamento' },
    { pattern: /(?:api_key|secret_key|private_key|token|password|credentials\.json|\.env\.production)/i, rule: 'Acesso ou modificação de credenciais sensíveis de produção' },
    { pattern: /(?:route53|cloudflare\s+dns|dns\s+record|nameserver)/i, rule: 'Alteração de DNS ou domínio' }
  ];

  // Regex patterns for ORANGE (requires human approval via Approval Inbox)
  private static ORANGE_PATTERNS = [
    { pattern: /(?:alter\s+table.*drop\s+column|migrate\s+down|prisma\s+migrate\s+reset)/i, rule: 'Alteração destrutiva no schema do banco de dados' },
    { pattern: /(?:switch\s+framework|rewrite\s+in\s+vue|rewrite\s+in\s+angular)/i, rule: 'Mudança radical da stack principal' },
    { pattern: /(?:(?:install|add|i)\s+.*(?:openai|anthropic|replicate|elevenlabs|aws-sdk|@google\/genai)|(?:openai|anthropic|replicate|elevenlabs|aws-sdk|@google\/genai).*install)/i, rule: 'Adição de serviço externo que possa incorrer em custos' },
    { pattern: /(?:remove\s+feature|deprecate\s+requirement)/i, rule: 'Remoção de requisito do briefing do produto' }
  ];

  // Regex patterns for YELLOW (Supervisor can decide autonomously)
  private static YELLOW_PATTERNS = [
    { pattern: /(?:lucide-react|feather-icons|date-fns|dayjs|clsx|tailwind-merge)/i, rule: 'Adoção ou troca de biblioteca utilitária/secundária' },
    { pattern: /(?:refactor\s+endpoints|rename\s+route|restructure\s+components)/i, rule: 'Reorganização estrutural interna de componentes ou rotas' },
    { pattern: /(?:change\s+theme|adjust\s+color\s+palette|layout\s+density)/i, rule: 'Ajuste de estilo visual ou paleta' }
  ];

  /**
   * Evaluate a proposed command line string or action
   */
  static evaluateCommand(commandLine: string): ActionEvaluation {
    const cmd = commandLine.trim();

    // Check RED
    for (const p of this.RED_PATTERNS) {
      if (p.pattern.test(cmd)) {
        return {
          riskLevel: 'red',
          actionType: 'command',
          description: `Comando potencialmente perigoso: "${cmd.slice(0, 60)}..."`,
          requiresHumanApproval: true,
          canSupervisorDecide: false,
          isHardBlocked: true,
          ruleMatched: p.rule
        };
      }
    }

    // Check ORANGE
    for (const p of this.ORANGE_PATTERNS) {
      if (p.pattern.test(cmd)) {
        return {
          riskLevel: 'orange',
          actionType: 'command',
          description: `Comando de alto impacto arquitetural: "${cmd.slice(0, 60)}..."`,
          requiresHumanApproval: true,
          canSupervisorDecide: false,
          isHardBlocked: false,
          ruleMatched: p.rule
        };
      }
    }

    // Check YELLOW
    for (const p of this.YELLOW_PATTERNS) {
      if (p.pattern.test(cmd)) {
        return {
          riskLevel: 'yellow',
          actionType: 'command',
          description: `Comando de ajuste técnico secundário: "${cmd.slice(0, 60)}..."`,
          requiresHumanApproval: false,
          canSupervisorDecide: true,
          isHardBlocked: false,
          ruleMatched: p.rule
        };
      }
    }

    // Default to GREEN for standard local dev operations
    return {
      riskLevel: 'green',
      actionType: 'command',
      description: `Comando padrão de desenvolvimento local: "${cmd.slice(0, 60)}..."`,
      requiresHumanApproval: false,
      canSupervisorDecide: true,
      isHardBlocked: false,
      ruleMatched: 'Operação padrão de compilação, teste, execução ou edição local'
    };
  }

  /**
   * Evaluate a proposed architectural decision or change description
   */
  static evaluateDecision(decision: string, rationale: string): ActionEvaluation {
    const text = `${decision} ${rationale}`.toLowerCase();

    for (const p of this.RED_PATTERNS) {
      if (p.pattern.test(text)) {
        return {
          riskLevel: 'red',
          actionType: 'decision',
          description: decision,
          requiresHumanApproval: true,
          canSupervisorDecide: false,
          isHardBlocked: true,
          ruleMatched: p.rule
        };
      }
    }

    for (const p of this.ORANGE_PATTERNS) {
      if (p.pattern.test(text)) {
        return {
          riskLevel: 'orange',
          actionType: 'decision',
          description: decision,
          requiresHumanApproval: true,
          canSupervisorDecide: false,
          isHardBlocked: false,
          ruleMatched: p.rule
        };
      }
    }

    for (const p of this.YELLOW_PATTERNS) {
      if (p.pattern.test(text)) {
        return {
          riskLevel: 'yellow',
          actionType: 'decision',
          description: decision,
          requiresHumanApproval: false,
          canSupervisorDecide: true,
          isHardBlocked: false,
          ruleMatched: p.rule
        };
      }
    }

    return {
      riskLevel: 'green',
      actionType: 'decision',
      description: decision,
      requiresHumanApproval: false,
      canSupervisorDecide: true,
      isHardBlocked: false,
      ruleMatched: 'Decisão de rotina de implementação e refatoração'
    };
  }
}
