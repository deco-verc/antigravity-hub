// server/src/designSkillService.ts
// Motor de Design Anti-Slop & Validação Visual do DecoHUB
// Integração de 4 tecnologias oficiais:
// 1. Leonxlnx Taste-Skill (design-taste-frontend, minimalist, brutalist, soft, redesign, 3 dials)
// 2. Vercel Web Interface & Design Guidelines (tabular-nums, accessibility, reduced-motion)
// 3. VoltAgent Awesome DESIGN.md (sistemas de design de ponta: Linear, Stripe, Vercel, Notion, etc.)
// 4. Playwright Agent CLI (@playwright/cli para automação, snapshots enumerados por secção e console error audit)

import fs from 'node:fs';
import path from 'node:path';
import { DocSimpService } from './docSimpService.js';
import { Logger } from './logger.js';

export interface DesignDials {
  variance: number; // 1 (Perfect Symmetry) to 10 (Artsy Chaos)
  motion: number;   // 1 (Static) to 10 (Cinematic / Physics)
  density: number;  // 1 (Art Gallery / Airy) to 10 (Cockpit / Data-dense)
}

export type DesignArchetype =
  | 'linear'
  | 'stripe'
  | 'vercel'
  | 'notion'
  | 'clean-saas'
  | 'fintech'
  | 'dark-telemetry'
  | 'minimalist'
  | 'brutalist'
  | 'soft';

export interface DesignProfile {
  archetype: DesignArchetype;
  dials: DesignDials;
  designSystemFile: string;
  description: string;
}

export interface ProductMatrixRecipe {
  domain: string;
  archetype: DesignArchetype;
  fontPairing: string;
  cssTokens: Record<string, string>;
  cssTokensBlock: string;
  dials: DesignDials;
  animationChoreography: string;
  antiSlopChecklist: string[];
  description: string;
}

export interface ProvisionDesignResult {
  profile: DesignProfile;
  designMdPath: string;
  skillsDir: string;
  copiedSkills: string[];
  directiveBlock: string;
}

