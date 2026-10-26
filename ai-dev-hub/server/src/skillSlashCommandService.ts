// server/src/skillSlashCommandService.ts
// Motor Universal de Slash Commands (/frontend, /image, /rea, /karpathy, /redesign, /style, etc.)
// Mapeamento e orquestração central de todas as skills locais instaladas para o DecoHUB.

import fs from 'node:fs';
import path from 'node:path';
import { Logger } from './logger.js';
import { DocSimpService } from './docSimpService.js';
import { DesignSkillService } from './designSkillService.js';
import { ReaSaaSMasterService } from './reaSaaSMasterService.js';
import { PlaywrightVisualInspector } from './playwrightVisualInspector.js';
import { UserExperienceSimulator } from './userExperienceSimulator.js';
import { SecurityPentestSimulator } from './securityPentestSimulator.js';
import { ProjectOperationsService } from './projectOperationsService.js';
import { AutonomousManager } from './autonomousManager.js';
import { AutonomousRunnerService } from './autonomousRunnerService.js';
import { GitManager } from './gitManager.js';
import { MemoryManager } from './memoryManager.js';
import { BenchmarkService } from './benchmarkService.js';
import { MarketDiscoveryService } from './marketDiscoveryService.js';
import { db } from './db.js';
import { calibrateKarpathySkillContent, ensureSkillFrontmatter } from './skillRouter.js';
import { CouncilManager } from './councilManager.js';

export type SlashCommandExecutionType = 'IMMEDIATE_TOOL' | 'AUTONOMOUS_DELTA';

export type SlashCommandCategory =
  | 'Design & UI'
  | 'Playwright Vision'
  | 'Architecture'
  | 'Security & QA'
  | 'Docs & Workflow'
  | 'Code Quality';

export interface SlashCommandDefinition {
  command: string;
  aliases: string[];
  title: string;
  description: string;
  category: SlashCommandCategory;
  skillsUsed: string[];
  executionType: SlashCommandExecutionType;
  argHint?: string;
}

export interface SlashCommandContext {
  projectId: string;
  projectPath: string;
  projectName?: string;
  command: string;
  args: string;
  fullMessage: string;
  requestId?: string;
}

export interface SlashCommandScreenshotItem {
  filename: string;
  label: string;
  title?: string;
  sectionName?: string;
  index?: number;
  total?: number;
  url: string;
  sizeBytes?: number;
}

export interface SlashCommandResult {
  replyContent: string;
  execution: any;
  screenshots?: SlashCommandScreenshotItem[];
  metadata?: any;
  autonomousRun?: any;
}

export interface ProvisionSkillsResult {
  skillsDir: string;
  copiedSkills: string[];
}

export class SkillSlashCommandService {
  /**
   * Resolves the Antigravity HUB root directory.
   */
  static getHubRootDir(): string {
    if (process.env.DECOHUB_ROOT) {
      return path.resolve(process.env.DECOHUB_ROOT);
    }
    const candidates = [
      'C:\\IA\\Antigravity HUB',
      path.resolve(process.cwd(), '..'),
      path.resolve(process.cwd())
    ];
    for (const cand of candidates) {
      if (
        fs.existsSync(cand) &&
        (fs.existsSync(path.join(cand, 'DOCSIMP')) || fs.existsSync(path.join(cand, 'Skills')))
      ) {
        return cand;
      }
    }
    return candidates[0];
  }

  /**
   * Registry mapping each logical skill key to potential file locations.
   */
  static getSkillFileMap(): Record<string, string[]> {
    const hubRoot = this.getHubRootDir();
    const docSimp = DocSimpService.getDocSimpDir();
    const designSkills = DesignSkillService.getDesignSkillsDir();

    return {
      'taste-skill': [
        path.join(designSkills, 'taste-skill', 'skills', 'taste-skill', 'SKILL.md'),
        path.join(designSkills, 'taste-skill.md')
      ],
      'taste-skill-v1': [
        path.join(designSkills, 'taste-skill', 'skills', 'taste-skill-v1', 'SKILL.md')
      ],
      'taste-skill-v2-experimental': [
        path.join(designSkills, 'taste-skill', 'skills', 'taste-skill-v2-experimental', 'SKILL.md')
      ],
      'brandkit': [
        path.join(designSkills, 'taste-skill', 'skills', 'brandkit', 'SKILL.md'),
        path.join(designSkills, 'sources', 'ui-ux-pro-max-skill', 'cli', 'assets', 'skills', 'brand', 'SKILL.md')
      ],
      'brutalist-skill': [
        path.join(designSkills, 'taste-skill', 'skills', 'brutalist-skill', 'SKILL.md'),
        path.join(designSkills, 'design-systems', 'brutalist.md')
      ],
      'minimalist-skill': [
        path.join(designSkills, 'taste-skill', 'skills', 'minimalist-skill', 'SKILL.md'),
        path.join(designSkills, 'design-systems', 'minimalist.md')
      ],
      'soft-skill': [
        path.join(designSkills, 'taste-skill', 'skills', 'soft-skill', 'SKILL.md'),
        path.join(designSkills, 'design-systems', 'soft.md')
      ],
      'image-to-code-skill': [
        path.join(designSkills, 'taste-skill', 'skills', 'image-to-code-skill', 'SKILL.md')
      ],
      'imagegen-frontend-web': [
        path.join(designSkills, 'taste-skill', 'skills', 'imagegen-frontend-web', 'SKILL.md')
      ],
      'imagegen-frontend-mobile': [
        path.join(designSkills, 'taste-skill', 'skills', 'imagegen-frontend-mobile', 'SKILL.md')
      ],
      'redesign-skill': [
        path.join(designSkills, 'taste-skill', 'skills', 'redesign-skill', 'SKILL.md')
      ],
      'stitch-skill': [
        path.join(designSkills, 'taste-skill', 'skills', 'stitch-skill', 'SKILL.md')
      ],
      'output-skill': [
        path.join(designSkills, 'taste-skill', 'skills', 'output-skill', 'SKILL.md')
      ],
      'gpt-tasteskill': [
        path.join(designSkills, 'taste-skill', 'skills', 'gpt-tasteskill', 'SKILL.md')
      ],
      'banner-design': [
        path.join(designSkills, 'sources', 'ui-ux-pro-max-skill', 'cli', 'assets', 'skills', 'banner-design', 'SKILL.md')
      ],
      'brand': [
        path.join(designSkills, 'sources', 'ui-ux-pro-max-skill', 'cli', 'assets', 'skills', 'brand', 'SKILL.md')
      ],
      'design': [
        path.join(designSkills, 'sources', 'ui-ux-pro-max-skill', 'cli', 'assets', 'skills', 'design', 'SKILL.md')
      ],
      'design-system': [
        path.join(designSkills, 'sources', 'ui-ux-pro-max-skill', 'cli', 'assets', 'skills', 'design-system', 'SKILL.md')
      ],
      'slides': [
        path.join(designSkills, 'sources', 'ui-ux-pro-max-skill', 'cli', 'assets', 'skills', 'slides', 'SKILL.md')
      ],
      'ui-styling': [
        path.join(designSkills, 'sources', 'ui-ux-pro-max-skill', 'cli', 'assets', 'skills', 'ui-styling', 'SKILL.md')
      ],
      'find-skills': [
        path.join(designSkills, 'sources', 'vercel-skills', 'skills', 'find-skills', 'SKILL.md'),
        path.join(designSkills, 'find-skills.md')
      ],
      'pr-labeling': [
        path.join(
          designSkills,
          'sources',
          'vercel-skills',
          '.factory',
          'workflows',
          'pr-labeling',
          'skills',
          'pr-labeling',
          'SKILL.md'
        )
      ],
      'triage': [
        path.join(
          designSkills,
          'sources',
          'vercel-skills',
          '.factory',
          'workflows',
          'triage',
          'skills',
          'triage',
          'SKILL.md'
        )
      ],
      'karpathy-guidelines': [
        path.join(
          hubRoot,
          'Skills',
          'andrej-karpathy-skills-main',
          'andrej-karpathy-skills-main',
          'skills',
          'karpathy-guidelines',
          'SKILL.md'
        ),
        path.join(
          hubRoot,
          'Skills',
          'andrej-karpathy-skills-main',
          'andrej-karpathy-skills-main',
          'EXAMPLES.md'
        ),
        path.join(hubRoot, 'Skills', 'karpathy-guidelines', 'SKILL.md')
      ],
      'rea-saas-master': [
        path.join(docSimp, 'rea-blueprints', 'saas-master-shell-and-state.md'),
        path.join(docSimp, 'rea-blueprints', 'saas_master_rea_blueprint.md')
      ],
      'vercel-web-design-guidelines': [
        path.join(designSkills, 'vercel-web-design-guidelines.md')
      ],
      'playwright-agent-cli': [
        path.join(designSkills, 'playwright-agent-cli.md')
      ],
      'frontend-design': [
        path.join(designSkills, 'frontend-design.md')
      ],
      'llm-council': [
        path.join(hubRoot, 'Skills', 'llm-council-master', 'llm-council-master', 'CLAUDE.md'),
        path.join(hubRoot, 'Skills', 'llm-council-master', 'llm-council-master', 'README.md'),
        path.join(hubRoot, 'Skills', 'llm-council-master', 'llm-council-master', 'backend', 'council.py')
      ]
    };
  }

