// server/src/projectLivingSpecService.ts
// Motor Autônomo de Especificação Viva na Onda 0 do DecoHUB
// Materializa no disco do projeto 4 documentos canônicos de especificação viva:
// 1. CONTEUDO.md (Especificação de Produto, Seções 01-Secao e REA)
// 2. DESIGN.md (Arquétipo Visual, Tokens :root, Tipografia e Estados)
// 3. BACKEND.md (Esquemas SQLite, Contratos REST e Fórmulas de Domínio)
// 4. PRINCIPIOS.md (Invariantes Karpathy, PORT_GUARD e Blindagem AppSec)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from './db.js';
import { Logger } from './logger.js';
import { MarketDiscoveryService } from './marketDiscoveryService.js';
import { ReaSaaSMasterService } from './reaSaaSMasterService.js';
import { DesignSkillService } from './designSkillService.js';
import { DocSimpService } from './docSimpService.js';

export interface GenerateLivingSpecsInput {
  projectId?: string;
  projectName: string;
  projectPath: string;
  briefing: string;
  requirements?: string[];
  model?: string;
  runId?: string;
}

export interface GeneratedLivingSpecsResult {
  conteudoMdPath: string;
  designMdPath: string;
  backendMdPath: string;
  principiosMdPath: string;
  jornadasMdPath: string;
  designMdRootPath: string;
  agentsMdRootPath: string;
  specsDir: string;
  filesGenerated: string[];
  executiveCard?: string;
  chatMessageId?: string;
}

export type SpecTaskRole =
  | 'SUPERVISOR_BLUEPRINT'
  | 'SUPERVISOR_EXPAND'
  | 'WORKER_BACKEND'
  | 'WORKER_FRONTEND'
  | 'WORKER_FULLSTACK'
  | 'WORKER_TEST';

interface DomainSpecBlueprint {
  domainKey: string;
  domainName: string;
  targetAudience: string;
  referenceApps: string[];
  marketBenchmark: string;
  differentials: string[];
  sections: Array<{
    code: string;
    name: string;
    tabId: string;
    kpis: string[];
    chart: string;
    gridColumns: string[];
    filters: string[];
    drawerContent: string;
    modalContent: string;
    seedSummary: string;
  }>;
  sqliteSchema: string;
  restContracts: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    requestBody: string;
    responseBody: string;
    description: string;
  }>;
  formulas: string[];
  validations: string[];
  envKeys: string[];
  archetype: 'linear' | 'stripe' | 'vercel' | 'fintech' | 'dark-telemetry' | 'clean-saas';
  accentColor: string;
}