export class DesignSkillService {
  /**
   * Resolves the central design-skills directory within DOCSIMP.
   */
  static getDesignSkillsDir(): string {
    if (process.env.DESIGN_SKILLS_DIR) {
      return path.resolve(process.env.DESIGN_SKILLS_DIR);
    }
    const docSimpBase = DocSimpService.getDocSimpDir();
    const candidatePaths = [
      path.join(docSimpBase, 'design-skills'),
      'C:\\IA\\Antigravity HUB\\DOCSIMP\\design-skills',
      path.resolve(process.cwd(), '..', 'DOCSIMP', 'design-skills'),
      path.resolve(process.cwd(), 'DOCSIMP', 'design-skills')
    ];
    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) return cand;
    }
    return candidatePaths[0];
  }

  /**
   * Writes a UTF-8 file only if it does not exist or its content has changed.
   */
  private static writeFileIfChanged(filePath: string, content: string): void {
    try {
      if (fs.existsSync(filePath)) {
        const existing = fs.readFileSync(filePath, 'utf-8');
        if (existing === content) return;
      }
      fs.writeFileSync(filePath, content, 'utf-8');
    } catch {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }

  /**
   * Copies a file only if destination does not exist or differs in size/content.
   */
  private static copyFileIfChanged(srcPath: string, destPath: string): void {
    try {
      if (fs.existsSync(destPath)) {
        const srcStat = fs.statSync(srcPath);
        const destStat = fs.statSync(destPath);
        if (srcStat.size === destStat.size) {
          const srcBuf = fs.readFileSync(srcPath);
          const destBuf = fs.readFileSync(destPath);
          if (srcBuf.equals(destBuf)) return;
        }
      }
      fs.copyFileSync(srcPath, destPath);
    } catch {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  /**
   * Infers the optimal design archetype and dials from the user briefing.
   */
  static inferDesignProfile(briefing: string): DesignProfile {
    const text = (briefing || '').toLowerCase();

    if (/brutalis(t|ta)|industrial|raw grid|swiss grotesk|mechanical/i.test(text)) {
      return {
        archetype: 'brutalist',
        dials: { variance: 9, motion: 2, density: 7 },
        designSystemFile: 'brutalist.md',
        description:
          'Brutalist & Industrial: Alto contraste, tipografia suíça marcante e estrutura geométrica sem concessões.'
      };
    }

    if (/\bsoft(-skill)?\b|pastel|past[eé]is|suave|rounded|wellness|calm\s+ui|sa[uú]de|cl[ií]nica|odontol|m[eé]dic/i.test(text)) {
      return {
        archetype: 'soft',
        dials: { variance: 4, motion: 4, density: 4 },
        designSystemFile: 'soft.md',
        description:
          'Soft & Organic UI: Superfícies suaves, bordas arredondadas confortáveis, contraste equilibrado e microinterações fluidas.'
      };
    }

    if (/stripe|pagamento|payment|checkout|gateway|cobranca|cobran[çc]a/i.test(text)) {
      return {
        archetype: 'stripe',
        dials: { variance: 6, motion: 4, density: 5 },
        designSystemFile: 'stripe.md',
        description:
          'Stripe Infrastructure: Superfícies elegantes, microinterações precisas e estética de plataforma financeira global.'
      };
    }

    if (/fintech|banco|banking|wallet|carteira|revolut|wise|mercury/i.test(text)) {
      return {
        archetype: 'fintech',
        dials: { variance: 6, motion: 4, density: 5 },
        designSystemFile: 'fintech.md',
        description:
          'Fintech Moderna: Segurança, dados transacionais claros, números tabulares e acabamento refinado.'
      };
    }

    if (/vercel|infra|cloud|devops|serverless|developer tool|engine/i.test(text)) {
      return {
        archetype: 'vercel',
        dials: { variance: 5, motion: 3, density: 6 },
        designSystemFile: 'vercel.md',
        description:
          'Vercel Developer Experience: Monocromático de alta precisão, tipografia Geist, bordas de 1px e respiro técnico.'
      };
    }

    if (/notion|docs|wiki|knowledge|caderno|notes|document|workspace/i.test(text)) {
      return {
        archetype: 'notion',
        dials: { variance: 4, motion: 2, density: 4 },
        designSystemFile: 'notion.md',
        description:
          'Notion Workspace: Tipografia legível, foco editorial em conteúdo, contrastes confortáveis e fluidez de leitura.'
      };
    }

    if (/dark telemetry|telemetr(y|ia)|cockpit|terminal|raycast|analytics|posthog|monitoring/i.test(text)) {
      return {
        archetype: 'dark-telemetry',
        dials: { variance: 5, motion: 3, density: 8 },
        designSystemFile: 'dark-telemetry.md',
        description:
          'Dark Telemetry: Cockpit de alta densidade, superfícies escuras profundas (#010102), métricas tabulares e máxima eficiência visual.'
      };
    }

    if (/linear/i.test(text)) {
      return {
        archetype: 'linear',
        dials: { variance: 5, motion: 3, density: 3 },
        designSystemFile: 'linear.md',
        description:
          'Linear Software Craft: Design dark premium, superfícies carvão (#0f1011), destaque lavanda (#5e6ad2) e precisão de engenharia.'
      };
    }

    if (/clean|resend|newsletter|email|onboarding/i.test(text)) {
      return {
        archetype: 'clean-saas',
        dials: { variance: 5, motion: 3, density: 4 },
        designSystemFile: 'clean-saas.md',
        description:
          'Clean SaaS: Clareza tipográfica, espaçamento equilibrado, paleta restrita e foco na conversão.'
      };
    }

    if (/minimalis(t|ta)|calm|subtle|editorial/i.test(text)) {
      return {
        archetype: 'minimalist',
        dials: { variance: 5, motion: 3, density: 3 },
        designSystemFile: 'minimalist.md',
        description:
          'Minimalist Editorial: Respiro amplo, ausência de ruído, sofisticação serena e tipografia hierárquica.'
      };
    }

    // Default archetype: Linear (Modern Software Craft)
    return {
      archetype: 'linear',
      dials: { variance: 5, motion: 3, density: 3 },
      designSystemFile: 'linear.md',
      description:
        'Linear Software Craft: Design dark premium, superfícies carvão (#0f1011), destaque lavanda (#5e6ad2) e precisão de engenharia.'
    };
  }

  /**
   * Detects whether a task or project involves frontend, UI or web presentation.
   */
  static isUiOrFrontendTask(content: string, stack?: string): boolean {
    const combined = `${content || ''}${stack || ''}`.toLowerCase();
    const uiPattern =
      /\b(frontend|front-end|ui|ux|interface|component|componente|layout|screen|tela|css|html|react|vue|svelte|tailwind|dashboard|page|p[aá]gina|view|bot[aã]o|modal|drawer|form|formul[aá]rio|navbar|sidebar|topbar|tab|abas?|chart|gr[aá]fico|data-grid|design|estilo|spa)\b/i;
    return uiPattern.test(combined);
  }

  /**
   * Generates the compact directive block (~950 to 1,250 chars) for injection into prompts.
   */
  static generateDirectiveBlock(profile: DesignProfile, projectPath?: string): string {
    const designPathRef = 'DESIGN.md';
    const skillsPathRef = '.ai-dev-hub/skills/';
    const recipe = this.getProductMatrixRecipe(profile.archetype);
    const compactTokens = Object.entries(recipe.cssTokens)
      .map(([k, v]) => `${k}:${v}`)
      .join('; ');

    return [
      `=== DIRETRIZES DE DESIGN ANTI-SLOP & VALIDAÇÃO VISUAL (TASTE-SKILL & VERCEL) ===`,
      `ARQUÉTIPO VISUAL: [${profile.archetype.toUpperCase()}] | DIALS: VARIANCE=${profile.dials.variance}/10 | MOTION=${profile.dials.motion}/10 | DENSITY=${profile.dials.density}/10`,
      `ESTILO: ${profile.description}`,
      `TOKENS (:root): { ${compactTokens} } | FONTE: ${recipe.fontPairing}`,
      `ARQUIVOS DE REFERÊNCIA NO PROJETO: "${designPathRef}" e "${skillsPathRef}".`,
      `1. ZERO AI-SLOP & ZERO EMOJIS: Proibido usar emojis nativos como ícones. Use exclusivamente SVGs limpos inline (Lucide, stroke-width 1.75px).`,
      `2. DESIGN TOKENS, TABULAR-NUMS & ABAS: Variáveis em :root, scrollbar de 6px e "font-variant-numeric: tabular-nums" em números/datas. Botões/abas com role="tab" e data-tab="<secao>" para captura de secções (01-Secao.png).`,
      `3. VERCEL GUIDELINES & ESTADOS: Animações GPU-only (transform/opacity) com prefers-reduced-motion. Estados Empty, Loading, Populated e Error; sanitização escapeHtml.`,
      `4. ROTEAMENTO, PORT_GUARD & PLAYWRIGHT-CLI: Servir public/index.html em GET / e JSON em /api/health. Portas 4000-4999 (proibido 3001/3000/5173). Valide com playwright-cli.`,
      `=== FIM DAS DIRETRIZES DE DESIGN ===`
    ].join('\n');
  }

  /**
   * Synthesizes a complete canonical DESIGN.md document when a physical archetype file is not present.
   */
  private static buildSynthesizedDesignMd(profile: DesignProfile, briefing: string): string {
    const recipe = this.getProductMatrixRecipe(briefing || profile.archetype);
    return [
      `# DESIGN.md — ${profile.archetype.toUpperCase()} (${recipe.domain})`,
      ``,
      `> ${profile.description}`,
      ``,
      `## 1. Design Dials (Calibração Taste-Skill)`,
      `- **Variance:** ${profile.dials.variance}/10`,
      `- **Motion:** ${profile.dials.motion}/10`,
      `- **Density:** ${profile.dials.density}/10`,
      ``,
      `## 2. Tipografia & Números Tabulares`,
      `- **Font Pairing:** \`${recipe.fontPairing}\``,
      `- **Regra Numérica Obrigatória:** Aplicar \`font-variant-numeric: tabular-nums;\` em todos os KPIs, preços, contadores, datas e células numéricas de tabelas.`,
      ``,
      `## 3. Paleta de Tokens CSS Semânticos (:root)`,
      `\`\`\`css`,
      recipe.cssTokensBlock,
      `\`\`\``,
      ``,
      `## 4. Coreografia de Movimento & Scrollbar`,
      `- ${recipe.animationChoreography}`,
      `- Scrollbar customizada: \`::-webkit-scrollbar { width: 6px; height: 6px; } ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }\``,
      ``,
      `## 5. Checklist Anti-Slop & Navegação de Secções`,
      ...recipe.antiSlopChecklist.map(item => `- ${item}`),
      `- Todos os itens de navegação entre vistas/abas devem conter \`role="tab"\` e \`data-tab="<nome-da-secao>"\` para inspeção e captura enumerada (\`01-Secao.png\`).`
    ].join('\n');
  }

  /**
   * Provisions DESIGN.md and relevant design skills into the target project workspace.
   */
  static async provisionDesignSkillsForProject(briefing: string, projectPath: string): Promise<ProvisionDesignResult> {
    const profile = this.inferDesignProfile(briefing);
    const designSkillsRoot = this.getDesignSkillsDir();
    const skillsDestDir = path.join(projectPath, '.ai-dev-hub', 'skills');
    const targetDesignMd = path.join(projectPath, 'DESIGN.md');

    try {
      if (!fs.existsSync(projectPath)) {
        fs.mkdirSync(projectPath, { recursive: true });
      }
      if (!fs.existsSync(skillsDestDir)) {
        fs.mkdirSync(skillsDestDir, { recursive: true });
      }

      // 1. Copy or generate DESIGN.md idempotently
      const archetypeCandidates = [
        path.join(designSkillsRoot, 'design-systems', profile.designSystemFile),
        path.join(designSkillsRoot, 'taste-skill', profile.designSystemFile),
        path.join(designSkillsRoot, 'awesome-design-md', 'design-md', `${profile.archetype}.app`, 'DESIGN.md'),
        path.join(designSkillsRoot, 'awesome-design-md', 'design-md', 'linear.app', 'DESIGN.md')
      ];

      const existingSource = archetypeCandidates.find(cand => fs.existsSync(cand) && fs.statSync(cand).isFile());
      if (existingSource) {
        this.copyFileIfChanged(existingSource, targetDesignMd);
      } else {
        this.writeFileIfChanged(targetDesignMd, this.buildSynthesizedDesignMd(profile, briefing));
      }

      // 2. Copy skill files into .ai-dev-hub/skills/ idempotently
      const copiedSkills: string[] = [];
      const skillFilesToCopy = [
        { src: 'taste-skill.md', altDirs: ['taste-skill'], dest: 'taste-skill.md' },
        { src: 'vercel-web-design-guidelines.md', altDirs: ['sources/vercel-skills'], dest: 'vercel-web-design-guidelines.md' },
        { src: 'playwright-agent-cli.md', altDirs: [], dest: 'playwright-agent-cli.md' },
        { src: 'find-skills.md', altDirs: ['sources/vercel-skills'], dest: 'find-skills.md' },
        { src: 'frontend-design.md', altDirs: ['taste-skill'], dest: 'frontend-design.md' },
        { src: 'modern-frontend-design.md', altDirs: ['taste-skill'], dest: 'modern-frontend-design.md' },
        { src: 'ui-ux-pro-max.md', altDirs: ['sources/ui-ux-pro-max-skill'], dest: 'ui-ux-pro-max.md' },
        { src: 'vercel-react-best-practices.md', altDirs: ['sources/vercel-skills'], dest: 'vercel-react-best-practices.md' },
        { src: 'vercel-composition-patterns.md', altDirs: ['sources/vercel-skills'], dest: 'vercel-composition-patterns.md' },
        { src: 'web-animation-design.md', altDirs: ['taste-skill'], dest: 'web-animation-design.md' }
      ];

      for (const item of skillFilesToCopy) {
        const candidateSources = [
          path.join(designSkillsRoot, item.src),
          ...item.altDirs.map(d => path.join(designSkillsRoot, d, item.src))
        ];
        const foundSrc = candidateSources.find(s => fs.existsSync(s) && fs.statSync(s).isFile());
        const destPath = path.join(skillsDestDir, item.dest);

        if (foundSrc) {
          this.copyFileIfChanged(foundSrc, destPath);
          copiedSkills.push(item.dest);
        } else {
          this.writeFileIfChanged(
            destPath,
            `# ${item.dest}\nDiretrizes de design Anti-Slop, tokens semânticos (:root), ícones SVG Lucide e validação visual automatizada.\n`
          );
          copiedSkills.push(item.dest);
        }
      }

      const directiveBlock = this.generateDirectiveBlock(profile, projectPath);
      Logger.info(
        `[DesignSkillService] Habilidades de design provisionadas para "${path.basename(projectPath)}" (Arquétipo: ${profile.archetype}).`
      );

      return {
        profile,
        designMdPath: targetDesignMd,
        skillsDir: skillsDestDir,
        copiedSkills,
        directiveBlock
      };
    } catch (err: any) {
      Logger.warn(`[DesignSkillService] Falha não bloqueante ao provisionar design skills: ${err.message}`);
      const directiveBlock = this.generateDirectiveBlock(profile, projectPath);
      return {
        profile,
        designMdPath: targetDesignMd,
        skillsDir: skillsDestDir,
        copiedSkills: [],
        directiveBlock
      };
    }
  }

  /**
   * Product Matrix: resolves exact design tokens, typography, dials and anti-slop rules
   * based on product domain (SaaS Subscriptions, Fintech, Productivity, Devops, Docs, Soft, Brutalist, etc.).
   */
  static getProductMatrixRecipe(domainOrBriefing: string): ProductMatrixRecipe {
    const text = (domainOrBriefing || '').toLowerCase();

    // 1. SaaS Subscriptions / Billing / MRR
    if (/saas|subscri(ption|ber)|assinatura|recorrente|mrr|churn|billing|fatura|pricing|plano/i.test(text)) {
      const cssTokens: Record<string, string> = {
        '--bg': '#0b0d0e',
        '--surface': '#141719',
        '--surface-hover': '#1c2023',
        '--border': '#23272b',
        '--border-focus': '#5e6ad2',
        '--text': '#f0f2f5',
        '--text-muted': '#8b949e',
        '--accent': '#5e6ad2',
        '--accent-hover': '#4e5ac0',
        '--success': '#22c55e',
        '--warning': '#f59e0b',
        '--danger': '#ef4444'
      };
      const cssTokensBlock = Object.entries(cssTokens)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');
      return {
        domain: 'saas-subscriptions',
        archetype: 'linear',
        fontPairing: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        cssTokens,
        cssTokensBlock: `:root {\n${cssTokensBlock}\n}`,
        dials: { variance: 4, motion: 3, density: 6 },
        animationChoreography:
          'Transições rápidas de 150ms ease-out em botões e tabs; modais com 200ms cubic-bezier(0.16, 1, 0.3, 1); contadores com tabular-nums.',
        antiSlopChecklist: [
          'Ícones SVG limpos (Lucide ou inline) em todas as ações e navegações (zero emojis como ícones)',
          'Preços, contadores e métricas formatados com font-variant-numeric: tabular-nums',
          'Dropdowns de planos e status com largura de 100% sem truncar texto do Windows',
          'Cards de planos e faturas com borda lateral de destaque e superfícies contrastadas',
          'Scrollbar escura estilizada com 6px (::-webkit-scrollbar)'
        ],
        description:
          'SaaS B2B & Subscriptions: Superfícies escuras refinadas, lavanda Linear (#5e6ad2), métricas tabulares e hierarquia cristalina.'
      };
    }

    // 2. Fintech / Banking / Payments / Checkout
    if (/fintech|pagamento|payment|checkout|gateway|pix|banco|banking|wallet|cobranca|cobran[çc]a|stripe/i.test(text)) {
      const cssTokens: Record<string, string> = {
        '--bg': '#090a0f',
        '--surface': '#12141c',
        '--surface-hover': '#1b1e2a',
        '--border': '#202436',
        '--border-focus': '#10b981',
        '--text': '#f8fafc',
        '--text-muted': '#94a3b8',
        '--accent': '#10b981',
        '--accent-hover': '#059669',
        '--success': '#10b981',
        '--warning': '#f59e0b',
        '--danger': '#ef4444'
      };
      const cssTokensBlock = Object.entries(cssTokens)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');
      return {
        domain: 'fintech-payments',
        archetype: 'stripe',
        fontPairing: "'Geist', 'Inter', -apple-system, sans-serif",
        cssTokens,
        cssTokensBlock: `:root {\n${cssTokensBlock}\n}`,
        dials: { variance: 3, motion: 2, density: 7 },
        animationChoreography:
          'Microinterações rápidas de 120ms ease-in-out, animações suaves de loading state em botões de confirmação de pagamento.',
        antiSlopChecklist: [
          'Ícones SVG de cadeado, cartão e setas (zero emojis em botões de pagamento)',
          'Valores monetários com font-variant-numeric: tabular-nums e alinhamento à direita',
          'Feedback visual explícito de status da transação (pendente, aprovado, estornado)',
          'Scrollbar 6px integrada ao dark theme'
        ],
        description:
          'Fintech & Payments: Estética Stripe/Mercury com acentos esmeralda (#10b981), dados transacionais densos e alta percepção de segurança.'
      };
    }

    // 3. Productivity / Daily Planner / Focus
    if (/planner|rotina|habito|h[aá]bito|habit|tarefa|agenda|foco|focus|daily|todo/i.test(text)) {
      const cssTokens: Record<string, string> = {
        '--bg': '#0d1117',
        '--surface': '#161b22',
        '--surface-hover': '#21262d',
        '--border': '#30363d',
        '--border-focus': '#6366f1',
        '--text': '#c9d1d9',
        '--text-muted': '#8b949e',
        '--accent': '#6366f1',
        '--accent-hover': '#4f46e5',
        '--success': '#238636',
        '--warning': '#d29922',
        '--danger': '#f85149'
      };
      const cssTokensBlock = Object.entries(cssTokens)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');
      return {
        domain: 'productivity-planner',
        archetype: 'linear',
        fontPairing: "'Inter', system-ui, sans-serif",
        cssTokens,
        cssTokensBlock: `:root {\n${cssTokensBlock}\n}`,
        dials: { variance: 4, motion: 3, density: 5 },
        animationChoreography:
          'Transição suave ao marcar tarefas concluídas (fade + strike 150ms), reordenação com animação suave de 180ms.',
        antiSlopChecklist: [
          'Ícones SVG com stroke fino para checkboxes e ações (zero emojis em botões)',
          'Temporizadores e contadores de tempo com font-variant-numeric: tabular-nums',
          'Barra de progresso refinada com gradiente discreto e cantos arredondados',
          'Select de prioridade e filtros estilizados com padding adequado'
        ],
        description:
          'Productivity & Daily Planner: Padrão Linear Software Craft com acento índigo (#6366f1), foco em fluxo e zero distração.'
      };
    }

    // 4. DevOps & Dark Telemetry
    if (
      /dark telemetry|dark-telemetry|telemetr(y|ia)|cockpit|terminal|raycast|analytics|posthog|monitoring|devops|cloud|infra|vercel/i.test(
        text
      )
    ) {
      const cssTokens: Record<string, string> = {
        '--bg': '#010102',
        '--surface': '#0a0b0e',
        '--surface-hover': '#121419',
        '--border': '#1a1d24',
        '--border-focus': '#06b6d4',
        '--text': '#f3f4f6',
        '--text-muted': '#6b7280',
        '--accent': '#06b6d4',
        '--accent-hover': '#0891b2',
        '--success': '#10b981',
        '--warning': '#f59e0b',
        '--danger': '#ef4444'
      };
      const cssTokensBlock = Object.entries(cssTokens)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');
      return {
        domain: 'devops-telemetry',
        archetype: 'dark-telemetry',
        fontPairing: "'JetBrains Mono', 'Geist Mono', monospace",
        cssTokens,
        cssTokensBlock: `:root {\n${cssTokensBlock}\n}`,
        dials: { variance: 3, motion: 2, density: 9 },
        animationChoreography:
          'Indicadores pulsantes de status (ping 1.5s), gráficos com transição linear de 100ms sem saltos.',
        antiSlopChecklist: [
          'Ícones de status técnicos em SVG com cores semânticas',
          'Métricas e gráficos com números tabulares e fonte monoespaçada',
          'Terminal logs com scrollbar ultrafina (4px) e fundo preto profundo'
        ],
        description:
          'DevOps & Telemetry: Cockpit de alta densidade (#010102), ciano (#06b6d4) e tipografia técnica de alta legibilidade.'
      };
    }

    // 5. Docs & Knowledge Base
    if (/notion|docs|wiki|knowledge|caderno|notes|document|workspace/i.test(text)) {
      const cssTokens: Record<string, string> = {
        '--bg': '#191919',
        '--surface': '#202020',
        '--surface-hover': '#2a2a2a',
        '--border': '#2f2f2f',
        '--border-focus': '#2eaadc',
        '--text': '#ffffff',
        '--text-muted': '#9b9b9b',
        '--accent': '#2eaadc',
        '--accent-hover': '#1d92bf',
        '--success': '#0f7b6c',
        '--warning': '#d9730d',
        '--danger': '#e03e3e'
      };
      const cssTokensBlock = Object.entries(cssTokens)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');
      return {
        domain: 'docs-knowledge',
        archetype: 'notion',
        fontPairing: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        cssTokens,
        cssTokensBlock: `:root {\n${cssTokensBlock}\n}`,
        dials: { variance: 4, motion: 2, density: 4 },
        animationChoreography: 'Transições suaves de 150ms em menus colapsáveis e breadcrumbs.',
        antiSlopChecklist: [
          'Ícones SVG minimalistas para documentos, pastas e busca',
          'Espaçamento generoso entre parágrafos e títulos hierárquicos',
          'Blocos de código com destaque de sintaxe e borda discreta'
        ],
        description:
          'Docs & Knowledge Base: Estilo Notion/GitBook com foco editorial, superfícies confortáveis e leitura desimpedida.'
      };
    }

    // 6. Brutalist Industrial
    if (/brutalis(t|ta)|industrial|raw grid|swiss grotesk|mechanical/i.test(text)) {
      const cssTokens: Record<string, string> = {
        '--bg': '#000000',
        '--surface': '#111111',
        '--surface-hover': '#222222',
        '--border': '#ffffff',
        '--border-focus': '#ffffff',
        '--text': '#ffffff',
        '--text-muted': '#888888',
        '--accent': '#ff3300',
        '--accent-hover': '#cc2900',
        '--success': '#00ff66',
        '--warning': '#ffff00',
        '--danger': '#ff0033'
      };
      const cssTokensBlock = Object.entries(cssTokens)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');
      return {
        domain: 'brutalist-industrial',
        archetype: 'brutalist',
        fontPairing: "'Space Mono', 'Courier New', monospace",
        cssTokens,
        cssTokensBlock: `:root {\n${cssTokensBlock}\n}`,
        dials: { variance: 9, motion: 2, density: 7 },
        animationChoreography:
          'Cortes secos sem easing artificial (0ms a 50ms step), transições instantâneas de alto impacto.',
        antiSlopChecklist: [
          'Zero emojis; bordas sólidas de 2px de alto contraste',
          'Tipografia monumental em caixa alta nos cabeçalhos'
        ],
        description:
          'Brutalist & Industrial: Alto contraste geométrico, bordas sólidas e estética crua sem concessões.'
      };
    }

    // 7. Soft / Pastel / Organic UI
    if (/\bsoft(-skill)?\b|pastel|past[eé]is|suave|rounded|wellness/i.test(text)) {
      const cssTokens: Record<string, string> = {
        '--bg': '#121318',
        '--surface': '#1a1c24',
        '--surface-hover': '#232631',
        '--border': '#2c303d',
        '--border-focus': '#a78bfa',
        '--text': '#f3f4f8',
        '--text-muted': '#9ca3af',
        '--accent': '#a78bfa',
        '--accent-hover': '#8b5cf6',
        '--success': '#34d399',
        '--warning': '#fbbf24',
        '--danger': '#f87171'
      };
      const cssTokensBlock = Object.entries(cssTokens)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');
      return {
        domain: 'soft-organic',
        archetype: 'soft',
        fontPairing: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
        cssTokens,
        cssTokensBlock: `:root {\n${cssTokensBlock}\n}`,
        dials: { variance: 4, motion: 4, density: 4 },
        animationChoreography:
          'Transições suaves de 220ms cubic-bezier(0.22, 1, 0.36, 1) com bordas arredondadas (12px) e elevação sutil.',
        antiSlopChecklist: [
          'Ícones SVG arredondados (stroke-linecap: round) sem emojis nativos',
          'Métricas e valores formatados com font-variant-numeric: tabular-nums',
          'Scrollbar estilizada de 6px integrada à superfície suave'
        ],
        description:
          'Soft & Organic UI: Tons lavanda pastel (#a78bfa), superfícies acolhedoras, cantos arredondados e hierarquia fluida.'
      };
    }

    // 8. Minimalist Editorial
    if (/minimalis(t|ta)|clean|calm|subtle|editorial|resend/i.test(text)) {
      const cssTokens: Record<string, string> = {
        '--bg': '#ffffff',
        '--surface': '#f9fafb',
        '--surface-hover': '#f3f4f6',
        '--border': '#e5e7eb',
        '--border-focus': '#111827',
        '--text': '#111827',
        '--text-muted': '#6b7280',
        '--accent': '#000000',
        '--accent-hover': '#374151',
        '--success': '#059669',
        '--warning': '#d97706',
        '--danger': '#dc2626'
      };
      const cssTokensBlock = Object.entries(cssTokens)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n');
      return {
        domain: 'minimalist-editorial',
        archetype: 'minimalist',
        fontPairing: "'Newsreader', 'Inter', serif",
        cssTokens,
        cssTokensBlock: `:root {\n${cssTokensBlock}\n}`,
        dials: { variance: 5, motion: 3, density: 3 },
        animationChoreography: 'Transições etéreas de 200ms ease, fades sutis de opacidade.',
        antiSlopChecklist: [
          'Ausência de ruído visual; espaçamento generoso',
          'Ícones SVG ultrafinos com stroke de 1.25px'
        ],
        description: 'Minimalist Editorial: Respiro amplo, sofisticação serena e tipografia hierárquica.'
      };
    }

    // Default: General Clean SaaS (Linear Standard)
    const cssTokens: Record<string, string> = {
      '--bg': '#0f1011',
      '--surface': '#16181a',
      '--surface-hover': '#1f2225',
      '--border': '#282b30',
      '--border-focus': '#5e6ad2',
      '--text': '#f7f8f8',
      '--text-muted': '#8a8f98',
      '--accent': '#5e6ad2',
      '--accent-hover': '#4e5ac0',
      '--success': '#22c55e',
      '--warning': '#f59e0b',
      '--danger': '#ef4444'
    };
    const cssTokensBlock = Object.entries(cssTokens)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
    return {
      domain: 'general-saas',
      archetype: 'linear',
      fontPairing: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      cssTokens,
      cssTokensBlock: `:root {\n${cssTokensBlock}\n}`,
      dials: { variance: 5, motion: 3, density: 6 },
      animationChoreography: 'Transições suaves de 150ms ease-out em controles interativos.',
      antiSlopChecklist: [
        'Ícones SVG limpos (zero emojis como ícones em botões e navegação)',
        'Métricas com font-variant-numeric: tabular-nums',
        'Controles customizados com scrollbar escura 6px'
      ],
      description:
        'Modern Software Craft: Design dark premium padrão Linear/Raycast com acento lavanda e acabamento de engenharia.'
    };
  }

  /**
   * Builds an actionable, role-specific playbook for Supervisor, Worker or Evaluator.
   */
  static buildRoleSpecificSkillPlaybook(
    role: 'SUPERVISOR' | 'WORKER' | 'EVALUATOR',
    domainOrBriefing: string,
    projectPath?: string
  ): string {
    const recipe = this.getProductMatrixRecipe(domainOrBriefing);
    const designRef = projectPath ? path.join(projectPath, 'DESIGN.md') : 'DESIGN.md';
    const skillsRef = projectPath ? path.join(projectPath, '.ai-dev-hub', 'skills') : '.ai-dev-hub/skills/';

    if (role === 'SUPERVISOR') {
      return [
        `=== PLAYBOOK DE SKILL PARA O SUPERVISOR (DECOMPOSIÇÃO & GOVERNANÇA UI) ===`,
        `DOMÍNIO DETECTADO: [${recipe.domain.toUpperCase()}] | ARQUÉTIPO: [${recipe.archetype.toUpperCase()}]`,
        `DIALS RECOMENDADOS: VARIANCE=${recipe.dials.variance}/10 | MOTION=${recipe.dials.motion}/10 | DENSITY=${recipe.dials.density}/10`,
        `PALETA DE TOKENS CANÔNICOS:`,
        recipe.cssTokensBlock,
        `DIRETRIZES MANDATÓRIAS DE PLANEJAMENTO MULTI-PASS:`,
        `1. TAREFA 0 - FOUNDATION OBRIGATÓRIA: Planeje sempre uma primeira microtarefa dedicada aos tokens semânticos (:root), reset global, atributos de navegação de secções (role="tab", data-tab) e scrollbar 6px em "${designRef}".`,
        `2. BANIMENTO DE EMOJIS: Todas as tarefas de interface devem exigir explicitamente ícones SVG limpos (Lucide ou inline) e proibir emojis nativos do sistema como ícones.`,
        `3. 4 ESTADOS DE INTERFACE & 7 PILARES REA: Exija na decomposição que componentes contemplem Empty state, Loading/Skeleton, Toast de feedback e Slide-Over Detail Drawer / Command Palette (Ctrl+K).`,
        `4. CRITÉRIOS DE AUDITORIA & SCREENSHOTS ENUMERADOS: Adicione critério de verificação visual automatizada com Playwright (zero console errors, layout sem overflow e secções navegáveis para captura 01-Secao.png).`,
        `5. ROTEAMENTO FULL-STACK & SPA: Exija que a rota raiz GET / sirva public/index.html (HTML) e isole o status JSON em GET /api/health.`,
        `6. RESERVA ESTRITA DE PORTA (PORT_GUARD): Exija que a aplicação utilize como fallback a faixa de portas 4000-4999 (ex: 4000 ou 4001), reservando estritamente 3001 (e 3000/5173) ao DecoHUB.`,
        `7. SIMULAÇÃO DE JORNADA DO USUÁRIO REAL (UX SIMULATOR): Na última Grande Tarefa (GT-6 / Homologação Final), a aprovação final exigirá passar pela simulação de jornada de usuário real no navegador (preenchimento de formulário na UI -> chamada real à API REST sem erro 400/404/500 -> persistência comprovada após reload F5 e zero botões mortos).`,
        `8. BLINDAGEM DE SEGURANÇA & APPSEC (RED TEAM GATE): Exija na decomposição que rotas backend e serviços validem inputs, usem queries SQL parametrizadas (?), protejam contra Path Traversal, tratem requisições malformadas/negativas com HTTP 400 e previnam XSS (escapeHtml).`,
        `9. SMART DEMO SEEDING (seedIfEmpty): Exija na decomposição uma rotina seedIfEmpty() idempotente na camada de banco/servidor populando 15 a 30 registros realistas de demonstração para evitar telas vazias no primeiro boot.`,
        `10. CLOUD DEPLOY PACK: Exija a entrega de um Dockerfile padronizado (Node 22 Alpine, HEALTHCHECK em /api/health, volume de dados e PORT 4000-4999) e .dockerignore para deploy imediato em produção.`,
        `=== FIM DO PLAYBOOK DO SUPERVISOR ===`
      ].join('\n');
    }

    if (role === 'WORKER') {
      return [
        `=== PLAYBOOK OPERACIONAL PARA O WORKER (PROTOCOLO 4-PASSOS FRONTEND & 6-PASSOS FULL-STACK) ===`,
        `ARQUÉTIPO: [${recipe.archetype.toUpperCase()}] | DOMÍNIO: ${recipe.domain}`,
        `LEITURA OBRIGATÓRIA: "${designRef}" e "${skillsRef}".`,
        `PASSO 1: FUNDAÇÃO (DESIGN TOKENS) & ROTEAMENTO`,
        `- Aplicar tokens canônicos no :root:`,
        recipe.cssTokensBlock,
        `- Scrollbar escura de 6px: ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }`,
        `- Tipografia com font-variant-numeric: tabular-nums em métricas, contadores e preços.`,
        `- NAVEGAÇÃO DE SECÇÕES (FASE 17): Estruture todos os botões de abas/menus principais com role="tab" e data-tab="<secao>" para permitir a captura enumerada de todas as secções (01-Dashboard.png, 02-Secao.png).`,
        `- ROTEAMENTO FULL-STACK & SPA: A rota raiz GET / DEVE servir public/index.html (Content-Type: text/html). NUNCA retorne JSON na raiz. Endpoints de status/healthcheck devem residir em GET /api/health.`,
        `- RESERVA ESTRITA DE PORTA (PORT_GUARD): As portas 3001, 3000 e 5173 são reservadas ao DecoHUB. Use a faixa 4000-4999 (ex: Number(process.env.PORT) || 4000) no código e no .env.example.`,
        `PASSO 2: COMPOSIÇÃO ANTI-SLOP`,
        recipe.antiSlopChecklist.map(c => `- ${c}`).join('\n'),
        `PASSO 3: POLIMENTO VERCEL & ACESSIBILIDADE`,
        `- Botões e links com aria-label explícito e :focus-visible { outline: 2px solid var(--accent); }`,
        `- Animações GPU-only (transform, opacity) com suporte a prefers-reduced-motion.`,
        `- Layout fluido sem horizontal overflow em desktop (1280x800) e mobile (390x844).`,
        `PASSO 4: AUTO-INSPEÇÃO ("OLHOS DO AGENTE") & TESTE DE USUÁRIO REAL`,
        `- Inspecione a UI visualmente com Playwright (playwright-cli open) e valide a jornada do usuário real: preencha os formulários, clique em enviar, confirme que as requisições de API retornam 200/201 (sem 404/500), verifique os novos dados na tela e dê reload (F5) para comprovar a persistência. Garanta que nenhum botão fique inerte (sem botões mortos).`,
        `PASSO 5: BLINDAGEM DE SEGURANÇA (APPSEC OWASP TOP 10 & RED TEAM GATE)`,
        `- Path Traversal: Valide path.resolve(publicDir, '.' + reqPath).startsWith(publicDir) bloqueando ".." e dotfiles (.env).`,
        `- SQL Injection: NUNCA interpole strings em SQL. Use queries parametrizadas (prepare/run/all com ?).`,
        `- XSS: NUNCA interpole dados não sanitizados em innerHTML. Use textContent ou helper escapeHtml.`,
        `- Lógica de Negócio & Fuzzing: Rejeite preços/quantidades/durações negativas ou NaN com HTTP 400. Não crashe com JSON inválido.`,
        `- Segredos & Headers: Não salve chaves de API em public/. Adicione cabeçalho "X-Content-Type-Options: nosniff" e oculte stack traces.`,
        `PASSO 6: SMART DEMO SEEDING & KIT CLOUD DEPLOY`,
        `- Inclua em src/db.* ou src/seed.* a rotina seedIfEmpty() idempotente que popula 15 a 30 registros de demonstração realistas na primeira abertura se o banco estiver vazio.`,
        `- Crie ou mantenha o Dockerfile (Node 22 Alpine) e .dockerignore expondo PORT na faixa 4000-4999 com HEALTHCHECK em /api/health.`,
        `=== FIM DO PROTOCOLO DO WORKER ===`
      ].join('\n');
    }

    // Role: EVALUATOR
    return [
      `=== PLAYBOOK DE AUDITORIA VISUAL PARA O INDEPENDENT EVALUATOR ===`,
      `ARQUÉTIPO ESPERADO: [${recipe.archetype.toUpperCase()}] | DOMÍNIO: ${recipe.domain}`,
      `GATES DE QUALIDADE VISUAL AUTOMATIZADOS (PLAYWRIGHT INSPECTION):`,
      `1. ZERO CONSOLE ERRORS: O navegador não pode disparar erros não tratados de runtime (console.error ou Uncaught Error). Rejeição imediata se houver erro.`,
      `2. EMPTY ROOT DETECTION: O elemento raiz ou <body> não pode estar vazio; deve haver elementos interativos renderizados.`,
      `3. OVERFLOW & RESPONSIVIDADE: scrollWidth deve ser <= innerWidth em viewports 1280x800 e 390x844.`,
      `4. ANTI-SLOP CHECK: Presença de tokens semânticos em :root e ausência de emojis de sistema como ícones em navegações/botões.`,
      `5. GATE ANTI-JSON NA RAIZ: A rota GET / não pode retornar JSON de status quando há public/index.html no projeto (ROOT_ROUTE_HIJACKED_BY_JSON).`,
      `6. EVIDÊNCIA EM SCREENSHOTS ENUMERADOS: Capturas automatizadas de todas as secções/abas persistidas em .ai-dev-hub/evidence/ (01-Dashboard.png, 02-Secao.png, etc.).`,
      `7. SIMULAÇÃO DE JORNADA DO USUÁRIO REAL (UX SIMULATOR): Em tarefas de frontend/integração com servidor HTTP, executa o simulador de usuário (Click, Type, Network & F5 Persistence). Rejeição imediata se houver erro de API (400/404/500) durante a ação do usuário, perda de dados após F5 ou botões mortos (DEAD_INTERACTIVE_ELEMENTS).`,
      `8. AUDITORIA DE SEGURANÇA (SECURITY PENTEST SIMULATOR): Executa pentest ofensivo contra 6 vetores OWASP (Path Traversal, SQLi, Stored/Reflected XSS, Business Logic/Fuzzing, Secret Leaks e Security Headers/Burst). Rejeição imediata se alguma vulnerabilidade for detectada.`,
      `=== FIM DO PLAYBOOK DO EVALUATOR ===`
    ].join('\n');
  }

  /**
   * Dynamically discovers skills matching a domain or keyword query (including subdirectories).
   */
  static discoverSkillsForDomain(query: string): string[] {
    const matchedSkills = new Set<string>();
    const normalizedQuery = (query || '').toLowerCase().trim();
    if (!normalizedQuery) return [];

    const queryTokens = normalizedQuery.split(/[\s,._-]+/).filter(t => t.length > 2);
    try {
      const catalog = DocSimpService.loadCatalog();
      for (const doc of catalog.documents) {
        const matchScore = queryTokens.some(
          token =>
            doc.id.toLowerCase().includes(token) ||
            doc.name.toLowerCase().includes(token) ||
            doc.aliases.some(a => a.toLowerCase().includes(token)) ||
            doc.summary.toLowerCase().includes(token)
        );

        if (matchScore) {
          matchedSkills.add(path.basename(doc.file_path));
        }
      }
    } catch {}

    // Scan design-skills folder and its immediate subdirectories
    const designSkillsRoot = this.getDesignSkillsDir();
    const scanSkillsFolder = (dir: string, depth = 0) => {
      if (depth > 2 || !fs.existsSync(dir)) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanSkillsFolder(full, depth + 1);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const baseName = entry.name.replace(/\.md$/i, '').toLowerCase();
            const parentName = path.basename(dir).toLowerCase();
            if (queryTokens.some(t => baseName.includes(t) || parentName.includes(t))) {
              matchedSkills.add(entry.name);
            }
          }
        }
      } catch {}
    };

    scanSkillsFolder(designSkillsRoot, 0);

    return Array.from(matchedSkills);
  }
}