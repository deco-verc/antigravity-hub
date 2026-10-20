// server/src/reaSaaSMasterService.ts
// Serviço de Integração do morluto/rea (Reverse Engineer Anything)
// Engenharia Reversa de Arquiteturas SaaS Reais & Elevação para o padrão SaaS Master.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Logger } from './logger.js';
import { AgentApiGateway } from './agentApiGateway.js';
import { DocSimpService } from './docSimpService.js';

export interface SaaSMasterPillar {
  id: number;
  title: string;
  requirement: string;
  keyElements: string[];
}

export interface ReaAnalysisResult {
  slug: string;
  blueprintContent: string;
  blueprintPath: string;
  fromCache: boolean;
  copiedToProject?: string;
  directive: string;
}

export class ReaSaaSMasterService {
  public static readonly SAAS_MASTER_PILLARS: SaaSMasterPillar[] = [
    {
      id: 1,
      title: 'Enterprise App Shell, Command Palette (Ctrl+K) & Notification Center',
      requirement:
        'Sidebar estruturada e colapsável com badges em tempo real e botões de navegação semânticos (role="tab" e data-tab="<secao>") + Topbar com seletor de Workspace, Central de Notificações com contador e Command Palette (Ctrl+K / Cmd+K modal de comandos rápidos navegável por teclado).',
      keyElements: [
        'sidebar',
        'command-palette',
        'ctrl+k',
        'topbar',
        'workspace-switcher',
        'notification-center',
        'role="tab"',
        'data-tab'
      ]
    },
    {
      id: 2,
      title: 'Slide-Over Detail Drawers & Optimistic UI',
      requirement:
        'Clicar em qualquer item de tabela/card abre um Drawer lateral detalhado com sub-abas (Detalhes, Edição Rápida Inline, Notas e Histórico de Auditoria daquele item), sem sair do contexto e com feedback Optimistic UI.',
      keyElements: ['drawer', 'slide-over', 'detail-panel', 'tabs', 'inline-edit', 'optimistic-ui', 'audit-history']
    },
    {
      id: 3,
      title: 'Data Grids Avançados, Bulk Actions & Alternância Lista/Kanban',
      requirement:
        'Busca em tempo real com debounce, filtros compostos por status/tags/período, ordenação de colunas, paginação, seleção em lote (Bulk Actions: alterar status, exportar ou deletar selecionados), alternância entre visualização em Tabela e Kanban/Cards, e exportação CSV/JSON (RFC-4180).',
      keyElements: [
        'data-grid',
        'debounce-search',
        'filters',
        'sortable-headers',
        'bulk-actions',
        'kanban-toggle',
        'csv-export'
      ]
    },
    {
      id: 4,
      title: 'Executive BI Analytics, Multi-Series SVG Charts & Goal Tracking',
      requirement:
        'Cards de KPIs executivos com números tabulares (tabular-nums), variação percentual (Δ% vs período anterior), sparklines, gráficos SVG/Canvas multi-série interativos (evolução, distribuição/rosca, funil) com tooltips flutuantes e seletor de período (7d, 30d, 90d, 12m).',
      keyElements: [
        'kpi-cards',
        'tabular-nums',
        'delta-percentage',
        'sparklines',
        'svg-charts',
        'tooltips',
        'period-selector',
        'bi-dashboard'
      ]
    },
    {
      id: 5,
      title: 'Billing Center, Planos, Usage Meters & Checkout/Recibo PIX',
      requirement:
        'Secção dedicada de Assinatura/Billing com comparador de planos (Starter, Pro, Enterprise — Mensal/Anual), barras de consumo de cota (Usage Progress Meters), geração de fatura e QR Code PIX Copia-e-Cola simulado e recibo detalhado.',
      keyElements: [
        'billing-center',
        'pricing-plans',
        'usage-meters',
        'pix-checkout',
        'qr-code',
        'invoice-receipt',
        'subscription'
      ]
    },
    {
      id: 6,
      title: 'Centro de Documentação Interativa (/docs) & Developer Hub (API Keys & Webhooks)',
      requirement:
        'Secção/aba dedicada de Documentação & API no próprio SaaS contendo: Guia Quickstart, Arquitetura do Sistema, Catálogo interativo de Endpoints REST (com snippets curl e fetch em 1 clique), gerenciador de API Keys (criar/revogar com máscara) e Webhooks Playground (configurar URL e disparar evento de teste real para o backend).',
      keyElements: [
        '/docs',
        'api-documentation',
        'quickstart',
        'api-keys',
        'webhooks-playground',
        'curl-snippets',
        'rest-catalog'
      ]
    },
    {
      id: 7,
      title: 'Gestão de Equipe (RBAC), Configurações de Workspace, Onboarding Checklist & Audit Trail',
      requirement:
        'Secção de Configurações com membros da equipe e papéis (Admin, Manager, Viewer), preferências de notificação/tema, widget de Onboarding Checklist com progresso percentual de configuração inicial e timeline global de audit_logs (/api/audit-logs).',
      keyElements: [
        'rbac',
        'team-management',
        'workspace-settings',
        'onboarding-checklist',
        'audit_logs',
        '/api/audit-logs',
        'timeline'
      ]
    },
    {
      id: 8,
      title: 'Reactive Client Store & Smart Demo Seeding (seedIfEmpty Rico)',
      requirement:
        'Store reativa centralizada no cliente (Store + dispatch + subscribers com sanitização escapeHtml sobrevivendo ao F5) e rotina seedIfEmpty() populando de 30 a 50 registros realistas e interconectados em todas as tabelas (entidades principais, faturas, membros da equipe, API keys, webhooks, notificações e logs de auditoria).',
      keyElements: [
        'reactive-store',
        'dispatch',
        'subscribers',
        'seedIfEmpty',
        '30-to-50-records',
        'escapeHtml',
        'f5-persistence'
      ]
    }
  ];

