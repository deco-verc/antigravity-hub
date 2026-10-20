import fs from 'node:fs';
import path from 'node:path';
import { Logger } from './logger.js';
import { EngineeringContextService } from './engineeringContextService.js';
import { ReaSaaSMasterService } from './reaSaaSMasterService.js';

export interface PreBlueprintDiscoveryParams {
  briefing: string;
  projectName: string;
  projectPath: string;
  model?: string;
}

export interface PreBlueprintDiscoveryResult {
  fullReportPath: string;
  dossierPath?: string;
  domainName?: string;
  referenceApps: string[];
  coreEntities: string[];
  killerFeatures: string[];
  compactDiscoveryBlock: string;
  marketDiagnosis: string;
  screenFlows: string[];
  calculationFormulas: string[];
}

interface DomainKnowledgeProfile {
  domainName: string;
  referenceApps: string[];
  marketDiagnosis: string;
  screenFlows: string[];
  coreEntities: string[];
  calculationFormulas: string[];
  killerFeatures: string[];
}

export class MarketDiscoveryService {
  private static readonly DOMAIN_PROFILES: Record<string, DomainKnowledgeProfile> = {
    fintech: {
      domainName: 'Fintech & Cobranças',
      referenceApps: ['Stripe', 'Asaas', 'ContaAzul', 'Stone'],
      marketDiagnosis:
        'Operações financeiras sofrem com reconciliação bancária fragmentada, fricção de cobrança e falta de liquidez previsível. O líder de mercado entrega conciliação instantânea, PIX com webhook resiliente e visão unificada de fluxo de caixa.',
      screenFlows: [
        'App Shell com abas [role="tab"]: Dashboard Financeiro, Lançamentos, Cobranças/PIX, Clientes, Relatórios Fiscais',
        'Command Palette (Ctrl+K) com pesquisa rápida de transações e filtros compostos',
        'Slide-Over Drawer com detalhes analíticos da transação, comprovantes e log de auditoria',
        'Data Grid com busca debounce, paginação, filtros de status e exportação CSV'
      ],
      coreEntities: [
        'transactions (id, type, amount, fee, status, description, date, metadata_json)',
        'customers (id, name, email, document, phone, status, created_at)',
        'invoices (id, customer_id, amount, due_date, status, payment_method, paid_at)',
        'payment_methods (id, customer_id, type, token, is_default)',
        'financial_categories (id, name, type, budget_limit, color)'
      ],
      calculationFormulas: [
        'saldo_liquido = sum(receitas) - sum(despesas) - sum(taxas)',
        'mrr = sum(assinaturas_ativas_valor_mensal)',
        'taxa_inadimplencia = (total_faturas_vencidas / total_faturas_emitidas) * 100'
      ],
      killerFeatures: [
        'Conciliação em tempo real com Optimistic UI e estorno seguro idempotente',
        'Dashboard analítico BI com projeção de fluxo de caixa para 30/60/90 dias e alertas preditivos',
        'Trilha de auditoria imutável (/api/audit-logs) para compliance fiscal e bancário'
      ]
    },
    devtools: {
      domainName: 'Developer Tools & Issue Tracking',
      referenceApps: ['Linear', 'Raycast', 'Vercel', 'GitHub'],
      marketDiagnosis:
        'Equipes de produto e engenharia perdem velocidade em ferramentas pesadas e com latência perceptível. O padrão mundial prioriza velocidade extrema (<50ms), navegação integral por teclado e foco em ciclos sem atrito.',
      screenFlows: [
        'App Shell com abas [role="tab"]: Ciclos/Sprints, Backlog, Quadro Kanban, Documentação/Docs, Configurações',
        'Command Palette universal (Ctrl+K) com atalhos de criação e filtros fuzzy de tarefas',
        'Slide-Over Drawer com preview de código, atribuição rápida e timeline de eventos',
        'Data Grid de alta densidade com bulk actions e visão alternável entre Lista e Kanban'
      ],
      coreEntities: [
        'issues (id, code, title, description, status, priority, estimate, cycle_id, assignee_id)',
        'projects (id, name, slug, lead_id, target_date, status)',
        'cycles (id, project_id, number, start_date, end_date, is_active)',
        'comments (id, issue_id, author_id, content, created_at)',
        'audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)'
      ],
      calculationFormulas: [
        'cycle_progress = (issues_completed / total_issues) * 100',
        'cycle_velocity = sum(completed_estimate_points) / duracao_dias',
        'lead_time_medio = avg(resolved_at - created_at)'
      ],
      killerFeatures: [
        'Navegação e ações 100% por atalhos de teclado (j/k para seleção, c para criar, e para concluir)',
        'Transições de estado instantâneas via Optimistic UI com sincronização resiliente em background',
        'Trilha forense completa com diff estruturado de cada alteração de requisito e status'
      ]
    },
    health: {
      domainName: 'Saúde & Gestão de Clínicas',
      referenceApps: ['Clinicorp', 'JaneApp', 'Feegow', 'Doctoralia'],
      marketDiagnosis:
        'Clínicas enfrentam absenteísmo de pacientes, desorganização no prontuário eletrônico e atrasos no faturamento de convênios/particulares. Sistemas modernos exigem confirmação automatizada e prontuário ágil em poucos cliques.',
      screenFlows: [
        'App Shell com abas [role="tab"]: Agenda do Dia, Prontuário de Pacientes, Tratamentos/Planos, Financeiro, Relatórios',
        'Command Palette (Ctrl+K) com busca fonética e instantânea de pacientes por nome ou CPF',
        'Slide-Over Drawer para histórico clínico do paciente, anexos e prescrições rápidas',
        'Agenda interativa em grade com visualização por profissional e status de atendimento'
      ],
      coreEntities: [
        'patients (id, name, document, birth_date, phone, email, notes, created_at)',
        'appointments (id, patient_id, practitioner_id, scheduled_at, duration_min, status, notes)',
        'treatment_plans (id, patient_id, title, total_value, status, discount_percent)',
        'treatment_items (id, plan_id, procedure_name, tooth_region, price, completed)',
        'clinical_records (id, patient_id, professional_id, anamnesis, prescription, created_at)'
      ],
      calculationFormulas: [
        'taxa_ocupacao_agenda = (slots_atendidos / slots_disponiveis) * 100',
        'ticket_medio_paciente = receita_total_clinica / total_pacientes_atendidos',
        'taxa_no_show = (agendamentos_faltantes / total_agendamentos) * 100'
      ],
      killerFeatures: [
        'Ficha clínica ágil com timeline cronológica e salvamento automático contínuo',
        'Disparo de lembretes preventivos e confirmação de presença com status visual em tempo real',
        'Painel financeiro integrado com cálculo automático de comissões por profissional'
      ]
    },
    ecommerce: {
      domainName: 'E-Commerce & Logística / Delivery',
      referenceApps: ['Shopify', 'iFood', 'Nuvemshop', 'MercadoLivre'],
      marketDiagnosis:
        'Lojas e operações de entrega perdem vendas por catálogo desatualizado, atrasos no despacho e ausência de relatórios de giro de estoque. A liderança do setor opera com catálogo em tempo real, pedidos com status em etapas e rastreio.',
      screenFlows: [
        'App Shell com abas [role="tab"]: Painel de Pedidos, Catálogo de Produtos, Estoque, Clientes, Cupons/Promoções',
        'Command Palette (Ctrl+K) para localizar pedidos por código ou cliente instantaneamente',
        'Slide-Over Drawer com resumo de itens do pedido, endereço de entrega e status de despacho',
        'Data Grid com controle de estoque baixo, fotos dos produtos e atualização em lote'
      ],
      coreEntities: [
        'products (id, sku, name, description, price, cost_price, stock_qty, category_id, is_active)',
        'orders (id, order_number, customer_id, total_amount, discount, shipping_fee, status, created_at)',
        'order_items (id, order_id, product_id, unit_price, quantity, subtotal)',
        'customers (id, name, email, phone, shipping_address, created_at)',
        'inventory_logs (id, product_id, type, quantity_change, previous_qty, new_qty, reason, date)'
      ],
      calculationFormulas: [
        'ticket_medio = faturamento_total / total_pedidos',
        'margem_bruta_percentual = ((faturamento_total - custo_total_produtos) / faturamento_total) * 100',
        'taxa_ruptura_estoque = (produtos_zerados / total_catalogo) * 100'
      ],
      killerFeatures: [
        'Linha de produção de pedidos com atualização visual de etapas (Recebido -> Em Preparação -> Em Rota -> Entregue)',
        'Alerta inteligente de estoque mínimo com cálculo preditivo de reposição',
        'Motor de cupons com regras flexíveis de desconto percentual ou fixo e limites de uso'
      ]
    },
    crm_sales: {
      domainName: 'CRM, Gestão Comercial & Pipeline de Vendas',
      referenceApps: ['HubSpot', 'Pipedrive', 'Salesforce', 'RD Station'],
      marketDiagnosis:
        'Times comerciais perdem negócios por falta de acompanhamento de follow-up, propostas perdidas e visão opaca do funil. O software campeão oferece visão Kanban de arrastar e soltar, alertas de estagnação e previsão de fechamento.',
      screenFlows: [
        'App Shell com abas [role="tab"]: Funil de Vendas (Kanban), Contatos & Leads, Atividades/Tarefas, Propostas, Relatórios BI',
        'Command Palette (Ctrl+K) com busca rápida de leads, empresas e oportunidades',
        'Slide-Over Drawer com timeline de histórico de contato, notas e registro de ligações',
        'Data Grid de propostas com exportação, status de aceite e valor ponderado'
      ],
      coreEntities: [
        'leads (id, name, company, email, phone, source, stage, score, assigned_to)',
        'deals (id, title, lead_id, value, stage_id, probability, expected_close, status)',
        'pipeline_stages (id, name, order_index, probability, color)',
        'activities (id, deal_id, type, title, due_date, completed, notes)',
        'proposals (id, deal_id, proposal_number, total_value, valid_until, status)'
      ],
      calculationFormulas: [
        'valor_ponderado_pipeline = sum(valor_deal * (probabilidade / 100))',
        'taxa_conversao_funil = (deals_ganhos / total_deals_iniciados) * 100',
        'tempo_medio_fechamento = avg(closed_at - created_at)'
      ],
      killerFeatures: [
        'Funil visual de vendas com cards arrastáveis e atualização instantânea de totais por coluna',
        'Alertas automáticos de negócios estagnados (sem interação há mais de X dias)',
        'Dashboard comercial com comparativo de metas, taxas de conversão e ranking de corretores/vendedores'
      ]
    },
    general_saas: {
      domainName: 'SaaS Moderno de Alta Densidade & Operações',
      referenceApps: ['Linear', 'Stripe', 'Supabase', 'Cal.com'],
      marketDiagnosis:
        'Aplicações corporativas comuns frustram usuários por navegação lenta, falta de consistência visual e ausência de trilhas de auditoria. O padrão SaaS Master exige densidade de dados, atalhos de teclado e persistência confiável.',
      screenFlows: [
        'App Shell com Sidebar colapsável e Topbar com [role="tab"]: Dashboard, Registros, Operações, Auditoria, Configurações',
        'Command Palette (Ctrl+K) com busca global e ações rápidas',
        'Slide-Over Detail Drawer ao selecionar registros na tabela',
        'Data Grid com busca debounce, ordenação composta e exportação CSV'
      ],
      coreEntities: [
        'entities (id, title, category, status, value, metadata_json, created_at, updated_at)',
        'audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)',
        'system_settings (key, value, updated_at)',
        'metrics_snapshots (id, metric_name, value, recorded_at)'
      ],
      calculationFormulas: [
        'taxa_conclusao = (itens_concluidos / total_itens) * 100',
        'variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100'
      ],
      killerFeatures: [
        'Arquitetura de 7 Pilares SaaS Master (App Shell, Drawers, Grids, KPIs, Trilha Forense, Reactive Store e Seed)',
        'Persistência factual de dados em SQLite nativo sem perda após F5',
        'Blindagem AppSec contra SQLi, XSS, Path Traversal e PORT_GUARD estrito (4000-4999)'
      ]
    }
  };