export class ProjectLivingSpecService {
  private static readonly DOMAIN_SPECS: Record<string, DomainSpecBlueprint> = {
    fintech: {
      domainKey: 'fintech',
      domainName: 'Fintech, Gestão Financeira & Cobranças',
      targetAudience: 'Empresas, autônomos e gestores financeiros que necessitam de controle de fluxo de caixa, conciliação e cobranças previsíveis.',
      referenceApps: ['Stripe', 'Asaas', 'ContaAzul', 'Stone'],
      marketBenchmark: 'Líderes de mercado entregam conciliação instantânea, PIX com webhook resiliente, extrato analítico e visão unificada de liquidez sem atraso operacional.',
      differentials: [
        'Conciliação em tempo real com Optimistic UI e estorno seguro idempotente',
        'Dashboard analítico BI com projeção de fluxo de caixa para 30/60/90 dias e alertas preditivos de saldo mínimo',
        'Trilha de auditoria imutável (/api/audit-logs) para compliance fiscal, com diff estruturado de cada lançamento'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Saldo Líquido: R$ 142.850,00 (Δ% +12.4% vs mês anterior)',
            'Receitas Mensais: R$ 185.300,00 (Δ% +8.2% vs mês anterior)',
            'Despesas Operacionais: R$ 42.450,00 (Δ% -3.1% vs mês anterior)',
            'Taxa de Inadimplência: 2.8% (Δ% -0.5% vs mês anterior)'
          ],
          chart: 'Gráfico SVG interativo de Projeção de Fluxo de Caixa (30/60/90 dias) com tooltips e eixos em tabular-nums',
          gridColumns: ['ID', 'Data/Hora', 'Descrição', 'Categoria', 'Tipo', 'Valor (R$)', 'Status'],
          filters: ['Filtro por Tipo (Todos, Entrada, Saída)', 'Filtro por Período (7d, 30d, 90d)', 'Busca debounce por descrição'],
          drawerContent: 'Slide-Over com resumo analítico da transação, comprovante fiscal, histórico de eventos e log de auditoria',
          modalContent: 'Modal de Novo Lançamento com campos: Descrição, Categoria, Tipo, Valor, Data de Vencimento e Anexo',
          seedSummary: '20 registros realistas de transações de entrada e saída com categorias comerciais e despesas fixas'
        },
        {
          code: '02',
          name: 'Transações',
          tabId: 'transacoes',
          kpis: [
            'Volume Total: R$ 348.900,00 (Δ% +15.1%)',
            'Volume PIX: R$ 210.400,00 (Δ% +22.0%)',
            'Cartão de Crédito: R$ 112.500,00 (Δ% +4.3%)',
            'Estornos/Disputas: R$ 1.850,00 (Δ% -18.2%)'
          ],
          chart: 'Gráfico SVG de barras de Distribuição por Método de Pagamento (PIX, Crédito, Boleto)',
          gridColumns: ['Código', 'Data', 'Cliente/Fornecedor', 'Descrição', 'Método', 'Valor Bruto', 'Taxa', 'Valor Líquido', 'Status', 'Ações'],
          filters: ['Status (Todos, Concluída, Pendente, Falha)', 'Método (PIX, Cartão, Boleto)', 'Busca debounce por código ou cliente'],
          drawerContent: 'Detalhes completos da transação, payload de webhook associado e botão de estorno com confirmação',
          modalContent: 'Modal de Conciliação Manual com seleção de extrato bancário e vínculo a lançamentos pendentes',
          seedSummary: '25 registros de transações com métodos variados (PIX, Boleto, Crédito) e taxas calculadas'
        },
        {
          code: '03',
          name: 'Cobranças',
          tabId: 'cobrancas',
          kpis: [
            'Faturas Emitidas: 142 (Δ% +9.5%)',
            'Faturas Pagas: 128 (Δ% +11.2%)',
            'Faturas Vencidas: 8 (Δ% -14.0%)',
            'A Vencer (Próx. 7d): 6 (R$ 18.200,00)'
          ],
          chart: 'Gráfico SVG de curva de liquidação de faturas por prazo de vencimento',
          gridColumns: ['Fatura #', 'Cliente', 'CPF/CNPJ', 'Valor', 'Vencimento', 'Método', 'Status', 'QR Code / Link', 'Ações'],
          filters: ['Status de Fatura (Pagas, Pendentes, Vencidas)', 'Filtro por Cliente'],
          drawerContent: 'Histórico de disparos de lembretes, QR Code PIX ampliado e código de barras digitável',
          modalContent: 'Modal de Emissão de Fatura com seleção de cliente, itens, vencimento, juros e desconto por pontualidade',
          seedSummary: '18 faturas com status Pago, Pendente e Vencido para teste de alertas e liquidação'
        },
        {
          code: '04',
          name: 'Relatórios',
          tabId: 'relatorios',
          kpis: [
            'Margem Líquida: 77.1% (Δ% +2.3%)',
            'EBITDA Projetado: R$ 142.850,00',
            'Giro de Caixa Médio: 18 dias',
            'Economia Fiscal: R$ 8.420,00'
          ],
          chart: 'Gráfico SVG de DRE sintético comparativo (Receita Bruta -> Deduções -> Despesas -> Lucro Líquido)',
          gridColumns: ['Competência', 'Receita Operacional', 'Custos Diretos', 'Despesas Operacionais', 'Resultado Financeiro', 'Lucro Líquido'],
          filters: ['Ano Contábil', 'Centro de Custo', 'Visão Sintética / Analítica'],
          drawerContent: 'Detalhamento contábil por centro de custo e plano de contas',
          modalContent: 'Modal de Exportação de Relatório com seleção de formato (CSV, JSON, PDF estruturado)',
          seedSummary: '12 meses de competência contábil com fechamento financeiro consolidado'
        },
        {
          code: '05',
          name: 'Configurações',
          tabId: 'configuracoes',
          kpis: [
            'Chaves PIX Ativas: 2',
            'Webhooks Saudáveis: 100%',
            'Certificado Digital: Válido (310 dias)',
            'Usuários com Acesso: 4'
          ],
          chart: 'Gráfico SVG de latência e taxa de sucesso dos webhooks bancários nas últimas 24h',
          gridColumns: ['Chave / Parâmetro', 'Tipo', 'Valor Mascarado', 'Última Alteração', 'Responsável', 'Status'],
          filters: ['Categoria de Parâmetro (Bancário, Fiscal, Segurança)'],
          drawerContent: 'Log de alterações da configuração selecionada com diff antes/depois',
          modalContent: 'Modal de Atualização de Chaves de API e Webhook com teste de conectividade',
          seedSummary: 'Configurações de chaves PIX de homologação, limites diários e regras de juros'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - Fintech & Gestão Financeira
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  fee REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category_id TEXT NOT NULL,
  customer_id TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'credit_card', 'boleto', 'transfer', 'cash')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'cancelled')),
  date TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories (id),
  FOREIGN KEY (customer_id) REFERENCES customers (id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  payment_method TEXT NOT NULL DEFAULT 'pix',
  paid_at TEXT,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers (id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices (due_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Verificação de integridade operacional do backend e conectividade com SQLite'
        },
        {
          method: 'GET',
          path: '/api/audit-logs',
          requestBody: 'Query: ?entity=&limit=',
          responseBody: 'Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>',
          description: 'Trilha de auditoria forense imutável com histórico estruturado de ações'
        },
        {
          method: 'GET',
          path: '/api/kpis',
          requestBody: 'N/A',
          responseBody: '{ netBalance: number, totalIncome: number, totalExpense: number, defaultRate: number, formatted: object }',
          description: 'Totais consolidados e variações percentuais para os Cards de KPI do topo'
        },
        {
          method: 'GET',
          path: '/api/transactions',
          requestBody: 'Query: ?type=&status=&q=&page=&limit=',
          responseBody: 'Array<{ id: string, description: string, amount: number, fee: number, type: string, category_id: string, payment_method: string, status: string, date: string }>',
          description: 'Listagem de transações com suporte a busca debounce e filtros compostos'
        },
        {
          method: 'POST',
          path: '/api/transactions',
          requestBody: '{ description: string, amount: number, fee?: number, type: "income" | "expense", category_id: string, customer_id?: string, payment_method: string, date: string }',
          responseBody: '{ id: string, description: string, amount: number, ... } (Status 201) ou { error: string, message: string } (Status 400)',
          description: 'Criação de nova transação com validação de campos obrigatórios e auditoria'
        },
        {
          method: 'GET',
          path: '/api/invoices',
          requestBody: 'Query: ?status=&customer_id=',
          responseBody: 'Array<{ id: string, customer_id: string, amount: number, due_date: string, status: string, paid_at?: string }>',
          description: 'Listagem de faturas e cobranças com status de liquidação'
        },
        {
          method: 'POST',
          path: '/api/invoices',
          requestBody: '{ customer_id: string, amount: number, due_date: string, payment_method?: string }',
          responseBody: '{ id: string, amount: number, due_date: string, status: "pending", ... } (Status 201)',
          description: 'Emissão de nova fatura de cobrança'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "transactions" | "invoices" | "audit_logs", filters?: object }',
          responseBody: 'Content-Type: text/csv com cabeçalhos sanitizados e linhas de dados',
          description: 'Exportação em lote de dados tabulares em formato CSV para download'
        }
      ],
      formulas: [
        'saldo_liquido = sum(receitas) - sum(despesas) - sum(taxas)',
        'mrr = sum(assinaturas_ativas_valor_mensal)',
        'taxa_inadimplencia = (total_faturas_vencidas / total_faturas_emitidas) * 100',
        'variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100'
      ],
      validations: [
        'amount e fee devem ser números finitos maiores que zero (rejeitar números negativos e NaN com HTTP 400)',
        'description deve conter pelo menos 3 caracteres não-vazios após trim (HTTP 400)',
        'due_date e date devem estar no padrão ISO-8601 YYYY-MM-DD válido (HTTP 400)',
        'type deve pertencer exclusivamente ao conjunto ["income", "expense"] (HTTP 400)'
      ],
      envKeys: ['PORT=4000', 'NODE_ENV=development', 'DATABASE_PATH=./data/fintech.db', 'PIX_GATEWAY_KEY=mock_key_pix'],
      archetype: 'stripe',
      accentColor: '#6366f1'
    },

    devtools: {
      domainKey: 'devtools',
      domainName: 'Developer Tools & Issue Tracking',
      targetAudience: 'Engenheiros de software, tech leads e gerentes de produto que buscam ciclos rápidos, backlog sem atrito e rastreabilidade total.',
      referenceApps: ['Linear', 'Raycast', 'Vercel', 'GitHub'],
      marketBenchmark: 'Velocidade extrema (<50ms), navegação integral por atalhos de teclado (j/k/c), transições de estado instantâneas e foco em ciclos sem latência.',
      differentials: [
        'Navegação e ações 100% por atalhos de teclado (j/k para seleção, c para criar, e para concluir)',
        'Transições de estado instantâneas via Optimistic UI com sincronização resiliente em background',
        'Trilha forense completa com diff estruturado de cada alteração de requisito e status (/api/audit-logs)'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Issues Abertas: 24 (Δ% -8.0%)',
            'Velocidade do Ciclo: 48 pts/semana (Δ% +14.2%)',
            'Taxa de Conclusão: 91.5% (Δ% +3.5%)',
            'Lead Time Médio: 2.4 dias (Δ% -18.0%)'
          ],
          chart: 'Gráfico SVG Burndown do ciclo atual com linha ideal vs linha realizada em tabular-nums',
          gridColumns: ['ID', 'Prioridade', 'Título', 'Responsável', 'Estimativa', 'Status', 'Ciclo'],
          filters: ['Minhas Tarefas', 'Filtro por Prioridade (Urgent, High, Medium, Low)', 'Busca debounce'],
          drawerContent: 'Slide-Over de Issue com markdown renderizado, timeline de eventos, atribuição rápida e comandos Git',
          modalContent: 'Modal de Nova Issue (atalho "C") com título, descrição markdown, estimativa em pontos e labels',
          seedSummary: '24 issues divididas em Backlog, Todo, In Progress e Done'
        },
        {
          code: '02',
          name: 'Issues',
          tabId: 'issues',
          kpis: [
            'Backlog: 38 itens',
            'Em Andamento: 7 itens',
            'Em Revisão: 4 itens',
            'Concluídas no Ciclo: 19 itens'
          ],
          chart: 'Gráfico SVG de distribuição de issues por categoria técnica (Frontend, Backend, Infra, Bug)',
          gridColumns: ['Código', 'Título', 'Prioridade', 'Status', 'Responsável', 'Pontos', 'Atualizado Em', 'Ações'],
          filters: ['Status (Backlog, Todo, Doing, Review, Done)', 'Assignee', 'Busca debounce por título ou código'],
          drawerContent: 'Drawer com diff de alterações, comentários encadeados e links para branches Git',
          modalContent: 'Modal de Edição em Lote (Bulk Actions) para alteração de status e responsáveis',
          seedSummary: '30 issues realistas com códigos descritivos (ex: LIN-101 a LIN-130)'
        },
        {
          code: '03',
          name: 'Ciclos',
          tabId: 'ciclos',
          kpis: [
            'Ciclo Ativo: Ciclo 14 (7 dias restantes)',
            'Progresso do Escopo: 78%',
            'Pontos Comprometidos: 52 pts',
            'Escopo Adicionado pós-Início: 4 pts'
          ],
          chart: 'Gráfico SVG de velocidade histórica dos últimos 6 ciclos (Velocity Chart)',
          gridColumns: ['Ciclo #', 'Período', 'Pontos Estimados', 'Pontos Concluídos', 'Taxa de Entrega', 'Status'],
          filters: ['Ciclos Ativos', 'Histórico de Ciclos Concluídos'],
          drawerContent: 'Relatório retrospectivo do ciclo selecionado com lista de issues entregues',
          modalContent: 'Modal de Planejamento de Ciclo com definição de datas e alocação de capacidade',
          seedSummary: '6 ciclos de sprint com datas e métricas históricas de velocidade'
        },
        {
          code: '04',
          name: 'Auditoria',
          tabId: 'auditoria',
          kpis: [
            'Commits Auditados: 184',
            'Deploy Runs: 42 (100% sucesso)',
            'Tempo Médio de Build: 45s',
            'Rollbacks: 0'
          ],
          chart: 'Gráfico SVG de frequência diária de eventos e deploys',
          gridColumns: ['Data/Hora', 'Ator', 'Ação', 'Entidade', 'Identificador', 'Diff JSON', 'Ações'],
          filters: ['Filtro por Ator', 'Filtro por Ação (CREATE, UPDATE, DELETE)'],
          drawerContent: 'Visualizador de JSON Diff com destaque visual de adições e remoções',
          modalContent: 'Modal de Exportação de Trilha de Auditoria para auditorias de conformidade SOC2',
          seedSummary: '40 registros de auditoria cobrindo mudanças de status, atribuições e deploys'
        },
        {
          code: '05',
          name: 'Configuracoes',
          tabId: 'configuracoes',
          kpis: [
            'Projetos Conectados: 3',
            'Integração Git: Sincronizada',
            'Membros Ativos: 8',
            'Chaves de API: 2'
          ],
          chart: 'Gráfico SVG de consumo de API e webhooks por hora',
          gridColumns: ['Módulo', 'Configuração', 'Status', 'Última Sincronização', 'Ações'],
          filters: ['Geral', 'Segurança', 'Webhooks'],
          drawerContent: 'Painel de gerenciamento de permissões de usuários e webhooks',
          modalContent: 'Modal de Criação de Chave de Acesso Pessoal (Token de API)',
          seedSummary: 'Configurações de fluxo de trabalho, status personalizados e templates de issues'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - Developer Tools & Issue Tracking
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects (id)
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
  estimate_points INTEGER NOT NULL DEFAULT 1 CHECK (estimate_points >= 0),
  cycle_id TEXT,
  assignee_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cycle_id) REFERENCES cycles (id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (issue_id) REFERENCES issues (id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_issues_code ON issues (code);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues (status);
CREATE INDEX IF NOT EXISTS idx_issues_cycle ON issues (cycle_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Healthcheck operacional'
        },
        {
          method: 'GET',
          path: '/api/audit-logs',
          requestBody: 'Query: ?entity=&limit=',
          responseBody: 'Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>',
          description: 'Trilha de auditoria estruturada'
        },
        {
          method: 'GET',
          path: '/api/kpis',
          requestBody: 'N/A',
          responseBody: '{ openIssues: number, cycleVelocity: number, completionRate: number, leadTimeDays: number }',
          description: 'Métricas de engenharia e velocidade de sprint'
        },
        {
          method: 'GET',
          path: '/api/issues',
          requestBody: 'Query: ?status=&priority=&cycle_id=&q=',
          responseBody: 'Array<{ id: string, code: string, title: string, status: string, priority: string, estimate_points: number, assignee_name: string }>',
          description: 'Listagem filtrada de issues'
        },
        {
          method: 'POST',
          path: '/api/issues',
          requestBody: '{ title: string, description?: string, priority?: string, estimate_points?: number, cycle_id?: string, assignee_name?: string }',
          responseBody: '{ id: string, code: string, title: string, ... } (Status 201)',
          description: 'Criação de issue com geração automática de código sequencial'
        },
        {
          method: 'PUT',
          path: '/api/issues/:id',
          requestBody: '{ title?: string, status?: string, priority?: string, estimate_points?: number }',
          responseBody: '{ id: string, code: string, status: string, ... } (Status 200)',
          description: 'Atualização de status com registro de auditoria'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "issues" | "audit_logs" }',
          responseBody: 'Content-Type: text/csv',
          description: 'Exportação em lote de issues para CSV'
        }
      ],
      formulas: [
        'cycle_progress = (issues_completed / total_issues) * 100',
        'cycle_velocity = sum(completed_estimate_points) / duracao_dias',
        'lead_time_medio = avg(resolved_at - created_at)'
      ],
      validations: [
        'title deve ter pelo menos 3 caracteres (HTTP 400)',
        'estimate_points deve ser número inteiro >= 0 (HTTP 400)',
        'status deve ser um dos valores válidos do enum (HTTP 400)'
      ],
      envKeys: ['PORT=4000', 'DATABASE_PATH=./data/devtools.db'],
      archetype: 'linear',
      accentColor: '#5e6ad2'
    },

    health: {
      domainKey: 'health',
      domainName: 'Saúde, Clínicas & Gestão de Pacientes',
      targetAudience: 'Clínicas médicas, odontológicas e profissionais de saúde que exigem prontuário seguro, agenda eficiente e compliance com dados médicos.',
      referenceApps: ['Clinicorp', 'JaneApp', 'Feegow', 'Doctoralia'],
      marketBenchmark: 'Confirmação automatizada de consultas, prontuário ágil em poucos cliques com timeline cronológica e painel financeiro integrado.',
      differentials: [
        'Ficha clínica ágil com timeline cronológica e salvamento automático contínuo',
        'Disparo de lembretes preventivos e confirmação de presença com status visual em tempo real',
        'Painel financeiro integrado com cálculo automático de comissões por profissional'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Consultas do Dia: 18 (Δ% +12.5%)',
            'Pacientes Atendidos: 14',
            'Taxa de Ocupação: 88.0% (Δ% +4.0%)',
            'Taxa de No-Show: 3.2% (Δ% -1.8%)'
          ],
          chart: 'Gráfico SVG de distribuição de horários e ocupação da grade de consultórios',
          gridColumns: ['Horário', 'Paciente', 'Profissional', 'Procedimento', 'Status', 'Ações'],
          filters: ['Filtro por Profissional', 'Status (Aguardando, Em Atendimento, Concluído)'],
          drawerContent: 'Resumo clínico do paciente agendado, alertas de alergias e histórico prévio',
          modalContent: 'Modal de Agendamento Rápido com verificação de conflito de horários',
          seedSummary: '18 agendamentos para o dia com status diversificados'
        },
        {
          code: '02',
          name: 'Pacientes',
          tabId: 'pacientes',
          kpis: [
            'Total Cadastrados: 420 pacientes',
            'Novos no Mês: 34 (Δ% +18.2%)',
            'Em Tratamento Contínuo: 142',
            'Retornos Pendentes: 12'
          ],
          chart: 'Gráfico SVG de novos pacientes e evolução da base ativa mês a mês',
          gridColumns: ['ID', 'Nome', 'CPF/Documento', 'Data Nasc.', 'Telefone', 'Última Consulta', 'Status', 'Ações'],
          filters: ['Busca debounce por Nome ou CPF', 'Status Ativo/Inativo'],
          drawerContent: 'Slide-Over de Ficha do Paciente com prontuário, documentos e histórico de receitas',
          modalContent: 'Modal de Cadastro de Paciente com validação de CPF e dados de contato',
          seedSummary: '25 pacientes cadastrados com dados realistas e históricos de atendimento'
        },
        {
          code: '03',
          name: 'Tratamentos',
          tabId: 'tratamentos',
          kpis: [
            'Planos em Andamento: 48',
            'Valor Total em Aberto: R$ 86.400,00',
            'Taxa de Adesão a Planos: 74.5%',
            'Concluídos no Mês: 22'
          ],
          chart: 'Gráfico SVG de planos de tratamento por especialidade clínica',
          gridColumns: ['Plano #', 'Paciente', 'Título', 'Valor Total', 'Desconto', 'Status', 'Ações'],
          filters: ['Status (Proposto, Aprovado, Em Andamento, Concluído)'],
          drawerContent: 'Detalhamento de procedimentos do plano com checkboxes de evolução',
          modalContent: 'Modal de Novo Plano de Tratamento com seleção de procedimentos e orçamentos',
          seedSummary: '15 planos de tratamento clínicos com valores e status'
        },
        {
          code: '04',
          name: 'Financeiro',
          tabId: 'financeiro',
          kpis: [
            'Faturamento Bruto: R$ 94.200,00',
            'Particular: R$ 68.100,00',
            'Convênios: R$ 26.100,00',
            'Ticket Médio: R$ 420,00'
          ],
          chart: 'Gráfico SVG de receitas particulares vs repasses de convênio',
          gridColumns: ['Data', 'Paciente', 'Procedimento', 'Origem (Particular/Convênio)', 'Valor', 'Status'],
          filters: ['Origem', 'Período', 'Exportar CSV'],
          drawerContent: 'Detalhamento de faturamento e comprovantes de repasse',
          modalContent: 'Modal de Lançamento de Recebimento com emissão de recibo',
          seedSummary: '20 registros financeiros de atendimentos médicos e odontológicos'
        },
        {
          code: '05',
          name: 'Configuracoes',
          tabId: 'configuracoes',
          kpis: [
            'Profissionais Cadastrados: 5',
            'Especialidades: 4',
            'Convênios Integrados: 3',
            'Salas de Atendimento: 4'
          ],
          chart: 'Gráfico SVG de distribuição de atendimentos por sala e consultório',
          gridColumns: ['Item', 'Descrição', 'Valor Padrão', 'Duração Média', 'Status'],
          filters: ['Especialidades', 'Tabela de Procedimentos'],
          drawerContent: 'Edição de horários de atendimento por profissional',
          modalContent: 'Modal de Cadastro de Procedimento e Preço Base',
          seedSummary: 'Tabela base com 10 procedimentos médicos e especialidades configuradas'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - Saúde & Gestão Clínica
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT NOT NULL UNIQUE,
  birth_date TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  medical_alerts TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  practitioner_name TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'waiting', 'in_progress', 'completed', 'cancelled', 'no_show')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES patients (id)
);

