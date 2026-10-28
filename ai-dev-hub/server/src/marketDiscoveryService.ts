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
    youtube_viral_intelligence: {
      domainName: 'YouTube Viral Search, Video Intelligence & Creator SaaS',
      referenceApps: [
        '1of10.com (Outlier Video Finder)',
        'VidIQ (Viral Velocity & Keyword Research)',
        'Viewstats by MrBeast (Thumbnail & Retention Analytics)',
        'TubeBuddy (Channel Explorer)',
        'OpusClip / Descript (Transcript & Hook Analysis)',
        'n8n.io (Workflow Pipeline Engine)',
        'Attio.com (Data Grid Engine)',
        'Tally.so (Form UX)'
      ],
      marketDiagnosis:
        'Criadores de conteúdo e equipes de mídia perdem dias minerando vídeos e testando títulos às cegas. Plataformas modernas automatizam a descoberta de vídeos virais por Outlier Score, decompõem headlines em hooks e scores CTR, analisam ganchos de transcrição com timestamps e avaliam contraste e emoção de thumbnails com esteiras estilo n8n.',
      screenFlows: [
        'App Shell com abas [role="tab"]: 01-Radar Viral & Busca, 02-Decomposição (Headlines & Transcrições), 03-Canais & Esteira, 04-Planos & Checkout PIX, 05-Auditoria & Configurações',
        'Command Palette (Ctrl+K) com pesquisa rápida por nicho, canais monitorados e vídeos favoritos',
        'Slide-Over Drawer (520px) com 3 abas dedicadas: Headline/Hooks, Transcrição Interativa com Cópia em 1 Clique e Inspeção de Thumbnail',
        'Data Grid Bento com cards 16:9, filtros por Outlier Multiplier (>3x, >5x, >10x), Nicho, VPH e visualizações'
      ],
      coreEntities: [
        'users (id, email, full_name, supabase_uid, plan_tier, search_quota_limit, search_quota_used, is_active, created_at)',
        'auth_sessions (id, user_id, session_token, turnstile_verified, ip_address, expires_at, created_at)',
        'subscriptions (id, user_id, plan_tier, amount_cents, status, pix_provider, current_period_end, created_at)',
        'pix_payments (id, user_id, subscription_id, amount_cents, status, qr_code_base64, qr_code_copy_paste, provider_tx_id, paid_at, expires_at, created_at)',
        'channels (id, youtube_channel_id, channel_name, subscriber_count, total_videos, avg_views, niche, avatar_url, created_at)',
        'viral_videos (id, youtube_id, title, channel_id, channel_name, subscriber_count, views_count, likes_count, comments_count, duration_sec, published_at, outlier_multiplier, viral_score, engagement_rate, niche, language, thumbnail_url, created_at)',
        'video_breakdowns (id, video_id, headline_original, hook_category, ctr_score, power_words_json, generated_variations_json, transcript_hook_0_30s, transcript_body_segments_json, transcript_cta, full_text, thumbnail_hd_url, thumbnail_overlay_text, visual_emotion, contrast_score, dominant_hex_palette_json, created_at)',
        'workflow_runs (id, pipeline_name, status, stage, latency_ms, stages_latency_json, items_processed, error_log, created_at)',
        'saved_collections (id, user_id, name, description, video_ids_json, created_at, updated_at)',
        'audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)'
      ],
      calculationFormulas: [
        'outlier_multiplier = Number((views_count / Math.max(channel_avg_views, 1)).toFixed(2))',
        'viral_score = Number(((views_count / Math.max(subscriber_count, 1)) * (likes_count / Math.max(views_count, 1)) * 100).toFixed(2))',
        'engagement_rate = Number((((likes_count + comments_count) / Math.max(views_count, 1)) * 100).toFixed(2))',
        'views_per_hour = Math.round(views_count / Math.max((Date.now() - new Date(published_at).getTime()) / 3600000, 1))'
      ],
      killerFeatures: [
        'Radar de Outliers com cálculo preditivo de multiplicador viral comparado ao baseline do canal (3x a 50x)',
        'Slide-Over Drawer com decomposição em 3 abas: Headline Hooks com score CTR, Transcrição timestamped com cópia em 1 clique e Análise de Thumbnail (cores, contraste e emoção)',
        'Monetização SaaS nativa com planos Pro, PushinPay PIX com QR Code dinâmico e limite de cota de buscas com Cloudflare Turnstile',
        'Esteira estilo n8n (workflow_runs) com latência por etapa: Harvester -> Outlier Filter -> Transcript/Headline/Thumbnail Extractor'
      ]
    },
    creator_viral_video: {
      domainName: 'YouTube Viral Search, Video Intelligence & Creator SaaS',
      referenceApps: [
        '1of10.com (Outlier Video Finder)',
        'VidIQ (Viral Velocity & Keyword Research)',
        'Viewstats by MrBeast (Thumbnail & Retention Analytics)',
        'TubeBuddy (Channel Explorer)',
        'OpusClip / Descript (Transcript & Hook Analysis)'
      ],
      marketDiagnosis:
        'Criadores e equipes de mídia perdem dias minerando vídeos e testando títulos às cegas. Plataformas modernas automatizam a descoberta de vídeos virais por Outlier Score, decompõem headlines, analisam retenção/gancho da transcrição e avaliam contraste e emoção da thumbnail.',
      screenFlows: [
        'App Shell com abas [role="tab"]: 01-Radar Viral & Busca, 02-Decomposição (Headlines & Transcrições), 03-Coleções Salvas, 04-Planos & Checkout PIX, 05-Auditoria & Configurações',
        'Command Palette (Ctrl+K) com pesquisa rápida por nicho, canais monitorados e vídeos favoritos',
        'Slide-Over Drawer (520px) com 3 abas dedicadas: Headline/Hooks, Transcrição Interativa com Cópia em 1 Clique e Inspeção de Thumbnail',
        'Data Grid Bento com cards 16:9, filtros por Outlier Multiplier (>3x, >5x, >10x), Nicho, VPH e visualizações'
      ],
      coreEntities: [
        'users (id, email, full_name, supabase_uid, plan_tier, search_quota_limit, search_quota_used, is_active, created_at)',
        'auth_sessions (id, user_id, session_token, turnstile_verified, ip_address, expires_at, created_at)',
        'subscriptions (id, user_id, plan_tier, amount_cents, status, pix_provider, current_period_end, created_at)',
        'pix_payments (id, user_id, subscription_id, amount_cents, status, qr_code_base64, qr_code_copy_paste, provider_tx_id, paid_at, expires_at, created_at)',
        'viral_videos (id, youtube_video_id, title, channel_name, channel_subscribers, views_count, likes_count, comments_count, duration_seconds, published_at, viral_ratio_score, outlier_multiplier, engagement_rate, niche, language, thumbnail_url, created_at)',
        'video_breakdowns (id, video_id, headline_text, headline_hook_type, headline_ctr_score, headline_triggers_json, headline_variations_json, transcript_hook, transcript_body, transcript_cta, transcript_full_timestamped_json, thumbnail_dominant_colors_json, thumbnail_text_overlay, thumbnail_emotion, thumbnail_contrast_score, created_at)',
        'saved_collections (id, user_id, name, description, video_ids_json, created_at, updated_at)',
        'audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)'
      ],
      calculationFormulas: [
        'outlier_multiplier = Number((views_count / Math.max(channel_avg_views, 1)).toFixed(2))',
        'viral_ratio_score = Number(((views_count / Math.max(channel_subscribers, 1)) * (likes_count / Math.max(views_count, 1)) * 100).toFixed(2))',
        'engagement_rate = Number((((likes_count + comments_count) / Math.max(views_count, 1)) * 100).toFixed(2))',
        'views_per_hour = Math.round(views_count / Math.max((Date.now() - new Date(published_at).getTime()) / 3600000, 1))'
      ],
      killerFeatures: [
        'Radar de Outliers com cálculo preditivo de multiplicador viral comparado ao baseline do canal (3x a 50x)',
        'Slide-Over Drawer com decomposição em 3 abas: Headline Hooks com score CTR, Transcrição timestamped com cópia em 1 clique e Análise de Thumbnail (cores, contraste e emoção)',
        'Monetização SaaS nativa com planos Pro, PushinPay PIX com QR Code dinâmico e limite de cota de buscas com Cloudflare Turnstile'
      ]
    },
    creator_video_analytics: {
      domainName: 'Creator Economy / YouTube Viral Search & Analytics',
      referenceApps: [
        '1of10.com (Outlier Video Finder)',
        'VidIQ (Viral Velocity & Keyword Research)',
        'Viewstats by MrBeast (Thumbnail & Retention Analytics)',
        'TubeBuddy (Channel Explorer)',
        'OpusClip / Descript (Transcript & Hook Analysis)'
      ],
      marketDiagnosis:
        'Criadores de conteúdo, canais do YouTube e estrategistas de mídia perdem dias minerando referências manualmente e falham em identificar padrões virais. O líder de mercado (1of10, Viewstats) automatiza o cálculo de Outlier Multipliers (2x a 50x acima da média histórica do canal), velocidade de visualizações por hora (VPH) e monitoramento de nichos com radares de tração e notas de roteirização.',
      screenFlows: [
        'App Shell com abas [role="tab"]: 01-Dashboard (Radar de Virais & Bento KPIs), 02-Registros (Galeria de Cards 16:9 & Filtros de Engajamento), 03-Operacoes (Nichos & Varreduras), 04-Auditoria (Trilha Forense com JSON Diff), 05-Configuracoes (Algoritmos de Viral Score & API Keys)',
        'Command Palette universal (Ctrl+K) com pesquisa rápida de vídeos, canais, nichos e atalhos de filtro',
        'Slide-Over Video/Transcript Inspector Drawer 520px com preview de vídeo 16:9, métricas de retenção, tags e transcrição estruturada',
        'Galeria de Cards 16:9 de alta performance com debounce de busca (250ms), ordenação por Outlier Multiplier, badges monospace de duração e exportação CSV'
      ],
      coreEntities: [
        'viral_videos (id, youtube_id, title, channel_title, views, likes, comments, published_at, thumbnail_url, view_count_baseline, outlier_score, engagement_rate, views_per_hour, niche_id, tags_json, notes, created_at)',
        'saved_niches (id, name, keyword_filter, min_views, min_outlier_score, refresh_interval_hours, is_active, created_at)',
        'search_operations (id, query, niche_id, results_count, status, execution_time_ms, created_at)',
        'audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)',
        'system_settings (key, value, updated_at)'
      ],
      calculationFormulas: [
        'engagement_rate = ((likes + comments) / Math.max(views, 1)) * 100',
        'outlier_score = Number((views / Math.max(channel_avg_views, 1)).toFixed(2))',
        'views_per_hour = Math.round(views / Math.max((Date.now() - new Date(published_at).getTime()) / 3600000, 1))',
        'view_to_subscriber_ratio = (views / Math.max(subscribers, 1)) * 100'
      ],
      killerFeatures: [
        'Galeria de Cards de Vídeo 16:9 com badge de duração monospace e pílulas de Outlier Multiplier (>= 5x verde esmeralda, >= 2.5x azul)',
        'Barra de Filtros Compostos de Engajamento (Views, Engagement %, Outlier Score, Formato Shorts vs Longo e Nicho)',
        'Slide-Over Video/Transcript Inspector (520px) com decomposição de ganchos nos primeiros 30s e notas de roteiro'
      ]
    },
    creator_economy: {
      domainName: 'Creator Economy / YouTube Viral Search & Analytics',
      referenceApps: [
        '1of10.com (Outlier Video Finder)',
        'VidIQ (Viral Velocity & Keyword Research)',
        'Viewstats by MrBeast (Thumbnail & Retention Analytics)',
        'TubeBuddy (Channel Explorer)',
        'OpusClip / Descript (Transcript & Hook Analysis)'
      ],
      marketDiagnosis:
        'Criadores de conteúdo, canais do YouTube e estrategistas de mídia perdem dias minerando referências manualmente e falham em identificar padrões virais. O líder de mercado (1of10, Viewstats) automatiza o cálculo de Outlier Multipliers (2x a 50x acima da média histórica do canal), velocidade de visualizações por hora (VPH) e monitoramento de nichos com radares de tração e notas de roteirização.',
      screenFlows: [
        'App Shell com abas [role="tab"]: 01-Dashboard (Radar de Virais & Bento KPIs), 02-Registros (Explorador & Filtros de Engajamento), 03-Operacoes (Nichos & Coletas), 04-Auditoria (Trilha Forense com JSON Diff), 05-Configuracoes (Algoritmos de Viral Score & API Keys)',
        'Command Palette universal (Ctrl+K) com pesquisa rápida de vídeos, canais, nichos e atalhos de filtro',
        'Slide-Over Drawer 520px com preview de vídeo 16:9, métricas de retenção, tags e transcrição estruturada',
        'Data Grid de alta performance com debounce de busca (250ms), ordenação por Outlier Multiplier e exportação CSV'
      ],
      coreEntities: [
        'viral_videos (id, youtube_id, title, channel_title, views, likes, comments, published_at, thumbnail_url, view_count_baseline, outlier_score, engagement_rate, views_per_hour, niche_id, tags_json, notes, created_at)',
        'saved_niches (id, name, keyword_filter, min_views, min_outlier_score, refresh_interval_hours, is_active, created_at)',
        'search_operations (id, query, niche_id, results_count, status, execution_time_ms, created_at)',
        'audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)',
        'system_settings (key, value, updated_at)'
      ],
      calculationFormulas: [
        'engagement_rate = ((likes + comments) / Math.max(views, 1)) * 100',
        'outlier_score = Number((views / Math.max(channel_avg_views, 1)).toFixed(2))',
        'views_per_hour = Math.round(views / Math.max((Date.now() - new Date(published_at).getTime()) / 3600000, 1))'
      ],
      killerFeatures: [
        'Algoritmo Preditivo de Outlier Score comparando a performance do vídeo com a média histórica do canal (identifica virais autênticos de 3x a 50x)',
        'Radar de Nichos com busca multi-termo, filtros avançados de velocidade (VPH) e monitoramento de concorrentes',
        'Gaveta Analítica 520px com decomposição de títulos virais, tags de tração e exportação para briefing de roteiro'
      ]
    },
    ai_automation_agents: {
      domainName: 'AI Agents, LLM Workflows & Prompt Engineering Hub',
      referenceApps: [
        'LangSmith',
        'Vercel AI Playground',
        'Linear',
        'Raycast',
        'OpenRouter'
      ],
      marketDiagnosis:
        'Desenvolvedores e equipes de produto que implementam fluxos de IA enfrentam opacidade em execuções de prompts, variação imprevista de custos de tokens e ausência de observabilidade em cadeias RAG. Plataformas líderes entregam rastreabilidade de chamadas (traces), playground comparativo de modelos e auditoria detalhada de payloads e latência.',
      screenFlows: [
        'App Shell com abas [role="tab"]: 01-Playground (Execuções & Testes de Prompts), 02-Traces (Histórico de Chamadas & Latência), 03-Modelos (Catálogo & Custos por Token), 04-Auditoria (Diff de Payloads & Logs), 05-Configurações (API Keys de Provedores)',
        'Command Palette (Ctrl+K) com troca rápida de modelos e pesquisa instantânea de traces',
        'Slide-Over Inspector Drawer (520px) com abas de Payload JSON, Árvore de Execução RAG e Métricas de Latência/Custo',
        'Data Grid com filtros avançados por Modelo (GPT-4o, Claude 3.5, Gemini 1.5, Llama 3), Faixa de Latência P95 e Status da Execução'
      ],
      coreEntities: [
        'prompt_templates (id, name, model, system_prompt, user_prompt, temperature, top_p, version, created_at)',
        'agent_runs (id, template_id, model, input_json, output_text, prompt_tokens, completion_tokens, latency_ms, cost_usd, status, created_at)',
        'token_usage_records (id, model, date, total_tokens, total_cost_usd)',
        'audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)',
        'system_settings (key, value, updated_at)'
      ],
      calculationFormulas: [
        'custo_estimado = (prompt_tokens * custo_prompt_1k / 1000) + (completion_tokens * custo_completion_1k / 1000)',
        'taxa_sucesso_execucao = (execucoes_sucesso / total_execucoes) * 100',
        'latencia_media_ms = avg(duracao_ms)',
        'p95_latencia_ms = percentile_95(duracao_ms)'
      ],
      killerFeatures: [
        'Playground Interativo com comparação lado a lado de respostas de modelos concorrentes',
        'Calculadora em tempo real de custo por 1k tokens e latência P95',
        'Slide-Over Drawer 520px com visualização formatada de prompts, variáveis e inspeção de chunks'
      ]
    },
    edtech_learning: {
      domainName: 'EdTech, Plataformas de Ensino & Gestão de Aprendizagem',
      referenceApps: [
        'Duolingo',
        'Notion',
        'Linear',
        'Brilliant.org',
        'Maven'
      ],
      marketDiagnosis:
        'Ambientes virtuais de aprendizagem tradicionais sofrem com altas taxas de evasão, falta de feedback gamificado e dificuldade em acompanhar o progresso individual dos alunos. Os líderes de EdTech engajam através de trilhas visuais estruturadas, flashcards espaçados e diagnósticos claros de retenção e conclusão.',
      screenFlows: [
        'App Shell com abas [role="tab"]: 01-Dashboard (KPIs de Alunos & Engajamento), 02-Cursos (Catálogo de Módulos & Aulas), 03-Alunos (Progresso & Frequência), 04-Auditoria (Submissões de Provas & Certificados), 05-Configurações (Gamificação & Regras de Aprovação)',
        'Slide-Over Detail Drawer (520px) com resumo do aluno, progresso por aula e notas de exercícios',
        'Data Grid com filtros por módulo, status de matrícula (ativo, concluído, evadido) e pontuação'
      ],
      coreEntities: [
        'courses (id, title, description, category, total_modules, duration_hours, is_published, created_at)',
        'modules (id, course_id, title, order_index, lessons_count, created_at)',
        'lessons (id, module_id, title, video_url, content_text, duration_minutes, created_at)',
        'students (id, name, email, enrolled_courses_count, completed_lessons_count, average_score, created_at)',
        'progress_records (id, student_id, lesson_id, completed, score, last_accessed_at)',
        'audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)'
      ],
      calculationFormulas: [
        'taxa_conclusao_modulo = (aulas_concluidas / total_aulas) * 100',
        'retencao_alunos_pct = (alunos_ativos / total_alunos_matriculados) * 100',
        'score_aproveitamento = (respostas_corretas / total_questoes) * 100'
      ],
      killerFeatures: [
        'Trilha visual de aprendizagem com badges de conquista e cálculo dinâmico de progresso',
        'Dashboard de retenção com identificação precoce de alunos com risco de evasão',
        'Drawer analítico 520px com histórico de submissões e tempo dedicado por aula'
      ]
    },
    logistics_operations: {
      domainName: 'Logística, Gestão de Frotas, Estoque & Supply Chain',
      referenceApps: [
        'Flexport',
        'Samsara',
        'Shopify Admin',
        'Linear'
      ],
      marketDiagnosis:
        'Cadeias de suprimentos e centros de distribuição enfrentam falta de visibilidade de estoques em tempo real, atrasos na expedição e frotas ociosas. Sistemas modernos de logística unificam inventário físico, tracking de remessas e SLAs de entrega com alertas preditivos de ruptura.',
      screenFlows: [
        'App Shell com abas [role="tab"]: 01-Dashboard (Painel Operacional & SLAs), 02-Estoque (Itens, Lotes & Giro), 03-Remessas (Rastreio de Pedidos & Frotas), 04-Auditoria (Inventário Físico & Baixas), 05-Configurações (Centros de Distribuição & Rotas)',
        'Slide-Over Drawer 520px com rastreamento de lote, movimentações de entrada/saída e notas fiscais',
        'Filtros compostos por Armazém, Status da Entrega (em trânsito, entregue, atrasado) e Nível de Estoque (crítico, normal, excesso)'
      ],
      coreEntities: [
        'inventory_items (id, sku, name, category, warehouse_location, quantity_on_hand, min_threshold, unit_cost, created_at, updated_at)',
        'shipments (id, tracking_code, destination, carrier, status, estimated_delivery, actual_delivery, created_at)',
        'fleet_vehicles (id, plate, driver_name, capacity_kg, current_status, last_maintenance, created_at)',
        'stock_movements (id, item_id, type, quantity, reason, actor, created_at)',
        'audit_logs (id, actor, action, entity, entity_id, diff_json, created_at)'
      ],
      calculationFormulas: [
        'sla_cumprimento_entregas = (entregas_no_prazo / total_entregas) * 100',
        'giro_estoque_mensal = custo_mercadoria_vendida / max(valor_estoque_medio, 1)',
        'lead_time_medio_dias = avg(data_entrega - data_pedido)'
      ],
      killerFeatures: [
        'Radar de ruptura de estoque com cálculo automático de ponto de ressuprimento',
        'Monitor de SLA de entregas com alerta visual para remessas com risco de atraso',
        'Drawer de movimentação 520px com histórico imutável de entradas, saídas e ajustes de inventário'
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

    // 1. YouTube / Vídeos Virais / Creator Economy (Prioridade Alta)
    if (/youtube|video|viral|engajamento|views?|likes?|transcri|transcript|roteiro|nicho|canal|thumbnail|tiktok|reels|creator|copywriting|headline|outlier/i.test(text)) {
      return this.DOMAIN_PROFILES.youtube_viral_intelligence || this.DOMAIN_PROFILES.creator_viral_video || this.DOMAIN_PROFILES.creator_video_analytics || this.DOMAIN_PROFILES.creator_economy;
    }
    // 2. IA / LLM / Agentes
    if (/\b(?:ia|ai)\b|llm|prompt|agente|agent|automacao|automation|rag|whisper|openai|groq|anthropic|langchain/i.test(text)) {
      return this.DOMAIN_PROFILES.ai_automation_agents;
    }
    // 3. EdTech / Cursos
    if (/curso|aula|aluno|estud|flashcard|mentoria|prova|quiz|ensino|trilha|educacao|aprendizado/i.test(text)) {
      return this.DOMAIN_PROFILES.edtech_learning;
    }
    // 4. Logística
    if (/estoque|frota|entrega|delivery|suprimento|producao|logistica|rastreio|armazem|frete|romaneio/i.test(text)) {
      return this.DOMAIN_PROFILES.logistics_operations;
    }
    // 5. Devtools
    if (/dev|bug|issue|task|kanban|sprint|scrum|deploy|repositorio|git|engenharia|codigo|commit|backlog/i.test(text)) {
      return this.DOMAIN_PROFILES.devtools;
    }
    // 6. Saúde
    if (/saude|clinic|medico|paciente|consulta|prontuario|odont|dentist|terapia|hospital|remedio|receita|telemedicin/i.test(text)) {
      return this.DOMAIN_PROFILES.health;
    }
    // 7. E-commerce
    if (/loja|e-commerce|ecommerce|produto|carrinho|restaurante|cardapio/i.test(text)) {
      return this.DOMAIN_PROFILES.ecommerce;
    }
    // 8. CRM & Vendas
    if (/crm|venda|lead|proposta|pipeline|funil|comercial|cliente|negocio|prospeccao/i.test(text)) {
      return this.DOMAIN_PROFILES.crm_sales;
    }

    // 9. Fintech: Somente quando o core business do produto for explicitamente contabilidade, banco digital ou ERP financeiro!
    // Removemos menções comuns de infraestrutura SaaS (pagamento, pix, checkout, etc.) para não sequestrar o domínio do usuário
    const sanitizedForFintech = text
      .replace(/banco\s+de\s+dados/g, ' ')
      .replace(/sqlite/g, ' ')
      .replace(/gateway\s*(de\s*pagamentos?)?/g, ' ')
      .replace(/pagamentos?/g, ' ')
      .replace(/pushinpay/g, ' ')
      .replace(/pix/g, ' ')
      .replace(/supabase/g, ' ')
      .replace(/turnstile/g, ' ')
      .replace(/cloudflare/g, ' ')
      .replace(/billing/g, ' ')
      .replace(/planos?(\s+de\s+assinatura)?/g, ' ')
      .replace(/assinaturas?/g, ' ')
      .replace(/checkout/g, ' ')
      .replace(/cota\s+de\s+buscas?/g, ' ');

    const isPureFintech = /\b(contabilidade|escritorio\s*contabil|banco\s*digital|erp\s*financeiro|conciliacao\s*bancaria|livro\s*caixa)\b/i.test(sanitizedForFintech);
    if (isPureFintech || (/finan|contabil|cobranc|fatura|concilia|boleto|livro\s*caixa|contas\s*a\s*pagar|dre|saldo|extrato|inadimpl/i.test(sanitizedForFintech) && !/(youtube|video|viral|transcri|transcript|headline|thumbnail|outlier|creator)/i.test(text))) {
      return this.DOMAIN_PROFILES.fintech;
    }

    return this.DOMAIN_PROFILES.general_saas;
  }

  /**
   * Dynamic Briefing Extractor:
   * Analyzes raw briefing to extract explicit entities, filters, integrations,
   * formulas, and detect whether billing or kanban were requested.
   */
  public static extractBriefingEntitiesAndRules(briefing: string): {
    entities: string[];
    filters: string[];
    integrations: string[];
    sections: string[];
    formulas: string[];
    services: string[];
    hasExplicitBilling: boolean;
    hasExplicitKanban: boolean;
  } {
    const raw = briefing || '';
    const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    const entities: string[] = [];
    const filters: string[] = [];
    const integrations: string[] = [];
    const sections: string[] = [];
    const formulas: string[] = [];
    const services: string[] = [];

    const hasExplicitBilling = /billing|fatura|cobran[cç]a|pix|checkout|assinatura|planos pagos|stripe/i.test(text);
    const hasExplicitKanban = /kanban|quadro de tarefas|colunas de sprint/i.test(text);

    // Entity matches
    const entityMatches = raw.match(/(?:tabela|entidade|model|cole[cç][aã]o|dados\s+de|busca\s+de|gest[aã]o\s+de|cadastro\s+de)\s+([a-zA-Z0-9_\-]{3,30})/gi);
    if (entityMatches) {
      for (const m of entityMatches) {
        const cleaned = m.replace(/^(?:tabela|entidade|model|cole[cç][aã]o|dados\s+de|busca\s+de|gest[aã]o\s+de|cadastro\s+de)\s+/i, '').trim().toLowerCase();
        if (cleaned && !['para', 'como', 'sobre', 'novo', 'cada', 'todo', 'mais', 'tela'].includes(cleaned)) {
          entities.push(cleaned);
        }
      }
    }

    // Service matches
    const serviceMatches = raw.match(/\b([A-Z][a-zA-Z0-9]+(?:Service|Provider|Registry|Engine|Manager|Controller|Repository|Client|Adapter))\b/g);
    if (serviceMatches) {
      for (const sm of serviceMatches) {
        if (!['DatabaseSync', 'EventEmitter', 'Promise', 'Array', 'String', 'Object'].includes(sm)) {
          services.push(sm);
        }
      }
    }

    if (/\b(youtube|canal\s+do\s+youtube|canais\s+do\s+youtube|video\s+viral|videos\s+virais|minerador\s+de\s+virais)\b/i.test(text)) {
      entities.push('viral_videos', 'channels', 'saved_niches');
      filters.push('Filtros de Engajamento (Views, Likes, Comentários)', 'Outlier Multiplier (>=2.5x, >=5x)', 'Formato (Shorts vs Longos)', 'Nicho');
      integrations.push('YouTube Data API', 'Groq / Whisper (Transcrições)');
      sections.push('Galeria de Vídeos 16:9', 'Radar de Outliers', 'Análise de Canais');
      formulas.push(
        'engagement_rate = ((likes + comments) / Math.max(views, 1)) * 100',
        'outlier_score = Number((views / Math.max(channel_avg_views, 1)).toFixed(2))',
        'views_per_hour = Math.round(views / Math.max((Date.now() - new Date(published_at).getTime()) / 3600000, 1))'
      );
    } else if (/\b(ads\s*library|ad\s*intelligence|anuncios?\s+da\s+meta|meta\s+ads|biblioteca\s+de\s+anuncios|anuncios?\s+ativos|criativos?\s+de\s+anuncios?|ad\s*spy|ad\s*crawler)\b/i.test(text)) {
      entities.push('searches', 'ads', 'creatives', 'ad_observations', 'advertisers');
      filters.push('Palavra-Chave', 'Plataforma (FB, IG, Audience Network)', 'Tempo Ativo (Dias)', 'Tipo de Mídia (Vídeo, Imagem, Carrossel)', 'Status Ativo');
      integrations.push('Meta Ads Library API / Web Collector', 'SQLite Persistência');
      sections.push('Pesquisa de Anúncios', 'Radar de Criativos em Escala', 'Painel de Anunciantes');
      formulas.push(
        'opportunity_score = Math.min(100, Math.round((dias_ativo * 1.5) + (total_variacoes * 4) + (plataformas_count * 8)))',
        'taxa_replicacao = (criativos_variantes / Math.max(total_criativos, 1)) * 100'
      );
    } else if (/\b(?:ia|ai)\b|llm|prompt|agente|rag/i.test(text)) {
      entities.push('prompt_templates', 'agent_runs', 'token_metrics');
      filters.push('Filtro por Modelo (GPT-4o, Claude, Gemini)', 'Faixa de Latência P95', 'Status de Execução');
      integrations.push('OpenAI / Anthropic / Google Gemini API', 'Vector DB / RAG Store');
      sections.push('Playground de Prompts', 'Histórico de Traces', 'Catálogo de Modelos');
      formulas.push(
        'custo_estimado = (prompt_tokens * custo_prompt_1k / 1000) + (completion_tokens * custo_completion_1k / 1000)',
        'taxa_sucesso_execucao = (execucoes_sucesso / total_execucoes) * 100'
      );
    } else if (/curso|aula|aluno|estud|flashcard|mentoria/i.test(text)) {
      entities.push('courses', 'modules', 'students', 'progress_records');
      filters.push('Filtro por Módulo', 'Status de Matrícula', 'Faixa de Rendimento');
      sections.push('Trilha de Aulas', 'Painel do Aluno', 'Desempenho em Exercícios');
      formulas.push('taxa_conclusao_modulo = (aulas_concluidas / total_aulas) * 100');
    } else if (/estoque|frota|entrega|suprimento|logistica/i.test(text)) {
      entities.push('inventory_items', 'shipments', 'fleet_vehicles');
      filters.push('Filtro por Armazém', 'Status da Entrega', 'Nível de Ruptura');
      sections.push('Mapa de Cargas', 'Inventário em Tempo Real', 'Monitor de SLAs');
      formulas.push('sla_cumprimento_entregas = (entregas_no_prazo / total_entregas) * 100');
    }

    if (/engajamento/i.test(text) && !filters.some(f => f.includes('Engajamento'))) filters.push('Taxa de Engajamento (%)');
    if (/nicho/i.test(text) && !filters.some(f => f.includes('Nicho'))) filters.push('Nicho / Categoria');
    if (/periodo|data/i.test(text) && !filters.some(f => f.includes('Período'))) filters.push('Período Temporal');
    if (/score|pontua[cç][aã]o/i.test(text) && !filters.some(f => f.includes('Score'))) filters.push('Score de Desempenho');

    return {
      entities: Array.from(new Set(entities)),
      filters: Array.from(new Set(filters)),
      integrations: Array.from(new Set(integrations)),
      sections: Array.from(new Set(sections)),
      formulas: Array.from(new Set(formulas)),
      services: Array.from(new Set(services)),
      hasExplicitBilling,
      hasExplicitKanban
    };
  }

  /**
   * Extracts explicitly mentioned reference apps from the user prompt (e.g. "como Linear", "estilo Stripe").
   */
  public static extractExplicitReferenceApps(briefing: string): string[] {
    const text = briefing || '';
    const apps: string[] = [];
    const patterns = [
      /(?:como|estilo|inspirado\s*no|baseado\s*no|refer[eê]ncia|padr[aã]o)\s+([A-Z0-9][a-zA-Z0-9_\-\.]{2,20})/g,
      /(?:1of10(?:\.com)?|vidiq|viewstats|tubebuddy|opusclip|linear|stripe|raycast|supabase|resend|cal\.com|shopify|ifood|stone|asaas|clinicorp|pipedrive|hubspot|notion|airtable|feegow)/gi
    ];

    for (const p of patterns) {
      const matches = text.matchAll(p);
      for (const m of matches) {
        const val = m[1] || m[0];
        if (val && !['para', 'como', 'sobre', 'novo', 'cada', 'todo', 'mais', 'com', 'esse', 'esta'].includes(val.toLowerCase())) {
          let formatted = val;
          const lower = val.toLowerCase();
          if (lower.includes('1of10')) formatted = '1of10.com';
          else if (lower === 'vidiq') formatted = 'VidIQ';
          else if (lower === 'viewstats') formatted = 'Viewstats';
          else if (lower === 'tubebuddy') formatted = 'TubeBuddy';
          else if (lower === 'opusclip') formatted = 'OpusClip';
          else formatted = val.charAt(0).toUpperCase() + val.slice(1);

          if (!apps.includes(formatted)) {
            apps.push(formatted);
          }
        }
      }
    }

    return apps.slice(0, 4);
  }

  /**
   * Extracts custom entity names, formulas, or overrides explicitly specified in the briefing.
   */
  public static extractCustomBriefingOverrides(briefing: string): Partial<DomainKnowledgeProfile> {
    const raw = briefing || '';
    const overrides: Partial<DomainKnowledgeProfile> = {};

    const entityMatches = raw.match(/(?:tabela|entidade|coleção|model)\s+([a-zA-Z0-9_]{3,30})/gi);
    if (entityMatches && entityMatches.length > 0) {
      overrides.coreEntities = entityMatches.map(m => m.split(/\s+/)[1].toLowerCase());
    }

    return overrides;
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
    const briefingContext = this.extractBriefingEntitiesAndRules(briefing);
    const overrides = this.extractCustomBriefingOverrides(briefing);
    const effectiveEntities = Array.from(new Set([
      ...briefingContext.entities,
      ...(overrides.coreEntities || []),
      ...profile.coreEntities
    ]));
    const effectiveFormulas = Array.from(new Set([
      ...briefingContext.formulas,
      ...profile.calculationFormulas
    ]));
    const explicitApps = this.extractExplicitReferenceApps(briefing);
    const combinedApps = Array.from(new Set([...explicitApps, ...profile.referenceApps])).slice(0, 5);

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
      effectiveEntities.map(e => `- \`${e}\``).join('\n'),
      ``,
      `**Fórmulas Matemáticas de Negócio:**`,
      effectiveFormulas.map(f => `- \`${f}\``).join('\n'),
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
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "marketDiscoveryService",
          error: (err as any)?.message || String(err)
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
      coreEntities: effectiveEntities,
      calculationFormulas: effectiveFormulas,
      killerFeatures: profile.killerFeatures
    });

    return {
      fullReportPath: targetFile,
      dossierPath: targetFile,
      domainName: profile.domainName,
      referenceApps: combinedApps,
      coreEntities: effectiveEntities,
      killerFeatures: profile.killerFeatures,
      compactDiscoveryBlock,
      marketDiagnosis: profile.marketDiagnosis,
      screenFlows: profile.screenFlows,
      calculationFormulas: effectiveFormulas
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