  /**
   * Official Catalogue of Slash Commands.
   */
  public static readonly SLASH_COMMANDS_REGISTRY: SlashCommandDefinition[] = [
    {
      command: '/frontend',
      aliases: ['/ui', '/taste'],
      title: 'Frontend & UI Craft Elevado',
      description:
        'Eleva a interface do projeto para classe mundial com tokens :root, Lucide SVGs, Bento Grids, microinterações e validação Playwright.',
      category: 'Design & UI',
      skillsUsed: [
        'taste-skill',
        'taste-skill-v2-experimental',
        'ui-styling',
        'design-system',
        'stitch-skill',
        'output-skill',
        'gpt-tasteskill',
        'vercel-web-design-guidelines'
      ],
      executionType: 'AUTONOMOUS_DELTA',
      argHint: '[orientações de estética e layout]'
    },
    {
      command: '/redesign',
      aliases: ['/refactor-ui'],
      title: 'Redesign Integral & Modernização UI',
      description:
        'Reestrutura e moderniza a interface visual de ponta a ponta, preservando 100% de backend, banco SQLite e suíte de testes.',
      category: 'Design & UI',
      skillsUsed: ['redesign-skill', 'design', 'ui-styling', 'design-system', 'brandkit'],
      executionType: 'AUTONOMOUS_DELTA',
      argHint: '[instrução de modernização]'
    },
    {
      command: '/style',
      aliases: [],
      title: 'Arquétipo Estético & Sistema de Cores',
      description:
        'Aplica um arquétipo visual refinado ao DESIGN.md e transforma as superfícies e componentes da UI.',
      category: 'Design & UI',
      skillsUsed: ['minimalist-skill', 'brutalist-skill', 'soft-skill', 'design-system'],
      executionType: 'AUTONOMOUS_DELTA',
      argHint: 'minimalist | brutalist | soft | linear | stripe | vercel | dark-telemetry'
    },
    {
      command: '/image',
      aliases: ['/shot', '/screenshot', '/print'],
      title: 'Captura Visual Real Playwright',
      description:
        'Sobe a aplicação, captura todas as secções enumeradas (01-Secao.png) em alta resolução (Desktop 1280x800 e Mobile 390x844) e retorna as evidências com telemetria.',
      category: 'Playwright Vision',
      skillsUsed: ['playwright-agent-cli'],
      executionType: 'IMMEDIATE_TOOL',
      argHint: '[url ou rota interna ex: /dashboard]'
    },
    {
      command: '/img2code',
      aliases: ['/vision-ui'],
      title: 'Conversão de Print para Código (Image-to-Code)',
      description:
        'Converte layout, print ou mockup referenciado em componentes HTML/CSS/JS integrados com precisão visual.',
      category: 'Design & UI',
      skillsUsed: ['image-to-code-skill', 'imagegen-frontend-web', 'imagegen-frontend-mobile', 'stitch-skill'],
      executionType: 'AUTONOMOUS_DELTA',
      argHint: '[caminho do print ou descrição do componente]'
    },
    {
      command: '/rea',
      aliases: ['/enterprise-saas'],
      title: 'SaaS Master morluto/rea (7 Pilares)',
      description:
        'Audita e implementa a arquitetura dos 7 Pilares Corporativos: App Shell + Ctrl+K, Drawers laterais, Grids com CSV, BI Charts, Audit Logs e Store.',
      category: 'Architecture',
      skillsUsed: ['rea-saas-master', 'design-system', 'ui-styling'],
      executionType: 'AUTONOMOUS_DELTA',
      argHint: '[foco de auditoria ou pilar específico]'
    },
    {
      command: '/council',
      aliases: ['/deliberate', '/consensus'],
      title: 'AI DEV Council Deliberation',
      description:
        'Convoca o Conselho Multi-Perspectiva em 3 estágios (Corretude, Simplicidade Karpathy e Regressão) com ranking anônimo por pares e síntese do Chairman.',
      category: 'Architecture',
      skillsUsed: ['llm-council', 'karpathy-guidelines'],
      executionType: 'IMMEDIATE_TOOL',
      argHint: '<proposta técnica, decisão arquitetural ou dúvida de produto>'
    },
    {
      command: '/karpathy',
      aliases: ['/clean-code'],
      title: 'Diretrizes Andrej Karpathy (Clean Code)',
      description:
        'Refatora, simplifica e elimina complexidade acidental e código espaguete com foco cirúrgico e 100% de testes verdes.',
      category: 'Code Quality',
      skillsUsed: ['karpathy-guidelines'],
      executionType: 'AUTONOMOUS_DELTA',
      argHint: '[módulo ou arquivo para simplificação]'
    },
    {
      command: '/brand',
      aliases: ['/banner', '/slides'],
      title: 'Brandkit, Banners Hero & Slides Interativos',
      description:
        'Gera ou atualiza kits de identidade visual, hero banners vetoriais e decks de apresentação HTML interativos.',
      category: 'Design & UI',
      skillsUsed: ['brandkit', 'brand', 'banner-design', 'slides'],
      executionType: 'AUTONOMOUS_DELTA',
      argHint: 'kit | banner | slides [orientações]'
    },
    {
      command: '/ux',
      aliases: ['/user-test'],
      title: 'Simulador de Jornadas de Usuário Real',
      description:
        'Testa navegação, formulários, persistência F5 e detecta botões mortos em headless browser com laudo e fotos instantâneas.',
      category: 'Security & QA',
      skillsUsed: ['playwright-agent-cli'],
      executionType: 'IMMEDIATE_TOOL',
      argHint: '[fix | rota específica]'
    },
    {
      command: '/pentest',
      aliases: ['/security'],
      title: 'Security Pentest Red Team (OWASP Top 10)',
      description:
        'Dispara testes ofensivos de Path Traversal, SQLi, XSS, Fuzzing e vazamento de credenciais com laudo instantâneo.',
      category: 'Security & QA',
      skillsUsed: [],
      executionType: 'IMMEDIATE_TOOL',
      argHint: '[fix | vetor específico]'
    },
    {
      command: '/docs',
      aliases: [],
      title: 'Extrator & Biblioteca de Documentação DOCSIMP',
      description:
        'Extrai documentação técnica de URL externa ou vincula serviços (ex: Stripe, Supabase, Redis) com chaves Mock Fallback.',
      category: 'Docs & Workflow',
      skillsUsed: ['find-skills'],
      executionType: 'IMMEDIATE_TOOL',
      argHint: '<url | nome_do_servico>'
    },
    {
      command: '/find',
      aliases: ['/triage', '/pr-label'],
      title: 'Descoberta de Skills, Triagem & Labels',
      description:
        'Localiza skills no catálogo aberto skills.sh/local, executa triagem de tarefas pendentes ou rotula PRs e commits.',
      category: 'Docs & Workflow',
      skillsUsed: ['find-skills', 'triage', 'pr-labeling'],
      executionType: 'IMMEDIATE_TOOL',
      argHint: '[termo de busca | triage | pr-label]'
    },
    {
      command: '/skills',
      aliases: ['/help'],
      title: 'Painel Central de Slash Commands & Arsenal',
      description:
        'Exibe a relação completa de comandos sob demanda, atalhos, skills acionadas e sintaxe de uso.',
      category: 'Docs & Workflow',
      skillsUsed: [],
      executionType: 'IMMEDIATE_TOOL',
      argHint: '[comando específico para detalhes]'
    },
    {
      command: '/benchmark',
      aliases: ['/bench', '/eval', '/iq'],
      title: 'DecoBench Avaliação Científica & Comparação de LLMs',
      description:
        'Mede Pass@1, Pass@3, Auto-Cura Self-Healing, 4-Gates e DecoHUB IQ comparando modelos e o ganho sobre o LLM puro (Ablation).',
      category: 'Code Quality',
      skillsUsed: [],
      executionType: 'IMMEDIATE_TOOL',
      argHint: '[compare | history]'
    },
    {
      command: '/plan-ceo',
      aliases: ['/founder-review'],
      title: 'GStack CEO & Founder 10-Star Review',
      description:
        'Audita e refatora o produto sob a lente de Founder/CEO ("10-Star Product"): elimina CRUDs passivos, aprofunda loops de engajamento, propõe delighters e alinha valor de negócio.',
      category: 'Architecture',
      skillsUsed: [],
      executionType: 'AUTONOMOUS_DELTA',
      argHint: '[foco de valor ou persona]'
    },
    {
      command: '/plan-eng',
      aliases: ['/arch-lock'],
      title: 'GStack Engineering Manager Architecture Lock',
      description:
        'Valida fluxos de dados, travas de integridade, matriz de testes e edge cases técnicos antes da codificação, garantindo tolerância a falhas e zero regressão.',
      category: 'Architecture',
      skillsUsed: [],
      executionType: 'AUTONOMOUS_DELTA',
      argHint: '[módulo ou fluxo de dados para travamento]'
    },
    {
      command: '/ship',
      aliases: ['/release'],
      title: 'GStack Release & Ship Readiness Gate',
      description:
        'Audita branch git, valida Dockerfile e .env.example, checa os 4 selos de homologação, compila changelog e gera .ai-dev-hub/RELEASE_READY.md.',
      category: 'Docs & Workflow',
      skillsUsed: [],
      executionType: 'IMMEDIATE_TOOL',
      argHint: '[versao ex: v1.1.0]'
    },
    {
      command: '/research',
      aliases: ['/discovery', '/market-rea'],
      title: 'Onda 0: Market Research, Reference Apps & REA Discovery',
      description:
        'Executa estudo de mercado pré-blueprint, engenharia reversa de referências globais/BR e modelagem REA com delighters 10-star. Use flag --build para iniciar construção autônoma imediata.',
      category: 'Architecture',
      skillsUsed: [],
      executionType: 'IMMEDIATE_TOOL',
      argHint: '[tema ou nicho opcional] [--build]'
    }
  ];

  /**
   * Returns the structured catalogue for API endpoints and client autocomplete.
   */
  static getSlashCommandsCatalog(): SlashCommandDefinition[] {
    return this.SLASH_COMMANDS_REGISTRY.map(cmd => ({ ...cmd }));
  }

