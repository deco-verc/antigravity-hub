// server/src/skillRouter.ts
// Skill Router: Identifica a especialidade técnica necessária para cada tarefa
// e configura o contexto do Worker de forma cirúrgica (sem criar conversas físicas extras).

import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { Logger } from './logger.js';
import { AutonomousManager } from './autonomousManager.js';

export type TechnicalSkill =
  | 'FRONTEND_SPECIALIST'
  | 'BACKEND_API'
  | 'DATABASE_ARCHITECT'
  | 'SECURITY_REVIEWER'
  | 'TEST_ENGINEER'
  | 'DEVOPS_CLI'
  | 'KARPATHY_MINIMALIST'
  | 'FULL_STACK';

export type SkillSource = 'BMAD' | 'Superpowers' | 'wshobson/agents' | 'agency-agents';

export interface RoutedSkill {
  skill: TechnicalSkill;
  displayName: string;
  description: string;
  sources: SkillSource[];
  methodologies: string[];
  concreteTechniques: string[];
  focusAreas: string[];
  priorityInvariants: string[];
  suggestedVerification: string;
  formattingSnippet: string;
  guidelines?: string[];
  physicalSkills?: string[];
  copiedFiles?: string[];
  surgicalDigest?: string;
  provisionDirective?: string;
}

export interface SkillRoutingOptions {
  stack?: string;
  projectObjective?: string;
  effortLevel?: 'MINIMAL' | 'STANDARD' | 'DEEP';
  isBugFix?: boolean;
  projectPath?: string;
}

/**
 * Calibrates the Karpathy guidelines SKILL.md by appending the Dual-Mode Contextual Calibration
 * to "## 1. Think Before Coding", eliminating conflicts with Full Dev Autonomy during autonomous runs.
 */
export function calibrateKarpathySkillContent(content: string): string {
  if (content.includes('Contextual Calibration (Interactive vs. Autonomous Execution)')) {
    return content;
  }
  const calibrationBlock = [
    '',
    '### Contextual Calibration (Interactive vs. Autonomous Execution)',
    '- **In Interactive / Planning Mode (`/plan`, `/grill-me`, or conversational chat without an active autonomous `run_id`)**: Surface assumptions, present multiple interpretations, push back on overcomplicated requests, and ask clarifying questions BEFORE writing code.',
    '- **In Autonomous Worker Execution (`run_id` active / Overnight Autopilot)**: NEVER halt execution or call `ask_question`. Instead, state your assumptions explicitly in the technical log, resolve ambiguities using canonical workspace specs (`@.ai-dev-hub/specs/*.md`) and existing codebase conventions, and choose the simplest architectural path.',
    ''
  ].join('\n');

  if (content.includes('## 2. Simplicity First')) {
    return content.replace('## 2. Simplicity First', `${calibrationBlock}\n## 2. Simplicity First`);
  }
  return `${content.trimEnd()}\n\n${calibrationBlock}\n`;
}

/**
 * Ensures a SKILL.md file has a valid YAML frontmatter containing `name:` and `description:`
 * as required by the native Google Antigravity 2.0 skill discovery system.
 */
export function ensureSkillFrontmatter(content: string, slug: string, defaultDescription?: string): string {
  const trimmed = content.trim();
  const frontmatterMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (frontmatterMatch) {
    let yamlBlock = frontmatterMatch[1];
    const body = frontmatterMatch[2];
    if (!/^name:\s*.+/m.test(yamlBlock)) {
      yamlBlock = `name: ${slug}\n` + yamlBlock;
    }
    if (!/^description:\s*.+/m.test(yamlBlock)) {
      const desc = defaultDescription || `Skill ${slug} para desenvolvimento autônomo e assistido no DecoHUB.`;
      yamlBlock = yamlBlock.trim() + `\ndescription: "${desc.replace(/"/g, '\\"')}"`;
    }
    return `---\n${yamlBlock.trim()}\n---\n\n${body.trim()}\n`;
  }

  // No frontmatter present
  const desc = defaultDescription || `Skill ${slug} para desenvolvimento autônomo e assistido no DecoHUB.`;
  return `---\nname: ${slug}\ndescription: "${desc.replace(/"/g, '\\"')}"\n---\n\n${trimmed}\n`;
}

export class SkillRouter {
  static calibrateKarpathySkillContent = calibrateKarpathySkillContent;
  static ensureSkillFrontmatter = ensureSkillFrontmatter;
  /**
   * Registry for dynamic external skill knowledge extensions
   */
  private static externalKnowledgeRegistry = new Map<TechnicalSkill, string[]>();

  /**
   * Caches for physical file digests and task-level resolution with bound eviction
   */
  private static readonly MAX_CACHE_ENTRIES = 500;
  private static physicalSkillDigestCache = new Map<string, string>();
  private static taskSkillResolutionCache = new Map<string, { files: string[]; copiedFiles: string[]; digest: string; provisionDirective: string }>();

  /**
   * Clears physical skills cache (useful for tests)
   */
  static clearPhysicalSkillsCache(): void {
    this.physicalSkillDigestCache.clear();
    this.taskSkillResolutionCache.clear();
  }

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
   * Extracts a condensed surgical digest (400 to 700 chars) from a physical markdown skill file.
   */
  private static extractSurgicalDigestFromFile(filePath: string): string {
    if (this.physicalSkillDigestCache.has(filePath)) {
      return this.physicalSkillDigestCache.get(filePath)!;
    }
    try {
      if (!fs.existsSync(filePath)) {
        return '';
      }
      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const withoutFrontmatter = rawContent.replace(/^---[\s\S]*?---\s*/, '');
      const lines = withoutFrontmatter.split('\n');
      const keyDirectives: string[] = [];

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('#') || line.startsWith('```') || line.startsWith('|')) continue;
        if (
          line.startsWith('- ') ||
          line.startsWith('* ') ||
          /^\d+\.\s+/.test(line) ||
          /\b(DEVE|NUNCA|PROIBIDO|OBRIGAT[OÓ]RIO|GARANTIR|MUST|ALWAYS|NEVER)\b/i.test(line)
        ) {
          const clean = line.replace(/^[-*]\s+|\d+\.\s+/, '').trim();
          if (clean.length > 20 && clean.length < 180 && !keyDirectives.includes(clean)) {
            keyDirectives.push(clean);
            if (keyDirectives.join('; ').length > 550) break;
          }
        }
      }