CREATE TABLE IF NOT EXISTS treatment_plans (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_value REAL NOT NULL CHECK (total_value > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'in_progress', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES patients (id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patients_name ON patients (name);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Healthcheck operacional'
        },
        {
          method: 'GET',
          path: '/api/audit-logs',
          requestBody: 'Query: ?entity=&limit=',
          responseBody: 'Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>',
          description: 'Trilha de auditoria médica'
        },
        {
          method: 'GET',
          path: '/api/kpis',
          requestBody: 'N/A',
          responseBody: '{ appointmentsToday: number, occupancyRate: number, noShowRate: number, activePatients: number }',
          description: 'Indicadores clínicos do dia'
        },
        {
          method: 'GET',
          path: '/api/patients',
          requestBody: 'Query: ?q=&page=&limit=',
          responseBody: 'Array<{ id: string, name: string, document: string, phone: string, birth_date: string }>',
          description: 'Busca debounce de pacientes'
        },
        {
          method: 'POST',
          path: '/api/patients',
          requestBody: '{ name: string, document: string, birth_date: string, phone: string, email?: string, medical_alerts?: string }',
          responseBody: '{ id: string, name: string, ... } (Status 201)',
          description: 'Cadastro de paciente com validação estrita'
        },
        {
          method: 'GET',
          path: '/api/appointments',
          requestBody: 'Query: ?date=&status=&practitioner=',
          responseBody: 'Array<{ id: string, patient_id: string, scheduled_at: string, status: string, duration_min: number }>',
          description: 'Grade de agendamentos'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "patients" | "appointments" }',
          responseBody: 'Content-Type: text/csv',
          description: 'Exportação em lote de registros clínicos'
        }
      ],
      formulas: [
        'taxa_ocupacao_agenda = (slots_atendidos / slots_disponiveis) * 100',
        'ticket_medio_paciente = receita_total_clinica / total_pacientes_atendidos',
        'taxa_no_show = (agendamentos_faltantes / total_agendamentos) * 100'
      ],
      validations: [
        'name deve conter pelo menos 3 caracteres (HTTP 400)',
        'document deve ser um CPF/documento válido não duplicado (HTTP 400)',
        'scheduled_at deve ser uma data e hora futura válida em formato ISO (HTTP 400)'
      ],
      envKeys: ['PORT=4000', 'DATABASE_PATH=./data/health.db'],
      archetype: 'clean-saas',
      accentColor: '#0ea5e9'
    },

    general_saas: {
      domainKey: 'general_saas',
      domainName: 'SaaS Corporativo Moderno & Gestão de Operações',
      targetAudience: 'Empresas e gestores de processos que buscam visibilidade analítica, gestão de registros e trilha de auditoria completa.',
      referenceApps: ['Linear', 'Stripe', 'Supabase', 'Cal.com'],
      marketBenchmark: 'Aplicações SaaS de alta densidade entregam navegação por teclado, resposta em <100ms, persistência confiável em SQLite e conformidade com os 7 Pilares SaaS Master.',
      differentials: [
        'Arquitetura de 7 Pilares SaaS Master (App Shell, Drawers, Grids, KPIs, Trilha Forense, Reactive Store e Seed)',
        'Persistência factual de dados em SQLite nativo sem perda após F5',
        'Blindagem AppSec contra SQLi, XSS, Path Traversal e PORT_GUARD estrito (4000-4999)'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Total Registros: 148 (Δ% +14.0%)',
            'Taxa de Sucesso: 98.2% (Δ% +1.5%)',
            'Operações no Mês: 1.240 (Δ% +22.1%)',
            'Alertas Ativos: 0 (Resolvidos)'
          ],
          chart: 'Gráfico SVG interativo de evolução temporal das operações com tooltips formatados em tabular-nums',
          gridColumns: ['ID', 'Título', 'Categoria', 'Status', 'Valor', 'Atualizado Em', 'Ações'],
          filters: ['Todos os Status', 'Busca debounce por título ou código'],
          drawerContent: 'Slide-Over Drawer com visão detalhada do item, metadados JSON e histórico de auditoria',
          modalContent: 'Modal de Novo Registro com validação de campos obrigatórios',
          seedSummary: '20 registros corporativos realistas com categorias e status'
        },
        {
          code: '02',
          name: 'Registros',
          tabId: 'registros',
          kpis: [
            'Pendentes: 14',
            'Em Processamento: 6',
            'Concluídos: 122',
            'Arquivados: 6'
          ],
          chart: 'Gráfico SVG de distribuição de registros por categoria e prioridade',
          gridColumns: ['Código', 'Título', 'Categoria', 'Status', 'Prioridade', 'Responsável', 'Data', 'Ações'],
          filters: ['Status (Pendente, Processando, Concluído)', 'Categoria', 'Exportar CSV'],
          drawerContent: 'Drawer com edição inline rápida e histórico de modificações',
          modalContent: 'Modal de Criação e parametrização de novos registros',
          seedSummary: '25 itens detalhados com categorias e responsáveis atribuídos'
        },
        {
          code: '03',
          name: 'Operações',
          tabId: 'operacoes',
          kpis: [
            'Fila de Execuções: Vazia',
            'Taxa de Conclusão: 100%',
            'Duração Média: 120ms',
            'Erros de Execução: 0'
          ],
          chart: 'Gráfico SVG de latência de operações em tempo real',
          gridColumns: ['ID Operação', 'Tipo', 'Início', 'Duração', 'Status', 'Resultado'],
          filters: ['Filtrar por Status', 'Filtrar por Tipo de Operação'],
          drawerContent: 'Visualizador de logs detalhados da operação com traceback seguro',
          modalContent: 'Modal de Disparo de Operação Manual em Lote',
          seedSummary: '15 operações processadas com tempos de resposta medidos'
        },
        {
          code: '04',
          name: 'Auditoria',
          tabId: 'auditoria',
          kpis: [
            'Logs Registrados: 340',
            'Atores Distintos: 4',
            'Operações de Escrita: 280',
            'Tentativas Bloqueadas: 0'
          ],
          chart: 'Gráfico SVG de frequência diária de eventos auditados',
          gridColumns: ['Timestamp', 'Ator', 'Ação', 'Entidade', 'ID Alvo', 'Diff JSON', 'Ações'],
          filters: ['Ação (CREATE, UPDATE, DELETE)', 'Busca debounce por entidade'],
          drawerContent: 'Visualizador de diff estruturado com dados anteriores e novos',
          modalContent: 'Modal de Exportação de Trilha Forense em CSV e JSON',
          seedSummary: '30 logs de auditoria imutáveis com registros de criação e atualização'
        },
        {
          code: '05',
          name: 'Configuracoes',
          tabId: 'configuracoes',
          kpis: [
            'Versão do Sistema: 1.0.0',
            'Banco de Dados: SQLite WAL',
            'Ambiente: Homologação Local',
            'Tempo Online: 99.98%'
          ],
          chart: 'Gráfico SVG de consumo de memória e recursos do servidor',
          gridColumns: ['Parâmetro', 'Valor Atual', 'Padrão', 'Modificado Em', 'Ações'],
          filters: ['Parâmetros Gerais', 'Segurança', 'Integrações'],
          drawerContent: 'Painel de personalização de variáveis de ambiente e preferências',
          modalContent: 'Modal de Ajuste de Parâmetro com validação de tipo',
          seedSummary: 'Configurações de sistema com valores padrão de produção'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - SaaS Geral de Alta Densidade
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'archived')),
  value REAL NOT NULL DEFAULT 0 CHECK (value >= 0),
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_records_status ON records (status);
CREATE INDEX IF NOT EXISTS idx_records_category ON records (category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Healthcheck de integridade operacional do backend'
        },
        {
          method: 'GET',
          path: '/api/audit-logs',
          requestBody: 'Query: ?entity=&limit=',
          responseBody: 'Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>',
          description: 'Trilha de auditoria imutável com diff estruturado'
        },
        {
          method: 'GET',
          path: '/api/kpis',
          requestBody: 'N/A',
          responseBody: '{ totalRecords: number, successRate: number, monthlyOperations: number, activeAlerts: number }',
          description: 'Indicadores consolidados dos Cards de KPI'
        },
        {
          method: 'GET',
          path: '/api/records',
          requestBody: 'Query: ?status=&category=&q=&page=&limit=',
          responseBody: 'Array<{ id: string, title: string, category: string, status: string, value: number, updated_at: string }>',
          description: 'Listagem com busca debounce e filtros compostos'
        },
        {
          method: 'POST',
          path: '/api/records',
          requestBody: '{ title: string, category: string, value?: number, status?: string, metadata?: object }',
          responseBody: '{ id: string, title: string, ... } (Status 201)',
          description: 'Criação de registro com validação e log de auditoria'
        },
        {
          method: 'PUT',
          path: '/api/records/:id',
          requestBody: '{ title?: string, category?: string, value?: number, status?: string }',
          responseBody: '{ id: string, title: string, ... } (Status 200)',
          description: 'Atualização de registro com registro de diff forense'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "records" | "audit_logs" }',
          responseBody: 'Content-Type: text/csv',
          description: 'Exportação em lote de dados tabulares em CSV'
        }
      ],
      formulas: [
        'taxa_conclusao = (itens_concluidos / total_itens) * 100',
        'variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100'
      ],
      validations: [
        'title deve ter pelo menos 3 caracteres não vazios (HTTP 400)',
        'value deve ser numérico maior ou igual a zero (HTTP 400)',
        'category deve ser informada (HTTP 400)'
      ],
      envKeys: ['PORT=4000', 'DATABASE_PATH=./data/saas.db'],
      archetype: 'clean-saas',
      accentColor: '#3b82f6'
    }
  };

  /**
   * Resolves the best domain blueprint based on the user's briefing and context.
   */
  public static resolveDomainBlueprint(briefing: string): DomainSpecBlueprint {
    const raw = briefing || '';
    const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    if (/banco|finan|pagamento|cobran|fatura|pix|cartao|transac|saldo|extrato|inadimpl|ledger|conta\s*a\s*pagar/i.test(text)) {
      return this.DOMAIN_SPECS.fintech;
    }
    if (/dev|bug|issue|task|kanban|sprint|scrum|deploy|repositorio|git|engenharia|codigo|commit|backlog|linear/i.test(text)) {
      return this.DOMAIN_SPECS.devtools;
    }
    if (/saude|clinic|medico|paciente|consulta|prontuario|odont|dentist|terapia|hospital|remedio|receita/i.test(text)) {
      return this.DOMAIN_SPECS.health;
    }

    return this.DOMAIN_SPECS.general_saas;
  }

  /**
   * Generates the CONTEUDO.md document (Product Specification, Sections 01-Secao & REA).
   */
  public static generateConteudoSpec(projectName: string, briefing: string, blueprint: DomainSpecBlueprint): string {
    const sectionsBlock = blueprint.sections
      .map(
        s => `### Seção ${s.code}: ${s.name}
- **Navegação SPA:** \`role="tab"\` e \`data-tab="${s.tabId}"\` (captura visual obrigatória: \`${s.code}-${s.name}.png\`)
- **Cards de KPI (com cálculo de variação percentual Δ%):**
${s.kpis.map(k => `  - ${k}`).join('\n')}
- **Visualização Gráfica:** ${s.chart}
- **Data Grid de Alta Densidade:**
  - **Colunas:** ${s.gridColumns.join(', ')}
  - **Filtros e Busca:** ${s.filters.join('; ')}
  - **Exportação:** Botão "Exportar CSV" conectado a \`POST /api/export/csv\`
- **Slide-Over Detail Drawer:** ${s.drawerContent}
- **Modais de Ação:** ${s.modalContent}
- **Povoamento Realista (\`seedIfEmpty\`):** ${s.seedSummary}
`
      )
      .join('\n');

    return `# ESPECIFICAÇÃO DE PRODUTO, SEÇÕES & REA (CONTEUDO.MD)

> **Fonte Única de Verdade da Onda 0:** Este documento é o mapa canônico da interface, fluxos e conteúdo do **${projectName}**. Toda implementação frontend e backend deve cumprir rigorosamente as seções enumeradas abaixo.

---

## 1. Resumo Executivo & Benchmark de Mercado
- **Projeto:** ${projectName}
- **Nicho & Domínio:** ${blueprint.domainName}
- **Público-Alvo:** ${blueprint.targetAudience}
- **Aplicativos de Referência Mapeados:** ${blueprint.referenceApps.join(', ')}
- **Diagnóstico Competitivo de Mercado:**
  ${blueprint.marketBenchmark}
- **Briefing Original do Usuário:**
  *"${briefing.trim()}"*

---

## 2. Os 3 Diferenciais "10-Estrelas" Obrigatórios
${blueprint.differentials.map((d, i) => `${i + 1}. **${d.split(' - ')[0]}:** ${d}`).join('\n')}

---

## 3. Mapa Canônico de Seções da Aplicação (01-Secao a 05-Secao)
Todas as telas abaixo devem coexistir no layout em abas/seções navegáveis com persistência de estado e troca instantânea sem recarregar a página inteira:

${sectionsBlock}

---

## 4. Requisitos de Povoamento Inicial (\`seedIfEmpty\`)
- O servidor backend deve invocar obrigatoriamente \`seedIfEmpty()\` na inicialização caso a base SQLite esteja vazia.
- A base deve iniciar com **entre 15 e 30 registros ricos e realistas**, cobrindo todas as categorias, métodos e status definidos acima.
- Proibido iniciar com tabelas zeradas ou dados artificiais ("Teste 1", "Lorem Ipsum").
`;
  }

  /**
   * Generates the DESIGN.md document (Archetype, CSS Tokens, Typography & States).
   */
  public static generateDesignSpec(projectName: string, briefing: string, blueprint: DomainSpecBlueprint): string {
    const profile = DesignSkillService.inferDesignProfile(briefing);
    let aestheticSkillName = 'linear-skill';
    if (profile.archetype === 'minimalist') aestheticSkillName = 'minimalist-skill';
    else if (profile.archetype === 'soft') aestheticSkillName = 'soft-skill';
    else if (profile.archetype === 'brutalist') aestheticSkillName = 'brutalist-skill';
    else if (profile.archetype === 'stripe' || profile.archetype === 'fintech') aestheticSkillName = 'stripe-skill';
    else if (profile.archetype === 'vercel') aestheticSkillName = 'vercel-skill';
    else if (profile.archetype === 'linear') aestheticSkillName = 'linear-skill';
    else aestheticSkillName = `${profile.archetype}-skill`;

    return `# SISTEMA DE DESIGN VISUAL ANTI-SLOP & DIRETRIZES DE UI (DESIGN.MD)

> **Fonte Canônica de Design do ${projectName}:** Este documento dita as cores, tipografia, tokens CSS, coreografia e estados de interface que impedem qualquer degradação de qualidade visual (Anti-Slop).

---

## 1. Arquétipo Visual, Dials & Habilidades de Design Injetadas Autonomamente
- **Arquétipo Selecionado:** \`${profile.archetype.toUpperCase()}\` (${profile.description})
- **Skill Estética Injetada Automaticamente:** \`${aestheticSkillName}\` (autonomamente provisionada para o nicho "${blueprint.domainName}" sem necessidade de slash commands manuais)
- **Dials de Taste:**
  - **Variância:** ${profile.dials.variance}/10 (Equilíbrio e Simetria)
  - **Movimento:** ${profile.dials.motion}/10 (Transições CSS Suaves <150ms)
  - **Densidade:** ${profile.dials.density}/10 (Cockpit de Alta Densidade / SaaS Master)

---

## 2. Paleta de Tokens CSS Semânticos Obrigatórios (\`:root\`)
Todo estilo de componentes deve consumir estritamente as variáveis abaixo, proibindo cores hexadecimais soltas nas regras CSS:

\`\`\`css
:root {
  /* Superfícies & Fundos */
  --bg-primary: #090d16;
  --bg-surface: #111726;
  --bg-elevated: #1a2236;

  /* Tipografia & Contraste */
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;

  /* Cor de Ação & Destaque */
  --accent-primary: ${blueprint.accentColor};
  --accent-hover: #4f46e5;
  --accent-subtle: rgba(99, 102, 241, 0.12);

  /* Bordas & Divisores */
  --border-subtle: #1e293b;
  --border-strong: #334155;

  /* Estados Semânticos */
  --status-success: #10b981;
  --status-warning: #f59e0b;
  --status-danger: #ef4444;
  --status-info: #0ea5e9;

  /* Raios e Tipografia */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', Menlo, Consolas, monospace;
}
\`\`\`

---

## 3. Regras Tipográficas & Numéricas
- **Interface Principal:** Fonte \`Inter\` para labels, títulos e textos com espaçamento reduzido e peso 500/600.
- **Regra Numérica Obrigatória (\`tabular-nums\`):** Todos os valores monetários, percentuais, contadores, datas e células numéricas de Data Grid devem aplicar:
  \`\`\`css
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  font-family: var(--font-mono);
  \`\`\`

---

## 4. Especificação de Componentes
- **Botões:** Estados \`:hover\`, \`:active\` (\`transform: scale(0.98)\`) e \`:disabled\` com opacidade 0.5.
- **Inputs & Selects:** Borda \`--border-subtle\`, foco com outline de 2px em \`--accent-primary\` e transição suave.
- **Command Palette (\`Ctrl+K\`):** Overlay elevado em \`--bg-elevated\`, pesquisa debounce e atalhos rápidos de navegação.
- **Slide-Over Detail Drawer:** Animação lateral suave a partir da direita (\`transform: translateX(0)\`) com backdrop blur.
- **Ícones:** Uso exclusivo de **ícones SVG Lucide inline** (24x24 ou 16x16, stroke-width 2). **Zero emojis nativos como ícones.**

---

## 5. Os 4 Estados Visuais Obrigatórios em Cada Tela
1. **Loading Skeleton:** Shimmer translúcido ocupando a área exata dos cards e tabelas durante requisições.
2. **Empty State:** Ícone SVG temático suave, mensagem explicativa clara e botão primário para criar o primeiro registro.
3. **Populated State:** Grade rica com alta densidade, paginação, busca instantânea e ordenação.
4. **Error Toast:** Alerta flutuante com auto-dismiss (4s) e opção de repetição da ação.
`;
  }

  /**
   * Generates the BACKEND.md document (SQLite Schemas, REST Contracts & Domain Formulas).
   */
  public static generateBackendSpec(projectName: string, briefing: string, blueprint: DomainSpecBlueprint): string {
    const contractsTable = blueprint.restContracts
      .map(c => `| \`${c.method}\` | \`${c.path}\` | \`${c.requestBody}\` | \`${c.responseBody}\` | ${c.description} |`)
      .join('\n');

    return `# ESPECIFICAÇÃO DE BACKEND, BANCO SQLITE & CONTRATOS REST (BACKEND.MD)

> **Contrato Canônico do Backend do ${projectName}:** Este documento é a Fonte Única de Verdade para schemas de banco de dados SQLite, contratos de requisição/resposta das rotas REST e fórmulas de domínio. O frontend (\`public/app.js\`) e o backend (\`src/server.js\`) devem consumir estritamente os mesmos nomes de propriedades JSON.

---

## 1. Esquema Relacional SQLite Completo
O arquivo do banco de dados deve ser inicializado pelo backend utilizando o utilitário nativo \`node:sqlite\` (DatabaseSync) com suporte obrigatório a \`PRAGMA journal_mode = WAL;\` e \`PRAGMA busy_timeout = 10000;\`.

\`\`\`sql
${blueprint.sqliteSchema}
\`\`\`

---

## 2. Tabela Canônica de Contratos REST da API
Todas as rotas da API devem ser prefixadas com \`/api/\`. A rota raiz \`GET /\` é estritamente reservada à entrega da interface web (\`public/index.html\`).

| Método | Caminho | Request Body JSON | Response JSON | Descrição |
| :--- | :--- | :--- | :--- | :--- |
${contractsTable}

---

## 3. Fórmulas Matemáticas & Validações de Domínio
### Fórmulas de Domínio
${blueprint.formulas.map(f => `- \`${f}\``).join('\n')}