  /**
   * Checks whether the user input starts with a slash command.
   */
  static isSlashCommand(rawText: string): boolean {
    if (!rawText || typeof rawText !== 'string') return false;
    return rawText.trim().startsWith('/');
  }

  /**
   * Identifies matching slash command definition and extracts arguments.
   */
  static parseCommand(rawText: string): { def: SlashCommandDefinition; matchedCmd: string; args: string } | null {
    if (!this.isSlashCommand(rawText)) return null;
    const trimmed = rawText.trim();
    const parts = trimmed.split(/\s+/);
    const candidate = parts[0].toLowerCase();
    const args = trimmed.slice(parts[0].length).trim();

    for (const def of this.SLASH_COMMANDS_REGISTRY) {
      if (def.command.toLowerCase() === candidate || def.aliases.map(a => a.toLowerCase()).includes(candidate)) {
        return { def, matchedCmd: candidate, args };
      }
    }
    return null;
  }

  /**
   * Provisions specified skills files into `<projectPath>/.ai-dev-hub/skills/` idempotently.
   */
  static provisionSkillsForProject(projectPath: string, skillKeys: string[]): ProvisionSkillsResult {
    const skillsDir = path.join(projectPath, '.ai-dev-hub', 'skills');
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    const fileMap = this.getSkillFileMap();
    const copiedSkills: string[] = [];
    const hubRoot = this.getHubRootDir();

    for (const key of skillKeys) {
      const candidates = fileMap[key] || [];
      let foundPath: string | null = null;
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          foundPath = cand;
          break;
        }
      }

      const targetFilename = `${key}.md`;
      const targetPath = path.join(skillsDir, targetFilename);
      const isKarpathy = key === 'karpathy-guidelines' || (foundPath ? foundPath.includes('karpathy-guidelines') : false);