      let digest = keyDirectives.slice(0, 4).join('; ');
      if (!digest || digest.length < 40) {
        const cleanText = withoutFrontmatter
          .replace(/```[\s\S]*?```/g, '')
          .replace(/#{1,6}\s+[^\n]+/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        digest = cleanText.slice(0, 450);
      }

      if (digest.length > 650) {
        digest = digest.slice(0, 647) + '...';
      }

      if (this.physicalSkillDigestCache.size >= this.MAX_CACHE_ENTRIES) {
        const first = this.physicalSkillDigestCache.keys().next().value;
        if (first) this.physicalSkillDigestCache.delete(first);
      }
      this.physicalSkillDigestCache.set(filePath, digest);
      return digest;
    } catch (err: any) {
      Logger.warn(`[SkillRouter] Falha ao extrair digest de ${filePath}: ${err.message}`);
      return '';
    }
  }

  /**
   * High-density domain default fallback digest when physical files are not populated on disk.
   */
  private static getDefaultSurgicalDigest(skill: TechnicalSkill): string {
    switch (skill) {
      case 'DATABASE_ARCHITECT':
        return 'Modelagem relacional SQLite com queries parametrizadas (?), transações BEGIN/COMMIT idempotentes, tabela audit_logs e rotina seedIfEmpty() com 15-30 registros realistas.';
      case 'FRONTEND_SPECIALIST':
        return 'Design Tokens CSS em :root, scrollbar customizada 6px, navegação com role="tab" e data-tab, ícones SVG inline (zero emojis), Store reativa e persistência F5.';
      case 'BACKEND_API':
      case 'FULL_STACK':
        return 'PORT_GUARD 4000-4999, servir public/index.html em GET /, healthcheck JSON isolado em GET /api/health, cabeçalho nosniff e adaptadores Dual-Mode com Graceful Mock Fallback.';
      case 'SECURITY_REVIEWER':
        return 'Sanitização DOM com escapeHtml(), contenção de Path Traversal com path.resolve().startsWith(publicDir), bloqueio de dotfiles (.env/.git) e HTTP 400 para números negativos.';
      case 'TEST_ENGINEER':
        return 'Testes determinísticos sem .skip ou asserções tautológicas, cobertura de edge cases (negativos, NaN, nulos) e encerramento limpo de servidores em try/finally com exitCode 0.';
      case 'DEVOPS_CLI':
        return 'Scripts CLI 100% não-interativos com propagação de exit codes, Dockerfile Node 22 Alpine com VOLUME e HEALTHCHECK em /api/health, sem processos zumbis.';
      case 'KARPATHY_MINIMALIST':
      default:
        return 'Simplicity First: código direto, modular e linear sem abstrações prematuras ou classes supérfluas, intervenções cirúrgicas e 100% dos testes passando.';
    }
  }

  /**
   * Maps persona and microtask keywords to physical files, copies them idempotently to .ai-dev-hub/skills/,
   * and extracts a condensed surgical digest (400-700 chars).
   */
  static resolvePhysicalSkillsForTask(
    task: {
      title: string;
      description?: string;
      criteria?: string[];
      expectedScopeFiles?: string[];
      expected_files?: string[];
      mode?: string;
    },
    skill: TechnicalSkill,
    projectPath?: string
  ): {
    files: string[];
    copiedFiles: string[];
    digest: string;
    provisionDirective: string;
  } {
    const taskKey = `${task.title || ''}::${skill}::${projectPath || ''}`;
    if (this.taskSkillResolutionCache.has(taskKey)) {
      return this.taskSkillResolutionCache.get(taskKey)!;
    }

    const hubRoot = this.getHubRootDir();
    const docSimp = path.join(hubRoot, 'DOCSIMP');
    const reaBlueprints = path.join(docSimp, 'rea-blueprints');
    const designSkills = path.join(docSimp, 'design-skills');
    const skillsDir = path.join(hubRoot, 'Skills');

    const text = [
      task.title || '',
      task.description || '',
      (task.criteria || []).join(' '),
      (task.expectedScopeFiles || task.expected_files || []).join(' ')
    ].join(' ').toLowerCase();

    const candidates: string[] = [];

    const karpathySkillFile = path.join(skillsDir, 'andrej-karpathy-skills-main', 'andrej-karpathy-skills-main', 'skills', 'karpathy-guidelines', 'SKILL.md');
    const karpathyExamplesFile = path.join(skillsDir, 'andrej-karpathy-skills-main', 'andrej-karpathy-skills-main', 'EXAMPLES.md');
    const backendWorkflowFile = path.join(reaBlueprints, 'saas-master-backend-and-workflows.md');
    const plugAndPlayFile = path.join(docSimp, 'saas_plug_and_play_standard.md');
    const supabaseKnowledgeFile = path.join(docSimp, 'supabase_knowledge_ready.md');
    const cloudflareKnowledgeFile = path.join(docSimp, 'cloudflare_knowledge_ready.md');
    const pushinpayKnowledgeFile = path.join(docSimp, 'pushinpay_docs_knowledge_ready.md');
    const upstashKnowledgeFile = path.join(docSimp, 'upstash_knowledge_ready.md');

    const tallyBlueprintFile = path.join(reaBlueprints, 'tally-form-block-ux_rea_blueprint.md');
    const n8nBlueprintFile = path.join(reaBlueprints, 'n8n-workflow-automation_rea_blueprint.md');
    const attioBlueprintFile = path.join(reaBlueprints, 'attio-crm-data-engine_rea_blueprint.md');

    const uiUxProMaxFile = path.join(designSkills, 'ui-ux-pro-max.md');
    const brandkitSkillFile = path.join(designSkills, 'taste-skill', 'skills', 'brandkit', 'SKILL.md');
    const vercelWebDesignFile = path.join(designSkills, 'vercel-web-design-guidelines.md');
    const tasteSkillFile = path.join(designSkills, 'taste-skill.md');
    const frontendDesignFile = path.join(designSkills, 'frontend-design.md');
    const modernFrontendFile = path.join(designSkills, 'modern-frontend-design.md');
    const shellAndStateFile = path.join(reaBlueprints, 'saas-master-shell-and-state.md');
    const webAnimationFile = path.join(designSkills, 'web-animation-design.md');
    const vercelBestPracticesFile = path.join(designSkills, 'vercel-react-best-practices.md');
    const playwrightAgentCliFile = path.join(designSkills, 'playwright-agent-cli.md');

    const backendSuite = [
      karpathySkillFile,
      karpathyExamplesFile,
      backendWorkflowFile,
      plugAndPlayFile,
      supabaseKnowledgeFile,
      cloudflareKnowledgeFile,
      pushinpayKnowledgeFile,
      upstashKnowledgeFile
    ];

    const frontendSuite = [
      uiUxProMaxFile,
      brandkitSkillFile,
      vercelWebDesignFile,
      tasteSkillFile,
      frontendDesignFile,
      modernFrontendFile,
      shellAndStateFile,
      webAnimationFile,
      vercelBestPracticesFile,
      playwrightAgentCliFile
    ];

    // Detecção semântica contextual para injeção prioritária cirúrgica
    const isFormOrModalOrTally = /\b(tally|forms?|formul[aá]rios?|modais|modal|inputs?|zero-fric[cç][aã]o|slash|slash-commands?|checkout)\b/i.test(text);
    const isWorkflowOrN8n = /\b(n8n|workflow|workflows|pipeline|esteira|extra[cç][aã]o|transcri[cç][aã]o|transcript|headline|thumbnails?|automac|node-graph)\b/i.test(text);
    const isDataGridOrAttio = /\b(attio|grid|data-grid|tabelas?|cards?|videos?|virais?|ordena[cç][aã]o|filtros?|kanban|spreadsheet|data-engine)\b/i.test(text);
    const isAuthOrSupabase = /\b(auth|autentica[cç][aã]o|login|register|logout|sess[aã]o|session|supabase|jwt)\b/i.test(text);
    const isTurnstileOrCloudflare = /\b(turnstile|cloudflare|captcha|anti-bot|bot)\b/i.test(text);
    const isPixOrBilling = /\b(pix|pushinpay|pagamentos?|billing|checkout-pix|assinatura|planos?|cotas?)\b/i.test(text);
    const isUpstashOrCache = /\b(upstash|redis|cache|rate-limit|ratelimit)\b/i.test(text);
    const isPlaywright = /\b(playwright|e2e|screenshot|screenshots|captura\s*visual|auditoria\s*visual|homologa[cç][aã]o)\b/i.test(text);

    // Injeção prioritária cirúrgica baseada nos tópicos semânticos
    if (isFormOrModalOrTally) {
      candidates.push(tallyBlueprintFile, vercelWebDesignFile);
    }
    if (isWorkflowOrN8n) {
      candidates.push(n8nBlueprintFile, tasteSkillFile);
    }
    if (isDataGridOrAttio) {
      candidates.push(attioBlueprintFile, modernFrontendFile);
    }
    if (isAuthOrSupabase) {
      candidates.push(supabaseKnowledgeFile);
    }
    if (isTurnstileOrCloudflare) {
      candidates.push(cloudflareKnowledgeFile);
    }
    if (isPixOrBilling) {
      candidates.push(pushinpayKnowledgeFile);
    }
    if (isUpstashOrCache) {
      candidates.push(upstashKnowledgeFile);
    }
    if (isPlaywright) {
      candidates.push(playwrightAgentCliFile);
    }

    const isExplicitUi = /(interface|frontend|front-end|\bui\b|\bux\b|dashboard|layout|css|html|drawer|tela|componente|visual|svg|lucide|command palette|cor|paleta|estilo|responsiv|playwright)/i.test(text);

    switch (skill) {
      case 'FRONTEND_SPECIALIST':
        candidates.push(...frontendSuite);
        break;

      case 'BACKEND_API':
      case 'DATABASE_ARCHITECT':
      case 'SECURITY_REVIEWER':
        candidates.push(...backendSuite);
        break;

      case 'FULL_STACK':
        if (isExplicitUi) {
          candidates.push(karpathySkillFile, karpathyExamplesFile, ...frontendSuite);
        } else {
          candidates.push(...backendSuite);
        }
        break;

      case 'TEST_ENGINEER':
      case 'DEVOPS_CLI':
      case 'KARPATHY_MINIMALIST':
      default:
        if (isExplicitUi) {
          candidates.push(playwrightAgentCliFile, karpathySkillFile, karpathyExamplesFile, plugAndPlayFile, ...frontendSuite);
        } else {
          candidates.push(karpathySkillFile, karpathyExamplesFile, backendWorkflowFile, plugAndPlayFile, playwrightAgentCliFile, ...backendSuite);
        }
        break;
    }

    // Filter existing files, deduplicate and ensure strictly up to 6 combined files
    const existingFiles = Array.from(new Set(candidates.filter(f => fs.existsSync(f))));
    const selectedFiles = existingFiles.slice(0, 6);

    // Provision on demand to <projectPath>/.ai-dev-hub/skills/ and native Antigravity 2.0 path <projectPath>/.agents/skills/<slug>/SKILL.md
    const copiedFiles: string[] = [];
    if (projectPath && selectedFiles.length > 0) {
      try {
        const targetSkillsDir = path.join(projectPath, '.ai-dev-hub', 'skills');
        if (!fs.existsSync(targetSkillsDir)) {
          fs.mkdirSync(targetSkillsDir, { recursive: true });
        }
        for (const src of selectedFiles) {
          const rawBase = path.basename(src);
          const isSkillMd = rawBase.toLowerCase() === 'skill.md';
          const slug = isSkillMd
            ? path.basename(path.dirname(src))
            : path.basename(src, path.extname(src));
          const destName = isSkillMd
            ? `${slug}-skill.md`
            : rawBase;
          const destPath = path.join(targetSkillsDir, destName);
          let srcContent = fs.readFileSync(src, 'utf-8');
          const isKarpathy = slug === 'karpathy-guidelines' || src.includes('karpathy-guidelines');
          if (isKarpathy) {
            srcContent = calibrateKarpathySkillContent(srcContent);
          }
          if (!fs.existsSync(destPath) || fs.readFileSync(destPath, 'utf-8') !== srcContent) {
            fs.writeFileSync(destPath, srcContent, 'utf-8');
          }
          copiedFiles.push(destName);

          // Native Antigravity 2.0 path: <projectPath>/.agents/skills/<slug>/SKILL.md
          try {
            const nativeSkillDir = path.join(projectPath, '.agents', 'skills', slug);
            if (!fs.existsSync(nativeSkillDir)) {
              fs.mkdirSync(nativeSkillDir, { recursive: true });
            }
            const nativeSkillFile = path.join(nativeSkillDir, 'SKILL.md');
            const nativeContent = ensureSkillFrontmatter(srcContent, slug);
            if (!fs.existsSync(nativeSkillFile) || fs.readFileSync(nativeSkillFile, 'utf-8') !== nativeContent) {
              fs.writeFileSync(nativeSkillFile, nativeContent, 'utf-8');
            }

            // For karpathy-guidelines, also provision examples/EXAMPLES.md
            if (isKarpathy) {
              const examplesSrc = path.join(
                skillsDir,
                'andrej-karpathy-skills-main',
                'andrej-karpathy-skills-main',
                'EXAMPLES.md'
              );
              if (fs.existsSync(examplesSrc)) {
                const examplesDir = path.join(nativeSkillDir, 'examples');
                if (!fs.existsSync(examplesDir)) {
                  fs.mkdirSync(examplesDir, { recursive: true });
                }
                const examplesDest = path.join(examplesDir, 'EXAMPLES.md');
                const examplesContent = fs.readFileSync(examplesSrc, 'utf-8');
                if (!fs.existsSync(examplesDest) || fs.readFileSync(examplesDest, 'utf-8') !== examplesContent) {
                  fs.writeFileSync(examplesDest, examplesContent, 'utf-8');
                }
              }
            }
          } catch (nativeErr: any) {
            Logger.warn(`[SkillRouter] Falha não bloqueante ao provisionar skill nativa ${slug}: ${nativeErr.message}`);
          }
        }
      } catch (err: any) {
        Logger.warn(`[SkillRouter] Falha não bloqueante ao copiar skills para ${projectPath}: ${err.message}`);
      }
    }

    // Extract surgical digest
    const digests = selectedFiles.map(f => this.extractSurgicalDigestFromFile(f)).filter(Boolean);
    let surgicalDigest = digests.join(' | ');
    if (!surgicalDigest || surgicalDigest.length < 50) {
      surgicalDigest = this.getDefaultSurgicalDigest(skill);
    }
    if (surgicalDigest.length > 700) {
      surgicalDigest = surgicalDigest.slice(0, 697) + '...';
    }

    const fileDisplay = copiedFiles.length > 0
      ? copiedFiles.join(', ')
      : (selectedFiles.length > 0
          ? selectedFiles.map(f => path.basename(f).toLowerCase() === 'skill.md' ? `${path.basename(path.dirname(f))}-skill.md` : path.basename(f)).join(', ')
          : 'regras-padrao.md');

    const provisionDirective = `ARQUIVOS DE SKILL PROVISIONADOS PARA ESTA TAREFA: .ai-dev-hub/skills/${fileDisplay} (Regras chave já injetadas abaixo; consulte o arquivo em caso de dúvida estrutural).`;

    const result = {
      files: selectedFiles,
      copiedFiles,
      digest: surgicalDigest,
      provisionDirective
    };

    if (this.taskSkillResolutionCache.size >= this.MAX_CACHE_ENTRIES) {
      const first = this.taskSkillResolutionCache.keys().next().value;
      if (first) this.taskSkillResolutionCache.delete(first);
    }
    this.taskSkillResolutionCache.set(taskKey, result);
    return result;
  }

  /**
   * Registers dynamic external methodology or catalog knowledge for a skill (deduplicated)
   */
  static registerExternalSkillKnowledge(skill: TechnicalSkill, knowledge: string[]): void {
    const existing = this.externalKnowledgeRegistry.get(skill) || [];
    const cleaned = (knowledge || []).map(k => String(k || '').trim()).filter(Boolean);
    const merged = Array.from(new Set([...existing, ...cleaned]));
    this.externalKnowledgeRegistry.set(skill, merged);
    Logger.info(`[SkillRouter] Conhecimento externo registrado para especialidade [${skill}] (${cleaned.length} itens)`);
  }

  /**
   * Clears or resets external skill knowledge
   */
  static clearExternalSkillKnowledge(): void {
    this.externalKnowledgeRegistry.clear();
  }

  /**
   * Technical skill definitions and invariants enriched from BMAD, Superpowers, wshobson/agents, and agency-agents
   */
  private static readonly SKILL_DEFINITIONS: Record<TechnicalSkill, {
    displayName: string;
    description: string;
    sources: SkillSource[];
    methodologies: string[];
    concreteTechniques: string[];
    focusAreas: string[];
    priorityInvariants: string[];
    suggestedVerification: string;
  }> = {
    DATABASE_ARCHITECT: {
      displayName: 'Database & Persistence Architect',
      description: 'Especialista em esquemas relacionais SQLite, persistência atómica, Smart Demo Seeding e integridade referencial.',
      sources: ['BMAD', 'wshobson/agents', 'agency-agents'],
      methodologies: [
        'BMAD Contract-First Architecture (especificação estrita de esquemas e colunas antes do código consumidor)',
        'wshobson Relational Invariant Integrity (garantia de integridade, constraints e queries parametrizadas)',
        'agency-agents Senior Data Modeler (migrações idempotentes, audit_logs e seedIfEmpty realista)'
      ],
      concreteTechniques: [
        'Queries SQLite 100% parametrizadas (?) via prepare/run/get/all (zero concatenação de strings em SQL)',
        'Transações atómicas BEGIN/COMMIT com bloco try/catch e ROLLBACK automático em operações multi-escrita',
        'Migrações aditivas e idempotentes (CREATE TABLE IF NOT EXISTS) sem jamais destruir dados em modo DELTA_EVOLUTION',
        'Rotina seedIfEmpty() idempotente populando 15 a 30 registos realistas e tabela audit_logs no primeiro boot'
      ],
      focusAreas: ['Modelagem SQLite parametrizada', 'Transações atómicas', 'Smart Demo Seeding (seedIfEmpty)', 'Migrações idempotentes'],
      priorityInvariants: [
        'Garantir atomicidade com transações (BEGIN / COMMIT / ROLLBACK) e usar exclusivamente queries parametrizadas (?).',
        'Esquemas, migrações e seedIfEmpty() devem ser 100% idempotentes e seguros contra execuções repetidas.',
        'NUNCA executar DROP TABLE ou apagar dados existentes em evoluções incrementais (DELTA_EVOLUTION).',
        'Preservar índices em chaves estrangeiras, colunas de filtro frequente e estrutura de audit_logs.'
      ],
      suggestedVerification: 'Verificar integridade do esquema, execução idempotente de seedIfEmpty() e rollback/commit com dados de borda.'
    },
    SECURITY_REVIEWER: {
      displayName: 'Security & AppSec Red Team Specialist',
      description: 'Especialista em blindagem OWASP Top 10, autenticação, sanitização XSS/SQLi, contenção de Path Traversal e validação de negócio.',
      sources: ['BMAD', 'wshobson/agents', 'agency-agents'],
      methodologies: [
        'wshobson Zero-Trust Access Boundary (verificação estrita de perímetro, caminhos e payloads em cada camada)',
        'agency-agents Application Security Auditor (defesa em profundidade contra os 6 vetores do SecurityPentestSimulator)',
        'BMAD Security Preflight Checklist (proibição de credenciais expostas e sanitização universal de entrada/saída)'
      ],
      concreteTechniques: [
        'Queries SQL parametrizadas (?) e Sanitização DOM com escapeHtml / textContent antes de qualquer innerHTML',
        'Contenção estrita de ficheiros estáticos: path.resolve(publicDir, "." + reqPath).startsWith(publicDir) e bloqueio de dotfiles (.env, .git)',
        'Validação de regras de negócio rejeitando valores monetários, quantidades ou durações negativas (< 0) ou NaN com HTTP 400',
        'Cabeçalhos de segurança obrigatórios (X-Content-Type-Options: nosniff) e zero segredos em ficheiros públicos'
      ],
      focusAreas: ['Anti-SQLi & Anti-XSS (escapeHtml)', 'Contenção de Path Traversal', 'Fuzzing de valores negativos (HTTP 400)', 'Proteção de segredos e headers'],
      priorityInvariants: [
        'Aplicar o princípio do menor privilégio e bloquear qualquer tentativa de Path Traversal (..) ou acesso a dotfiles.',
        'NUNCA expor tokens, SERVICE_ROLE_KEY, senhas ou chaves privadas em código cliente (public/), repositório ou logs.',
        'Sanitizar todas as entradas contra SQLi/XSS e rejeitar números negativos indevidos ou NaN com status HTTP 400.',
        'Incluir cabeçalho X-Content-Type-Options: nosniff e tratar JSON malformado sem derrubar o processo nem vazar stack traces.'
      ],
      suggestedVerification: 'Executar validação contra payloads de SQLi, XSS, Path Traversal, valores negativos e acesso a dotfiles.'
    },
    TEST_ENGINEER: {
      displayName: 'Test & Quality Assurance Engineer',
      description: 'Especialista em testes automatizados determinísticos, suítes de regressão E2E e proteção de integridade.',
      sources: ['Superpowers', 'BMAD', 'wshobson/agents'],
      methodologies: [
        'Superpowers Systematic TDD Loop (red-green-refactor disciplinado sem asserções falsas)',
        'BMAD Acceptance Contract Invariants (critérios de aceitação binários e verificáveis)',
        'wshobson Anti-Tampering QA Standard (deteção de enfraquecimento e proibição de assert.ok(true) tautológico)'
      ],
      concreteTechniques: [
        'Testes com exit code binário estrito (0 para sucesso total, >0 para qualquer falha)',
        'Proibição absoluta de asserções ignoradas (.skip, xit ou testes comentados)',
        'Cobertura de edge cases: entradas nulas, valores negativos/NaN, payloads malformados e persistência de estado',
        'Encerramento limpo (try / finally) de qualquer servidor HTTP ou recurso efémero iniciado durante o teste'
      ],
      focusAreas: ['Testes unitários e E2E', 'Cenários adversariais e edge cases', 'Exit codes estritos', 'Determinismo e isolamento'],
      priorityInvariants: [
        'Testes devem ser determinísticos: o mesmo código deve produzir o mesmo resultado em 100% das execuções.',
        'NUNCA adulterar ou enfraquecer testes protegidos; jamais usar .skip, xit ou asserções tautológicas (assert.ok(true)).',
        'Cobrir obrigatoriamente tanto o caminho feliz quanto caminhos de erro (HTTP 400/404) e entradas limítrofes.',
        'Encerrar servidores de teste em blocos try/finally para que o runner termine imediatamente com exit code 0.'
      ],
      suggestedVerification: 'Executar a suíte completa garantindo 100% de aprovação, zero processos pendentes e zero asserções ignoradas.'
    },
    FRONTEND_SPECIALIST: {
      displayName: 'Frontend & SaaS Master UI/UX Specialist',
      description: 'Especialista em interfaces SaaS de alta densidade (7 Pilares REA), Design Tokens Anti-Slop, navegação de secções e reatividade.',
      sources: ['BMAD', 'wshobson/agents', 'agency-agents'],
      methodologies: [
        'wshobson UI Component Isolation (Reactive Client Store desacoplada e re-renderização limpa com escapeHtml)',
        'agency-agents Frontend Craftsman (7 Pilares REA: App Shell Ctrl+K, Slide-Over Drawers, Data Grids CSV e BI SVG)',
        'BMAD Presentation/Logic Boundary (tokens semânticos em :root, números tabulares e 4 estados visuais)'
      ],
      concreteTechniques: [
        'Tokens CSS em :root (DESIGN.md), scrollbar customizada (6px), font-variant-numeric: tabular-nums e ícones SVG Lucide inline (zero emojis)',
        'Botões de navegação/abas com atributos role="tab" e data-tab="<secao>" para descoberta e captura enumerada (01-Secao.png)',
        'Implementação dos 7 Pilares SaaS Master: Command Palette (Ctrl+K), Slide-Over Detail Drawers, Data Grids com filtros/CSV e gráficos SVG',
        'Fiação completa via fetch API real com persistência de dados no backend que sobrevive integralmente ao reload (F5)'
      ],
      focusAreas: ['Arquitetura SaaS Master (7 Pilares REA)', 'Design Tokens :root & Ícones SVG Lucide', 'Navegação semântica (role="tab" / data-tab)', 'Persistência pós-F5'],
      priorityInvariants: [
        'Construir interfaces densas e funcionais com componentes visuais reais e ícones SVG inline; proibir estritamente emojis nativos como ícones e placeholders vazios.',
        'Estruturar a navegação entre secções com role="tab" e data-tab="<secao>" e aplicar font-variant-numeric: tabular-nums em métricas.',
        'Garantir tratamento visual para Loading, Empty, Populated e Error, além de fiação real de formulários e botões.',
        'Validar renderização sem erros de consola, sem overflow horizontal (1280x800 e 390x844) e com persistência após F5.'
      ],
      suggestedVerification: 'Verificar integridade visual no navegador, ausência de erros de consola, navegação entre abas e persistência após F5.'
    },
    BACKEND_API: {
      displayName: 'Backend & Full-Stack API Engineer',
      description: 'Especialista em servidores HTTP/REST modulares, roteamento Full-Stack (SPA vs API), Dual-Mode DOCSIMP e validação estrita.',
      sources: ['BMAD', 'wshobson/agents', 'agency-agents'],
      methodologies: [
        'BMAD REST Contract Strictness (contratos JSON consistentes entre rotas de backend e chamadas fetch do frontend)',
        'agency-agents API Architect (roteamento seguro servindo SPA em GET / e isolando JSON em GET /api/health)',
        'wshobson HTTP Transport Safety (PORT_GUARD na faixa 4000-4999 e adaptadores Dual-Mode com Mock Fallback)'
      ],
      concreteTechniques: [
        'PORT_GUARD estrito: usar const PORT = Number(process.env.PORT) || 4000 (nunca usar as portas reservadas 3001, 3000 ou 5173)',
        'Roteamento Full-Stack: servir public/index.html (text/html) em GET / e manter healthcheck JSON exclusivamente em GET /api/health',
        'Padrão Dual-Mode Plug-and-Play (DOCSIMP): ler chaves de process.env com Graceful Mock Fallback automático quando ausentes',
        'Códigos HTTP semânticos (200, 201, 400, 404, 500), validação contra valores negativos/NaN e header X-Content-Type-Options: nosniff'
      ],
      focusAreas: ['Contratos RESTful & Roteamento SPA', 'PORT_GUARD (4000-4999)', 'Dual-Mode DOCSIMP (Mock Fallback)', 'Validação de payloads e erros'],
      priorityInvariants: [
        'Utilizar verbos HTTP corretos, códigos semânticos e manter consistência exata de campos JSON com o frontend.',
        'Em aplicações com UI web, NUNCA retornar JSON na rota raiz GET / (servir public/index.html e isolar status em GET /api/health).',
        'Respeitar o PORT_GUARD (faixa 4000-4999) e garantir funcionamento offline via Graceful Mock Fallback.',
        'Validar esquema e tipos do payload de entrada antes de persistir, rejeitando dados inválidos ou negativos com HTTP 400.'
      ],
      suggestedVerification: 'Executar chamadas HTTP validando GET / (HTML), GET /api/health (JSON), contratos CRUD e respostas HTTP 400.'
    },
    KARPATHY_MINIMALIST: {
      displayName: 'Karpathy Minimalist & Surgical Refactoring Specialist',
      description: 'Especialista no princípio Simplicity First: eliminação de overengineering, código cirúrgico, clareza direta e anti-slop.',
      sources: ['Superpowers', 'BMAD', 'agency-agents'],
      methodologies: [
        'Karpathy Simplicity First (rejeição de abstrações especulativas mantendo alta densidade funcional do produto)',
        'Superpowers Surgical Diff Practice (intervenção restrita aos ficheiros necessários sem quebrar contratos existentes)',
        'agency-agents Pragmatic Code Minimizer (código limpo, direto, linear e preferência por módulos nativos)'
      ],
      concreteTechniques: [
        'Eliminação de classes, fábricas e wrappers de uso único em favor de funções puras e diretas',
        'Reutilização de utilitários já existentes no repositório antes de criar novas funções ou instalar pacotes',
        'Modificações cirúrgicas restritas ao escopo da tarefa preservando 100% das tabelas SQLite e testes existentes',
        'Distinção estrita: simplicidade de implementação interna nunca reduz a completude funcional nem a riqueza da UI'
      ],
      focusAreas: ['Simplicidade radical de código', 'Eliminação de abstrações prematuras', 'Diffs cirúrgicos', 'Reuso e Anti-Slop'],
      priorityInvariants: [
        'Simplicidade em primeiro lugar: escreva o código mais direto e legível que resolve 100% dos requisitos sem cortar funcionalidades.',
        'Evitar classes e fábricas redundantes; preferir funções diretas e fluxo linear fácil de auditar.',
        'Modificações cirúrgicas: alterar apenas os ficheiros estritamente necessários para cumprir o contrato.',
        'Zero dependências externas supérfluas: utilizar módulos nativos do Node.js antes de instalar pacotes externos.'
      ],
      suggestedVerification: 'Avaliar o diff final verificando código enxuto, zero regressões nos testes e preservação de todas as funcionalidades.'
    },
    DEVOPS_CLI: {
      displayName: 'DevOps, Cloud Deploy & Tooling Engineer',
      description: 'Especialista em automação de scripts, CLI, Dockerfile multi-stage, configuração de ambiente e gestão de processos.',
      sources: ['BMAD', 'agency-agents', 'wshobson/agents'],
      methodologies: [
        'agency-agents DevOps Tooling Standard (scripts portáteis, Dockerfile Node 22 Alpine e exit codes padronizados)',
        'BMAD Environment Isolation (execução hermética com limpeza de variáveis Electron e encerramento de processos)',
        'wshobson CLI Resilience (suporte a execução headless não-interativa com timeouts explícitos)'
      ],
      concreteTechniques: [
        'Kit Cloud Deploy: Dockerfile em node:22-alpine com VOLUME ["/app/data"], EXPOSE 4000-4999, HEALTHCHECK em /api/health e .dockerignore',
        'Scripts CLI idempotentes e 100% não-interativos com propagação correta de exit codes para o sistema operativo',
        'Encerramento garantido de subprocessos e servidores efémeros (taskkill /f /t no Windows ou SIGTERM) após verificações',
        'Isolamento estrito de variáveis de ambiente (.env.example documentado) sem vazar segredos'
      ],
      focusAreas: ['Cloud Deploy Pack (Dockerfile & Healthcheck)', 'Scripts CLI não-interativos', 'Variáveis de ambiente (.env.example)', 'Gestão limpa de processos'],
      priorityInvariants: [
        'Scripts e ferramentas CLI devem tratar erros explicitamente e propagar exit codes padrão sem bloquear em prompts interativos.',
        'Garantir que artefactos de conteinerização (Dockerfile, .dockerignore) usem portas 4000-4999 e healthcheck em /api/health.',
        'Nunca deixar processos em background ou portas TCP abertas após a conclusão de scripts de build/verificação.',
        'Isolar variáveis de ambiente e configurações por projeto com fallback seguro.'
      ],
      suggestedVerification: 'Testar execução de scripts, validação de sintaxe/configuração e checagem de exit code 0.'
    },
    FULL_STACK: {
      displayName: 'Full-Stack SaaS Master Engineer',
      description: 'Engenheiro de desenvolvimento integrado ponta a ponta (UI SaaS Master + API REST + Persistência SQLite + AppSec).',
      sources: ['BMAD', 'Superpowers', 'agency-agents', 'wshobson/agents'],
      methodologies: [
        'BMAD End-to-End Contract Verification (alinhamento exato de rotas REST, payloads JSON e colunas SQLite)',
        'Superpowers Cohesive Feature Delivery (entrega funcional ponta a ponta aprovada nos 4 Portões de Qualidade)',
        'agency-agents Senior Full-Stack Craftsman (7 Pilares REA, seedIfEmpty realista, PORT_GUARD e blindagem OWASP)'
      ],
      concreteTechniques: [
        'Sincronia ponta a ponta: schema SQLite parametrizado (?) + seedIfEmpty() -> API REST (PORT 4000+) -> Reactive Store no Frontend',
        'Roteamento canónico: servir SPA (public/index.html) em GET / e isolar status JSON em GET /api/health',
        'Interface com tokens :root, ícones SVG Lucide, navegação com role="tab" / data-tab e sanitização escapeHtml',
        'Validação da jornada completa no navegador garantindo que dados criados persistem após recarregamento (F5)'
      ],
      focusAreas: ['Integração ponta a ponta (DB + API + UI)', 'Consistência de contratos JSON/SQLite', '7 Pilares REA & Persistência F5'],
      priorityInvariants: [
        'Garantir coerência absoluta de nomes de campos e contratos de dados entre banco SQLite, API REST e frontend.',
        'Validar a jornada completa do dado: ação na interface -> requisição HTTP -> persistência em disco -> sobrevivência ao F5.',
        'Respeitar o PORT_GUARD (4000-4999), servir HTML em GET / e aplicar blindagem AppSec (SQL parametrizado e escapeHtml).',
        'Seguir princípios de código limpo, modular e coberto por testes automatizados em todas as camadas.'
      ],
      suggestedVerification: 'Validar o fluxo completo de ponta a ponta (testes de domínio, API, renderização visual e persistência).'
    }
  };

  /**
   * Strips generic verification boilerplate from criteria so default phrases like
   * "Executar comando de verificação no terminal" or "Garantir que testes passem"
   * do not falsely hijack domain tasks into TEST_ENGINEER or DEVOPS_CLI.
   */
  private static stripVerificationBoilerplate(text: string): string {
    return String(text || '')
      .replace(/(?:executar|rodar)\s+o?\s*comando\s+de\s+verifica[çc][aã]o[^.;\n]*/gi, '')
      .replace(/garantir\s+que\s+(?:todos\s+os\s+)?testes?\s+automatizados?[^.;\n]*/gi, '')
      .replace(/todos\s+os\s+testes\s+antigos\s+e\s+novos\s+passando[^.;\n]*/gi, '')
      .replace(/suite\s+de\s+testes\s+passando\s+com\s+exit\s*code\s*0/gi, '')
      .replace(/retornando\s+(?:c[oó]digo\s+de\s+sa[ií]da|exit\s*code)\s*0/gi, '');
  }

  /**
   * Evaluates a candidate text block against specialty heuristics
   */
  private static matchSkillFromText(
    candidateText: string,
    titleLower: string,
    taskMode?: string,
    effortLevel?: 'MINIMAL' | 'STANDARD' | 'DEEP'
  ): TechnicalSkill | null {
    // 1. Database & Persistence check
    if (
      /\b(sql|sqlite|postgres|database|banco de dados|tabela|table|migration|migra[çc][aã]o|schema|seedifempty|seeding|foreign\s+key|audit_logs|persist[eê]ncia|persistente|armazenar em disco|salvar em disco)\b/i.test(candidateText) &&
      !/\b(interface|dashboard|css|html|react|frontend|drawer|command\s+palette)\b/i.test(titleLower)
    ) {
      return 'DATABASE_ARCHITECT';
    }

    // 2. Security & Auth / AppSec check
    if (
      /\b(auth|autentica[çc][aã]o|login|senha|password|jwt|token|cookie|cors|permiss[aã]o|chmod|chown|seguran[çc]a|security|criptografia|crypto|secret|credencial|xss|sqli|sql\s+injection|path\s+traversal|pentest|owasp|appsec|escapehtml|sanitiza[çc][aã]o)\b/i.test(candidateText)
    ) {
      return 'SECURITY_REVIEWER';
    }

    // 3. Testing & QA check
    const isImplementationTitle = /^(implementar|construir|criar|desenvolver)\s+(?!su[ií]te\s+de\s+testes?|testes?\b|casos\s+de\s+teste)/i.test(titleLower.trim());
    if (
      taskMode === 'TEST' ||
      (!isImplementationTitle &&
        /\b(teste|testes|test\s+suite|su[ií]te\s+de\s+testes?|asser[çc][aã]o|assert|cobertura|coverage|cen[aá]rios\s+de\s+teste|unit\s+test|integration\s+test|testes?\s+e2e|mock|stub)\b/i.test(candidateText))
    ) {
      return 'TEST_ENGINEER';
    }

    // 4. DevOps, Docker & CLI check (evaluated before generic frontend)
    if (
      /\b(cli|terminal|script|shell|bash|powershell|comando|package\.json|npm\s+script|build\s+tool|pipeline|deploy|dockerfile|docker-compose|dockerignore|container|healthcheck|configura[çc][aã]o\s+de\s+ambiente)\b/i.test(candidateText) &&
      !/\b(interface|dashboard|frontend|componente|html|css|command\s+palette)\b/i.test(titleLower)
    ) {
      return 'DEVOPS_CLI';
    }

    // 5. Frontend & SaaS Master UI check (with strict \bui\b and \bux\b word boundaries)
    if (
      /(interface|frontend|front-end|\bui\b|\bux\b|component|componente|visual|layout|dashboard|tela|html|\bcss\b|style|tailwind|react|vue|svelte|p[aá]gina\s+web|navegador|browser|command\s*palette|slide-over|drawer|data-?grid|svg|lucide|tabular-nums|design\.md|\bspa\b)/i.test(candidateText) &&
      !(/(\bapi\b|endpoint|endpoints|rota|rotas|controller|servidor|express|restful)\b/i.test(titleLower) && !/(interface|dashboard|tela|componente|html|css)/i.test(titleLower))
    ) {
      return 'FRONTEND_SPECIALIST';
    }

    // 6. Karpathy Minimalist & Refactoring check
    if (
      /\b(refator|refactor|simplific|clean\s+code|anti-slop|overengineering|reduzir\s+complexidade|remover\s+c[oó]digo\s+morto|dead\s+code|otimiza[çc][aã]o\s+cir[uú]rgica|karpathy)\b/i.test(candidateText) ||
      effortLevel === 'MINIMAL'
    ) {
      return 'KARPATHY_MINIMALIST';
    }

    // 7. Backend & API check
    if (
      /(\bapi\b|endpoint|rota|route|controller|backend|servidor|express|http|middleware|restful|json\s+response)/i.test(candidateText)
    ) {
      return 'BACKEND_API';
    }

    return null;
  }

  /**
   * Analyzes task attributes and classifies into the optimal technical specialty.
   * Evaluates task-specific signals first so project-wide stack/objective keywords do not hijack task routing.
   */
  static routeTask(
    task: {
      title: string;
      description?: string;
      criteria?: string[];
      expectedScopeFiles?: string[];
      mode?: string;
    },
    options?: SkillRoutingOptions
  ): RoutedSkill {
    const titleLower = (task.title || '').toLowerCase();
    const sanitizedCriteria = this.stripVerificationBoilerplate((task.criteria || []).join(' '));

    // Filter out accompanying test files from scope when non-test implementation files are also present
    const rawScopeFiles = task.expectedScopeFiles || [];
    const nonTestScopeFiles = rawScopeFiles.filter(f => !/\.(test|spec)\.[cm]?[jt]sx?$|^(?:test|tests)\//i.test(f));
    const effectiveScopeFiles = nonTestScopeFiles.length > 0 ? nonTestScopeFiles : rawScopeFiles;

    // Stage 1: Primary Task Signals (title + description + sanitized criteria + effective scope files)
    const primaryText = [
      task.title || '',
      task.description || '',
      sanitizedCriteria,
      effectiveScopeFiles.join(' ')
    ].join(' ').toLowerCase();

    let selectedSkill = this.matchSkillFromText(
      primaryText,
      titleLower,
      task.mode,
      options?.effortLevel
    );

    // Stage 2: Fallback to full context (including raw criteria, all scope files, stack, and projectObjective)
    if (!selectedSkill) {
      const fullText = [
        task.title || '',
        task.description || '',
        (task.criteria || []).join(' '),
        rawScopeFiles.join(' '),
        options?.stack || '',
        options?.projectObjective || ''
      ].join(' ').toLowerCase();

      selectedSkill =
        this.matchSkillFromText(fullText, titleLower, task.mode, options?.effortLevel) ||
        'FULL_STACK';
    }

    const def = this.SKILL_DEFINITIONS[selectedSkill];
    const externalKnowledge = this.externalKnowledgeRegistry.get(selectedSkill) || [];

    const effectiveProjectPath = options?.projectPath || (task as any).projectPath || (task as any).path;
    const physical = this.resolvePhysicalSkillsForTask(task, selectedSkill, effectiveProjectPath);

    const priorityInvariants = [
      physical.provisionDirective,
      `[RECEITA CIRÚRGICA FÍSICA]: ${physical.digest}`,
      ...def.priorityInvariants
    ];

    const snippet = this.formatPromptBlock(
      selectedSkill,
      def,
      externalKnowledge,
      physical.provisionDirective,
      physical.digest
    );

    return {
      skill: selectedSkill,
      displayName: def.displayName,
      description: def.description,
      sources: def.sources,
      methodologies: def.methodologies,
      concreteTechniques: [...def.concreteTechniques, ...externalKnowledge],
      focusAreas: def.focusAreas,
      priorityInvariants,
      guidelines: priorityInvariants,
      suggestedVerification: def.suggestedVerification,
      formattingSnippet: snippet,
      physicalSkills: physical.files,
      copiedFiles: physical.copiedFiles,
      surgicalDigest: physical.digest,
      provisionDirective: physical.provisionDirective
    };
  }

  /**
   * Formats a clean, high-impact instruction block for injection into Worker prompt
   */
  private static formatPromptBlock(
    skill: TechnicalSkill,
    def: {
      displayName: string;
      description: string;
      sources: SkillSource[];
      methodologies: string[];
      concreteTechniques: string[];
      priorityInvariants: string[];
      suggestedVerification: string;
    },
    externalKnowledge: string[] = [],
    provisionDirective?: string,
    surgicalDigest?: string
  ): string {
    return [
      `=== [SKILL ROUTER: ESPECIALIDADE TÉCNICA ATRIBUÍDA] ===`,
      `ESPECIALIDADE: ${def.displayName} [${skill}]`,
      `FONTES DE METODOLOGIA: ${def.sources.join(', ')}`,
      `MISSÃO: ${def.description}`,
      ...(provisionDirective ? [`PROVISIONAMENTO DE ARQUIVOS FÍSICOS:`, `• ${provisionDirective}`] : []),
      ...(surgicalDigest ? [`RECEITA CIRÚRGICA CONDENSADA (REGRAS DE OURO):`, `• ${surgicalDigest}`] : []),
      `METODOLOGIAS APLICADAS:`,
      ...def.methodologies.map(m => `• ${m}`),
      `TÉCNICAS CONCRETAS DE IMPLEMENTAÇÃO:`,
      ...def.concreteTechniques.map(t => `  - ${t}`),
      ...(externalKnowledge.length > 0 ? [`CONHECIMENTOS DINÂMICOS DO REPOSITÓRIO:`, ...externalKnowledge.map(k => `  * ${k}`)] : []),
      `DIRETRIZES DA ESPECIALIDADE (INVARIANTES ESSENCIAIS):`,
      ...(provisionDirective ? [`• ${provisionDirective}`] : []),
      ...def.priorityInvariants.map(inv => `• ${inv}`),
      `VERIFICAÇÃO SUGERIDA: ${def.suggestedVerification}`,
      `=== [FIM DA ESPECIALIDADE] ===`
    ].join('\n');
  }

  /**
   * Persists skill assignment in SQLite task record and logs to autonomous activity stream.
   * Completely preserves persistent agent sessions (zero conversation churn).
   */
  static persistSkillAssignment(taskId: string, runId: string, routedSkill: RoutedSkill): void {
    const nowIso = new Date().toISOString();
    try {
      db.prepare(`
        UPDATE autonomous_tasks
        SET skill_routed = ?, skill_guidelines_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        routedSkill.skill,
        JSON.stringify(routedSkill.priorityInvariants),
        nowIso,
        taskId
      );
    } catch {
      // In case column was not yet migrated in an ad-hoc test database
    }

    try {
      AutonomousManager.logEvent(
        runId,
        taskId,
        'system',
        'SKILL_ROUTED',
        `[SKILL_ROUTER] Skill Router alocou especialidade "${routedSkill.displayName}" para a tarefa.`,
        {
          skill: routedSkill.skill,
          displayName: routedSkill.displayName,
          focusAreas: routedSkill.focusAreas,
          verification: routedSkill.suggestedVerification
        }
      );
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "skillRouter",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:skillRouter]", err);
      }
    }

    Logger.info(`[SkillRouter] Tarefa "${taskId.slice(0, 8)}" roteada para [${routedSkill.skill}]: ${routedSkill.displayName}`);
  }

  /**
   * Retrieves active routed skill for a task
   */
  static getSkillForTask(taskId: string): { skill: TechnicalSkill; guidelines: string[] } | null {
    try {
      const row: any = db.prepare('SELECT skill_routed, skill_guidelines_json FROM autonomous_tasks WHERE id = ?').get(taskId);
      if (!row || !row.skill_routed) return null;
      return {
        skill: row.skill_routed as TechnicalSkill,
        guidelines: row.skill_guidelines_json ? JSON.parse(row.skill_guidelines_json) : []
      };
    } catch {
      return null;
    }
  }
}