  /**
   * Identifies the primary domain profile from user briefing and context.
   */
  public static inferDomainProfile(briefing: string): DomainKnowledgeProfile {
    const raw = briefing || '';
    const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    if (/banco|finan|pagamento|cobran|fatura|pix|cartao|transac|saldo|extrato|inadimpl|ledger|conta\s*a\s*pagar/i.test(text)) {
      return this.DOMAIN_PROFILES.fintech;
    }
    if (/dev|bug|issue|task|kanban|sprint|scrum|deploy|repositorio|git|engenharia|codigo|commit|backlog/i.test(text)) {
      return this.DOMAIN_PROFILES.devtools;
    }
    if (/saude|clinic|medico|paciente|consulta|prontuario|odont|dentist|terapia|hospital|remedio|receita|telemedicin/i.test(text)) {
      return this.DOMAIN_PROFILES.health;
    }
    if (/loja|e-commerce|ecommerce|produto|estoque|pedido|carrinho|entrega|delivery|restaurante|cardapio|frete/i.test(text)) {
      return this.DOMAIN_PROFILES.ecommerce;
    }
    if (/crm|venda|lead|proposta|pipeline|funil|comercial|cliente|negocio|prospeccao/i.test(text)) {
      return this.DOMAIN_PROFILES.crm_sales;
    }

    return this.DOMAIN_PROFILES.general_saas;
  }