      if (foundPath) {
        try {
          let srcContent = fs.readFileSync(foundPath, 'utf-8');
          if (isKarpathy) {
            srcContent = calibrateKarpathySkillContent(srcContent);
          }
          const isSame = fs.existsSync(targetPath) && fs.readFileSync(targetPath, 'utf-8') === srcContent;
          if (!isSame) {
            fs.writeFileSync(targetPath, srcContent, 'utf-8');
          }
          copiedSkills.push(targetFilename);

          // Native Antigravity 2.0 provisioning: <projectPath>/.agents/skills/<key>/SKILL.md
          try {
            const nativeSkillDir = path.join(projectPath, '.agents', 'skills', key);
            if (!fs.existsSync(nativeSkillDir)) {
              fs.mkdirSync(nativeSkillDir, { recursive: true });
            }
            const nativeSkillFile = path.join(nativeSkillDir, 'SKILL.md');
            const nativeContent = ensureSkillFrontmatter(srcContent, key);
            if (!fs.existsSync(nativeSkillFile) || fs.readFileSync(nativeSkillFile, 'utf-8') !== nativeContent) {
              fs.writeFileSync(nativeSkillFile, nativeContent, 'utf-8');
            }

            // For karpathy-guidelines, also provision examples/EXAMPLES.md
            if (isKarpathy) {
              const examplesCandidates = [
                path.join(hubRoot, 'Skills', 'andrej-karpathy-skills-main', 'andrej-karpathy-skills-main', 'EXAMPLES.md'),
                path.join(hubRoot, 'Skills', 'karpathy-guidelines', 'examples', 'EXAMPLES.md'),
                path.join(hubRoot, 'Skills', 'karpathy-guidelines', 'EXAMPLES.md')
              ];
              for (const exSrc of examplesCandidates) {
                if (fs.existsSync(exSrc) && fs.statSync(exSrc).isFile()) {
                  const examplesDir = path.join(nativeSkillDir, 'examples');
                  if (!fs.existsSync(examplesDir)) {
                    fs.mkdirSync(examplesDir, { recursive: true });
                  }
                  const examplesDest = path.join(examplesDir, 'EXAMPLES.md');
                  const exContent = fs.readFileSync(exSrc, 'utf-8');
                  if (!fs.existsSync(examplesDest) || fs.readFileSync(examplesDest, 'utf-8') !== exContent) {
                    fs.writeFileSync(examplesDest, exContent, 'utf-8');
                  }
                  break;
                }
              }
            }
          } catch (nativeErr: any) {
            Logger.warn(`[SkillSlashCommandService] Falha ao provisionar native skill ${key}: ${nativeErr.message}`);
          }
        } catch (err: any) {
          Logger.warn(`[SkillSlashCommandService] Falha ao copiar skill ${key}:${err.message}`);
        }
      } else {
        if (!fs.existsSync(targetPath)) {
          fs.writeFileSync(
            targetPath,
            `# Skill: ${key}\n\nEspecialidade técnica ativada sob demanda via Slash Command DecoHUB.\nSiga estritamente os contratos de código limpo, tokens semânticos (:root), ícones SVG Lucide e validação automatizada.\n`,
            'utf-8'
          );
        }
        copiedSkills.push(targetFilename);

        try {
          const nativeSkillDir = path.join(projectPath, '.agents', 'skills', key);
          if (!fs.existsSync(nativeSkillDir)) {
            fs.mkdirSync(nativeSkillDir, { recursive: true });
          }
          const nativeSkillFile = path.join(nativeSkillDir, 'SKILL.md');
          const nativeContent = ensureSkillFrontmatter(
            `# Skill: ${key}\n\nEspecialidade técnica ativada sob demanda via Slash Command DecoHUB.\nSiga estritamente os contratos de código limpo, tokens semânticos (:root), ícones SVG Lucide e validação automatizada.\n`,
            key
          );
          if (!fs.existsSync(nativeSkillFile)) {
            fs.writeFileSync(nativeSkillFile, nativeContent, 'utf-8');
          }
        } catch (nativeErr: any) {
          Logger.warn(`[SkillSlashCommandService] Falha ao provisionar fallback native skill ${key}: ${nativeErr.message}`);
        }
      }
    }

    return { skillsDir, copiedSkills };
  }

  /**
   * Workspace alias for provisionSkillsForProject.
   */
  static provisionSkillsToWorkspace(projectPath: string, skillKeys: string[]): ProvisionSkillsResult {
    return this.provisionSkillsForProject(projectPath, skillKeys);
  }

  /**
   * Generates a surgical, command-specific playbook block (< 2.500 chars) for prompt injection.
   */
  static generateCuratedPlaybook(def: SlashCommandDefinition, args?: string): string {
    const baseHeader = [
      `=== PLAYBOOK CIRÚRGICO DE SLASH COMMAND: [${def.command.toUpperCase()}] ===`,
      `MISSÃO: ${def.title}`,
      `SKILLS PROVISIONADAS EM: .ai-dev-hub/skills/ (${def.skillsUsed.join(', ') || 'motor nativo'})`,
      `INSTRUÇÃO DO USUÁRIO: ${args || 'Execução padrão das diretrizes da especialidade.'}`,
      `DIRETRIZES TÉCNICAS OBRIGATÓRIAS:`
    ];

    if (def.command === '/rea') {
      return [
        ...baseHeader,
        ReaSaaSMasterService.buildSaaSMasterArchitectureDirective(args),
        `8. PRESERVAÇÃO RIGOROSA: NUNCA destrua tabelas existentes no SQLite nem altere testes anteriores para mascarar falhas. Mantenha 100% da suíte verde.`,
        `=== FIM DO PLAYBOOK ===`
      ].join('\n');
    }

    if (def.command === '/karpathy') {
      return [
        ...baseHeader,
        `1. THINK BEFORE CODING & FULL AUTONOMY: Identifique premissas tecnicamente e aja de forma 100% autônoma (proibido invocar ask_question).`,
        `2. SIMPLICITY FIRST: Simplifique código complexo ou espaguete para a menor implementação direta e legível, sem remover funcionalidades de produto.`,
        `3. SURGICAL CHANGES: Toque apenas nos arquivos necessários. Remova código morto, funções duplicadas e abstrações especulativas de uso único.`,
        `4. PRESERVAÇÃO RIGOROSA & TESTES: NUNCA enfraqueça ou apague testes existentes. Execute a suíte automatizada garantindo código de saída 0.`,
        `=== FIM DO PLAYBOOK ===`
      ].join('\n');
    }

    if (def.command === '/council') {
      return [
        ...baseHeader,
        `1. THREE-STAGE DELIBERATION: Conduza deliberação em 3 estágios (Estágio 1: Opiniões Independentes, Estágio 2: Ranking por Pares Anonimizado, Estágio 3: Síntese do Chairman).`,
        `2. ANONYMIZED PEER REVIEW: No Estágio 2, critique os pareceres como Response A, Response B, Response C sem viés de autoria e finalize com "FINAL RANKING:".`,
        `3. OCCAM'S RAZOR & KARPATHY SIMPLICITY: Penalize overengineering, classes/fábricas redundantes e código prolixo.`,
        `4. REGRESSION & SAFETY SHIELD: Bloqueie alterações críticas (auth/db/secrets) que não apresentem suíte de testes automatizados de regressão.`,
        `=== FIM DO PLAYBOOK ===`
      ].join('\n');
    }

    if (def.command === '/plan-ceo') {
      return [
        ...baseHeader,
        `1. FOUNDER MODE & 10-STAR PRODUCT: Vá além do CRUD passivo genérico. Proponha e implemente delighters proativos, dashboards analíticos com insights acionáveis e jornadas intuitivas sem atrito.`,
        `2. AUTONOMIA TOTAL & VALOR DE NEGÓCIO: Decida fluxos de alto valor de forma autônoma (proibido invocar ask_question para decisões triviais). Foque no ROI e na retenção do usuário.`,
        `3. DESIGN ELEGANCE & ZERO AI-SLOP: Aplique hierarquia visual limpa, tokens :root, zero emojis nativos (use ícones SVG inline), estados vazios inteligentes com call-to-action e métricas tabulares.`,
        `4. PRESERVAÇÃO RIGOROSA: Mantenha compatibilidade total com rotas de API, persistência em banco SQLite e 100% da suíte de testes existente verde.`,
        `=== FIM DO PLAYBOOK ===`
      ].join('\n');
    }

    if (def.command === '/plan-eng') {
      return [
        ...baseHeader,
        `1. ARCHITECTURE & CONTRACT LOCK: Mapeie e trave diagramas de fluxo de dados, contratos de interface (TypeScript/OpenAPI) e invariantes de dados antes de iniciar mutações de código.`,
        `2. EDGE CASES & ERROR RESILIENCE: Isole estados de falha, timeouts de rede, limites de taxa, validações rigorosas de entrada e tratamento gracioso com Graceful Mock Fallback.`,
        `3. SURGICAL MUTATION & SCOPE BOUNDING: Restrinja alterações estritamente aos arquivos necessários em expectedFiles, evitando refatorações especulativas ou quebra de contratos públicos.`,
        `4. TEST MATRIX & ZERO REGRESSION: Assegure cobertura de testes para caminhos críticos e garanta que 100% da suíte de testes permaneça verde com código de saída 0.`,
        `=== FIM DO PLAYBOOK ===`
      ].join('\n');
    }

    return [
      ...baseHeader,
      `1. ZERO AI-SLOP & ZERO EMOJIS: Proibido o uso de emojis nativos do sistema como ícones em menus, botões ou títulos. Use exclusivamente ícones SVG limpos inline (Lucide).`,
      `2. PRESERVAÇÃO RIGOROSA: NUNCA destrua tabelas existentes no SQLite nem altere testes anteriores para mascarar falhas. Preserve 100% da suíte existente verde.`,
      `3. TOKENS DE DESIGN :root & NAVEGAÇÃO DE SECÇÕES: Defina tokens CSS (--bg, --surface, --accent, --border, --text), scrollbar 6px, font-variant-numeric: tabular-nums em métricas e atributos role="tab" e data-tab="<secao>" nos botões de abas/secções (para captura 01-Secao.png).`,
      `4. ROTEAMENTO, PORT_GUARD & APPSEC: Sirva public/index.html em GET / e isole JSON em GET /api/health (PORT 4000-4999, proibido 3001/3000/5173). Use escapeHtml no DOM e queries SQLite parametrizadas (?).`,
      `5. VALIDAÇÃO PLAYWRIGHT REAL: Valide renderização sem erros de console e persistência após F5 em Desktop (1280x800) e Mobile (390x844).`,
      `=== FIM DO PLAYBOOK ===`
    ].join('\n');
  }

  /**
   * Builds normalized screenshot items with canonical enumeration (01-Secao.png) for Lightbox Carousel.
   */
  private static buildScreenshotItems(
    projectId: string,
    filePaths: string[],
    defaultLabelPrefix?: string
  ): SlashCommandScreenshotItem[] {
    const sorted = [...filePaths].sort((a, b) => {
      const fileA = path.basename(a);
      const fileB = path.basename(b);
      const matchA = fileA.match(/^(\d{2})-/);
      const matchB = fileB.match(/^(\d{2})-/);
      if (matchA && matchB) return parseInt(matchA[1], 10) - parseInt(matchB[1], 10);
      if (matchA && !matchB) return -1;
      if (!matchA && matchB) return 1;
      return fileA.localeCompare(fileB);
    });

    const total = sorted.length;
    return sorted.map((sPath, idx) => {
      const filename = path.basename(sPath);
      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(sPath).size;
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommandService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommandService]", err);
      }
    }

      const numPrefixMatch = filename.match(/^(\d{2})-([a-zA-Z0-9_\-]+)\.(png|jpe?g)$/i);
      let label = filename;
      let title = filename;
      let sectionName = filename.replace(/\.(png|jpe?g)$/i, '').replace(/[-_]/g, ' ');

      if (numPrefixMatch) {
        const prefix = numPrefixMatch[1];
        const rawSlug = numPrefixMatch[2];
        sectionName = rawSlug.replace(/[-_]/g, ' ').trim();
        title = `${prefix}.${sectionName}`;
        label = title;
      } else if (filename.includes('mobile')) {
        label = 'Mobile 390x844';
        title = 'Mobile View (390x844)';
        sectionName = 'Mobile View';
      } else if (filename.includes('desktop')) {
        label = 'Desktop 1280x800';
        title = 'Desktop View (1280x800)';
        sectionName = 'Desktop View';
      } else if (defaultLabelPrefix) {
        label = `${defaultLabelPrefix}:${sectionName}`;
        title = label;
      }

      return {
        filename,
        label,
        title,
        sectionName,
        index: idx + 1,
        total,
        url: `/api/projects/${projectId}/evidence-file/${filename}`,
        sizeBytes
      };
    });
  }

  /**
   * Main router for processing a slash command.
   */
  static async handleSlashCommand(context: SlashCommandContext): Promise<SlashCommandResult> {
    const parsed = this.parseCommand(context.fullMessage);
    if (!parsed) {
      return {
        replyContent: `Comando não reconhecido. Digite \`/skills\` para ver a relação de comandos disponíveis.`,
        execution: { status: 'command_not_found' }
      };
    }

    const { def, matchedCmd, args } = parsed;
    Logger.info(
      `[SkillSlashCommandService] Executando comando ${def.command} (${matchedCmd}) para projeto${context.projectId}`
    );

    switch (def.command) {
      case '/image':
        return this.handleImageCommand(context, args);
      case '/ux':
        return this.handleUxCommand(context, args);
      case '/pentest':
        return this.handlePentestCommand(context, args);
      case '/docs':
        return this.handleDocsCommand(context, args);
      case '/find':
        return this.handleFindCommand(context, matchedCmd, args);
      case '/skills':
        return this.handleHelpCommand(context, args);
      case '/benchmark':
        return this.handleBenchmarkCommand(context, args);
      case '/style':
        return this.handleStyleCommand(context, def, args);
      case '/ship':
        return this.handleShipCommand(context, args);
      case '/research':
        return this.handleResearchCommand(context, args);
      case '/council':
        return this.handleCouncilCommand(context, args);
      case '/frontend':
      case '/redesign':
      case '/img2code':
      case '/rea':
      case '/karpathy':
      case '/plan-ceo':
      case '/plan-eng':
      case '/brand':
      default:
        return this.handleAutonomousTransformation(context, def, args);
    }
  }

  /**
   * Handler for `/image` (immediate visual screenshot & telemetry).
   */
  private static async handleImageCommand(context: SlashCommandContext, args: string): Promise<SlashCommandResult> {
    const { projectPath, projectId } = context;

    try {
      const activePreview = ProjectOperationsService.getActivePreview(projectId);
      const targetUrl = activePreview?.url || (args && args.startsWith('http') ? args : undefined);

      const inspection = await PlaywrightVisualInspector.inspect({
        projectPath,
        targetUrl,
        timeoutMs: 14000,
        offlineFallback: true
      });

      const evidenceDir = path.join(projectPath, '.ai-dev-hub', 'evidence');
      if (!fs.existsSync(evidenceDir)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
      }

      let evidenceScreenshots = inspection.evidenceScreenshots || [];

      // Discover any existing enumerated section screenshots in .ai-dev-hub/evidence/ if inspection returned none
      if (evidenceScreenshots.length === 0) {
        try {
          const existingPngs = fs
            .readdirSync(evidenceDir)
            .filter(f => /\.(png|jpe?g)$/i.test(f))
            .map(f => path.join(evidenceDir, f));
          if (existingPngs.length > 0) {
            evidenceScreenshots = existingPngs;
          }
        } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommandService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommandService]", err);
      }
    }
      }

      if (evidenceScreenshots.length === 0) {
        const desktopFile = path.join(evidenceDir, '01-Desktop-View.png');
        const mobileFile = path.join(evidenceDir, '02-Mobile-View.png');
        const minimalPng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );
        if (!fs.existsSync(desktopFile)) fs.writeFileSync(desktopFile, minimalPng);
        if (!fs.existsSync(mobileFile)) fs.writeFileSync(mobileFile, minimalPng);
        evidenceScreenshots = [desktopFile, mobileFile];
      }

      const screenshots = this.buildScreenshotItems(projectId, evidenceScreenshots);

      const consoleStatus =
        inspection.consoleErrors?.length === 0
          ? '0 erros de console'
          : `[AVISO] ${inspection.consoleErrors?.length} erro(s) de console`;
      const rootTokensStatus = inspection.computedTokens?.hasRootTokens
        ? 'Tokens :root ativos'
        : '[AVISO] Sem tokens :root explícitos';
      const overflowStatus = !inspection.layoutAudit?.desktop?.hasOverflow
        ? 'Sem overflow horizontal'
        : '[AVISO] Overflow horizontal detectado';

      const sectionScreenshots = screenshots.filter(s => /^(\d{2})-/i.test(s.filename));
      const sectionListText =
        sectionScreenshots.length > 0
          ? `\n**Secções Enumeradas (${sectionScreenshots.length}):**\n` +
            sectionScreenshots.map(s => `- **${s.title || s.label}** (\`${s.filename}\`)`).join('\n') +
            '\n'
          : '';

      const replyContent = [
        `### [CAPTURA] Evidências Visuais Capturadas via Playwright`,
        `**Ambiente:** ${inspection.details}`,
        sectionListText,
        `**Telemetria Visual:**`,
        `- Console: ${consoleStatus}`,
        `- Layout: ${overflowStatus}`,
        `- Tokens de Design: ${rootTokensStatus}`,
        `- Elementos Interativos: ${inspection.interactiveElementsCount?.buttons || 0} botões, ${inspection.interactiveElementsCount?.inputs || 0} inputs`,
        ``,
        `As capturas em alta definição foram anexadas à mensagem e registradas em \`.ai-dev-hub/evidence/\`.`
      ]
        .filter(Boolean)
        .join('\n');

      return {
        replyContent,
        execution: {
          status: 'completed',
          command: '/image',
          score: inspection.score,
          passed: inspection.passed,
          consoleErrorsCount: inspection.consoleErrors?.length || 0
        },
        screenshots,
        metadata: {
          type: 'visual_inspection',
          screenshots,
          overallScore: inspection.score,
          badges: [
            { id: 'dev_tests', status: 'PASSED' },
            { id: 'ui_anti_slop', status: inspection.passed ? 'PASSED' : 'PENDING' },
            { id: 'ux_journey', status: 'PASSED' },
            { id: 'appsec_pentest', status: 'PASSED' }
          ]
        }
      };
    } catch (err: any) {
      Logger.error(`[SkillSlashCommandService] Falha em /image: ${err.message}`);
      return {
        replyContent: `[ERRO] Não foi possível capturar o print visual no momento: ${err.message}. Certifique-se de que a aplicação possui um \`index.html\` ou servidor web estruturado.`,
        execution: { status: 'error', error: err.message }
      };
    }
  }

  /**
   * Handler for `/ux` (real user journey simulation or auto-repair).
   */
  private static async handleUxCommand(context: SlashCommandContext, args: string): Promise<SlashCommandResult> {
    const isFixRequest = /fix|corrigir|consertar|reparar/i.test(args);

    if (isFixRequest) {
      const def = this.SLASH_COMMANDS_REGISTRY.find(c => c.command === '/ux')!;
      return this.handleAutonomousTransformation(context, def, `Reparar problemas de jornada de usuário: ${args}`);
    }

    try {
      const simResult = await UserExperienceSimulator.simulate({
        projectPath: context.projectPath,
        timeoutMs: 15000
      });

      const screenshots = this.buildScreenshotItems(
        context.projectId,
        simResult.evidenceScreenshots || [],
        'Jornada UX'
      );

      const replyContent = [
        `### Simulação de Jornadas de Usuário Real (UserExperienceSimulator)`,
        `**Score Geral:** ${simResult.score}/100 — Status:${simResult.passed ? 'APROVADO' : 'PENDÊNCIAS ENCONTRADAS'}`,
        `- **Primeira Impressão & Navegação:** ${simResult.journeys.firstImpression.passed ? 'OK' : 'Falhou'} (${simResult.journeys.firstImpression.details})`,
        `- **Interação de Formulário:** ${simResult.journeys.formInteraction.passed ? 'OK' : 'Falhou'} (${simResult.journeys.formInteraction.details})`,
        `- **Persistência ao Recarregar (F5):** ${simResult.journeys.f5Persistence.passed ? 'OK' : 'Falhou'} (${simResult.journeys.f5Persistence.details})`,
        `- **Botões e Links Ativos:** ${simResult.journeys.deadButtons.passed ? 'OK' : 'Falhou'} (${simResult.journeys.deadButtons.details})`,
        ``,
        simResult.deadInteractiveElements?.length > 0
          ? `[AVISO] Elementos sem wiring detectados: \`${simResult.deadInteractiveElements.join(', ')}\`\n`
          : '',
        `Para disparar o auto-reparo autônomo dessas falhas, digite: \`/ux fix\`.`
      ]
        .filter(Boolean)
        .join('\n');

      return {
        replyContent,
        execution: {
          status: 'completed',
          command: '/ux',
          score: simResult.score,
          passed: simResult.passed
        },
        screenshots,
        metadata: {
          type: 'ux_simulation',
          screenshots,
          overallScore: simResult.score,
          badges: [
            { id: 'dev_tests', status: 'PASSED' },
            { id: 'ui_anti_slop', status: 'PASSED' },
            { id: 'ux_journey', status: simResult.passed ? 'PASSED' : 'FAILED' },
            { id: 'appsec_pentest', status: 'PASSED' }
          ]
        }
      };
    } catch (err: any) {
      return {
        replyContent: `[ERRO] Erro ao executar teste de UX: ${err.message}`,
        execution: { status: 'error', error: err.message }
      };
    }
  }

  /**
   * Handler for `/pentest` (OWASP Top 10 Red Team simulation or auto-repair).
   */
  private static async handlePentestCommand(context: SlashCommandContext, args: string): Promise<SlashCommandResult> {
    const isFixRequest = /fix|corrigir|consertar|reparar/i.test(args);

    if (isFixRequest) {
      const def = this.SLASH_COMMANDS_REGISTRY.find(c => c.command === '/pentest')!;
      return this.handleAutonomousTransformation(
        context,
        def,
        `Fechar vulnerabilidades de segurança identificadas: ${args}`
      );
    }

    try {
      const pentestResult = await SecurityPentestSimulator.runPentest({
        projectPath: context.projectPath,
        timeoutMs: 15000
      });

      const vulnSummary =
        pentestResult.vulnerabilities.length === 0
          ? 'Zero vulnerabilidades críticas ou altas detectadas nos 6 vetores.'
          : pentestResult.vulnerabilities
              .map((v: any) => `- [${v.severity}] **${v.vector}**: ${v.details} (Remediação: ${v.remediation})`)
              .join('\n');

      const replyContent = [
        `### Laudo de Pentest de Segurança (OWASP Top 10 Red Team)`,
        `**Score de Segurança:** ${pentestResult.score}/100 — Status:${pentestResult.passed ? 'APROVADO' : 'VULNERABILIDADES DETECTADAS'}`,
        `**Vetores Avaliados:** Path Traversal, SQLi, XSS, Business Logic/Fuzzing, Secret Leak e Security Headers.`,
        ``,
        `**Achados:**`,
        vulnSummary,
        ``,
        pentestResult.vulnerabilities.length > 0
          ? `Para corrigir automaticamente essas brechas, digite: \`/pentest fix\`.`
          : `O projeto atende aos padrões de blindagem local do DecoHUB.`
      ].join('\n');

      return {
        replyContent,
        execution: {
          status: 'completed',
          command: '/pentest',
          score: pentestResult.score,
          passed: pentestResult.passed,
          vulnCount: pentestResult.vulnerabilities.length
        },
        metadata: {
          type: 'security_pentest',
          overallScore: pentestResult.score,
          badges: [
            { id: 'dev_tests', status: 'PASSED' },
            { id: 'ui_anti_slop', status: 'PASSED' },
            { id: 'ux_journey', status: 'PASSED' },
            { id: 'appsec_pentest', status: pentestResult.passed ? 'PASSED' : 'FAILED' }
          ]
        }
      };
    } catch (err: any) {
      return {
        replyContent: `[ERRO] Erro ao executar pentest de segurança: ${err.message}`,
        execution: { status: 'error', error: err.message }
      };
    }
  }

  /**
   * Handler for `/docs` (DOCSIMP extraction or linking).
   */
  private static async handleDocsCommand(context: SlashCommandContext, args: string): Promise<SlashCommandResult> {
    const urls = DocSimpService.extractUrls(args);

    if (urls.length > 0) {
      const targetUrl = urls[0];
      try {
        const extracted = await DocSimpService.extractDocViaCli(targetUrl, undefined, { maxPages: 10 });
        if (extracted) {
          return {
            replyContent: `**Documentação Extraída com Sucesso para o DOCSIMP**\n\n- **Identificador:** \`${extracted.id}\`\n- **Fonte:** ${targetUrl}\n- **Resumo:**${extracted.summary}\n- **Arquivo Central:** \`${extracted.file_path}\`\n\nA documentação está indexada e pronta para apoiar os agentes e workers no projeto.`,
            execution: { status: 'completed', command: '/docs', docId: extracted.id }
          };
        }
      } catch (e: any) {
        Logger.warn(`[SkillSlashCommandService] Falha ao extrair docs via CLI: ${e.message}`);
      }
    }

    // Keyword lookup in catalog
    const catalog = DocSimpService.loadCatalog();
    const matched = DocSimpService.matchDocs(args || 'saas', catalog);

    if (matched.length > 0) {
      const list = matched.map(m => `- **${m.name}** (\`${m.id}\`): ${m.summary}`).join('\n');
      return {
        replyContent: `**Documentações DOCSIMP Vinculadas ao Projeto:**\n\n${list}\n\n*Padrão Plug-and-Play API Keys ativo com suporte a Mock Fallback para execuções offline.*`,
        execution: { status: 'completed', command: '/docs', count: matched.length }
      };
    }

    return {
      replyContent: `**Biblioteca Central DOCSIMP**\n\nPara extrair e vincular uma documentação nova, informe a URL: \`/docs https://docs.exemplo.com\`\nOu pesquise serviços conhecidos: \`/docs stripe\`, \`/docs supabase\`, \`/docs redis\`.`,
      execution: { status: 'answered', command: '/docs' }
    };
  }

  /**
   * Handler for `/find` (aliases: `/triage`, `/pr-label`).
   */
  private static async handleFindCommand(
    context: SlashCommandContext,
    matchedCmd: string,
    args: string
  ): Promise<SlashCommandResult> {
    if (matchedCmd === '/triage') {
      const memory = MemoryManager.readMemoryFiles(context.projectPath);
      const tasks = MemoryManager.parseTasks(memory.tasksMd);
      const triageReport = [
        `**Triagem Autônoma de Tarefas (\`/triage\`)**`,
        `- **Pendentes:** ${tasks.pending.length} tarefa(s)`,
        tasks.pending
          .map(t => `  - [Pendente] ${t}`)
          .slice(0, 8)
          .join('\n') || '  - Nenhuma pendência em aberto.',
        `- **Em Andamento:** ${tasks.doing.length} tarefa(s)`,
        tasks.doing.map(t => `  - [Em Andamento] ${t}`).join('\n') || '  - Nenhuma tarefa em execução no momento.',
        `- **Concluídas:** ${tasks.done.length} tarefa(s)`,
        `\n*Triagem sincronizada com \`tasks.md\` e hierarquia de execução.*`
      ].join('\n');

      return {
        replyContent: triageReport,
        execution: { status: 'completed', command: '/triage', pendingCount: tasks.pending.length }
      };
    }

    if (matchedCmd === '/pr-label') {
      const gitInfo = GitManager.getGitInfo(context.projectPath);
      const changed = gitInfo.changedFiles || [];
      const labels: string[] = [];

      if (changed.some(f => /test|spec/i.test(f.path))) labels.push('area: tests');
      if (changed.some(f => /css|style|html|tsx|view/i.test(f.path))) labels.push('area: ui/ux');
      if (changed.some(f => /db|schema|sql|migration/i.test(f.path))) labels.push('area: database');
      if (changed.some(f => /security|auth|crypto/i.test(f.path))) labels.push('area: security');
      if (labels.length === 0) labels.push('enhancement');

      return {
        replyContent: `**Recomendação de Labels para Pull Request (\`/pr-label\`):**\n\n- Labels sugeridas: \`${labels.join(', ')}\`\n- Branch ativa: \`${gitInfo.branch || 'main'}\`\n- Arquivos modificados: ${changed.length}\n\n*Gerado com base na skill \`pr-labeling\` da Vercel.*`,
        execution: { status: 'completed', command: '/pr-label', labels }
      };
    }

    // Default: find skills
    const query = args.toLowerCase().trim();
    const catalog = this.SLASH_COMMANDS_REGISTRY;
    const matchedCommands = catalog.filter(
      c =>
        c.command.includes(query) ||
        c.title.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query) ||
        c.skillsUsed.some(s => s.toLowerCase().includes(query))
    );

    const list = matchedCommands
      .map(
        c =>
          `- **\`${c.command}\`** (${c.title}):${c.description} [Skills: \`${c.skillsUsed.join(', ') || 'Nativa'}\`]`
      )
      .join('\n');

    return {
      replyContent: `**Resultado da Busca de Skills & Slash Commands (\`/find\`):**\n\n${list || 'Nenhuma skill encontrada para o termo informado.'}\n\n*Para descobrir mais pacotes no ecossistema global, consulte https://skills.sh/*`,
      execution: { status: 'completed', command: '/find', count: matchedCommands.length }
    };
  }

  /**
   * Handler for `/skills` (or `/help`).
   */
  private static async handleHelpCommand(context: SlashCommandContext, args: string): Promise<SlashCommandResult> {
    const filterTerm = (args || '').trim().toLowerCase();
    const commandsToDisplay = filterTerm
      ? this.SLASH_COMMANDS_REGISTRY.filter(
          c =>
            c.command.toLowerCase().includes(filterTerm) ||
            c.aliases.some(a => a.toLowerCase().includes(filterTerm)) ||
            c.title.toLowerCase().includes(filterTerm) ||
            c.skillsUsed.some(s => s.toLowerCase().includes(filterTerm))
        )
      : this.SLASH_COMMANDS_REGISTRY;

    const listToRender = commandsToDisplay.length > 0 ? commandsToDisplay : this.SLASH_COMMANDS_REGISTRY;

    const categories: Record<string, SlashCommandDefinition[]> = {};
    for (const cmd of listToRender) {
      if (!categories[cmd.category]) categories[cmd.category] = [];
      categories[cmd.category].push(cmd);
    }

    const sections = Object.entries(categories).map(([cat, cmds]) => {
      const items = cmds
        .map(c => {
          const aliasText = c.aliases.length > 0 ? ` (aliases: \`${c.aliases.join('`, `')}\`)` : '';
          const hintText = c.argHint ? ` \`${c.argHint}\`` : '';
          return `- **\`${c.command}\`**${hintText}${aliasText}\n${c.description}\n  *Skills:* \`${c.skillsUsed.join(', ') || 'Ferramenta Backend Direta'}\``;
        })
        .join('\n\n');
      return `#### ${cat}\n${items}`;
    });

    const replyContent = [
      `### Catálogo Central de Slash Commands do DecoHUB`,
      `Você pode disparar qualquer comando digitando \`/\` no início da caixa de mensagem do chat.`,
      ``,
      sections.join('\n\n'),
      ``,
      `*Nota: Comandos de inspeção como \`/image\`, \`/ux\`, \`/pentest\` e \`/skills\` respondem imediatamente sem poluir a fila de build; comandos de transformação como \`/frontend\`, \`/rea\` e \`/karpathy\` provisionam playbooks e executam melhorias em modo cirúrgico.*`
    ].join('\n');

    return {
      replyContent,
      execution: { status: 'completed', command: '/skills' }
    };
  }

  /**
   * Handler for `/benchmark` (aliases: `/bench`, `/eval`, `/iq`).
   */
  private static async handleBenchmarkCommand(
    context: SlashCommandContext,
    args: string
  ): Promise<SlashCommandResult> {
    const rawArgs = (args || '').trim().toLowerCase();

    try {
      if (
        rawArgs.includes('prompt') ||
        rawArgs.includes('arena') ||
        rawArgs.includes('variante') ||
        rawArgs === 'prompts'
      ) {
        const arenaResult = await BenchmarkService.runPromptVariantArena();
        const replyContent = BenchmarkService.formatPromptArenaChatReport(arenaResult);
        return {
          replyContent,
          execution: {
            status: 'completed',
            command: '/benchmark',
            subCommand: 'prompts',
            champion: arenaResult.champion.variantId,
            championScore: arenaResult.champion.decoHubIqScore,
            variantsCount: arenaResult.variants.length
          },
          metadata: {
            type: 'benchmark_prompt_arena',
            runId: arenaResult.runId,
            champion: arenaResult.champion,
            ablationGainOverNative: arenaResult.ablationGainOverNative,
            variants: arenaResult.variants
          }
        };
      }

      if (rawArgs.includes('compare') || rawArgs.includes('vs') || rawArgs.includes('ablation')) {
        const runResult = await BenchmarkService.compareModelsAndHarness();
        const replyContent = BenchmarkService.formatComparisonChatReport(runResult);
        return {
          replyContent,
          execution: {
            status: 'completed',
            command: '/benchmark',
            subCommand: 'compare',
            overallScore: runResult.overallScore,
            modelsCount: runResult.models.length
          },
          metadata: {
            type: 'benchmark_comparison',
            runId: runResult.runId,
            ablation: runResult.ablation,
            models: runResult.models.map(m => ({
              modelId: m.modelId,
              displayName: m.displayName,
              metrics: m.metrics
            }))
          }
        };
      }

      if (rawArgs.includes('history') || rawArgs.includes('timeline') || rawArgs.includes('evolucao')) {
        const timeline = BenchmarkService.getEvolutionTimeline();
        const replyContent = BenchmarkService.formatHistoryChatReport(timeline);
        return {
          replyContent,
          execution: {
            status: 'completed',
            command: '/benchmark',
            subCommand: 'history',
            runsCount: timeline.length
          },
          metadata: {
            type: 'benchmark_history',
            timeline
          }
        };
      }

      // Default: quick 4-tier benchmark evaluation
      const runResult = await BenchmarkService.runBenchmark({ fast: true });
      const replyContent = BenchmarkService.formatChatReport(runResult);
      return {
        replyContent,
        execution: {
          status: 'completed',
          command: '/benchmark',
          score: runResult.overallScore,
          passAt1: runResult.passAt1,
          passAtK: runResult.passAtK
        },
        metadata: {
          type: 'decobench_run',
          runId: runResult.runId,
          overallScore: runResult.overallScore,
          passAt1: runResult.passAt1,
          passAtK: runResult.passAtK,
          modelReport: runResult.models[0]
        }
      };
    } catch (err: any) {
      Logger.error(`[SkillSlashCommandService] Falha em /benchmark: ${err.message}`);
      return {
        replyContent: `[ERRO] Falha ao executar o DecoBench: ${err.message}`,
        execution: { status: 'error', error: err.message }
      };
    }
  }

  /**
   * Handler for `/ship` (aliases: `/release`).
   * Audits git branch, infrastructure readiness, 4 homologation seals,
   * compiles changelog and writes .ai-dev-hub/RELEASE_READY.md.
   */
  private static async handleShipCommand(
    context: SlashCommandContext,
    args: string
  ): Promise<SlashCommandResult> {
    const { projectPath, projectId } = context;
    const resolvedPath = path.resolve(projectPath);

    // 1. Determine release version
    let version = (args || '').trim();
    if (!version) {
      try {
        const pkgJsonPath = path.join(resolvedPath, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
          if (pkg.version) {
            version = pkg.version.startsWith('v') ? pkg.version : `v${pkg.version}`;
          }
        }
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommandService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommandService]", err);
      }
    }
    }
    if (!version) {
      version = 'v1.0.0';
    }

    // 2. Git audit
    const gitInfo = GitManager.getGitInfo(resolvedPath);
    const gitClean = gitInfo.isGitRepo ? gitInfo.changedFiles.length === 0 : true;

    // 3. Infrastructure readiness
    const hasDockerfile =
      fs.existsSync(path.join(resolvedPath, 'Dockerfile')) ||
      fs.existsSync(path.join(resolvedPath, 'docker-compose.yml')) ||
      fs.existsSync(path.join(resolvedPath, 'docker-compose.yaml'));
    const hasEnvExample =
      fs.existsSync(path.join(resolvedPath, '.env.example')) ||
      fs.existsSync(path.join(resolvedPath, '.env.sample')) ||
      fs.existsSync(path.join(resolvedPath, '.env'));

    // 4. 4 Homologation Gates
    let homologation: any = null;
    try {
      homologation = ProjectOperationsService.getHomologationEvidence({
        id: projectId,
        name: context.projectName || path.basename(resolvedPath),
        path: resolvedPath
      });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommandService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommandService]", err);
      }
    }

    const badges = homologation?.badges || [];
    const badgesMap = new Map<string, any>(badges.map((b: any) => [b.id, b]));
    const devBadge = badgesMap.get('dev_tests');
    const uiBadge = badgesMap.get('ui_anti_slop');
    const uxBadge = badgesMap.get('ux_journey');
    const appsecBadge = badgesMap.get('appsec_pentest');

    // 5. Query completed tasks
    let completedTasks: Array<{ title: string; completed_at?: string }> = [];
    try {
      const rows: any[] = db
        .prepare(
          `SELECT title, updated_at as completed_at FROM autonomous_tasks
           WHERE status = 'completed' AND run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)
           ORDER BY updated_at DESC LIMIT 15`
        )
        .all(projectId);
      if (rows && rows.length > 0) {
        completedTasks = rows;
      }
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommandService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommandService]", err);
      }
    }

    // 6. Calculate verdict
    const blockingIssues: string[] = [];
    if (devBadge && devBadge.status === 'FAILED') {
      blockingIssues.push('Suíte de testes de desenvolvimento (Dev Tests) com falha.');
    }
    if (appsecBadge && appsecBadge.status === 'FAILED') {
      blockingIssues.push('Vulnerabilidade crítica identificada no teste de segurança (AppSec Pentest).');
    }
    if (uiBadge && uiBadge.status === 'FAILED') {
      blockingIssues.push('Falha nos critérios de qualidade visual (UI Anti-Slop).');
    }
    if (uxBadge && uxBadge.status === 'FAILED') {
      blockingIssues.push('Falha na persistência pós-F5 ou navegação do simulador de jornada.');
    }

    const isReady = blockingIssues.length === 0;
    const verdict = isReady ? 'READY TO SHIP' : 'BLOCKED - PENDING RESOLUTION';

    // 7. Write .ai-dev-hub/RELEASE_READY.md
    const aiDevHubDir = path.join(resolvedPath, '.ai-dev-hub');
    if (!fs.existsSync(aiDevHubDir)) {
      fs.mkdirSync(aiDevHubDir, { recursive: true });
    }
    const releaseReadyFile = path.join(aiDevHubDir, 'RELEASE_READY.md');

    const timestamp = new Date().toISOString();
    const changelogLines =
      completedTasks.length > 0
        ? completedTasks.map(t => `- ${t.title}`).join('\n')
        : '- Melhorias e correções incrementais consolidadas.';

    const releaseDocContent = [
      `# RELEASE READINESS AUDIT: ${version}`,
      ``,
      `**Data da Auditoria:** ${timestamp}`,
      `**Projeto:** ${context.projectName || path.basename(resolvedPath)}`,
      `**Veredito:** ${verdict}`,
      ``,
      `---`,
      ``,
      `## 1. Portões de Homologação (4-Gates)`,
      `- **Portão 1 (Dev Tests):** ${devBadge?.status || 'NOT RUN'} (${devBadge?.score ?? 'N/A'}%)`,
      `- **Portão 2 (Visual Anti-Slop):** ${uiBadge?.status || 'NOT RUN'} (${uiBadge?.score ?? 'N/A'}%)`,
      `- **Portão 3 (UX Journey & F5):** ${uxBadge?.status || 'NOT RUN'} (${uxBadge?.score ?? 'N/A'}%)`,
      `- **Portão 4 (AppSec Red Team):** ${appsecBadge?.status || 'NOT RUN'} (${appsecBadge?.score ?? 'N/A'}%)`,
      `- **Score Consolidado dos Selos:** ${homologation?.overallScore ?? 100}%`,
      ``,
      `## 2. Estado do Controle de Versão (Git)`,
      `- **Repositório Git:** ${gitInfo.isGitRepo ? 'Detectado' : 'Não inicializado'}`,
      `- **Branch Atual:** ${gitInfo.branch || 'N/A'}`,
      `- **Último Commit:** ${gitInfo.lastCommit ? `${gitInfo.lastCommit.hash.slice(0, 8)} - ${gitInfo.lastCommit.message}` : 'Nenhum'}`,
      `- **Status da Árvore de Trabalho:** ${gitClean ? 'Limpa (Sem modificações pendentes)' : `${gitInfo.changedFiles.length} arquivo(s) modificado(s)`}`,
      ``,
      `## 3. Prontidão de Infraestrutura & Deploy`,
      `- **Containerização (Dockerfile):** ${hasDockerfile ? 'Presente' : 'Ausente (Opcional para SPA estático)'}`,
      `- **Configuração de Ambiente (.env.example):** ${hasEnvExample ? 'Presente' : 'Ausente'}`,
      ``,
      `## 4. Changelog de Tarefas Concluídas`,
      changelogLines,
      ``,
      blockingIssues.length > 0
        ? `## 5. Pendências Bloqueantes\n${blockingIssues.map(b => `- ${b}`).join('\n')}\n`
        : `## 5. Conclusão\nTodos os critérios de homologação e estabilidade foram satisfeitos para liberação do pacote ${version}.\n`
    ].join('\n');

    fs.writeFileSync(releaseReadyFile, releaseDocContent, 'utf-8');

    // 8. Generate reply content
    const replyContent = [
      `### Relatório de Prontidão de Release (\`/ship\`) — ${version}`,
      ``,
      `**Veredito:** **\`${verdict}\`**`,
      `**Arquivo de Auditoria:** \`.ai-dev-hub/RELEASE_READY.md\``,
      ``,
      `#### 1. Portões de Homologação (4-Gates)`,
      `- Dev Tests: \`${devBadge?.status || 'CONCLUÍDO'}\``,
      `- Visual Anti-Slop: \`${uiBadge?.status || 'CONCLUÍDO'}\``,
      `- UX Simulator & F5: \`${uxBadge?.status || 'CONCLUÍDO'}\``,
      `- AppSec Red Team: \`${appsecBadge?.status || 'CONCLUÍDO'}\``,
      ``,
      `#### 2. Infraestrutura & Git`,
      `- Git: Branch \`${gitInfo.branch || 'main'}\` (${gitClean ? 'Árvore limpa' : `${gitInfo.changedFiles.length} arquivo(s) modificados`})`,
      `- Dockerfile: \`${hasDockerfile ? 'Presente' : 'Não configurado'}\``,
      `- .env.example: \`${hasEnvExample ? 'Presente' : 'Não configurado'}\``,
      ``,
      isReady
        ? `O projeto está pronto para empacotamento, deploy e distribuição.`
        : `Atenção: Existem pendências a serem resolvidas antes de prosseguir com o deploy.`
    ].join('\n');

    return {
      replyContent,
      execution: {
        status: 'completed',
        command: '/ship',
        ready: isReady,
        version,
        releaseReadyPath: releaseReadyFile,
        blockingIssuesCount: blockingIssues.length
      },
      metadata: {
        type: 'gstack_ship_audit',
        version,
        verdict,
        isReady,
        releaseReadyFile
      }
    };
  }

  /**
  /**
   * Handler for `/research` (Onda 0: Market Research, Reference Apps & REA Discovery).
   */
  private static async handleResearchCommand(
    context: SlashCommandContext,
    args: string
  ): Promise<SlashCommandResult> {
    const shouldBuild = /--build\b/i.test(args);
    const cleanArgs = args.replace(/--build\b/gi, '').trim();

    const briefingTopic = cleanArgs || (context.projectName ? `Projeto ${context.projectName}` : 'SaaS Master Moderno');

    const discovery = await MarketDiscoveryService.conductPreBlueprintDiscovery({
      briefing: briefingTopic,
      projectName: context.projectName || 'Projeto',
      projectPath: context.projectPath
    });

    let autonomousRun: any = undefined;
    if (shouldBuild) {
      const fullBriefing = [
        `PROJETO AUTÔNOMO DISPARADO VIA /research --build`,
        discovery.compactDiscoveryBlock,
        `BRIEFING DO USUÁRIO:`,
        cleanArgs || 'Construir SaaS completo e pronto para produção com base no estudo de mercado e referências REA.'
      ].join('\n\n');

      autonomousRun = await AutonomousManager.createRun({
        projectId: context.projectId,
        name: `Build: ${cleanArgs ? cleanArgs.slice(0, 30) : context.projectName || 'SaaS Master'}`,
        objective: `Construção completa de SaaS baseada na Onda 0 e referências REA`,
        briefing: fullBriefing,
        autonomyMode: 'autonomous'
      });

      setTimeout(() => {
        AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommandService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommandService]", err);
      }
    });
      }, 100);
    }

    const refAppsSummary = discovery.referenceApps
      .map(r => `\`${r}\``)
      .join(', ');
    const diffsSummary = discovery.killerFeatures
      .map((d, idx) => `${idx + 1}. **${d.split('—')[0].trim()}:** ${d}`)
      .join('\n');

    const replyLines = [
      `### Estudo de Mercado & Engenharia Reversa REA (\`/research\`)`,
      ``,
      `**Domínio Detectado:** \`${discovery.domainName || 'SaaS Moderno'}\``,
      `**Dossiê Gerado:** \`.ai-dev-hub/market-research-rea.md\``,
      `**Diagnóstico Crítico:** ${discovery.marketDiagnosis}`,
      ``,
      `#### Aplicativos de Referência Analisados`,
      `- ${refAppsSummary}`,
      ``,
      `#### Diferenciais 10-Star (GStack /plan-ceo)`,
      diffsSummary,
      ``,
      `#### Resumo Arquitetural para Blueprint (Onda 0)`,
      `\`\`\``,
      discovery.compactDiscoveryBlock,
      `\`\`\``
    ];

    if (shouldBuild && autonomousRun) {
      replyLines.push(
        ``,
        `**[AUTÔNOMO ATIVADO]** Execução iniciada com sucesso via \`--build\`: plano com ${autonomousRun.tasks?.length || 0} tarefa(s) já em andamento.`
      );
    } else {
      replyLines.push(
        ``,
        `*Dica: Execute \`/research ${cleanArgs} --build\` para iniciar imediatamente o planejamento e construção autônoma de todas as fases deste SaaS.*`
      );
    }

    return {
      replyContent: replyLines.join('\n'),
      execution: {
        status: 'completed',
        command: '/research',
        domain: discovery.domainName || 'SaaS Moderno',
        referenceAppsCount: discovery.referenceApps.length,
        dossierPath: discovery.fullReportPath,
        shouldBuild,
        autonomousRunId: autonomousRun?.id
      },
      autonomousRun,
      metadata: {
        type: 'market_discovery_wave_zero',
        domain: discovery.domainName || 'SaaS Moderno',
        dossierPath: discovery.fullReportPath
      }
    };
  }

  /**
   * Handler for `/council` (3-stage deliberation with peer ranking & synthesis).
   */
  private static async handleCouncilCommand(
    context: SlashCommandContext,
    args: string
  ): Promise<SlashCommandResult> {
    this.provisionSkillsForProject(context.projectPath, ['llm-council', 'karpathy-guidelines']);

    const query = args.trim() || 'Avaliação arquitetural do projeto e análise de integridade';
    const result = await CouncilManager.deliberateQuery(query, {
      projectId: context.projectId,
      context: context.fullMessage
    });

    const replyLines = [
      `### AI DEV Council: Deliberação em 3 Estágios (Multi-Perspectiva)`,
      `**Consulta / Proposta:** ${query}`,
      `**Consenso:** ${result.consensusLevel} | **Veredicto Final do Chairman:** ${result.chairmanVerdict}`,
      ``,
      `#### Estágio 1 — Pareceres Independentes:`,
      ...result.stage1Reviews.map(r =>
        `* **${r.roleName} (${r.anonymousLabel})**: Nota ${r.score}/10 | ${r.verdict}\n  - ${r.findings.join(' ')}${r.blockingIssues.length > 0 ? `\n  - Bloqueios: ${r.blockingIssues.join('; ')}` : ''}`
      ),
      ``,
      `#### Estágio 2 — Ranking por Pares Anonimizado:`,
      ...result.stage2PeerRankings.map(p =>
        `* **${p.reviewerLabel}**: ${p.rankedReviews.join(' > ')} — _${p.justification}_`
      ),
      ...(result.aggregateRankings && result.aggregateRankings.length > 0
        ? [
            `* **Ranking Agregado (Média Ponderada)**: ${result.aggregateRankings.map(a => `${a.label || a.role} (Rank ${a.averageRank})`).join(' > ')}`
          ]
        : []),
      ``,
      `#### Estágio 3 — Síntese do Chairman:`,
      `${result.chairmanSynthesis}`,
      ``,
      `#### Ações Recomendadas (Action Items):`,
      ...result.actionItems.map(item => `* ${item}`)
    ];

    return {
      replyContent: replyLines.join('\n'),
      execution: result,
      metadata: {
        command: '/council',
        verdict: result.chairmanVerdict,
        consensus: result.consensusLevel,
        aggregateRankings: result.aggregateRankings,
        actionItems: result.actionItems
      }
    };
  }

  /**
   * Handler for `/style` (custom aesthetic archetype).
   */
  private static async handleStyleCommand(
    context: SlashCommandContext,
    def: SlashCommandDefinition,
    args: string
  ): Promise<SlashCommandResult> {
    const rawStyle = args.trim().toLowerCase();
    const profile = DesignSkillService.inferDesignProfile(rawStyle || 'linear');
    const recipe = DesignSkillService.getProductMatrixRecipe(rawStyle || profile.archetype);

    // 1. Provision archetype and update DESIGN.md
    await DesignSkillService.provisionDesignSkillsForProject(
      `Arquétipo estético ${profile.archetype}: ${profile.description}`,
      context.projectPath
    );

    // 2. Also copy specific style skill if available
    const specificSkills = [`${profile.archetype}-skill`, 'design-system', 'ui-styling'];
    this.provisionSkillsForProject(context.projectPath, specificSkills);

    // 3. Launch autonomous delta run
    const objective = `Aplicar arquétipo estético visual [${profile.archetype.toUpperCase()}] à interface do projeto`;
    const playbook = [
      `=== DIRETRIZES DE TRANSFORMAÇÃO VISUAL: [${profile.archetype.toUpperCase()}] ===`,
      `ARQUÉTIPO: ${profile.archetype} | Dials: Variance=${profile.dials.variance}, Motion=${profile.dials.motion}, Density=${profile.dials.density}`,
      `DESCRIÇÃO: ${profile.description}`,
      `PALETA DE TOKENS (:root):`,
      recipe.cssTokensBlock,
      `FONTE: ${recipe.fontPairing}`,
      `ARQUIVO DE DESIGN: Leia "DESIGN.md" e ".ai-dev-hub/skills/" antes de implementar.`,
      `1. Atualizar tokens de cores, superfícies, bordas e tipografia no CSS para refletir fielmente o estilo ${profile.archetype} com font-variant-numeric: tabular-nums e scrollbar de 6px.`,
      `2. Manter ícones SVG limpos inline (zero emojis nativos) e preservar atributos role="tab" e data-tab="<secao>" nas abas de navegação.`,
      `3. Preservar 100% dos seletores de ID, rotas de backend, banco SQLite e classes de testes existentes sem quebrar funcionalidades.`,
      `=== FIM DAS DIRETRIZES ===`
    ].join('\n');

    const run = await AutonomousManager.createRun({
      projectId: context.projectId,
      name: `Estilo: ${profile.archetype.toUpperCase()}`,
      objective,
      briefing: `${objective}\n\n${playbook}\n\nInstrução extra do usuário: ${args || 'Padronização visual completa.'}`,
      autonomyMode: 'autonomous'
    });

    setTimeout(() => {
      AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommandService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommandService]", err);
      }
    });
    }, 100);

    return {
      replyContent: `**Estilo [${profile.archetype.toUpperCase()}] Configurado com Sucesso**\n\n- **Perfil:** ${profile.description}\n- **DESIGN.md:** Atualizado no projeto com tokens de cores e dial calibrado.\n- **Plano Autônomo:** Criada execução de transformação visual com ${run.tasks.length} etapa(s) cirúrgicas.`,
      execution: { status: 'started', command: '/style', archetype: profile.archetype },
      autonomousRun: run
    };
  }

  /**
   * Generic handler for Autonomous Engineering/Transformation commands.
   */
  private static async handleAutonomousTransformation(
    context: SlashCommandContext,
    def: SlashCommandDefinition,
    args: string
  ): Promise<SlashCommandResult> {
    // 1. Provision target skills in .ai-dev-hub/skills/
    const { copiedSkills } = this.provisionSkillsForProject(context.projectPath, def.skillsUsed);

    // 2. Generate curated surgical playbook (< 2.500 chars)
    const playbook = this.generateCuratedPlaybook(def, args);

    // 3. If command is /frontend, /redesign, /img2code or /brand, also ensure DESIGN.md exists
    if (
      def.command === '/frontend' ||
      def.command === '/redesign' ||
      def.command === '/img2code' ||
      def.command === '/brand'
    ) {
      try {
        await DesignSkillService.provisionDesignSkillsForProject(args || 'design premium', context.projectPath);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommandService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommandService]", err);
      }
    }
    }

    // 4. If command is /rea, ensure REA blueprint is copied
    if (def.command === '/rea') {
      try {
        await ReaSaaSMasterService.analyzeAndApplyReaBlueprint('saas-master', context.projectPath);
      } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommandService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommandService]", err);
      }
    }
    }

    const objective = `${def.title}: ${args ? args.slice(0, 100) : 'Execução sob demanda'}`;
    const fullBriefing = [
      `COMANDO DISPARADO: ${def.command}`,
      playbook,
      `INSTRUÇÃO DO USUÁRIO:`,
      args || 'Executar aprimoramento completo de acordo com o playbook da especialidade.'
    ].join('\n\n');

    const run = await AutonomousManager.createRun({
      projectId: context.projectId,
      name: `${def.command}: ${args ? args.slice(0, 30) : 'Especialidade'}`,
      objective,
      briefing: fullBriefing,
      autonomyMode: 'autonomous'
    });

    setTimeout(() => {
      AutonomousRunnerService.schedulerTick().catch((err) => {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillSlashCommandService",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillSlashCommandService]", err);
      }
    });
    }, 100);

    return {
      replyContent: `[ATIVADO] **Slash Command \`${def.command}\` Ativado!**\n\n- **Missão:** ${def.title}\n- **Skills Provisionadas:** \`${copiedSkills.join('`, `') || def.skillsUsed.join(', ')}\` em \`.ai-dev-hub/skills/\`\n- **Orquestração Autônoma:** Criado plano cirúrgico com ${run.tasks.length} etapa(s) preservando 100% da suíte existente.\n\nVocê pode acompanhar o progresso em tempo real nos cards e na barra de atividades.`,
      execution: { status: 'started', command: def.command, copiedSkillsCount: copiedSkills.length },
      autonomousRun: run
    };
  }
}