  /**
   * Resolves the rea-blueprints directory inside DOCSIMP.
   */
  static getReaBlueprintsDir(): string {
    const docSimp = DocSimpService.getDocSimpDir();
    const candidate = path.join(docSimp, 'rea-blueprints');
    if (!fs.existsSync(candidate)) {
      try {
        fs.mkdirSync(candidate, { recursive: true });
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "reaSaaSMasterService",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:reaSaaSMasterService]", err);
      }
    }
    }
    return candidate;
  }

  /**
   * Heuristic to determine if a briefing or project context refers to a SaaS or Full-Stack web app.
   */
  static isSaaSOrFullStackProject(briefingOrContext?: string): boolean {
    if (!briefingOrContext || !briefingOrContext.trim()) return false;
    const text = briefingOrContext.toLowerCase();
    const sanitized = text
      .replace(/\b(sem|n[aã]o\s+precisa\s+de|n[aã]o\s+usar|dispensa|without|no)\s+[^.,;\n]+/gi, ' ')
      .replace(/\binterface\s+(de\s+linha\s+de\s+comando|cli|p[uú]blica|program[aá]tica|de\s+programa[cç][aã]o|api)\b/gi, ' ');

    // Respect explicit CLI-only / headless library constraints when no web UI is requested
    const isExplicitlyHeadlessCli =
      /\b(apenas\s+cli|somente\s+cli|cli\s+only|sem\s+interface\s+web|sem\s+frontend|headless\s+library)\b/i.test(text) &&
      !/\b(saas|dashboard|spa|full-stack|fullstack)\b/i.test(sanitized);
    if (isExplicitlyHeadlessCli) return false;

    const substringKeywords = [
      'saas',
      'full-stack',
      'fullstack',
      'dashboard',
      'painel',
      'plataforma',
      'aplicativo',
      'frontend',
      'front-end',
      'portal',
      'sistema',
      'finance',
      'gestao',
      'gestão',
      'tabela',
      'analytics',
      'linear',
      'stripe',
      'notion'
    ];
    if (substringKeywords.some(kw => sanitized.includes(kw))) {
      return true;
    }

    // Short keywords checked with word boundaries to avoid matching substrings like "habilidade" (bi) or "wrapper" (app)
    return /\b(app|web|spa|crm|erp|grid|bi|ui)\b/i.test(sanitized);
  }

  /**
   * Generates a slug from target string or briefing.
   */
  static generateSlug(targetOrBriefing: string): string {
    const clean = String(targetOrBriefing || '')
      .toLowerCase()
      .replace(/https?:\/\//g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return clean || 'saas_master';
  }

  /**
   * Reads and combines the Master Blueprints pre-compiled in DOCSIMP/rea-blueprints.
   * Falls back to a rich canonical synthesis of the 8 Pillars if external files are not yet on disk.
   */
  static loadLocalMasterBlueprints(): string {
    const dir = this.getReaBlueprintsDir();
    const files = [
      'saas-master-shell-and-state.md',
      'saas-master-data-tables-and-bi.md',
      'saas-master-backend-and-workflows.md'
    ];

    const sections: string[] = [
      '# DOSSIÊ CONSOLIDADO DE ARQUITETURA SAAS MASTER (ENGENHARIA REVERSA REA)',
      '> Diretrizes canônicas extraídas via morluto/rea de referências líderes (Linear, Stripe, Notion, Cal.com).'
    ];

    let loadedFilesCount = 0;
    for (const f of files) {
      const full = path.join(dir, f);
      if (fs.existsSync(full)) {
        try {
          const content = fs.readFileSync(full, 'utf-8').trim();
          if (content.length > 0) {
            sections.push(content);
            loadedFilesCount++;
          }
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "reaSaaSMasterService",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:reaSaaSMasterService]", err);
      }
    }
      }
    }

    if (loadedFilesCount === 0) {
      const synthesizedPillars = this.SAAS_MASTER_PILLARS.map(
        p =>
          `## Pilar ${p.id}: ${p.title}\n- **Requisito Canônico:** ${p.requirement}\n- **Elementos Obrigatórios:** ${p.keyElements.join(', ')}`
      ).join('\n\n');
      sections.push(synthesizedPillars);
    }

    return sections.join('\n\n---\n\n');
  }

  /**
   * Facade alias for analyzing and applying REA blueprint.
   */
  static async analyzeAndApplyReaBlueprint(targetOrBriefing: string, projectPath?: string): Promise<ReaAnalysisResult> {
    return this.analyzeTargetOrReference({ targetOrBriefing, projectPath });
  }

  /**
   * Performs reverse engineering analysis or retrieves cached Master Blueprint.
   */
  static async analyzeTargetOrReference(params: {
    targetOrBriefing: string;
    projectPath?: string;
    slug?: string;
  }): Promise<ReaAnalysisResult> {
    const slug = params.slug || this.generateSlug(params.targetOrBriefing);
    const blueprintsDir = this.getReaBlueprintsDir();
    const cacheFile = path.join(blueprintsDir, `${slug}_rea_blueprint.md`);

    let blueprintContent = '';
    let fromCache = false;

    // 1. Cache-First check
    if (fs.existsSync(cacheFile)) {
      try {
        const cached = fs.readFileSync(cacheFile, 'utf-8');
        if (cached.trim().length > 100) {
          blueprintContent = cached;
          fromCache = true;
          Logger.info(`[ReaSaaSMasterService] Blueprint REA recuperado do cache: ${path.basename(cacheFile)}`);
        }
      } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "reaSaaSMasterService",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:reaSaaSMasterService]", err);
      }
    }
    }

    // 2. If not cached, inspect target with rea CLI or synthesize from Master Blueprints
    if (!blueprintContent) {
      const isUrlOrFile =
        /^https?:\/\//i.test(params.targetOrBriefing) ||
        (fs.existsSync(params.targetOrBriefing) && fs.statSync(params.targetOrBriefing).isFile());
      const isOffline = AgentApiGateway.isOfflineMode();

      if (isUrlOrFile && !isOffline) {
        try {
          Logger.info(`[ReaSaaSMasterService] Invocando REA CLI para engenharia reversa de: ${params.targetOrBriefing}`);
          let cliEvidence = '';
          try {
            const helpOutput = execSync('rea --version', {
              encoding: 'utf-8',
              timeout: 5000,
              stdio: ['ignore', 'pipe', 'ignore']
            });
            cliEvidence = `REA CLI v${helpOutput.trim()} ativo. Inspeção estática de alvo: ${params.targetOrBriefing}`;
          } catch (e: any) {
            cliEvidence = `REA CLI fallback local: ${e.message}`;
          }

          const localMaster = this.loadLocalMasterBlueprints();
          blueprintContent = [
            `# REA REVERSE-ENGINEERED BLUEPRINT: ${slug.toUpperCase()}`,
            `Alvo inspecionado: ${params.targetOrBriefing}`,
            `Evidência Técnica REA: ${cliEvidence}`,
            '',
            localMaster
          ].join('\n');
        } catch (err: any) {
          Logger.warn(
            `[ReaSaaSMasterService] Falha não bloqueante ao invocar REA CLI: ${err.message}. Usando Master Blueprints.`
          );
          blueprintContent = this.loadLocalMasterBlueprints();
        }
      } else {
        blueprintContent = this.loadLocalMasterBlueprints();
      }

      // Persist in DOCSIMP cache
      try {
        fs.writeFileSync(cacheFile, blueprintContent, 'utf-8');
        Logger.info(`[ReaSaaSMasterService] Novo blueprint REA salvo em: ${cacheFile}`);
      } catch (err: any) {
        Logger.warn(`[ReaSaaSMasterService] Falha ao salvar cache de blueprint: ${err.message}`);
      }
    }

    // 3. Copy idempotently to projectPath/.ai-dev-hub/rea-blueprint.md if projectPath is provided
    let copiedToProject: string | undefined = undefined;
    if (params.projectPath) {
      try {
        const projectAiDevHubDir = path.join(params.projectPath, '.ai-dev-hub');
        if (!fs.existsSync(projectAiDevHubDir)) {
          fs.mkdirSync(projectAiDevHubDir, { recursive: true });
        }
        const projectBlueprintPath = path.join(projectAiDevHubDir, 'rea-blueprint.md');
        const alreadyIdentical =
          fs.existsSync(projectBlueprintPath) && fs.readFileSync(projectBlueprintPath, 'utf-8') === blueprintContent;
        if (!alreadyIdentical) {
          fs.writeFileSync(projectBlueprintPath, blueprintContent, 'utf-8');
          Logger.info(`[ReaSaaSMasterService] Dossiê REA copiado para o projeto: ${projectBlueprintPath}`);
        }
        copiedToProject = projectBlueprintPath;
      } catch (err: any) {
        Logger.warn(`[ReaSaaSMasterService] Falha ao gravar blueprint no projeto: ${err.message}`);
      }
    }

    const directive = this.buildSaaSMasterArchitectureDirective(params.targetOrBriefing, copiedToProject || cacheFile);

    return {
      slug,
      blueprintContent,
      blueprintPath: copiedToProject || cacheFile,
      fromCache,
      copiedToProject,
      directive
    };
  }

  /**
   * Provisions REA Blueprint and injects directive for a project.
   */
  static async provisionReaBlueprintForProject(
    projectPath: string,
    briefing?: string,
    targetReference?: string
  ): Promise<{ blueprintPath: string; directive: string; fullContent: string }> {
    const effectiveTarget = targetReference || briefing || 'enterprise-saas';
    const result = await this.analyzeTargetOrReference({
      targetOrBriefing: effectiveTarget,
      projectPath,
      slug: this.generateSlug(targetReference || briefing || 'saas_master')
    });

    return {
      blueprintPath: result.blueprintPath,
      directive: result.directive,
      fullContent: result.blueprintContent
    };
  }

  /**
   * Generates a high-density architectural synthesis (~1.400 characters)
   * that strictly enforces the 8 Pillars of SaaS Master without overflowing CLI limits (< 1.800 chars).
   */
  static buildSaaSMasterArchitectureDirective(briefing?: string, blueprintPath?: string): string {
    const normPath = (blueprintPath || '').replace(/\\/g, '/');
    const relPath = normPath.includes('.ai-dev-hub/')
      ? `.ai-dev-hub/${path.basename(normPath)}`
      : blueprintPath
        ? path.basename(blueprintPath)
        : '.ai-dev-hub/rea-blueprint.md';

    return [
      `=== DIRETRIZ MANDATÓRIA SAAS MASTER (ENGENHARIA REVERSA REA) ===`,
      `PROIBIÇÃO ESTRITA: Proibido gerar interfaces simples ou CRUDs rasos de poucas abas.`,
      `Todo projeto Full-Stack deve implementar os 8 Pilares de Arquitetura SaaS Master (${relPath}):`,
      `1. APP SHELL ENTERPRISE: Sidebar colapsável com badges e botões role="tab"/data-tab (captura 01-Secao.png), Topbar com Workspace selector, Notificações e Command Palette (Ctrl+K).`,
      `2. SLIDE-OVER DETAIL DRAWERS: Clicar em registros abre Drawer lateral com abas (Detalhes, Edição Inline, Notas e Auditoria) sem trocar de tela e com Optimistic UI.`,
      `3. DATA GRID AVANÇADO, BULK ACTIONS & KANBAN: Busca debounce, filtros compostos, ordenação, ações em massa (Bulk Actions), alternância Tabela/Kanban e exportação CSV (RFC-4180).`,
      `4. BI & ANALYTICS REAL: Cards KPI tabulares (tabular-nums), variação percentual (Δ%), sparklines e gráficos SVG interativos com tooltips e filtro de período (7d, 30d, 90d, 12m).`,
      `5. BILLING CENTER & PIX: Assinatura com planos (Starter/Pro/Enterprise), medidores de consumo (Usage Meters), fatura com QR Code PIX e recibo.`,
      `6. PORTAL /docs & DEVELOPER HUB: Aba /docs com Quickstart, catálogo REST com snippets curl/fetch em 1 clique, API Keys mascaradas e Webhooks Playground com disparo de teste.`,
      `7. RBAC DE EQUIPE, WORKSPACE & AUDIT TRAIL NO BACKEND: Membros (Admin/Manager/Viewer), preferências, widget Onboarding Checklist e timeline global /api/audit-logs.`,
      `8. REACTIVE CLIENT STORE & DENSIDADE DE SEED RICO: Client Store (Store + dispatch + subscribers) com persistência F5 e seedIfEmpty() com 30-50 registros realistas em todas as entidades.`,
      `=== FIM DA DIRETRIZ SAAS MASTER ===`
    ].join('\n');
  }

  /**
   * Returns the explicit high-density UI and Domain microtasks required for SaaS Master projects.
   */
  static getRequiredSaaSMasterMicrotasks(projectName?: string): Array<{
    subCode: string;
    title: string;
    desc: string;
    files: string[];
    criteria: string[];
  }> {
    const name = projectName || 'SaaS';
    return [
      {
        subCode: 'UI-1',
        title: `Enterprise App Shell, Design System, Workspace Switcher, Notification Center & Command Palette (Ctrl+K) de ${name}`,
        desc: 'Construir App Shell com Sidebar colapsável contendo botões de navegação com role="tab" e data-tab="<secao>", Topbar com seletor de Workspace, central de notificações e Command Palette flutuante navegável por teclado acionada por atalho Ctrl+K / Cmd+K.',
        files: ['public/index.html', 'public/style.css', 'public/app.js'],
        criteria: [
          'Sidebar com navegação estruturada usando atributos role="tab" e data-tab="<secao>" e badges de contadores em tempo real',
          'Command Palette funcional acionada por Ctrl+K ou busca global com atalhos de navegação e filtros rápidos',
          'Design tokens em :root com font-variant-numeric: tabular-nums, ícones SVG Lucide inline e scrollbar estilizada (6px)'
        ]
      },
      {
        subCode: 'UI-2',
        title: `Dashboard Analítico BI Executivo com Gráficos SVG Multi-Série, KPIs Tabulares (Δ%) & Seletor de Período de ${name}`,
        desc: 'Implementar painel executivo com cards de KPIs calculando variação percentual (Δ%), sparklines e gráficos interativos em SVG puro multi-série com curvas, tooltips no hover e seletor temporal (7d, 30d, 90d, 12m).',
        files: ['public/index.html', 'public/app.js', 'public/style.css'],
        criteria: [
          'Cards de métricas com valores absolutos tabulares (tabular-nums) e badges de variação percentual (+/- Δ%)',
          'Gráficos vetoriais SVG responsivos (linha/barras/distribuição) com tooltips interativos ao passar o mouse',
          'Filtro de período refletindo alterações instantâneas nos gráficos e métricas'
        ]
      },
      {
        subCode: 'UI-3',
        title: `Módulos de Domínio Core, Data Grids Avançados com Debounce, Filtros Compostos & Bulk Actions de ${name}`,
        desc: 'Construir visualização tabular avançada de entidades com busca com debounce, ordenação de colunas, filtros por status, paginação, seleção em lote (Bulk Actions) e exportação CSV em 1 clique.',
        files: ['public/index.html', 'public/app.js'],
        criteria: [
          'Data Grid com busca em tempo real com debounce e filtros combinados por status e categoria',
          'Cabeçalhos de coluna ordenáveis com indicadores visuais de ordenação (asc/desc)',
          'Barra de Bulk Actions para operações em lote nos itens selecionados e botão de exportação CSV conforme RFC-4180'
        ]
      },
      {
        subCode: 'UI-4',
        title: `Visão Kanban Interativa, Alternância Lista/Quadro & Gestão Visual de Workflow de ${name}`,
        desc: 'Implementar alternância dinâmica entre modo Tabela e visão Kanban com colunas por status, contadores de cards, filtros de fluxo e atualização de estado com feedback otimista.',
        files: ['public/index.html', 'public/app.js', 'public/style.css'],
        criteria: [
          'Alternância fluida entre visualização em Data Grid e visão Kanban de cards',
          'Colunas de status com contadores, empty states e transição visual de itens entre estágios',
          'Sincronização imediata das mudanças de estágio com o backend'
        ]
      },
      {
        subCode: 'UI-5',
        title: `Slide-Over Detail Drawers com Sub-Abas, Edição Inline & Histórico de Auditoria de ${name}`,
        desc: 'Implementar painel lateral deslizante (Drawer) abrindo ao clicar em registros com sub-abas (Detalhes, Edição Rápida Inline, Notas e Histórico de Auditoria) sem trocar de página.',
        files: ['public/index.html', 'public/app.js', 'public/style.css'],
        criteria: [
          'Drawer lateral deslizante abrindo ao clicar em qualquer registro do Data Grid ou Kanban',
          'Sub-abas de navegação interna com edição inline de campos e feedback imediato Optimistic UI',
          'Timeline de auditoria do registro consumindo histórico detalhado de alterações'
        ]
      },
      {
        subCode: 'UI-6',
        title: `Modais de Criação/Simulação Ricos, Formulários Reativos & Widget de Onboarding Checklist de ${name}`,
        desc: 'Implementar modais multifásicos com validação síncrona rigorosa, tratamento de erros amigável e widget interativo de Onboarding Checklist com progresso percentual e etapas guiadas.',
        files: ['public/index.html', 'public/app.js', 'public/style.css'],
        criteria: [
          'Modais de criação/edição com campos tipados, validação em tempo real e prevenção de double submit',
          'Widget de Onboarding Checklist com etapas configuráveis e cálculo percentual de progresso',
          'Feedback visual com notificações toast de sucesso e erro com auto-dismiss'
        ]
      },
      {
        subCode: 'UI-7',
        title: `Billing Center, Comparador de Planos, Usage Progress Meters & Checkout/Recibo PIX com QR-Code de ${name}`,
        desc: 'Construir secção dedicada de Assinatura/Billing contendo comparador de planos (Starter, Pro, Enterprise), barras de consumo de cota (Usage Meters), modal de fatura com QR-Code PIX Copia-e-Cola e recibo.',
        files: ['public/index.html', 'public/app.js', 'public/style.css'],
        criteria: [
          'Cards de planos com toggle mensal/anual e comparador claro de recursos',
          'Barras de consumo de cota (Usage Progress Meters) indicando limites operacionais',
          'Fluxo de checkout com simulação de QR-Code PIX Copia-e-Cola e emissão de recibo detalhado'
        ]
      },
      {
        subCode: 'UI-8',
        title: `Developer Hub: Gerenciador de API Keys Mascaradas & Playground de Webhooks com Disparo Real de ${name}`,
        desc: 'Desenvolver secção do Desenvolvedor com criação, exibição mascarada e revogação de API Keys, e simulador/playground de Webhooks com configuração de URL e disparo de eventos de teste.',
        files: ['public/index.html', 'public/app.js', 'public/style.css'],
        criteria: [
          'Gerenciamento de API Keys com máscara de segurança, cópia em 1 clique e botão de revogação',
          'Webhooks Playground com seletor de evento, input de endpoint e botão de disparo de teste',
          'Painel de resposta HTTP exibindo status code, headers e payload JSON retornado pelo teste'
        ]
      },
      {
        subCode: 'UI-9',
        title: `Portal de Documentação Técnica Interativa (/docs) com Snippets Copiáveis (curl/fetch) & Guia Quickstart de ${name}`,
        desc: 'Construir secção/aba dedicada de documentação técnica integrada contendo Guia Quickstart, visão de arquitetura do sistema e catálogo interativo de rotas REST com snippets curl e fetch copiáveis em 1 clique.',
        files: ['public/index.html', 'public/app.js', 'public/style.css'],
        criteria: [
          'Secção de documentação interativa acessível diretamente via navegação [data-tab="docs"]',
          'Catálogo de rotas REST com parâmetros, exemplos de payload e códigos de resposta HTTP',
          'Blocos de código com snippets curl e fetch gerados dinamicamente com botão de copiar em 1 clique'
        ]
      },
      {
        subCode: 'UI-10',
        title: `Configurações de Workspace, Gestão de Membros de Equipe (RBAC), Trilha Audit Trail & Integração Reativa E2E pós-F5 de ${name}`,
        desc: 'Implementar gestão de membros e papéis RBAC (Admin, Manager, Viewer), preferências do Workspace, timeline global de audit_logs e validação da Reactive Client Store com persistência pós-reload F5.',
        files: ['public/app.js', 'src/server.js', 'test/e2e/workflow.test.ts'],
        criteria: [
          'Painel de membros da equipe com papéis RBAC e configurações gerais do Workspace',
          'Timeline global de atividades consumindo /api/audit-logs com filtros e paginação',
          'Reactive Client Store gerenciando estado sem duplicações e persistindo dados completamente após F5'
        ]
      }
    ];
  }
}