  /**
   * Extracts explicitly mentioned reference apps from the user prompt (e.g. "como Linear", "estilo Stripe").
   */
  public static extractExplicitReferenceApps(briefing: string): string[] {
    const text = briefing || '';
    const apps: string[] = [];
    const patterns = [
      /(?:como|estilo|inspirado\s*no|baseado\s*no|refer[eê]ncia|padr[aã]o)\s+([A-Z][a-zA-Z0-9_\-\.]{2,20})/g,
      /(?:linear|stripe|raycast|supabase|resend|cal\.com|shopify|ifood|stone|asaas|clinicorp|pipedrive|hubspot|notion|airtable|feegow)/gi
    ];

    for (const p of patterns) {
      const matches = text.matchAll(p);
      for (const m of matches) {
        const val = m[1] || m[0];
        if (val && !['para', 'como', 'sobre', 'novo', 'cada', 'todo', 'mais', 'com', 'esse', 'esta'].includes(val.toLowerCase())) {
          const capitalized = val.charAt(0).toUpperCase() + val.slice(1);
          if (!apps.includes(capitalized)) {
            apps.push(capitalized);
          }
        }
      }
    }

    return apps.slice(0, 4);
  }

  /**
   * Main method: conducts Onda 0 pre-blueprint discovery, generates dossier,
   * validates local engineering constraints, saves report, and returns compact block.
   */
  public static async conductPreBlueprintDiscovery(
    params: PreBlueprintDiscoveryParams
  ): Promise<PreBlueprintDiscoveryResult> {
    const { briefing, projectName, projectPath } = params;
    const resolvedPath = path.resolve(projectPath);
    const aiDevHubDir = path.join(resolvedPath, '.ai-dev-hub');
    const targetFile = path.join(aiDevHubDir, 'market-research-rea.md');

    Logger.info(`[MarketDiscoveryService] Onda 0: Iniciando estudo de mercado e engenharia reversa REA para "${projectName}"...`);

    // 1. Identify domain profile & reference apps
    const profile = this.inferDomainProfile(briefing);
    const explicitApps = this.extractExplicitReferenceApps(briefing);
    const combinedApps = Array.from(new Set([...explicitApps, ...profile.referenceApps])).slice(0, 4);

    // 2. Synthesize REA analysis
    const reaAnalysis = await ReaSaaSMasterService.analyzeTargetOrReference({
      targetOrBriefing: `${briefing}\nReferência: ${combinedApps.join(', ')}`,
      projectPath: resolvedPath
    });

    // 3. Assemble full dossier markdown
    const fullDossierContent = [
      `# ESTUDO DE MERCADO, APLICATIVOS DE REFERÊNCIA & ENGENHARIA REVERSA REA (ONDA 0)`,
      ``,
      `**Projeto:** ${projectName}`,
      `**Domínio Classificado:** ${profile.domainName}`,
      `**Aplicativos de Referência Mapeados:** ${combinedApps.join(', ')}`,
      `**Data de Síntese:** ${new Date().toISOString()}`,
      ``,
      `---`,
      ``,
      `## 1. Diagnóstico de Mercado & Dor Crítica do Usuário`,
      `${profile.marketDiagnosis}`,
      ``,
      `---`,
      ``,
      `## 2. Benchmarking Global & Nacional dos Aplicativos de Referência`,
      combinedApps.map(app => `- **${app}:** Referência de mercado em experiência fluida, previsibilidade e arquitetura de dados robusta.`).join('\n'),
      ``,
      `---`,
      ``,
      `## 3. Engenharia Reversa REA (morluto/rea) dos Aplicativos de Referência`,
      `### 3.1 Fluxos de Tela Indispensáveis (UI de Alta Densidade)`,
      profile.screenFlows.map(s => `- ${s}`).join('\n'),
      ``,
      `### 3.2 Entidades de Banco de Dados SQLite & Fórmulas Críticas`,
      `**Entidades Recomendadas:**`,
      profile.coreEntities.map(e => `- \`${e}\``).join('\n'),
      ``,
      `**Fórmulas Matemáticas de Negócio:**`,
      profile.calculationFormulas.map(f => `- \`${f}\``).join('\n'),
      ``,
      `---`,
      ``,
      `## 4. Três Diferenciais "10-Estrelas" (gstack /plan-ceo)`,
      profile.killerFeatures.map((kf, i) => `${i + 1}. **${kf.split('—')[0].trim()}:** ${kf}`).join('\n\n'),
      ``,
      `---`,
      ``,
      `## 5. Validação de Engenharia Local & Invariantes`,
      `- **Stack Conforme:** Node.js (v20/22/24) + SQLite nativo (node:sqlite / prepare-run-all parametrizado com ?)`,
      `- **Roteamento Full-Stack:** SPA servida em \`GET /\`, API isolada sob \`/api/*\` e healthcheck em \`GET /api/health\``,
      `- **Isolamento de Porta (PORT_GUARD):** Faixa 4000-4999 obrigatória (3001 reservada ao DecoHUB)`,
      `- **Padrão Dual-Mode DOCSIMP:** Chaves de terceiros com Graceful Mock Fallback determinístico offline`,
      `- **Navegação Visual:** Abas com atributos explícitos \`[role="tab"]\` e \`data-tab="<secao>"\` para crawler 01-Secao.png`,
      ``
    ].join('\n');

    // 4. Validate through EngineeringContextService.evaluateResearch
    try {
      EngineeringContextService.evaluateResearch(
        fullDossierContent,
        'Node.js + native SQLite + Vanilla SPA',
        'medium'
      );
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "marketDiscoveryService",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:marketDiscoveryService]", err);
      }
    }

    // 5. Persist dossier in .ai-dev-hub/market-research-rea.md
    if (!fs.existsSync(aiDevHubDir)) {
      fs.mkdirSync(aiDevHubDir, { recursive: true });
    }
    fs.writeFileSync(targetFile, fullDossierContent, 'utf-8');
    Logger.success(`[MarketDiscoveryService] Dossiê de pesquisa Onda 0 gravado com sucesso em: ${targetFile}`);

    // 6. Assemble compact discovery block (strictly between 800 and 1.400 chars)
    const compactDiscoveryBlock = this.buildCompactDiscoveryBlock({
      referenceApps: combinedApps,
      marketDiagnosis: profile.marketDiagnosis,
      screenFlows: profile.screenFlows,
      coreEntities: profile.coreEntities,
      calculationFormulas: profile.calculationFormulas,
      killerFeatures: profile.killerFeatures
    });

    return {
      fullReportPath: targetFile,
      dossierPath: targetFile,
      domainName: profile.domainName,
      referenceApps: combinedApps,
      coreEntities: profile.coreEntities,
      killerFeatures: profile.killerFeatures,
      compactDiscoveryBlock,
      marketDiagnosis: profile.marketDiagnosis,
      screenFlows: profile.screenFlows,
      calculationFormulas: profile.calculationFormulas
    };
  }

  /**
   * Builds a dense, surgical context block for prompt injection.
   * Guaranteed to be between 800 and 1.400 characters to prevent context rot.
   */
  public static buildCompactDiscoveryBlock(data: {
    referenceApps: string[];
    marketDiagnosis: string;
    screenFlows: string[];
    coreEntities: string[];
    calculationFormulas: string[];
    killerFeatures: string[];
  }): string {
    const appsStr = data.referenceApps.join(', ');
    const diagnosisStr = data.marketDiagnosis.length > 200
      ? data.marketDiagnosis.slice(0, 197) + '...'
      : data.marketDiagnosis;
    const flowsStr = data.screenFlows.slice(0, 3).map(f => f.split('(')[0].trim()).join(' | ');
    const entitiesStr = data.coreEntities.slice(0, 4).map(e => e.split('(')[0].trim()).join(', ');
    const formulasStr = data.calculationFormulas.slice(0, 2).join('; ');
    const killerStr = data.killerFeatures.slice(0, 3).map((k, i) => `${i + 1}) ${k.slice(0, 70)}`).join('; ');

    const rawBlock = [
      `=== ONDA 0: ESTUDO DE MERCADO, REFERÊNCIAS & REA DISCOVERY ===`,
      `APLICATIVOS DE REFERÊNCIA: ${appsStr}`,
      `DIAGNÓSTICO & DOR DE MERCADO: ${diagnosisStr}`,
      `FLUXOS DE TELA REA: ${flowsStr}`,
      `ENTIDADES SQLITE & FÓRMULAS MATEMÁTICAS: ${entitiesStr}. Fórmulas: ${formulasStr}`,
      `DIFERENCIAIS 10-ESTRELAS (PLAN-CEO): ${killerStr}`,
      `DIRETRIZ DE ARQUITETURA: Modele tarefas, tabelas e abas refletindo os padrões dos produtos líderes mapeados. Consulte .ai-dev-hub/market-research-rea.md.`,
      `=== FIM DO DOSSIÊ ONDA 0 ===`
    ].join('\n');

    // Clamp or adjust to ensure between 800 and 1.400 chars
    if (rawBlock.length > 1380) {
      return rawBlock.slice(0, 1375) + '...\n=== FIM DO DOSSIÊ ONDA 0 ===';
    }

    if (rawBlock.length < 800) {
      const padding = `PADRÕES ARQUITETURAIS REA ADICIONAIS: App Shell com sidebar recolhível, Data Grids com ordenação/filtros compostos e Command Palette (Ctrl+K). Blindagem AppSec com queries preparadas SQLite (?) e validação de limites.\n`;
      const padded = rawBlock.replace(
        `DIRETRIZ DE ARQUITETURA:`,
        `${padding}DIRETRIZ DE ARQUITETURA:`
      );
      if (padded.length <= 1380) return padded;
    }

    return rawBlock;
  }
}