### Regras de Validação HTTP 400 (Bad Request)
${blueprint.validations.map(v => `- **Validação:** ${v}`).join('\n')}
- Payloads com campos nulos, strings vazias após \`.trim()\`, valores negativos para quantias financeiras ou \`NaN\` devem retornar status HTTP 400 com JSON estruturado:
  \`\`\`json
  {
    "error": "ValidationError",
    "message": "Descrição amigável e precisa do campo inválido"
  }
  \`\`\`

---

## 4. Integrações DOCSIMP & Dual-Mode Fallback
### Adaptadores de Domínio DOCSIMP Ativos
- **better-sqlite3 / DatabaseSync:** Banco de dados relacional embutido com WAL mode (\`PRAGMA journal_mode = WAL;\`) e timeouts defensivos (\`PRAGMA busy_timeout = 10000;\`).
- **express / node:http:** Roteamento determinístico REST com validação de payload síncrona e códigos de erro amigáveis.
- **lucide-icons:** Ícones vetoriais SVG inline estruturados para navegação semântica em abas.
- **Nicho & Domínio Ativo (DOCSIMP):** Adaptadores de **${blueprint.domainName}** (${blueprint.domainKey === 'health' ? 'HEALTHCARE_APPOINTMENTS' : blueprint.domainKey === 'devtools' ? 'DEVTOOLS_ISSUES' : 'FINANCE_SAAS'}) provisionados autonomamente pelo MarketDiscoveryService na Onda 0.

### Chaves de Ambiente & Graceful Mock Fallback
O backend deve operar de modo 100% autônomo e offline através de Graceful Mock Fallback:
\`\`\`bash
${blueprint.envKeys.join('\n')}
\`\`\`
- Se as chaves externas não forem configuradas no ambiente, o sistema não deve falhar nem lançar exceções; ele deve utilizar geradores determinísticos em memória garantindo resposta aos endpoints REST.
`;
  }

  /**
   * Generates the PRINCIPIOS.md document (Karpathy Invariants, AppSec & Operations).
   */
  public static generatePrincipiosSpec(projectName: string): string {
    return `# PRINCÍPIOS DE ENGENHARIA, APPSEC & INVARIANTES OPERACIONAIS (PRINCIPIOS.MD)

> **Constituição Canônica de Engenharia do ${projectName}:** Regras de ouro derivadas dos princípios de Andrej Karpathy e das defesas Red Team AppSec do DecoHUB.

---

## 1. Os 6 Princípios Globais de Engenharia (Andrej Karpathy)
1. **THINK BEFORE CODING:** Identifique premissas, ambiguidades e a menor solução antes de tocar no código. Em execuções autônomas (\`run_id\` ativo), é **estritamente proibido invocar \`ask_question\`** ou bloquear o terminal; resolva qualquer ambiguidade consultando os 5 documentos canônicos em \`.ai-dev-hub/specs/\` (\`PRINCIPIOS.md\`, \`CONTEUDO.md\`, \`BACKEND.md\`, \`DESIGN.md\`, \`JORNADAS.md\`).
2. **SIMPLICITY FIRST:** Menor implementação correta que resolve 100% do problema. Zero abstrações para uso único. Simplicidade NUNCA significa produto raso: entregue os 7 Pilares SaaS Master e povoamento realista via \`seedIfEmpty()\`.
3. **SURGICAL CHANGES:** Toque apenas nos arquivos indispensáveis ao escopo da tarefa. Nunca reformatar código adjacente ou quebrar contratos já validados em suítes anteriores.
4. **GOAL-DRIVEN VERIFICATION:** Cada tarefa deve ser verificada por comando simples compatível com \`controlledVerification.ts\` (sem encadeamentos como \`&&\`, \`;\`, \`||\`, \`|\` ou \`node -e\`).
5. **OPERATIONAL AUTONOMY:** Processos e servidores efêmeros criados em testes devem ser encerrados obrigatoriamente em blocos \`try / finally\` (\`server.stop()\`). Proibição absoluta de alterar ou enfraquecer testes protegidos (\`TAMPERING_DETECTED\`).
6. **FULL-STACK, APPSEC & ANTI-SLOP INVARIANTS:** Cumprir todas as salvaguardas de rede, roteamento e segurança listadas a seguir.

---

## 2. Rede & Regra PORT_GUARD
- O servidor da aplicação deve ler a porta exclusivamente de \`Number(process.env.PORT) || 4000\`, operando na faixa **4000 a 4999**.
- **PROIBIÇÃO ESTRITA:** É terminantemente proibido utilizar as portas **\`3001\`**, **\`3000\`** ou **\`5173\`**, que são reservadas aos processos do DecoHUB.

---

## 3. Roteamento Full-Stack & Entrega Estática
- A rota raiz \`GET /\` deve servir estritamente o arquivo HTML da aplicação (\`public/index.html\`) com fallback para rotas de SPA caso não possuam extensão de arquivo.
- O endpoint de status operacional deve residir exclusivamente em \`GET /api/health\`.
- **ANTI-PADRÃO PROIBIDO (\`ROOT_ROUTE_HIJACKED_BY_JSON\`):** A rota \`GET /\` jamais deve responder com JSON de API.

---

## 4. Blindagem AppSec Red Team (OWASP Top 10)
- **SQL Injection:** 100% das queries SQLite devem utilizar queries parametrizadas com placeholders \`?\` (ex: \`db.prepare('SELECT * FROM t WHERE id = ?').get(id)\`). Concatenação de variáveis em SQL é proibida.
- **Cross-Site Scripting (XSS):** Todo dado dinâmico injetado no DOM via \`innerHTML\` deve passar obrigatoriamente pela função \`escapeHtml()\`. Sempre que possível, utilize \`element.textContent\` ou \`document.createElement\`.
- **Path Traversal:** O servidor de arquivos estáticos deve verificar canonicamente se o caminho do arquivo resolvido inicia com o diretório base:
  \`safePath = path.normalize(path.join(publicDir, reqPath)); safePath.startsWith(resolvedPublicDir)\`. Violações devem retornar HTTP 403 Forbidden.
- **Cabeçalhos de Segurança:** Todas as respostas HTTP devem incluir \`X-Content-Type-Options: nosniff\` e tipos MIME precisos (\`text/html; charset=utf-8\`, \`application/json; charset=utf-8\`).

---

## 5. Fidelidade de Persistência pós-F5
- Ao recarregar a página (evento \`DOMContentLoaded\`), o script \`public/app.js\` deve obrigatoriamente disparar chamadas \`fetch()\` aos endpoints da API (\`/api/kpis\`, \`/api/transactions\`, etc.) para hidratar o estado da tela com dados factuais do SQLite.
- Proibido manter dados apenas em variáveis voláteis de memória do navegador.
`;
  }

  /**
   * Generates the JORNADAS.md document (Visual Inspection Routes, UX Simulator F5 Scenarios & AppSec Pentest Rules).
   */
  public static generateJornadasSpec(
    projectName: string,
    briefing: string,
    blueprint: DomainSpecBlueprint
  ): string {
    const visualSections = blueprint.sections
      .map(
        s => `### Seção ${s.code}: ${s.name}
- **Aba de Navegação:** \`[data-tab="${s.tabId}"]\` (com \`role="tab"\`)
- **Arquivo de Snapshot Obrigatório:** \`${s.code}-${s.name.replace(/[^a-zA-Z0-9]/g, '')}.png\`
- **Elementos Visuais a Validar:**
  - App Shell visível com Sidebar estruturada e Topbar com Workspace selector
  - Cards de KPIs com formatação \`tabular-nums\` e badges de variação percentual (\`Δ%\`)
  - ${s.chart}
  - Data Grid povoado com linhas realistas (mínimo 5 itens visíveis)
  - Botão de ação primária ativo (ex.: "${s.modalContent.split(' com ')[0]}")
`
      )
      .join('\n');

    return `# JORNADAS DE TESTE, VALIDAÇÃO VISUAL & HOMOLOGAÇÃO (JORNADAS.MD)

> **Fonte Canônica de Jornadas do ${projectName}:** Este documento dita as jornadas automatizadas de ponta a ponta, roteiros visuais para o PlaywrightVisualInspector, cenários de experiência do usuário (UX) com persistência pós-reload (F5) e regras de validação Red Team (AppSec).

---

## 1. Roteiro Visual de Seções & Snapshots (PlaywrightVisualInspector)
Para cada seção da aplicação, o agente visual deve navegar até a aba via atributo \`data-tab\`, aguardar estabilização do DOM (<150ms) e capturar a evidência fotográfica em formato PNG enumerado:

${visualSections}

---

## 2. Cenários de Experiência do Usuário & Persistência F5 (UserExperienceSimulator)
O simulador de experiência de usuário deve executar e validar os seguintes fluxos interativos:

### Cenário 1: Ciclo Completo de Criação e Persistência Pós-Reload (F5)
1. **Disparo:** Clicar no botão de criação primário da aba ativa (ex.: "Novo Registro" / "Adicionar").
2. **Modal Interativo:** O modal deve abrir suavemente com foco no primeiro input editável.
3. **Preenchimento de Dados:** Inserir dados válidos de teste com valores coerentes e numéricos positivos.
4. **Submissão & Optimistic UI:** Ao enviar o formulário:
   - Notificação Toast de sucesso deve surgir imediatamente.
   - O modal deve fechar sem erro no console do navegador.
   - A linha criada deve ser inserida imediatamente no Data Grid.
5. **Teste de Persistência F5:**
   - O simulador executa um recarregamento completo da página (\`F5\` / reload do navegador).
   - O evento \`DOMContentLoaded\` dispara \`fetch('/api/...')\` e o registro criado continua presente no Data Grid, comprovando persistência física em SQLite.

### Cenário 2: Slide-Over Detail Drawer & Edição Rápida Inline
1. **Abertura do Drawer:** Clicar em qualquer registro do Data Grid abre o painel lateral deslizante (\`transform: translateX(0)\`).
2. **Navegação em Sub-Abas:** Alternar entre sub-abas (Detalhes, Notas e Histórico de Auditoria).
3. **Edição Inline:** Alterar um campo permitido (ex.: status ou categoria) e validar persistência imediata com feedback visual.

---

## 3. Matriz de Segurança, Validação de Entrada & Pentest (SecurityPentestSimulator)
O simulador de pentest Red Team executará asserções contra todas as mutações (\`POST\`, \`PUT\`, \`DELETE\`):

### Regras de Validação de Entrada (HTTP 400 Bad Request)
- **Valores Negativos ou Zero em Campos Monetários/Quantitativos:**
  - Payload com \`valor < 0\` ou \`valor = 0\` (onde positivo é obrigatório) deve retornar estritamente HTTP 400 com JSON amigável (\`{ "error": "ValidationError", ... }\`).
- **Valores Não Numéricos (NaN / strings alfanuméricas em campos numéricos):**
  - Payload com \`valor: "abc"\` ou \`NaN\` deve ser interceptado com HTTP 400 antes de atingir o banco de dados.
- **Campos Obrigatórios Vazios:**
  - Strings com espaços em branco após \`.trim()\` devem ser rejeitadas com HTTP 400.

### Mitigação de Injeção & XSS (OWASP Top 10)
- **SQL Injection (SQLi):**
  - Todas as consultas ao banco SQLite devem utilizar exclusivamente queries parametrizadas com placeholders \`?\`.
  - Proibida concatenação de strings ou interpolação de variáveis em instruções SQL (\`"SELECT ... WHERE id = " + id\`).
- **Cross-Site Scripting (XSS):**
  - Qualquer dado vindo do backend ou input do usuário deve passar por sanitização via \`escapeHtml()\` antes de ser injetado em \`innerHTML\` no frontend.
- **Vazamento de Segredos (Secret Leak):**
  - Arquivos estáticos em \`public/\` não devem conter chaves de API sensíveis, senhas ou tokens privados hardcoded.
`;
  }

  /**
   * Main entrypoint: generates and persists all 4 living spec files in .ai-dev-hub/specs/
   * and mirrors DESIGN.md to project root.
   */
  public static async generateAndPersistLivingSpecs(
    input: GenerateLivingSpecsInput
  ): Promise<GeneratedLivingSpecsResult> {
    const { projectName, projectPath, briefing } = input;
    const resolvedProjectPath = path.resolve(projectPath);
    const specsDir = path.join(resolvedProjectPath, '.ai-dev-hub', 'specs');

    Logger.info(`[ProjectLivingSpecService] Onda 0: Gerando especificações vivas para "${projectName}" em ${specsDir}...`);

    if (!fs.existsSync(specsDir)) {
      fs.mkdirSync(specsDir, { recursive: true });
    }

    // 1. Run upstream Onda 0 discovery services in non-blocking fashion
    try {
      await MarketDiscoveryService.conductPreBlueprintDiscovery({
        briefing,
        projectName,
        projectPath: resolvedProjectPath,
        model: input.model
      });
    } catch (err: any) {
      Logger.warn(`[ProjectLivingSpecService] Falha não bloqueante em MarketDiscoveryService: ${err.message}`);
    }

    try {
      await DesignSkillService.provisionDesignSkillsForProject(briefing, resolvedProjectPath);
    } catch (err: any) {
      Logger.warn(`[ProjectLivingSpecService] Falha não bloqueante em DesignSkillService: ${err.message}`);
    }

    try {
      await ReaSaaSMasterService.provisionReaBlueprintForProject(resolvedProjectPath, briefing);
    } catch (err: any) {
      Logger.warn(`[ProjectLivingSpecService] Falha não bloqueante em ReaSaaSMasterService: ${err.message}`);
    }

    try {
      await DocSimpService.resolveDocsForBriefing(briefing, resolvedProjectPath);
    } catch (err: any) {
      Logger.warn(`[ProjectLivingSpecService] Falha não bloqueante em DocSimpService: ${err.message}`);
    }

    // 2. Synthesize domain blueprint
    const blueprint = this.resolveDomainBlueprint(briefing);

    // 3. Assemble document contents
    const conteudoContent = this.generateConteudoSpec(projectName, briefing, blueprint);
    const designContent = this.generateDesignSpec(projectName, briefing, blueprint);
    const backendContent = this.generateBackendSpec(projectName, briefing, blueprint);
    const principiosContent = this.generatePrincipiosSpec(projectName);
    const jornadasContent = this.generateJornadasSpec(projectName, briefing, blueprint);

    // 4. Persist 5 physical canonical files in .ai-dev-hub/specs/
    const conteudoMdPath = path.join(specsDir, 'CONTEUDO.md');
    const designMdPath = path.join(specsDir, 'DESIGN.md');
    const backendMdPath = path.join(specsDir, 'BACKEND.md');
    const principiosMdPath = path.join(specsDir, 'PRINCIPIOS.md');
    const jornadasMdPath = path.join(specsDir, 'JORNADAS.md');
    const designMdRootPath = path.join(resolvedProjectPath, 'DESIGN.md');
    const agentsMdRootPath = path.join(resolvedProjectPath, 'AGENTS.md');

    fs.writeFileSync(conteudoMdPath, conteudoContent, 'utf-8');
    fs.writeFileSync(designMdPath, designContent, 'utf-8');
    fs.writeFileSync(backendMdPath, backendContent, 'utf-8');
    fs.writeFileSync(principiosMdPath, principiosContent, 'utf-8');
    fs.writeFileSync(jornadasMdPath, jornadasContent, 'utf-8');

    // 5. Mirror DESIGN.md to project root
    fs.writeFileSync(designMdRootPath, designContent, 'utf-8');

    // 6. Generate AGENTS.md in project root with canonical living specs references
    const canonicalAgentsMdContent = [
      `# Arquitetura e Especificações Oficiais do Projeto (DecoHUB Living Specs)`,
      `Consulte obrigatoriamente as especificações canônicas abaixo antes de modificar qualquer arquivo:`,
      `- Princípios e Invariantes: @.ai-dev-hub/specs/PRINCIPIOS.md`,
      `- Conteúdo, Seções e REA: @.ai-dev-hub/specs/CONTEUDO.md`,
      `- Design System e UI: @.ai-dev-hub/specs/DESIGN.md`,
      `- Contratos de Banco e API: @.ai-dev-hub/specs/BACKEND.md`,
      `- Jornadas de Teste e Homologação: @.ai-dev-hub/specs/JORNADAS.md`,
      ``
    ].join('\n');

    if (!fs.existsSync(agentsMdRootPath)) {
      fs.writeFileSync(agentsMdRootPath, canonicalAgentsMdContent, 'utf-8');
    } else {
      const existing = fs.readFileSync(agentsMdRootPath, 'utf-8');
      if (!existing.includes('@.ai-dev-hub/specs/')) {
        fs.writeFileSync(agentsMdRootPath, canonicalAgentsMdContent + '\n---\n\n' + existing, 'utf-8');
      }
    }

    Logger.info(`[ProjectLivingSpecService] Onda 0: 5 especificações vivas gravadas com sucesso em ${specsDir} e AGENTS.md provisionado na raiz.`);

    let executiveCardResult: { posted: boolean; messageId?: string; content: string } | undefined;
    if (input.projectId) {
      executiveCardResult = this.postWaveZeroExecutiveCardToChat(
        input.projectId,
        resolvedProjectPath,
        blueprint,
        input.runId
      );
    }

    return {
      conteudoMdPath,
      designMdPath,
      backendMdPath,
      principiosMdPath,
      jornadasMdPath,
      designMdRootPath,
      agentsMdRootPath,
      specsDir,
      filesGenerated: [conteudoMdPath, designMdPath, backendMdPath, principiosMdPath, jornadasMdPath, designMdRootPath, agentsMdRootPath],
      executiveCard: executiveCardResult?.content,
      chatMessageId: executiveCardResult?.messageId
    };
  }

  /**
   * Helper that clamps string length between minLen and maxLen cleanly,
   * avoiding arbitrary middle-of-word truncation.
   */
  private static clampContextLength(text: string, minLen = 1500, maxLen = 3500): string {
    if (text.length > maxLen) {
      const cutTarget = maxLen - 120;
      const lastNl = text.lastIndexOf('\n', cutTarget);
      const safeIndex = lastNl > minLen ? lastNl : cutTarget;
      return (
        text.slice(0, safeIndex) +
        '\n\n[...especificações completas detalhadas nos documentos canônicos @.ai-dev-hub/specs/]\n=== FIM DA ESPECIFICAÇÃO VIVA ==='
      );
    }
    return text;
  }

  /**
   * Builds a lean, surgical, role-routed specification block (between 1,500 and 3,500 characters, strictly <= 3,800 chars)
   * that serves as the Single Source of Truth for builders and supervisors.
   */
  public static getRoleSpecificSpecContext(projectPath: string, taskRole: SpecTaskRole): string {
    const resolvedPath = path.resolve(projectPath);
    const specsDir = path.join(resolvedPath, '.ai-dev-hub', 'specs');

    const readSpecSafe = (filename: string): string => {
      const p = path.join(specsDir, filename);
      if (fs.existsSync(p)) {
        try {
          return fs.readFileSync(p, 'utf-8');
        } catch {
          return '';
        }
      }
      return '';
    };

    const conteudoRaw = readSpecSafe('CONTEUDO.md');
    const designRaw = readSpecSafe('DESIGN.md');
    const backendRaw = readSpecSafe('BACKEND.md');
    const principiosRaw = readSpecSafe('PRINCIPIOS.md');
    const jornadasRaw = readSpecSafe('JORNADAS.md');

    const header = [
      `=== ESPECIFICAÇÃO VIVA DA ONDA 0 (FONTE ÚNICA DA VERDADE) ===`,
      `Documentos Canônicos: @.ai-dev-hub/specs/CONTEUDO.md | @.ai-dev-hub/specs/DESIGN.md | @.ai-dev-hub/specs/BACKEND.md | @.ai-dev-hub/specs/PRINCIPIOS.md | @.ai-dev-hub/specs/JORNADAS.md`,
      `Diretriz: O Worker NÃO deve criar arquivos soltos em .ai-dev-hub/notes/; toda implementação deve seguir estritamente os contratos canônicos abaixo.`
    ].join('\n');

    let body = '';

    switch (taskRole) {
      case 'WORKER_BACKEND': {
        // Extract SQLite schema, REST contracts table, domain formulas and HTTP 400 validation
        const schemaExtract = backendRaw.includes('## 1. Esquema Relacional SQLite Completo')
          ? backendRaw.split('## 1. Esquema Relacional SQLite Completo')[1]?.split('## 2.')[0]?.trim() || ''
          : '';
        const routesExtract = backendRaw.includes('## 2. Tabela Canônica de Contratos REST da API')
          ? backendRaw.split('## 2. Tabela Canônica de Contratos REST da API')[1]?.split('## 3.')[0]?.trim() || ''
          : '';

        body = [
          `\n[PAPEL DO WORKER: BACKEND & BANCO DE DADOS]`,
          `1. TABELAS SQLITE OBRIGATÓRIAS (node:sqlite com WAL):`,
          schemaExtract.slice(0, 850),
          `\n2. ROTAS REST OBRIGATÓRIAS & CONTRATOS JSON:`,
          routesExtract.slice(0, 850),
          `\n3. INVARIANTES BACKEND & APPSEC (PRINCIPIOS.MD):`,
          `- Queries parametrizadas com placeholders '?' (SQLi Red Team)`,
          `- HTTP 400 em payloads inválidos (valores negativos, NaN, strings vazias após trim)`,
          `- PORT_GUARD: porta de Number(process.env.PORT) || 4000 (faixa 4000-4999; proibido 3001/3000/5173)`,
          `- GET /api/health retorna JSON de status operacional; GET / serve public/index.html`,
          `\n4. REQUISITOS DE SEED (CONTEUDO.MD):`,
          `- seedIfEmpty() obrigatório na inicialização gerando entre 15 e 30 registros ricos e realistas.`
        ].join('\n');
        break;
      }

      case 'WORKER_FRONTEND': {
        // Extract sections map from CONTEUDO.md, CSS tokens from DESIGN.md, routes table from BACKEND.md
        const sectionsExtract = conteudoRaw.includes('## 3. Mapa Canônico de Seções da Aplicação')
          ? conteudoRaw.split('## 3. Mapa Canônico de Seções da Aplicação')[1]?.split('## 4.')[0]?.trim() || ''
          : '';
        const tokensExtract = designRaw.includes('## 2. Paleta de Tokens CSS Semânticos')
          ? designRaw.split('## 2. Paleta de Tokens CSS Semânticos')[1]?.split('## 3.')[0]?.trim() || ''
          : '';
        const routesExtract = backendRaw.includes('## 2. Tabela Canônica de Contratos REST da API')
          ? backendRaw.split('## 2. Tabela Canônica de Contratos REST da API')[1]?.split('## 3.')[0]?.trim() || ''
          : '';
        const realContractsExtract = backendRaw.includes('## CONTRATOS REAIS IMPLEMENTADOS EM DISCO (VERIFICADOS)')
          ? backendRaw.split('## CONTRATOS REAIS IMPLEMENTADOS EM DISCO (VERIFICADOS)')[1]?.slice(0, 350)?.trim() || ''
          : '';

        body = [
          `\n[PAPEL DO WORKER: FRONTEND & DESIGN ANTI-SLOP]`,
          `1. SEÇÕES OBRIGATÓRIAS DA INTERFACE (CONTEUDO.MD):`,
          sectionsExtract.slice(0, 850),
          `\n2. TOKENS CSS :ROOT & TIPOGRAFIA (DESIGN.MD):`,
          tokensExtract.slice(0, 550),
          `\n3. CONTRATOS REST PARA FETCH NO FRONTEND (BACKEND.MD):`,
          routesExtract.slice(0, 550),
          realContractsExtract ? `\n3.1. ROTAS & TABELAS REAIS IMPLEMENTADAS NO BACKEND:\n${realContractsExtract}` : '',
          `\n4. DIRETRIZES DE DESIGN & APPSEC (PRINCIPIOS.MD):`,
          `- font-variant-numeric: tabular-nums obrigatório em valores monetários e tabelas`,
          `- Ícones: uso exclusivo de SVGs Lucide inline (proibido emojis como ícones)`,
          `- 4 Estados Visuais: Loading Skeleton, Empty State, Populated State, Error Toast`,
          `- escapeHtml() obrigatório em qualquer injeção dinâmica de dados no DOM`,
          `- Persistência pós-F5: DOMContentLoaded recarregando dados reais via fetch('/api/...')`
        ].filter(Boolean).join('\n');
        break;
      }

      case 'WORKER_TEST':
      case 'WORKER_FULLSTACK': {
        const routesExtract = backendRaw.includes('## 2. Tabela Canônica de Contratos REST da API')
          ? backendRaw.split('## 2. Tabela Canônica de Contratos REST da API')[1]?.split('## 3.')[0]?.trim() || ''
          : '';
        const sectionsExtract = conteudoRaw.includes('## 3. Mapa Canônico de Seções da Aplicação')
          ? conteudoRaw.split('## 3. Mapa Canônico de Seções da Aplicação')[1]?.split('## 4.')[0]?.trim() || ''
          : '';
        const visualJourneys = jornadasRaw.includes('## 1. Roteiro Visual de Seções')
          ? jornadasRaw.split('## 1. Roteiro Visual de Seções')[1]?.split('## 2.')[0]?.slice(0, 450)?.trim() || ''
          : '';
        const uxJourneys = jornadasRaw.includes('## 2. Cenários de Experiência do Usuário')
          ? jornadasRaw.split('## 2. Cenários de Experiência do Usuário')[1]?.split('## 3.')[0]?.slice(0, 450)?.trim() || ''
          : '';

        body = [
          `\n[PAPEL DO WORKER: FULLSTACK & VERIFICAÇÃO AUTOMATIZADA]`,
          `1. CONTRATOS DE API & ENDPOINTS A TESTAR (BACKEND.MD):`,
          routesExtract.slice(0, 700),
          `\n2. SEÇÕES & NAVEGAÇÃO DA APLICAÇÃO (CONTEUDO.MD):`,
          sectionsExtract.slice(0, 650),
          visualJourneys ? `\n3. ROTEIRO DE SNAPSHOTS PLAYWRIGHT (JORNADAS.MD):\n${visualJourneys}` : '',
          uxJourneys ? `\n4. CENÁRIOS DE PERSISTÊNCIA F5 & UX (JORNADAS.MD):\n${uxJourneys}` : '',
          `\n5. INVARIANTES DE OPERAÇÃO & VERIFICAÇÃO (PRINCIPIOS.MD):`,
          `- PORT_GUARD estrito: utilizar faixa 4000-4999 (proibido 3001, 3000, 5173)`,
          `- Processos e servidores efêmeros em testes devem ser encerrados em try/finally`,
          `- Comando de verificação simples e direto sem encadeamento de operadores (controlledVerification)`,
          `- Proibição de ROOT_ROUTE_HIJACKED_BY_JSON: GET / serve public/index.html e GET /api/health retorna JSON`,
          `- Persistência pós-F5: dados mantidos em SQLite, hidratados na inicialização.`
        ].filter(Boolean).join('\n');
        break;
      }

      case 'SUPERVISOR_BLUEPRINT':
      case 'SUPERVISOR_EXPAND':
      default: {
        const sectionsSummary = conteudoRaw.includes('## 3. Mapa Canônico de Seções da Aplicação')
          ? conteudoRaw.split('## 3. Mapa Canônico de Seções da Aplicação')[1]?.slice(0, 800) || ''
          : '';
        const schemaSummary = backendRaw.includes('## 1. Esquema Relacional SQLite Completo')
          ? backendRaw.split('## 1. Esquema Relacional SQLite Completo')[1]?.slice(0, 700) || ''
          : '';

        body = [
          `\n[PAPEL DO SUPERVISOR: ARQUITETURA & DECOMPOSIÇÃO DE TAREFAS]`,
          `1. VISÃO DO PRODUTO & SEÇÕES CANÔNICAS (CONTEUDO.MD):`,
          sectionsSummary.slice(0, 800),
          `\n2. ESTRUTURA DO BANCO & ENTIDADES (BACKEND.MD):`,
          schemaSummary.slice(0, 700),
          `\n3. DIRETRIZES DE DECOMPOSIÇÃO (PRINCIPIOS.MD, DESIGN.MD & JORNADAS.MD):`,
          `- Tarefas de Backend devem cobrir tabelas, seeds e rotas REST completas`,
          `- Tarefas de Frontend devem cobrir as seções enumeradas (01-Secao.png) com abas role="tab" e data-tab`,
          `- Tarefas de Teste devem cobrir os fluxos F5 e validação de segurança de JORNADAS.md`,
          `- Cada tarefa deve conter verificação objetiva compatível com controlledVerification.ts`,
          `- Zero criação de notas intermediárias: o único contrato de referência são os 5 arquivos canônicos em .ai-dev-hub/specs/`
        ].join('\n');
        break;
      }
    }

    const fullBlock = `${header}\n${body}\n=== FIM DA ESPECIFICAÇÃO VIVA ===`;
    return this.clampContextLength(fullBlock, 1500, 3500);
  }

  /**
   * FASE 23C: Publica no chat do projeto um card executivo conciso apresentando a arquitetura deduzida na Onda 0.
   * Totalmente idempotente: não duplica se já existir mensagem da Onda 0 para o projeto/run.
   */
  public static postWaveZeroExecutiveCardToChat(
    projectId: string,
    projectPath: string,
    blueprint: DomainSpecBlueprint,
    runId?: string
  ): { posted: boolean; messageId?: string; content: string } {
    try {
      const tablesList: string[] = [];
      const createTableRegex = /CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/gi;
      let match;
      while ((match = createTableRegex.exec(blueprint.sqliteSchema)) !== null) {
        tablesList.push(match[1]);
      }

      const topRoutes = blueprint.restContracts.slice(0, 8).map(r => `${r.method} ${r.path}`);
      const sectionsList = blueprint.sections.map(s => `${s.code}-${s.name}`);

      const content = [
        `### Arquitetura Deduzida na Onda 0 (Especificação Viva)`,
        ``,
        `O DecoHUB realizou a pesquisa de mercado e estruturou as especificações canônicas para o projeto:`,
        ``,
        `- **Aplicativos de Referência Analisados:** ${blueprint.referenceApps.join(', ')}`,
        `- **Seções Canônicas (CONTEUDO.md):** ${sectionsList.join(', ')}`,
        `- **Arquétipo Visual (DESIGN.md):** ${blueprint.archetype} (tokens semânticos :root, tabular-nums e SVGs Lucide inline)`,
        `- **Tabelas SQLite (BACKEND.md):** ${tablesList.join(', ')}`,
        `- **Rotas REST Principais (BACKEND.md):** ${topRoutes.join(', ')}`,
        `- **Invariantes e Blindagem (PRINCIPIOS.md):** PORT_GUARD (faixa 4000-4999), escapeHtml(), seedIfEmpty() e blindagem AppSec.`,
        ``,
        `Documentos canônicos consolidados em \`.ai-dev-hub/specs/\`. Prosseguindo para o planejamento e construção autônoma.`
      ].join('\n');

      // Idempotency: verify if an executive card message already exists for this project (and runId if specified)
      try {
        if (runId) {
          const existing: any = db.prepare(`
            SELECT id FROM messages 
            WHERE project_id = ? 
              AND metadata LIKE ? 
            LIMIT 1
          `).get(projectId, `%"runId":"${runId}"%`);
          if (existing) {
            return { posted: false, messageId: existing.id, content };
          }
        }

        const existingCard: any = db.prepare(`
          SELECT id FROM messages
          WHERE project_id = ?
            AND metadata LIKE '%"type":"wave_zero_executive_card"%'
          LIMIT 1
        `).get(projectId);

        if (existingCard && !runId) {
          return { posted: false, messageId: existingCard.id, content };
        }

        const messageId = crypto.randomUUID();
        const nowIso = new Date().toISOString();
        const metadata = JSON.stringify({
          type: 'wave_zero_executive_card',
          runId: runId || null,
          referenceApps: blueprint.referenceApps,
          archetype: blueprint.archetype,
          sections: sectionsList,
          tables: tablesList,
          routes: topRoutes
        });

        db.prepare(`
          INSERT INTO messages (id, project_id, role, content, created_at, metadata)
          VALUES (?, ?, 'assistant', ?, ?, ?)
        `).run(messageId, projectId, content, nowIso, metadata);

        if (runId) {
          try {
            db.prepare(`
              INSERT INTO autonomous_events (id, run_id, task_id, source, event_type, message, data_json, created_at)
              VALUES (?, ?, NULL, 'supervisor', 'WAVE_ZERO_SPECS_GENERATED', ?, ?, ?)
            `).run(
              crypto.randomUUID(),
              runId,
              'Onda 0 concluída: especificações vivas geradas e arquitetura publicada no chat do projeto.',
              metadata,
              nowIso
            );
          } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecService",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecService]", err);
      }
    }
        }

        Logger.info(`[ProjectLivingSpecService] Card executivo da Onda 0 publicado no chat do projeto ${projectId} (msg #${messageId}).`);
        return { posted: true, messageId, content };
      } catch (dbErr: any) {
        Logger.warn(`[ProjectLivingSpecService] Aviso ao persistir mensagem no banco SQLite: ${dbErr.message}`);
        return { posted: false, content };
      }
    } catch (err: any) {
      Logger.warn(`[ProjectLivingSpecService] Falha não bloqueante ao publicar card executivo no chat: ${err.message}`);
      return { posted: false, content: '' };
    }
  }

  /**
   * FASE 23C: Additively registers a new feature into CONTEUDO.md and BACKEND.md during DELTA_EVOLUTION mode.
   * Keeps living specs synchronized with the evolving project without overwriting previous contracts.
   */
  public static appendDeltaFeatureToSpecs(
    projectPath: string,
    deltaBriefing: string,
    plannedDeltaTasks?: any[]
  ): {
    success: boolean;
    updatedFiles: string[];
    addedSection?: string;
    addedTables?: string[];
    addedRoutes?: string[];
  } {
    const resolvedPath = path.resolve(projectPath);
    const specsDir = path.join(resolvedPath, '.ai-dev-hub', 'specs');
    const conteudoPath = path.join(specsDir, 'CONTEUDO.md');
    const backendPath = path.join(specsDir, 'BACKEND.md');

    if (!fs.existsSync(specsDir)) {
      fs.mkdirSync(specsDir, { recursive: true });
    }

    const updatedFiles: string[] = [];
    const text = (deltaBriefing || '').trim();
    if (!text) {
      return { success: false, updatedFiles: [] };
    }

    // Auto-bootstrap if specs files don't exist yet
    if (!fs.existsSync(conteudoPath) || !fs.existsSync(backendPath)) {
      try {
        const projectName = path.basename(resolvedPath) || 'Projeto';
        const blueprint = this.resolveDomainBlueprint(text);
        const cContent = this.generateConteudoSpec(projectName, text, blueprint);
        const dContent = this.generateDesignSpec(projectName, text, blueprint);
        const bContent = this.generateBackendSpec(projectName, text, blueprint);
        const pContent = this.generatePrincipiosSpec(projectName);
        const jContent = this.generateJornadasSpec(projectName, text, blueprint);

        fs.writeFileSync(conteudoPath, cContent, 'utf-8');
        fs.writeFileSync(path.join(specsDir, 'DESIGN.md'), dContent, 'utf-8');
        fs.writeFileSync(backendPath, bContent, 'utf-8');
        fs.writeFileSync(path.join(specsDir, 'PRINCIPIOS.md'), pContent, 'utf-8');
        fs.writeFileSync(path.join(specsDir, 'JORNADAS.md'), jContent, 'utf-8');
        fs.writeFileSync(path.join(resolvedPath, 'DESIGN.md'), dContent, 'utf-8');

        const agentsMdRoot = path.join(resolvedPath, 'AGENTS.md');
        if (!fs.existsSync(agentsMdRoot)) {
          const canonicalAgentsMdContent = [
            `# Arquitetura e Especificações Oficiais do Projeto (DecoHUB Living Specs)`,
            `Consulte obrigatoriamente as especificações canônicas abaixo antes de modificar qualquer arquivo:`,
            `- Princípios e Invariantes: @.ai-dev-hub/specs/PRINCIPIOS.md`,
            `- Conteúdo, Seções e REA: @.ai-dev-hub/specs/CONTEUDO.md`,
            `- Design System e UI: @.ai-dev-hub/specs/DESIGN.md`,
            `- Contratos de Banco e API: @.ai-dev-hub/specs/BACKEND.md`,
            `- Jornadas de Teste e Homologação: @.ai-dev-hub/specs/JORNADAS.md`,
            ``
          ].join('\n');
          fs.writeFileSync(agentsMdRoot, canonicalAgentsMdContent, 'utf-8');
        }
      } catch (bootErr: any) {
        Logger.warn(`[ProjectLivingSpecService] Falha ao pré-provisionar specs antes do append: ${bootErr.message}`);
      }
    }

    // 1. Extract feature title and identifier
    let featureClean = text
      .replace(/^(adicione|adicionar|criar|nova feature|implementar|inserir)\s+(uma?\s+)?(se[çc][ãa]o\s+de\s+|m[oó]dulo\s+de\s+|funcionalidade\s+de\s+|tela\s+de\s+)?/i, '')
      .replace(/\s+com\s+.*$/i, '')
      .trim();
    if (!featureClean || featureClean.length < 3) {
      featureClean = text.slice(0, 30);
    }
    const sectionTitle = featureClean.charAt(0).toUpperCase() + featureClean.slice(1);
    const words = featureClean
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 3 && !['de', 'da', 'do', 'das', 'dos', 'em', 'para', 'com', 'uma', 'um'].includes(w));
    const tabId = (words[0] || 'delta-feature').slice(0, 20);

    const entityName = tabId.replace(/-/g, '_');

    // 2. Update CONTEUDO.md additively
    let addedSection: string | undefined;
    if (fs.existsSync(conteudoPath)) {
      try {
        let conteudo = fs.readFileSync(conteudoPath, 'utf-8');

        // Check idempotency: if section already present, skip appending
        if (!conteudo.includes(`data-tab="${tabId}"`) && !conteudo.includes(`### Seção ` + sectionTitle)) {
          // Find the highest section number
          const matches = [...conteudo.matchAll(/### Seção\s+(\d+):/gi)];
          let nextNum = 6;
          if (matches.length > 0) {
            const numbers = matches.map(m => parseInt(m[1], 10)).filter(n => !isNaN(n));
            if (numbers.length > 0) {
              nextNum = Math.max(...numbers) + 1;
            }
          }
          const sectionCode = String(nextNum).padStart(2, '0');
          addedSection = `${sectionCode}-${sectionTitle}`;

          const newSectionBlock = [
            `\n### Seção ${sectionCode}: ${sectionTitle} (Adicionada via DELTA_EVOLUTION)`,
            `- **Navegação SPA:** \`role="tab"\` e \`data-tab="${tabId}"\` (captura visual obrigatória: \`${sectionCode}-${sectionTitle}.png\`)`,
            `- **Cards de KPI (com cálculo de variação percentual Δ%):**`,
            `  - Total de ${sectionTitle}: Ativo (Δ% +10.0% vs período anterior)`,
            `  - Volume Operacional: Atualizado (Δ% +5.2%)`,
            `- **Visualização Gráfica:** Gráfico SVG de evolução e status de ${sectionTitle}`,
            `- **Data Grid de Alta Densidade:**`,
            `  - **Colunas:** ID, Data, Título/Descrição, Valor, Status, Ações`,
            `  - **Filtros e Busca:** Filtro por Status; Busca debounce por texto`,
            `  - **Exportação:** Botão "Exportar CSV" conectado a \`POST /api/export/csv\``,
            `- **Slide-Over Detail Drawer:** Detalhes analíticos de ${sectionTitle}, metadados e histórico`,
            `- **Modais de Ação:** Modal de Criação / Edição de ${sectionTitle} com validação de input`,
            `- **Povoamento Realista (\`seedIfEmpty\`):** Povoamento de 5 a 10 registros iniciais realistas para ${sectionTitle}`
          ].join('\n');

          // Insert before "## 4. Requisitos de Povoamento Inicial" or append to end of file
          if (conteudo.includes('## 4. Requisitos de Povoamento Inicial')) {
            conteudo = conteudo.replace('## 4. Requisitos de Povoamento Inicial', `${newSectionBlock}\n\n---\n\n## 4. Requisitos de Povoamento Inicial`);
          } else {
            conteudo += `\n${newSectionBlock}\n`;
          }

          fs.writeFileSync(conteudoPath, conteudo, 'utf-8');
          updatedFiles.push(conteudoPath);
          Logger.info(`[ProjectLivingSpecService] CONTEUDO.md atualizado aditivamente com Seção ${addedSection}.`);
        }
      } catch (err: any) {
        Logger.warn(`[ProjectLivingSpecService] Erro ao atualizar CONTEUDO.md aditivamente: ${err.message}`);
      }
    }

    // 3. Update BACKEND.md additively
    const addedTables: string[] = [];
    const addedRoutes: string[] = [];
    if (fs.existsSync(backendPath)) {
      try {
        let backend = fs.readFileSync(backendPath, 'utf-8');

        // Check if table already defined
        if (!backend.includes(`CREATE TABLE IF NOT EXISTS ${entityName}`)) {
          const newTableSql = [
            `\n-- Tabela adicionada via DELTA_EVOLUTION: ${sectionTitle}`,
            `CREATE TABLE IF NOT EXISTS ${entityName} (`,
            `  id TEXT PRIMARY KEY,`,
            `  title TEXT NOT NULL,`,
            `  description TEXT,`,
            `  amount REAL DEFAULT 0,`,
            `  limit_amount REAL DEFAULT 0,`,
            `  status TEXT DEFAULT 'active',`,
            `  created_at TEXT NOT NULL,`,
            `  updated_at TEXT NOT NULL`,
            `);`,
            `CREATE INDEX IF NOT EXISTS idx_${entityName}_status ON ${entityName}(status);`
          ].join('\n');

          // Insert inside sql codeblock in section 1
          if (backend.includes('```sql') && backend.includes('```\n\n---')) {
            backend = backend.replace('```\n\n---', `${newTableSql}\n\`\`\`\n\n---`);
          } else {
            backend += `\n\`\`\`sql\n${newTableSql}\n\`\`\`\n`;
          }
          addedTables.push(entityName);
        }

        // Check if REST routes already defined
        const routePath = `/api/${tabId}`;
        if (!backend.includes(`| GET | ${routePath} `)) {
          const newRows = [
            `| GET | ${routePath} | - | {"items": [...]} | Listar registros de ${sectionTitle} |`,
            `| POST | ${routePath} | {"title": "string", "amount": 0} | {"id": "string", "status": "created"} | Criar novo registro de ${sectionTitle} |`,
            `| GET | ${routePath}/:id | - | {"id": "string", ...} | Obter detalhes de ${sectionTitle} |`,
            `| PUT | ${routePath}/:id | {"title": "string", ...} | {"updated": true} | Atualizar registro de ${sectionTitle} |`
          ].join('\n');

          if (backend.includes('## 2. Tabela Canônica de Contratos REST da API')) {
            // Find end of section 2 table
            const parts = backend.split('## 3. Fórmulas Matemáticas & Validações de Domínio');
            if (parts.length === 2) {
              backend = parts[0].trimEnd() + '\n' + newRows + '\n\n---\n\n## 3. Fórmulas Matemáticas & Validações de Domínio' + parts[1];
            } else {
              backend += `\n${newRows}\n`;
            }
          }
          addedRoutes.push(`GET ${routePath}`, `POST ${routePath}`, `PUT ${routePath}/:id`);
        }

        if (addedTables.length > 0 || addedRoutes.length > 0) {
          fs.writeFileSync(backendPath, backend, 'utf-8');
          updatedFiles.push(backendPath);
          Logger.info(`[ProjectLivingSpecService] BACKEND.md atualizado aditivamente com tabela "${entityName}" e rotas para "${routePath}".`);
        }
      } catch (err: any) {
        Logger.warn(`[ProjectLivingSpecService] Erro ao atualizar BACKEND.md aditivamente: ${err.message}`);
      }
    }

    // 4. Update JORNADAS.md additively if it exists
    const jornadasPath = path.join(specsDir, 'JORNADAS.md');
    if (fs.existsSync(jornadasPath)) {
      try {
        let jornadas = fs.readFileSync(jornadasPath, 'utf-8');
        if (!jornadas.includes(`data-tab="${tabId}"`)) {
          const sectionNum = addedSection ? addedSection.split('-')[0] : '06';
          const newJourneyBlock = [
            `\n### Seção ${sectionNum}: ${sectionTitle} (Adicionada via DELTA_EVOLUTION)`,
            `- **Aba de Navegação:** \`[data-tab="${tabId}"]\` (com \`role="tab"\`)`,
            `- **Arquivo de Snapshot Obrigatório:** \`${sectionNum}-${sectionTitle.replace(/[^a-zA-Z0-9]/g, '')}.png\``,
            `- **Elementos Visuais a Validar:**`,
            `  - Cards de KPIs com formatação \`tabular-nums\` e badges de variação percentual (\`Δ%\`)`,
            `  - Gráfico SVG de evolução e status de ${sectionTitle}`,
            `  - Data Grid povoado com linhas realistas`,
            `  - Modal de Criação / Edição de ${sectionTitle}`
          ].join('\n');

          if (jornadas.includes('## 2. Cenários de Experiência do Usuário')) {
            jornadas = jornadas.replace('## 2. Cenários de Experiência do Usuário', `${newJourneyBlock}\n\n---\n\n## 2. Cenários de Experiência do Usuário`);
          } else {
            jornadas += `\n${newJourneyBlock}\n`;
          }

          fs.writeFileSync(jornadasPath, jornadas, 'utf-8');
          updatedFiles.push(jornadasPath);
          Logger.info(`[ProjectLivingSpecService] JORNADAS.md atualizado aditivamente com roteiro para Seção ${sectionNum}.`);
        }
      } catch (err: any) {
        Logger.warn(`[ProjectLivingSpecService] Erro ao atualizar JORNADAS.md aditivamente: ${err.message}`);
      }
    }

    // 5. Ensure AGENTS.md in root
    const agentsMdRoot = path.join(resolvedPath, 'AGENTS.md');
    if (!fs.existsSync(agentsMdRoot)) {
      try {
        const canonicalAgentsMdContent = [
          `# Arquitetura e Especificações Oficiais do Projeto (DecoHUB Living Specs)`,
          `Consulte obrigatoriamente as especificações canônicas abaixo antes de modificar qualquer arquivo:`,
          `- Princípios e Invariantes: @.ai-dev-hub/specs/PRINCIPIOS.md`,
          `- Conteúdo, Seções e REA: @.ai-dev-hub/specs/CONTEUDO.md`,
          `- Design System e UI: @.ai-dev-hub/specs/DESIGN.md`,
          `- Contratos de Banco e API: @.ai-dev-hub/specs/BACKEND.md`,
          `- Jornadas de Teste e Homologação: @.ai-dev-hub/specs/JORNADAS.md`,
          ``
        ].join('\n');
        fs.writeFileSync(agentsMdRoot, canonicalAgentsMdContent, 'utf-8');
        updatedFiles.push(agentsMdRoot);
      } catch (err: any) {
        Logger.warn(`[ProjectLivingSpecService] Erro ao provisionar AGENTS.md na raiz: ${err.message}`);
      }
    }

    return {
      success: updatedFiles.length > 0,
      updatedFiles,
      addedSection,
      addedTables: addedTables.length > 0 ? addedTables : undefined,
      addedRoutes: addedRoutes.length > 0 ? addedRoutes : undefined
    };
  }

  /**
   * FASE 23E: Scans project source files on disk to identify physical SQLite tables
   * and REST routes implemented in code, then updates BACKEND.md with verified contracts.
   */
  public static syncImplementedBackendContractsToSpec(projectPath: string): {
    synced: boolean;
    tables: string[];
    routes: Array<{ method: string; path: string }>;
    backendMdPath?: string;
  } {
    const resolvedPath = path.resolve(projectPath);
    const specsDir = path.join(resolvedPath, '.ai-dev-hub', 'specs');
    const backendPath = path.join(specsDir, 'BACKEND.md');

    if (!fs.existsSync(backendPath)) {
      return { synced: false, tables: [], routes: [] };
    }

    // 1. Gather all candidate server/backend source files
    const candidateFiles: string[] = [];
    const srcDir = path.join(resolvedPath, 'src');
    if (fs.existsSync(srcDir)) {
      const walkDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (!['node_modules', '.git', 'dist', 'build', '.ai-dev-hub'].includes(entry.name)) {
                walkDir(fullPath);
              }
            } else if (entry.isFile() && /\.(ts|js|mjs|cjs)$/i.test(entry.name) && !entry.name.endsWith('.d.ts')) {
              candidateFiles.push(fullPath);
            }
          }
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecService",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:projectLivingSpecService]", err);
      }
    }
      };
      walkDir(srcDir);
    }

    // Root server files
    const rootCandidates = ['server.js', 'server.ts', 'server.mjs', 'app.js', 'app.ts', 'app.mjs', 'index.js', 'index.ts'];
    for (const rootFile of rootCandidates) {
      const p = path.join(resolvedPath, rootFile);
      if (fs.existsSync(p) && !candidateFiles.includes(p)) {
        candidateFiles.push(p);
      }
    }

    if (candidateFiles.length === 0) {
      return { synced: false, tables: [], routes: [], backendMdPath: backendPath };
    }

    // 2. Scan candidate files for table creations and REST endpoints
    const tableSet = new Set<string>();
    const routeMap = new Map<string, { method: string; path: string }>();

    for (const filePath of candidateFiles) {
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      // Match CREATE TABLE [IF NOT EXISTS] <name>
      const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi;
      let tableMatch;
      while ((tableMatch = tableRegex.exec(content)) !== null) {
        if (tableMatch[1]) {
          tableSet.add(tableMatch[1].toLowerCase());
        }
      }

      // Match Express/Fastify/Polka: (app|router|server).(get|post|put|delete|patch)('path', ...)
      const expressRegex = /\b(?:app|router|server|apiRouter)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
      let expressMatch;
      while ((expressMatch = expressRegex.exec(content)) !== null) {
        const method = expressMatch[1].toUpperCase();
        const routePath = expressMatch[2].trim();
        const key = `${method} ${routePath}`;
        if (!routeMap.has(key)) {
          routeMap.set(key, { method, path: routePath });
        }
      }

      // Match native Node HTTP request url patterns: req.url === '/path' or req.url.startsWith('/path')
      const nativeRouteRegex = /req(?:uest)?\.url\s*(?:===|==|\.startsWith\()\s*['"`]([^'"`]+)['"`]/gi;
      let nativeMatch;
      while ((nativeMatch = nativeRouteRegex.exec(content)) !== null) {
        const routePath = nativeMatch[1].trim();
        const key = `GET ${routePath}`;
        if (!routeMap.has(key)) {
          routeMap.set(key, { method: 'GET', path: routePath });
        }
      }
    }

    const tables = Array.from(tableSet).sort();
    const routes = Array.from(routeMap.values()).sort((a, b) => a.path.localeCompare(b.path));

    if (tables.length === 0 && routes.length === 0) {
      return { synced: false, tables: [], routes: [], backendMdPath: backendPath };
    }

    // 3. Format verified contracts block
    const nowIso = new Date().toISOString();
    const tablesListStr = tables.length > 0 ? tables.map(t => `\`${t}\``).join(', ') : 'Nenhuma tabela SQLite identificada';
    const routesListStr = routes.length > 0
      ? routes.map(r => `  - \`${r.method} ${r.path}\``).join('\n')
      : '  - Nenhuma rota REST identificada';

    const verifiedHeader = '## CONTRATOS REAIS IMPLEMENTADOS EM DISCO (VERIFICADOS)';
    const verifiedSection = [
      verifiedHeader,
      `*Sincronização autônoma realizada pelo DecoHUB a partir do código-fonte em disco:*`,
      `- **Tabelas Físicas SQLite Identificadas:** ${tablesListStr}`,
      `- **Rotas REST Físicas Detectadas:**`,
      routesListStr,
      `- **Data/Hora da Última Verificação:** ${nowIso}`
    ].join('\n');

    try {
      let backendContent = fs.readFileSync(backendPath, 'utf-8');
      if (backendContent.includes(verifiedHeader)) {
        const parts = backendContent.split(verifiedHeader);
        const before = parts[0].trimEnd();
        const afterPart = parts[1] || '';
        const nextH2Idx = afterPart.search(/\n##\s+/);
        const remainder = nextH2Idx !== -1 ? afterPart.slice(nextH2Idx) : '';
        backendContent = `${before}\n\n${verifiedSection}${remainder}\n`;
      } else {
        backendContent = `${backendContent.trimEnd()}\n\n---\n\n${verifiedSection}\n`;
      }

      fs.writeFileSync(backendPath, backendContent, 'utf-8');
      Logger.info(`[ProjectLivingSpecService] Contratos de backend sincronizados em BACKEND.md (${tables.length} tabelas, ${routes.length} rotas).`);
      return {
        synced: true,
        tables,
        routes,
        backendMdPath: backendPath
      };
    } catch (err: any) {
      Logger.warn(`[ProjectLivingSpecService] Falha ao gravar contratos sincronizados em BACKEND.md: ${err.message}`);
      return { synced: false, tables, routes, backendMdPath: backendPath };
    }
  }
}
