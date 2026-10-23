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

    creator_economy: {
      domainKey: 'creator_economy',
      domainName: 'Creator Economy / YouTube Viral Search & Analytics',
      targetAudience: 'Criadores de conteúdo, canais do YouTube, agências e estrategistas de mídia que buscam minerar referências virais, analisar métricas de engajamento e prever tendências com Outlier Multipliers.',
      referenceApps: [
        '1of10.com (Outlier Video Finder)',
        'VidIQ (Viral Velocity & Keyword Research)',
        'Viewstats by MrBeast (Thumbnail & Retention Analytics)',
        'TubeBuddy (Channel Explorer)',
        'OpusClip / Descript (Transcript & Hook Analysis)'
      ],
      marketBenchmark: 'Líderes de mercado (1of10, Viewstats) automatizam a identificação de virais por Outlier Score (desempenho comparado à média histórica do canal), analisam padrões de thumbnail, velocidade de visualizações por hora (VPH) e organizam nichos em radares de conteúdo com exportação e notas de roteirização.',
      differentials: [
        'Algoritmo Preditivo de Outlier Score comparando a performance do vídeo com a média histórica do canal (identifica virais autênticos de 3x a 50x)',
        'Radar de Nichos & Monitoramento de Concorrentes com cálculo de velocidade em tempo real (Views Per Hour - VPH)',
        'Gaveta Analítica 520px com decomposição de thumbnails (16:9), tags de tração, métricas de retenção e exportação para roteirização'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Vídeos Minerados: 1.420 (Δ% +18.4% vs semana anterior)',
            'Outliers Críticos (>5x): 84 vídeos',
            'Taxa de Engajamento Média: 6.8% (Δ% +1.2%)',
            'Velocidade Máx. Registrada: 42.500 views/h'
          ],
          chart: 'Gráfico SVG interativo de Curva de Velocidade Viral (Views/Hora vs Tempo desde publicação) com tooltips e eixos em tabular-nums',
          gridColumns: ['Thumbnail', 'Título do Vídeo', 'Canal', 'Visualizações', 'Outlier Score', 'Engajamento (%)', 'Publicado Em', 'Ações'],
          filters: ['Filtro por Outlier Score (>3x, >5x, >10x)', 'Filtro por Nicho', 'Busca debounce por título ou canal'],
          drawerContent: 'Slide-Over Drawer com preview de vídeo 16:9, gráfico de retenção estimada, tags de tração, métricas detalhadas (likes, comentários, VPH) e bloco de anotações de roteiro',
          modalContent: 'Modal de Importação Manual ou Coleta Rápida via YouTube ID/URL com cálculo instantâneo de Outlier Score',
          seedSummary: '25 vídeos virais realistas de nichos como Finanças, Tecnologia, Produtividade e Curiosidades com métricas e thumbnails'
        },
        {
          code: '02',
          name: 'Registros',
          tabId: 'registros',
          kpis: [
            'Vídeos Catalogados: 250',
            'Super Outliers (>10x): 18 vídeos',
            'Engajamento Alto (>8%): 64 vídeos',
            'Canais Monitorados: 42'
          ],
          chart: 'Gráfico SVG de Dispersão / Barras de Outlier Score por Nicho e Duração',
          gridColumns: ['ID', 'Thumbnail', 'Título', 'Canal', 'Views', 'Outlier Multiplier', 'Likes', 'Taxa Engajamento', 'Data', 'Ações'],
          filters: ['Multi-range Outlier (>2x, >5x, >10x, >20x)', 'Filtro por Faixa de Views (<50k, 50k-500k, >1M)', 'Busca debounce (250ms)'],
          drawerContent: 'Drawer com análise aprofundada de títulos, padrões de thumbnail (contraste/expressão), tags e botão de exportar para briefing de roteiro',
          modalContent: 'Modal de Registro de Vídeo com preenchimento assistido e cálculo de baseline do canal',
          seedSummary: '30 registros detalhados de vídeos virais catalogados com tags e baseline de canal'
        },
        {
          code: '03',
          name: 'Operações',
          tabId: 'operacoes',
          kpis: [
            'Nichos Ativos: 8 nichos',
            'Coletas Executadas: 142',
            'Taxa de Sucesso de Coleta: 100%',
            'Tempo Médio de Varredura: 280ms'
          ],
          chart: 'Gráfico SVG de Volume de Vídeos Capturados por Nicho nas últimas 24h',
          gridColumns: ['ID Coleta', 'Nicho / Query', 'Vídeos Minerados', 'Status', 'Duração (ms)', 'Executado Em', 'Ações'],
          filters: ['Filtro por Nicho', 'Status da Coleta (Sucesso, Processando, Falha)'],
          drawerContent: 'Visualizador de payload de coleta, termos pesquisados e lista de vídeos descobertos na varredura',
          modalContent: 'Modal de Nova Varredura de Nicho (Trigger Scan) com palavras-chave, filtros de data e limite de resultados',
          seedSummary: '15 operações de varredura executadas em nichos de IA, Finanças e Games'
        },
        {
          code: '04',
          name: 'Auditoria',
          tabId: 'auditoria',
          kpis: [
            'Logs Auditados: 312',
            'Atores do Sistema: 3',
            'Operações de Criação/Atualização: 275',
            'Eventos de Exclusão: 37'
          ],
          chart: 'Gráfico SVG de linha do tempo de operações auditadas',
          gridColumns: ['Timestamp', 'Ator', 'Ação', 'Entidade', 'ID Alvo', 'Diff JSON', 'Ações'],
          filters: ['Ação (CREATE, UPDATE, DELETE)', 'Entidade (viral_videos, saved_niches, settings)', 'Busca debounce'],
          drawerContent: 'Visualizador de diff JSON formatado antes/depois com realce de sintaxe',
          modalContent: 'Modal de Exportação de Trilha Forense em formato CSV e JSON',
          seedSummary: '35 logs de auditoria imutáveis com registros de coletas, alterações de notas e criação de nichos'
        },
        {
          code: '05',
          name: 'Configuracoes',
          tabId: 'configuracoes',
          kpis: [
            'Algoritmo Ativo: Outlier Multiplier V2',
            'YouTube Data API V3: Graceful Mock Ativo',
            'Intervalo de Varredura: 6h',
            'Status do Banco: SQLite WAL Conectado'
          ],
          chart: 'Gráfico SVG de consumo de cota de API simulada / real por hora',
          gridColumns: ['Parâmetro', 'Chave', 'Valor Configurado', 'Última Alteração', 'Responsável', 'Ações'],
          filters: ['Gerais', 'Algoritmos & Pesos', 'API & Chaves'],
          drawerContent: 'Painel de parametrização de pesos da fórmula de Outlier e multiplicadores de engajamento',
          modalContent: 'Modal de Edição de Chaves de API (YouTube Data API V3) com alternância para Mock Fallback determinístico',
          seedSummary: 'Configurações completas de pesos de algoritmo, limites de busca e chaves mock'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - Creator Economy & YouTube Viral Search
CREATE TABLE IF NOT EXISTS saved_niches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keyword_filter TEXT NOT NULL,
  min_views INTEGER NOT NULL DEFAULT 10000,
  min_outlier_score REAL NOT NULL DEFAULT 3.0,
  refresh_interval_hours INTEGER NOT NULL DEFAULT 6,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS viral_videos (
  id TEXT PRIMARY KEY,
  youtube_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  view_count_baseline REAL NOT NULL DEFAULT 10000,
  outlier_score REAL NOT NULL DEFAULT 1.0,
  engagement_rate REAL NOT NULL DEFAULT 0.0,
  views_per_hour REAL NOT NULL DEFAULT 0.0,
  niche_id TEXT,
  tags_json TEXT DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (niche_id) REFERENCES saved_niches (id)
);

CREATE TABLE IF NOT EXISTS search_operations (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  niche_id TEXT,
  results_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  execution_time_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (niche_id) REFERENCES saved_niches (id)
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

CREATE INDEX IF NOT EXISTS idx_viral_videos_outlier ON viral_videos (outlier_score DESC);
CREATE INDEX IF NOT EXISTS idx_viral_videos_niche ON viral_videos (niche_id);
CREATE INDEX IF NOT EXISTS idx_viral_videos_views ON viral_videos (views DESC);
CREATE INDEX IF NOT EXISTS idx_search_operations_created ON search_operations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Healthcheck de integridade operacional do backend e SQLite'
        },
        {
          method: 'GET',
          path: '/api/audit-logs',
          requestBody: 'Query: ?entity=&limit=',
          responseBody: 'Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>',
          description: 'Trilha de auditoria forense imutável com histórico estruturado'
        },
        {
          method: 'GET',
          path: '/api/kpis',
          requestBody: 'N/A',
          responseBody: '{ totalVideos: number, criticalOutliers: number, avgEngagement: number, maxVph: number, formatted: object }',
          description: 'Totais consolidados e indicadores de viralidade para Cards Bento de KPI'
        },
        {
          method: 'GET',
          path: '/api/videos',
          requestBody: 'Query: ?niche_id=&min_outlier=&q=&page=&limit=&order_by=',
          responseBody: 'Array<{ id: string, youtube_id: string, title: string, channel_title: string, views: number, likes: number, comments: number, outlier_score: number, engagement_rate: number, views_per_hour: number, thumbnail_url: string, published_at: string }>',
          description: 'Listagem de vídeos minerados com busca debounce, filtros compostos e ordenação por Outlier'
        },
        {
          method: 'POST',
          path: '/api/videos',
          requestBody: '{ youtube_id: string, title: string, channel_title: string, views: number, likes?: number, comments?: number, published_at: string, thumbnail_url: string, view_count_baseline?: number, niche_id?: string, tags?: string[], notes?: string }',
          responseBody: '{ id: string, title: string, outlier_score: number, engagement_rate: number, ... } (Status 201)',
          description: 'Cadastro ou importação de vídeo viral com cálculo automático de Outlier Score e auditoria'
        },
        {
          method: 'PUT',
          path: '/api/videos/:id',
          requestBody: '{ notes?: string, niche_id?: string, tags?: string[] }',
          responseBody: '{ id: string, title: string, ... } (Status 200)',
          description: 'Atualização de anotações e nicho do vídeo com registro de diff forense'
        },
        {
          method: 'GET',
          path: '/api/niches',
          requestBody: 'Query: ?active_only=true',
          responseBody: 'Array<{ id: string, name: string, keyword_filter: string, min_views: number, min_outlier_score: number, is_active: number }>',
          description: 'Listagem de nichos monitorados para radar de virais'
        },
        {
          method: 'POST',
          path: '/api/niches',
          requestBody: '{ name: string, keyword_filter: string, min_views?: number, min_outlier_score?: number }',
          responseBody: '{ id: string, name: string, ... } (Status 201)',
          description: 'Criação de nicho monitorado'
        },
        {
          method: 'POST',
          path: '/api/operations/scan',
          requestBody: '{ query: string, niche_id?: string, max_results?: number }',
          responseBody: '{ operation_id: string, results_count: number, videos_found: Array<object>, execution_time_ms: number }',
          description: 'Disparo de operação de mineração de virais (com Graceful Mock Fallback se sem chave de API)'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "viral_videos" | "saved_niches" | "audit_logs", filters?: object }',
          responseBody: 'Content-Type: text/csv com cabeçalhos sanitizados',
          description: 'Exportação em lote de vídeos e métricas em CSV para análise em planilhas ou roteiros'
        }
      ],
      formulas: [
        'engagement_rate = ((likes + comments) / Math.max(views, 1)) * 100',
        'outlier_score = Number((views / Math.max(channel_avg_views, 1)).toFixed(2))',
        'views_per_hour = Math.round(views / Math.max((Date.now() - new Date(published_at).getTime()) / 3600000, 1))',
        'variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100'
      ],
      validations: [
        'youtube_id deve conter exatamente 11 caracteres alfanuméricos ou URL válida de YouTube (HTTP 400)',
        'title deve ter pelo menos 3 caracteres (HTTP 400)',
        'views deve ser número inteiro maior ou igual a zero (HTTP 400)',
        'thumbnail_url deve ser uma URL válida ou caminho de asset local (HTTP 400)'
      ],
      envKeys: ['PORT=4000', 'DATABASE_PATH=./data/viralytsearch.db', 'YOUTUBE_API_KEY=mock_youtube_api_key'],
      archetype: 'dark-telemetry',
      accentColor: '#ef4444'
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
    },

    youtube_viral_intelligence: {
      domainKey: 'youtube_viral_intelligence',
      domainName: 'YouTube Viral Search, Video Intelligence & Creator SaaS',
      targetAudience: 'Criadores de conteúdo, canais do YouTube, agências e estrategistas de mídia que buscam minerar referências virais, analisar métricas de engajamento, decompor headlines/transcrições e prever tendências com Outlier Multipliers.',
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
      marketBenchmark: 'Líderes de mercado automatizam a identificação de virais por Outlier Score, analisam padrões de thumbnail, velocidade de visualizações por hora (VPH) e decompõem ganchos de transcrição e headline para roteirização com esteiras estilo n8n e monetização SaaS via PIX.',
      differentials: [
        'Radar de Outliers com cálculo preditivo de multiplicador viral comparado ao baseline do canal (3x a 50x)',
        'Slide-Over Drawer com decomposição em 3 abas: Headline Hooks com score CTR, Transcrição timestamped com cópia em 1 clique e Análise de Thumbnail (cores, contraste e emoção)',
        'Monetização SaaS nativa com planos Pro, PushinPay PIX com QR Code dinâmico e limite de cota de buscas com Cloudflare Turnstile',
        'Esteira estilo n8n (workflow_runs) com latência por etapa: Harvester -> Outlier Filter -> Transcript/Headline/Thumbnail Extractor'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Vídeos Minerados: 1.420 (Δ% +18.4%)',
            'Outliers Críticos (>5x): 84 vídeos',
            'Taxa de Engajamento Média: 6.8% (Δ% +1.2%)',
            'Cota de Buscas Restante: 42/50 buscas'
          ],
          chart: 'Gráfico SVG interativo de Curva de Velocidade Viral (Views/Hora vs Tempo) com tooltips e eixos em tabular-nums',
          gridColumns: ['Thumbnail', 'Título do Vídeo', 'Canal', 'Visualizações', 'Outlier Score', 'Engajamento (%)', 'Publicado Em', 'Ações'],
          filters: ['Filtro por Outlier Score (>3x, >5x, >10x)', 'Filtro por Nicho', 'Busca debounce por título ou canal'],
          drawerContent: 'Slide-Over Drawer com preview 16:9, gráfico de retenção estimada, tags de tração, métricas detalhadas (likes, comentários, VPH) e notas de roteiro',
          modalContent: 'Modal de Nova Busca / Importação de Vídeo com cálculo instantâneo de Outlier Score',
          seedSummary: '25 vídeos virais realistas de nichos como Finanças, Tecnologia, Produtividade e Curiosidades com métricas e thumbnails'
        },
        {
          code: '02',
          name: 'Breakdown',
          tabId: 'breakdown',
          kpis: [
            'Headlines Analisadas: 180',
            'Ganchos de Alta Retenção: 64',
            'Score CTR Médio: 8.6 / 10',
            'Transcrições Processadas: 142'
          ],
          chart: 'Gráfico SVG de distribuição de Hooks (Curiosidade, Contraintuitivo, Urgência, História)',
          gridColumns: ['ID', 'Título', 'Tipo de Gancho', 'Score CTR', 'Thumbnail Contraste', 'Emoção Predominante', 'Ações'],
          filters: ['Tipo de Gancho', 'Faixa de CTR Score', 'Busca debounce'],
          drawerContent: 'Slide-Over com abas dedicadas para Headline/Hooks, Transcrição Interativa com Cópia em 1 Clique e Inspeção de Thumbnail',
          modalContent: 'Modal de Decomposição Manual de Vídeo e Geração de Hooks Alternativos',
          seedSummary: '25 breakdowns detalhados de headline, transcrições timestamped e cores dominantes de thumbnail'
        },
        {
          code: '03',
          name: 'Esteira',
          tabId: 'esteira',
          kpis: [
            'Pipelines Concluídos: 48 (100% sucesso)',
            'Latência Média: 420ms por etapa',
            'Vídeos Minerados (Harvester): 1.420',
            'Outliers Filtrados (>3x): 84'
          ],
          chart: 'Gráfico SVG de latência por estágio da esteira (Harvester, Outlier Filter, Extractor)',
          gridColumns: ['ID Pipeline', 'Nome do Pipeline', 'Estágio', 'Status', 'Latência (ms)', 'Itens Processados', 'Criado Em', 'Ações'],
          filters: ['Todos os Estágios', 'Status (idle, running, completed, failed)'],
          drawerContent: 'Drawer com detalhamento da esteira estilo n8n, breakdown de latência por nó e log de execução',
          modalContent: 'Modal de Nova Execução de Pipeline Harvester',
          seedSummary: '12 execuções de esteira de mineração e extração com latência por nó'
        },
        {
          code: '04',
          name: 'Assinatura',
          tabId: 'assinatura',
          kpis: [
            'Plano Atual: Pro Creator',
            'Cota de Buscas: 8 / 500 usadas',
            'Status Pagamento: Ativo (PIX)',
            'Renovação: em 28 dias'
          ],
          chart: 'Gráfico SVG de consumo diário da cota de buscas da assinatura',
          gridColumns: ['ID Transação', 'Plano', 'Valor (R$)', 'Status PIX', 'Data', 'Ações'],
          filters: ['Todos os Planos', 'Status (Pago, Pendente, Expirado)'],
          drawerContent: 'Drawer com QR Code PIX ampliado, código copia-e-cola e status de confirmação em tempo real',
          modalContent: 'Modal de Upgrade de Plano com seleção Pro/Enterprise e geração de PIX via PushinPay',
          seedSummary: 'Histórico de pagamentos PIX simulados com status pagos e chaves de teste'
        },
        {
          code: '05',
          name: 'Auditoria',
          tabId: 'auditoria',
          kpis: [
            'Logs Registrados: 312',
            'Atores do Sistema: 3',
            'Sessões Ativas: 4',
            'Turnstile Verificados: 100%'
          ],
          chart: 'Gráfico SVG de linha do tempo de operações auditadas e logins protegidos com Turnstile',
          gridColumns: ['Timestamp', 'Ator', 'Ação', 'Entidade', 'ID Alvo', 'Diff JSON', 'Ações'],
          filters: ['Ação (CREATE, UPDATE, DELETE)', 'Entidade (viral_videos, video_breakdowns, subscriptions)'],
          drawerContent: 'Visualizador de JSON diff com metadados de sessão e IP mascarado',
          modalContent: 'Modal de Exportação de Logs e Verificação de Status do Turnstile',
          seedSummary: '35 logs de auditoria imutáveis com registros de buscas, favoritos e pagamentos'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - YouTube Viral Search & Video Intelligence
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  supabase_uid TEXT UNIQUE,
  plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro', 'enterprise')),
  search_quota_limit INTEGER NOT NULL DEFAULT 50,
  search_quota_used INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  turnstile_verified INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_tier TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  pix_provider TEXT NOT NULL DEFAULT 'pushinpay',
  current_period_end TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS pix_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_id TEXT,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  qr_code_base64 TEXT,
  qr_code_copy_paste TEXT,
  provider_tx_id TEXT UNIQUE,
  webhook_payload_json TEXT,
  paid_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  youtube_channel_id TEXT NOT NULL UNIQUE,
  channel_name TEXT NOT NULL,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  total_videos INTEGER NOT NULL DEFAULT 0,
  avg_views INTEGER NOT NULL DEFAULT 0,
  niche TEXT NOT NULL DEFAULT 'general',
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS viral_videos (
  id TEXT PRIMARY KEY,
  youtube_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  views_count INTEGER NOT NULL DEFAULT 0,
  likes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  outlier_multiplier REAL NOT NULL DEFAULT 1.0,
  viral_score REAL NOT NULL DEFAULT 1.0,
  engagement_rate REAL NOT NULL DEFAULT 0.0,
  niche TEXT NOT NULL DEFAULT 'general',
  language TEXT NOT NULL DEFAULT 'pt-BR',
  thumbnail_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (channel_id) REFERENCES channels (id)
);

CREATE TABLE IF NOT EXISTS video_breakdowns (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL UNIQUE,
  headline_original TEXT NOT NULL,
  hook_category TEXT NOT NULL DEFAULT 'curiosity',
  ctr_score REAL NOT NULL DEFAULT 8.5,
  power_words_json TEXT NOT NULL DEFAULT '[]',
  generated_variations_json TEXT NOT NULL DEFAULT '[]',
  transcript_hook_0_30s TEXT NOT NULL,
  transcript_body_segments_json TEXT NOT NULL DEFAULT '[]',
  transcript_cta TEXT NOT NULL,
  full_text TEXT NOT NULL,
  thumbnail_hd_url TEXT NOT NULL,
  thumbnail_overlay_text TEXT,
  visual_emotion TEXT NOT NULL DEFAULT 'curiosity',
  contrast_score REAL NOT NULL DEFAULT 8.2,
  dominant_hex_palette_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (video_id) REFERENCES viral_videos (id)
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  pipeline_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'completed', 'failed')),
  stage TEXT NOT NULL CHECK (stage IN ('harvester', 'outlier_filter', 'extractor', 'done')),
  latency_ms INTEGER NOT NULL DEFAULT 0,
  stages_latency_json TEXT NOT NULL DEFAULT '{}',
  items_processed INTEGER NOT NULL DEFAULT 0,
  error_log TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  video_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id)
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

CREATE INDEX IF NOT EXISTS idx_viral_videos_outlier ON viral_videos (outlier_multiplier DESC);
CREATE INDEX IF NOT EXISTS idx_viral_videos_niche ON viral_videos (niche);
CREATE INDEX IF NOT EXISTS idx_viral_videos_channel ON viral_videos (channel_id);
CREATE INDEX IF NOT EXISTS idx_video_breakdowns_video ON video_breakdowns (video_id);
CREATE INDEX IF NOT EXISTS idx_pix_payments_user ON pix_payments (user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_stage ON workflow_runs (stage);
CREATE INDEX IF NOT EXISTS idx_saved_collections_user ON saved_collections (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Healthcheck de integridade operacional do backend e SQLite'
        },
        {
          method: 'POST',
          path: '/api/auth/register',
          requestBody: '{ email: string, password: string, fullName: string, turnstileToken: string }',
          responseBody: '{ user: object, sessionToken: string } (Status 201)',
          description: 'Registro de usuário com validação anti-bot Turnstile e criação de sessão'
        },
        {
          method: 'POST',
          path: '/api/auth/login',
          requestBody: '{ email: string, password: string, turnstileToken: string }',
          responseBody: '{ user: object, sessionToken: string }',
          description: 'Autenticação compatível com Supabase Auth e fallback local SQLite'
        },
        {
          method: 'POST',
          path: '/api/auth/logout',
          requestBody: 'Header: Authorization: Bearer <sessionToken>',
          responseBody: '{ success: true }',
          description: 'Encerramento de sessão autenticada'
        },
        {
          method: 'POST',
          path: '/api/auth/verify-turnstile',
          requestBody: '{ token: string }',
          responseBody: '{ success: boolean, hostname?: string }',
          description: 'Verificação do token Cloudflare Turnstile'
        },
        {
          method: 'GET',
          path: '/api/auth/me',
          requestBody: 'Header: Authorization: Bearer <sessionToken>',
          responseBody: '{ id: string, email: string, fullName: string, planTier: string, searchQuota: object }',
          description: 'Retorna perfil do usuário autenticado e cota de buscas atual'
        },
        {
          method: 'GET',
          path: '/api/billing/plans',
          requestBody: 'N/A',
          responseBody: 'Array<{ id: string, name: string, priceCents: number, quota: number, features: string[] }>',
          description: 'Lista planos de assinatura disponíveis com limites de cota'
        },
        {
          method: 'POST',
          path: '/api/billing/checkout-pix',
          requestBody: '{ planTier: "pro" | "enterprise" }',
          responseBody: '{ paymentId: string, qrCodeBase64: string, qrCodeCopyPaste: string, amountCents: number, expiresAt: string }',
          description: 'Gera cobrança PIX via PushinPay com QR Code e Copia-e-Cola'
        },
        {
          method: 'POST',
          path: '/api/webhooks/pushinpay',
          requestBody: '{ providerTxId: string, status: "paid", amountCents: number, signature: string }',
          responseBody: '{ received: true, upgraded: boolean }',
          description: 'Webhook PushinPay para confirmação de pagamento e upgrade automático de plano'
        },
        {
          method: 'GET',
          path: '/api/videos',
          requestBody: 'Query: ?niche=&minOutlier=&minViews=&q=&sort=&page=&limit=',
          responseBody: 'Array<{ id: string, youtube_id: string, title: string, channel_name: string, subscriber_count: number, views_count: number, outlier_multiplier: number, viral_score: number, engagement_rate: number, thumbnail_url: string }>',
          description: 'Listagem dos vídeos minerados com paginação, filtros compostos e busca debounce'
        },
        {
          method: 'GET',
          path: '/api/videos/:id/breakdown',
          requestBody: 'N/A',
          responseBody: '{ video: object, headline: object, transcript: object, thumbnail: object }',
          description: 'Decomposição em 3 eixos: Headline Hooks, Transcrição timestamped e Análise de Thumbnail'
        },
        {
          method: 'POST',
          path: '/api/workflows/harvest',
          requestBody: '{ niche?: string, query?: string }',
          responseBody: '{ runId: string, status: "completed", processedCount: number, stagesLatency: object }',
          description: 'Executa esteira estilo n8n (Harvester -> Outlier Filter -> Extractor)'
        },
        {
          method: 'GET',
          path: '/api/workflows/runs',
          requestBody: 'Query: ?stage=&status=&limit=',
          responseBody: 'Array<{ id: string, pipeline_name: string, status: string, stage: string, latency_ms: number, items_processed: number, created_at: string }>',
          description: 'Lista histórico de execuções de esteira com latência por etapa'
        },
        {
          method: 'GET',
          path: '/api/collections',
          requestBody: 'N/A',
          responseBody: 'Array<{ id: string, name: string, description: string, videoCount: number, videos: array }>',
          description: 'Listagem de coleções salvas do usuário'
        },
        {
          method: 'POST',
          path: '/api/collections',
          requestBody: '{ name: string, description?: string, videoId?: string }',
          responseBody: '{ id: string, name: string } (Status 201)',
          description: 'Criação ou salvamento de vídeo em coleção'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "viral_videos" | "video_breakdowns" | "audit_logs" }',
          responseBody: 'Content-Type: text/csv',
          description: 'Exportação em lote em conformidade com RFC-4180'
        },
        {
          method: 'GET',
          path: '/api/kpis',
          requestBody: 'N/A',
          responseBody: '{ totalVideos: number, criticalOutliers: number, avgEngagement: number, quotaUsed: number, quotaLimit: number }',
          description: 'Cards de métricas consolidadas de viralidade e cota'
        },
        {
          method: 'GET',
          path: '/api/audit-logs',
          requestBody: 'Query: ?entity=&limit=',
          responseBody: 'Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>',
          description: 'Trilha de auditoria imutável com diff JSON'
        }
      ],
      formulas: [
        'outlier_multiplier = Number((views_count / Math.max(channel_avg_views, 1)).toFixed(2))',
        'viral_score = Number(((views_count / Math.max(subscriber_count, 1)) * (likes_count / Math.max(views_count, 1)) * 100).toFixed(2))',
        'engagement_rate = Number((((likes_count + comments_count) / Math.max(views_count, 1)) * 100).toFixed(2))',
        'views_per_hour = Math.round(views_count / Math.max((Date.now() - new Date(published_at).getTime()) / 3600000, 1))',
        'variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100'
      ],
      validations: [
        'youtube_id deve conter identificador de vídeo válido do YouTube (HTTP 400)',
        'title deve ter pelo menos 3 caracteres (HTTP 400)',
        'views_count deve ser número inteiro maior ou igual a zero (HTTP 400)',
        'thumbnail_url deve ser uma URL válida ou asset local (HTTP 400)',
        'amount_cents deve ser número inteiro positivo em centavos (HTTP 400)',
        'turnstileToken é obrigatório em rotas de autenticação (HTTP 400)'
      ],
      envKeys: [
        'PORT=4000',
        'DATABASE_PATH=./data/viralytsearch.db',
        'SUPABASE_URL=mock_supabase_url',
        'SUPABASE_ANON_KEY=mock_supabase_anon_key',
        'CLOUDFLARE_TURNSTILE_SECRET_KEY=mock_turnstile_secret',
        'PUSHINPAY_API_TOKEN=mock_pushinpay_token',
        'UPSTASH_REDIS_REST_URL=mock_redis_url'
      ],
      archetype: 'dark-telemetry',
      accentColor: '#ef4444'
    },

    creator_viral_video: {
      domainKey: 'creator_viral_video',
      domainName: 'Creator Economy / YouTube Viral Search & Video Intelligence',
      targetAudience: 'Criadores de conteúdo, canais do YouTube, agências e estrategistas de mídia que buscam minerar referências virais, analisar métricas de engajamento e prever tendências com Outlier Multipliers.',
      referenceApps: [
        '1of10.com (Outlier Video Finder)',
        'VidIQ (Viral Velocity & Keyword Research)',
        'Viewstats by MrBeast (Thumbnail & Retention Analytics)',
        'TubeBuddy (Channel Explorer)',
        'OpusClip / Descript (Transcript & Hook Analysis)'
      ],
      marketBenchmark: 'Líderes de mercado automatizam a identificação de virais por Outlier Score, analisam padrões de thumbnail, velocidade de visualizações por hora (VPH) e decompõem ganchos de transcrição e headline para roteirização com monetização SaaS via PIX.',
      differentials: [
        'Radar de Outliers com cálculo preditivo de multiplicador viral comparado ao baseline do canal (3x a 50x)',
        'Slide-Over Drawer com decomposição em 3 abas: Headline Hooks com score CTR, Transcrição timestamped com cópia em 1 clique e Análise de Thumbnail (cores, contraste e emoção)',
        'Monetização SaaS nativa com planos Pro, PushinPay PIX com QR Code dinâmico e limite de cota de buscas com Cloudflare Turnstile'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Vídeos Minerados: 1.420 (Δ% +18.4%)',
            'Outliers Críticos (>5x): 84 vídeos',
            'Taxa de Engajamento Média: 6.8% (Δ% +1.2%)',
            'Cota de Buscas Restante: 42/50 buscas'
          ],
          chart: 'Gráfico SVG interativo de Curva de Velocidade Viral (Views/Hora vs Tempo) com tooltips e eixos em tabular-nums',
          gridColumns: ['Thumbnail', 'Título do Vídeo', 'Canal', 'Visualizações', 'Outlier Score', 'Engajamento (%)', 'Publicado Em', 'Ações'],
          filters: ['Filtro por Outlier Score (>3x, >5x, >10x)', 'Filtro por Nicho', 'Busca debounce por título ou canal'],
          drawerContent: 'Slide-Over Drawer com preview 16:9, gráfico de retenção estimada, tags de tração, métricas detalhadas (likes, comentários, VPH) e notas de roteiro',
          modalContent: 'Modal de Nova Busca / Importação de Vídeo com cálculo instantâneo de Outlier Score',
          seedSummary: '25 vídeos virais realistas de nichos como Finanças, Tecnologia, Produtividade e Curiosidades com métricas e thumbnails'
        },
        {
          code: '02',
          name: 'Breakdown',
          tabId: 'breakdown',
          kpis: [
            'Headlines Analisadas: 180',
            'Ganchos de Alta Retenção: 64',
            'Score CTR Médio: 8.6 / 10',
            'Transcrições Processadas: 142'
          ],
          chart: 'Gráfico SVG de distribuição de Hooks (Curiosidade, Contraintuitivo, Urgência, História)',
          gridColumns: ['ID', 'Título', 'Tipo de Gancho', 'Score CTR', 'Thumbnail Contraste', 'Emoção Predominante', 'Ações'],
          filters: ['Tipo de Gancho', 'Faixa de CTR Score', 'Busca debounce'],
          drawerContent: 'Slide-Over com abas dedicadas para Headline/Hooks, Transcrição Interativa com Cópia em 1 Clique e Inspeção de Thumbnail',
          modalContent: 'Modal de Decomposição Manual de Vídeo e Geração de Hooks Alternativos',
          seedSummary: '25 breakdowns detalhados de headline, transcrições timestamped e cores dominantes de thumbnail'
        },
        {
          code: '03',
          name: 'Colecoes',
          tabId: 'colecoes',
          kpis: [
            'Coleções Salvas: 12',
            'Vídeos Favoritados: 96',
            'Nichos Monitorados: 8',
            'Exportações Realizadas: 34'
          ],
          chart: 'Gráfico SVG de volume de vídeos favoritados por nicho',
          gridColumns: ['ID Coleção', 'Nome da Coleção', 'Descrição', 'Qtd Vídeos', 'Criado Em', 'Ações'],
          filters: ['Todos os Nichos', 'Busca debounce'],
          drawerContent: 'Visualizador dos vídeos contidos na coleção com ação de remover ou exportar',
          modalContent: 'Modal de Nova Coleção de Vídeos Virais',
          seedSummary: '8 coleções pré-configuradas com vídeos agrupados por temas e canais'
        },
        {
          code: '04',
          name: 'Assinatura',
          tabId: 'assinatura',
          kpis: [
            'Plano Atual: Pro Creator',
            'Cota de Buscas: 8 / 500 usadas',
            'Status Pagamento: Ativo (PIX)',
            'Renovação: em 28 dias'
          ],
          chart: 'Gráfico SVG de consumo diário da cota de buscas da assinatura',
          gridColumns: ['ID Transação', 'Plano', 'Valor (R$)', 'Status PIX', 'Data', 'Ações'],
          filters: ['Todos os Planos', 'Status (Pago, Pendente, Expirado)'],
          drawerContent: 'Drawer com QR Code PIX ampliado, código copia-e-cola e status de confirmação em tempo real',
          modalContent: 'Modal de Upgrade de Plano com seleção Pro/Enterprise e geração de PIX via PushinPay',
          seedSummary: 'Histórico de pagamentos PIX simulados com status pagos e chaves de teste'
        },
        {
          code: '05',
          name: 'Auditoria',
          tabId: 'auditoria',
          kpis: [
            'Logs Registrados: 312',
            'Atores do Sistema: 3',
            'Sessões Ativas: 4',
            'Turnstile Verificados: 100%'
          ],
          chart: 'Gráfico SVG de linha do tempo de operações auditadas e logins protegidos com Turnstile',
          gridColumns: ['Timestamp', 'Ator', 'Ação', 'Entidade', 'ID Alvo', 'Diff JSON', 'Ações'],
          filters: ['Ação (CREATE, UPDATE, DELETE)', 'Entidade (viral_videos, video_breakdowns, subscriptions)'],
          drawerContent: 'Visualizador de JSON diff com metadados de sessão e IP mascarado',
          modalContent: 'Modal de Exportação de Logs e Verificação de Status do Turnstile',
          seedSummary: '35 logs de auditoria imutáveis com registros de buscas, favoritos e pagamentos'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - Creator Economy / YouTube Viral Search & Video Intelligence
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  supabase_uid TEXT UNIQUE,
  plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro', 'enterprise')),
  search_quota_limit INTEGER NOT NULL DEFAULT 50,
  search_quota_used INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  turnstile_verified INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_tier TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  pix_provider TEXT NOT NULL DEFAULT 'pushinpay',
  current_period_end TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS pix_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_id TEXT,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  qr_code_base64 TEXT,
  qr_code_copy_paste TEXT,
  provider_tx_id TEXT UNIQUE,
  webhook_payload_json TEXT,
  paid_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS viral_videos (
  id TEXT PRIMARY KEY,
  youtube_video_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_subscribers INTEGER NOT NULL DEFAULT 0,
  views_count INTEGER NOT NULL DEFAULT 0,
  likes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  viral_ratio_score REAL NOT NULL DEFAULT 1.0,
  outlier_multiplier REAL NOT NULL DEFAULT 1.0,
  engagement_rate REAL NOT NULL DEFAULT 0.0,
  niche TEXT NOT NULL DEFAULT 'general',
  language TEXT NOT NULL DEFAULT 'pt-BR',
  thumbnail_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS video_breakdowns (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL UNIQUE,
  headline_text TEXT NOT NULL,
  headline_hook_type TEXT NOT NULL DEFAULT 'curiosity',
  headline_ctr_score REAL NOT NULL DEFAULT 8.5,
  headline_triggers_json TEXT NOT NULL DEFAULT '[]',
  headline_variations_json TEXT NOT NULL DEFAULT '[]',
  transcript_hook TEXT NOT NULL,
  transcript_body TEXT NOT NULL,
  transcript_cta TEXT NOT NULL,
  transcript_full_timestamped_json TEXT NOT NULL DEFAULT '[]',
  thumbnail_dominant_colors_json TEXT NOT NULL DEFAULT '[]',
  thumbnail_text_overlay TEXT,
  thumbnail_emotion TEXT NOT NULL DEFAULT 'curiosity',
  thumbnail_contrast_score REAL NOT NULL DEFAULT 8.2,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (video_id) REFERENCES viral_videos (id)
);

CREATE TABLE IF NOT EXISTS saved_collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  video_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id)
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

CREATE INDEX IF NOT EXISTS idx_viral_videos_outlier ON viral_videos (outlier_multiplier DESC);
CREATE INDEX IF NOT EXISTS idx_viral_videos_niche ON viral_videos (niche);
CREATE INDEX IF NOT EXISTS idx_video_breakdowns_video ON video_breakdowns (video_id);
CREATE INDEX IF NOT EXISTS idx_pix_payments_user ON pix_payments (user_id);
CREATE INDEX IF NOT EXISTS idx_saved_collections_user ON saved_collections (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Healthcheck de integridade operacional do backend e SQLite'
        },
        {
          method: 'POST',
          path: '/api/auth/register',
          requestBody: '{ email: string, password: string, fullName: string, turnstileToken: string }',
          responseBody: '{ user: object, sessionToken: string } (Status 201)',
          description: 'Registro de usuário com validação anti-bot Turnstile e criação de sessão'
        },
        {
          method: 'POST',
          path: '/api/auth/login',
          requestBody: '{ email: string, password: string, turnstileToken: string }',
          responseBody: '{ user: object, sessionToken: string }',
          description: 'Autenticação compatível com Supabase Auth e fallback local SQLite'
        },
        {
          method: 'POST',
          path: '/api/auth/verify-turnstile',
          requestBody: '{ token: string }',
          responseBody: '{ success: boolean, hostname?: string }',
          description: 'Verificação do token Cloudflare Turnstile'
        },
        {
          method: 'GET',
          path: '/api/auth/me',
          requestBody: 'Header: Authorization: Bearer <sessionToken>',
          responseBody: '{ id: string, email: string, fullName: string, planTier: string, searchQuota: object }',
          description: 'Retorna perfil do usuário autenticado e cota de buscas atual'
        },
        {
          method: 'GET',
          path: '/api/videos',
          requestBody: 'Query: ?niche=&minOutlier=&minViews=&format=&q=&sort=&page=&limit=',
          responseBody: 'Array<{ id: string, youtube_video_id: string, title: string, channel_name: string, views_count: number, outlier_multiplier: number, engagement_rate: number, thumbnail_url: string }>',
          description: 'Listagem dos vídeos minerados com paginação, filtros e busca debounce'
        },
        {
          method: 'GET',
          path: '/api/videos/:id/breakdown',
          requestBody: 'N/A',
          responseBody: '{ video: object, headline: object, transcript: object, thumbnail: object }',
          description: 'Decomposição em 3 eixos: Headline Hooks, Transcrição timestamped e Análise de Thumbnail'
        },
        {
          method: 'POST',
          path: '/api/payments/pix-checkout',
          requestBody: '{ planTier: "pro" | "enterprise" }',
          responseBody: '{ paymentId: string, qrCodeBase64: string, qrCodeCopyPaste: string, amountCents: number, expiresAt: string }',
          description: 'Gera cobrança PIX via PushinPay com QR Code e Copia-e-Cola'
        },
        {
          method: 'POST',
          path: '/api/webhooks/payment',
          requestBody: '{ providerTxId: string, status: "paid", amountCents: number, signature: string }',
          responseBody: '{ received: true, upgraded: boolean }',
          description: 'Webhook PushinPay para confirmação de pagamento e upgrade automático de plano'
        },
        {
          method: 'GET',
          path: '/api/collections',
          requestBody: 'N/A',
          responseBody: 'Array<{ id: string, name: string, description: string, videoCount: number, videos: array }>',
          description: 'Listagem de coleções salvas do usuário'
        },
        {
          method: 'POST',
          path: '/api/collections',
          requestBody: '{ name: string, description?: string, videoId?: string }',
          responseBody: '{ id: string, name: string } (Status 201)',
          description: 'Criação ou salvamento de vídeo em coleção'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "viral_videos" | "video_breakdowns" | "audit_logs" }',
          responseBody: 'Content-Type: text/csv',
          description: 'Exportação em lote em conformidade com RFC-4180'
        },
        {
          method: 'GET',
          path: '/api/kpis',
          requestBody: 'N/A',
          responseBody: '{ totalVideos: number, criticalOutliers: number, avgEngagement: number, quotaUsed: number, quotaLimit: number }',
          description: 'Cards de métricas consolidadas de viralidade e cota'
        },
        {
          method: 'GET',
          path: '/api/audit-logs',
          requestBody: 'Query: ?entity=&limit=',
          responseBody: 'Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>',
          description: 'Trilha de auditoria imutável com diff JSON'
        }
      ],
      formulas: [
        'outlier_multiplier = Number((views_count / Math.max(channel_avg_views, 1)).toFixed(2))',
        'viral_ratio_score = Number(((views_count / Math.max(channel_subscribers, 1)) * (likes_count / Math.max(views_count, 1)) * 100).toFixed(2))',
        'engagement_rate = Number((((likes_count + comments_count) / Math.max(views_count, 1)) * 100).toFixed(2))',
        'views_per_hour = Math.round(views_count / Math.max((Date.now() - new Date(published_at).getTime()) / 3600000, 1))',
        'variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100'
      ],
      validations: [
        'youtube_video_id deve conter exatamente 11 caracteres ou URL válida de YouTube (HTTP 400)',
        'title deve ter pelo menos 3 caracteres (HTTP 400)',
        'views_count deve ser número inteiro maior ou igual a zero (HTTP 400)',
        'thumbnail_url deve ser uma URL válida ou asset local (HTTP 400)',
        'amount_cents deve ser número inteiro positivo em centavos (HTTP 400)'
      ],
      envKeys: [
        'PORT=4000',
        'DATABASE_PATH=./data/viralytsearch.db',
        'SUPABASE_URL=mock_supabase_url',
        'SUPABASE_ANON_KEY=mock_supabase_anon_key',
        'CLOUDFLARE_TURNSTILE_SECRET_KEY=mock_turnstile_secret',
        'PUSHINPAY_API_TOKEN=mock_pushinpay_token',
        'UPSTASH_REDIS_REST_URL=mock_redis_url'
      ],
      archetype: 'dark-telemetry',
      accentColor: '#ef4444'
    },

    creator_video_analytics: {
      domainKey: 'creator_video_analytics',
      domainName: 'Creator Economy / YouTube Viral Search & Analytics',
      targetAudience: 'Criadores de conteúdo, canais do YouTube, agências e estrategistas de mídia que buscam minerar referências virais, analisar métricas de engajamento e prever tendências com Outlier Multipliers.',
      referenceApps: [
        '1of10.com (Outlier Video Finder)',
        'VidIQ (Viral Velocity & Keyword Research)',
        'Viewstats by MrBeast (Thumbnail & Retention Analytics)',
        'TubeBuddy (Channel Explorer)',
        'OpusClip / Descript (Transcript & Hook Analysis)'
      ],
      marketBenchmark: 'Líderes de mercado (1of10, Viewstats) automatizam a identificação de virais por Outlier Score (desempenho comparado à média histórica do canal), analisam padrões de thumbnail, velocidade de visualizações por hora (VPH) e organizam nichos em radares de conteúdo com exportação e notas de roteirização.',
      differentials: [
        'Algoritmo Preditivo de Outlier Score comparando a performance do vídeo com a média histórica do canal (identifica virais autênticos de 3x a 50x)',
        'Radar de Nichos & Monitoramento de Concorrentes com cálculo de velocidade em tempo real (Views Per Hour - VPH)',
        'Gaveta Analítica 520px com decomposição de thumbnails (16:9), tags de tração, métricas de retenção e exportação para roteirização'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Vídeos Minerados: 1.420 (Δ% +18.4% vs semana anterior)',
            'Outliers Críticos (>5x): 84 vídeos',
            'Taxa de Engajamento Média: 6.8% (Δ% +1.2%)',
            'Velocidade Máx. Registrada: 42.500 views/h'
          ],
          chart: 'Gráfico SVG interativo de Curva de Velocidade Viral (Views/Hora vs Tempo desde publicação) com tooltips e eixos em tabular-nums',
          gridColumns: ['Thumbnail', 'Título do Vídeo', 'Canal', 'Visualizações', 'Outlier Score', 'Engajamento (%)', 'Publicado Em', 'Ações'],
          filters: ['Filtro por Outlier Score (>3x, >5x, >10x)', 'Filtro por Nicho', 'Busca debounce por título ou canal'],
          drawerContent: 'Slide-Over Drawer com preview de vídeo 16:9, gráfico de retenção estimada, tags de tração, métricas detalhadas (likes, comentários, VPH) e bloco de anotações de roteiro',
          modalContent: 'Modal de Importação Manual ou Coleta Rápida via YouTube ID/URL com cálculo instantâneo de Outlier Score',
          seedSummary: '25 vídeos virais realistas de nichos como Finanças, Tecnologia, Produtividade e Curiosidades com métricas e thumbnails'
        },
        {
          code: '02',
          name: 'Registros',
          tabId: 'registros',
          kpis: [
            'Vídeos Catalogados: 250',
            'Super Outliers (>10x): 18 vídeos',
            'Engajamento Alto (>8%): 64 vídeos',
            'Canais Monitorados: 42'
          ],
          chart: 'Gráfico SVG de Dispersão / Barras de Outlier Score por Nicho e Duração',
          gridColumns: ['ID', 'Thumbnail', 'Título', 'Canal', 'Views', 'Outlier Multiplier', 'Likes', 'Taxa Engajamento', 'Data', 'Ações'],
          filters: ['Multi-range Outlier (>2x, >5x, >10x, >20x)', 'Filtro por Faixa de Views (<50k, 50k-500k, >1M)', 'Busca debounce (250ms)'],
          drawerContent: 'Drawer com análise aprofundada de títulos, padrões de thumbnail (contraste/expressão), tags e botão de exportar para briefing de roteiro',
          modalContent: 'Modal de Registro de Vídeo com preenchimento assistido e cálculo de baseline do canal',
          seedSummary: '30 registros detalhados de vídeos virais catalogados com tags e baseline de canal'
        },
        {
          code: '03',
          name: 'Operações',
          tabId: 'operacoes',
          kpis: [
            'Nichos Ativos: 8 nichos',
            'Coletas Executadas: 142',
            'Taxa de Sucesso de Coleta: 100%',
            'Tempo Médio de Varredura: 280ms'
          ],
          chart: 'Gráfico SVG de Volume de Vídeos Capturados por Nicho nas últimas 24h',
          gridColumns: ['ID Coleta', 'Nicho / Query', 'Vídeos Minerados', 'Status', 'Duração (ms)', 'Executado Em', 'Ações'],
          filters: ['Filtro por Nicho', 'Status da Coleta (Sucesso, Processando, Falha)'],
          drawerContent: 'Visualizador de payload de coleta, termos pesquisados e lista de vídeos descobertos na varredura',
          modalContent: 'Modal de Nova Varredura de Nicho (Trigger Scan) com palavras-chave, filtros de data e limite de resultados',
          seedSummary: '15 operações de varredura executadas em nichos de IA, Finanças e Games'
        },
        {
          code: '04',
          name: 'Auditoria',
          tabId: 'auditoria',
          kpis: [
            'Logs Auditados: 312',
            'Atores do Sistema: 3',
            'Operações de Criação/Atualização: 275',
            'Eventos de Exclusão: 37'
          ],
          chart: 'Gráfico SVG de linha do tempo de operações auditadas',
          gridColumns: ['Timestamp', 'Ator', 'Ação', 'Entidade', 'ID Alvo', 'Diff JSON', 'Ações'],
          filters: ['Ação (CREATE, UPDATE, DELETE)', 'Entidade (viral_videos, saved_niches, settings)', 'Busca debounce'],
          drawerContent: 'Visualizador de diff JSON formatado antes/depois com realce de sintaxe',
          modalContent: 'Modal de Exportação de Trilha Forense em formato CSV e JSON',
          seedSummary: '35 logs de auditoria imutáveis com registros de coletas, alterações de notas e criação de nichos'
        },
        {
          code: '05',
          name: 'Configuracoes',
          tabId: 'configuracoes',
          kpis: [
            'Algoritmo Ativo: Outlier Multiplier V2',
            'YouTube Data API V3: Graceful Mock Ativo',
            'Intervalo de Varredura: 6h',
            'Status do Banco: SQLite WAL Conectado'
          ],
          chart: 'Gráfico SVG de consumo de cota de API simulada / real por hora',
          gridColumns: ['Parâmetro', 'Chave', 'Valor Configurado', 'Última Alteração', 'Responsável', 'Ações'],
          filters: ['Gerais', 'Algoritmos & Pesos', 'API & Chaves'],
          drawerContent: 'Painel de parametrização de pesos da fórmula de Outlier e multiplicadores de engajamento',
          modalContent: 'Modal de Edição de Chaves de API (YouTube Data API V3) com alternância para Mock Fallback determinístico',
          seedSummary: 'Configurações completas de pesos de algoritmo, limites de busca e chaves mock'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - Creator Economy & YouTube Viral Search
CREATE TABLE IF NOT EXISTS saved_niches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keyword_filter TEXT NOT NULL,
  min_views INTEGER NOT NULL DEFAULT 10000,
  min_outlier_score REAL NOT NULL DEFAULT 3.0,
  refresh_interval_hours INTEGER NOT NULL DEFAULT 6,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS viral_videos (
  id TEXT PRIMARY KEY,
  youtube_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  view_count_baseline REAL NOT NULL DEFAULT 10000,
  outlier_score REAL NOT NULL DEFAULT 1.0,
  engagement_rate REAL NOT NULL DEFAULT 0.0,
  views_per_hour REAL NOT NULL DEFAULT 0.0,
  niche_id TEXT,
  tags_json TEXT DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (niche_id) REFERENCES saved_niches (id)
);

CREATE TABLE IF NOT EXISTS search_operations (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  niche_id TEXT,
  results_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  execution_time_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (niche_id) REFERENCES saved_niches (id)
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

CREATE INDEX IF NOT EXISTS idx_viral_videos_outlier ON viral_videos (outlier_score DESC);
CREATE INDEX IF NOT EXISTS idx_viral_videos_niche ON viral_videos (niche_id);
CREATE INDEX IF NOT EXISTS idx_viral_videos_views ON viral_videos (views DESC);
CREATE INDEX IF NOT EXISTS idx_search_operations_created ON search_operations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Healthcheck de integridade operacional do backend e SQLite'
        },
        {
          method: 'GET',
          path: '/api/audit-logs',
          requestBody: 'Query: ?entity=&limit=',
          responseBody: 'Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>',
          description: 'Trilha de auditoria forense imutável com histórico estruturado'
        },
        {
          method: 'GET',
          path: '/api/kpis',
          requestBody: 'N/A',
          responseBody: '{ totalVideos: number, criticalOutliers: number, avgEngagement: number, maxVph: number, formatted: object }',
          description: 'Totais consolidados e indicadores de viralidade para Cards Bento de KPI'
        },
        {
          method: 'GET',
          path: '/api/videos',
          requestBody: 'Query: ?nicheId=&minOutlier=&minViews=&q=&page=&limit=',
          responseBody: 'Array<{ id: string, youtube_id: string, title: string, channel_title: string, views: number, outlier_score: number, engagement_rate: number, thumbnail_url: string }>',
          description: 'Listagem dos vídeos minerados com paginação e busca debounce (250ms)'
        },
        {
          method: 'POST',
          path: '/api/videos',
          requestBody: '{ youtube_id: string, title: string, channel_title: string, views: number, likes?: number, comments?: number, thumbnail_url: string, niche_id?: string }',
          responseBody: '{ id: string, title: string, outlier_score: number } (Status 201)',
          description: 'Registro de novo vídeo minerado com cálculo automático de Outlier Score'
        },
        {
          method: 'GET',
          path: '/api/niches',
          requestBody: 'N/A',
          responseBody: 'Array<{ id: string, name: string, keyword_filter: string, min_views: number, min_outlier_score: number, is_active: number }>',
          description: 'Listagem de nichos e filtros configurados no radar'
        },
        {
          method: 'POST',
          path: '/api/niches',
          requestBody: '{ name: string, keyword_filter: string, min_views?: number, min_outlier_score?: number }',
          responseBody: '{ id: string, name: string, keyword_filter: string } (Status 201)',
          description: 'Criação de novo nicho de monitoramento'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "viral_videos" | "saved_niches" | "audit_logs" }',
          responseBody: 'Content-Type: text/csv',
          description: 'Exportação em lote de vídeos e análises em CSV'
        }
      ],
      formulas: [
        'engagement_rate = ((likes + comments) / Math.max(views, 1)) * 100',
        'outlier_score = Number((views / Math.max(channel_avg_views, 1)).toFixed(2))',
        'views_per_hour = Math.round(views / Math.max((Date.now() - new Date(published_at).getTime()) / 3600000, 1))',
        'variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100'
      ],
      validations: [
        'youtube_id deve conter exatamente 11 caracteres alfanuméricos ou URL válida de YouTube (HTTP 400)',
        'title deve ter pelo menos 3 caracteres (HTTP 400)',
        'views deve ser número inteiro maior ou igual a zero (HTTP 400)',
        'thumbnail_url deve ser uma URL válida ou caminho de asset local (HTTP 400)'
      ],
      envKeys: ['PORT=4000', 'DATABASE_PATH=./data/viralytsearch.db', 'YOUTUBE_API_KEY=mock_youtube_api_key'],
      archetype: 'dark-telemetry',
      accentColor: '#ef4444'
    },

    ai_automation_agents: {
      domainKey: 'ai_automation_agents',
      domainName: 'AI Automation, LLM Observability & Agents',
      targetAudience: 'Engenheiros de IA, desenvolvedores e equipes de automação que constroem, monitoram e avaliam pipelines de LLM, execuções de agentes e custos de tokens.',
      referenceApps: ['LangSmith', 'Vercel AI Playground', 'Linear', 'Raycast', 'OpenRouter'],
      marketBenchmark: 'Plataformas modernas de observabilidade de IA fornecem tracing granular de execuções passo a passo (spans), medição de latência P95 em ms, contabilidade de custo de tokens e playground interativo com fallback de modelos.',
      differentials: [
        'Tracing profundo de spans de execução de agentes com metadados de prompt, resposta e latência',
        'Contabilidade analítica de consumo de tokens (Prompt/Completion) e estimativa de custo em USD/BRL',
        'Playground interativo de teste de prompts com comparador de modelos e exportação de datasets'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Total Execuções: 8.420 (Δ% +24.1%)',
            'Latência P95: 412ms (Δ% -14.2%)',
            'Taxa de Sucesso: 99.1% (Δ% +0.8%)',
            'Custo Estimado (Hoje): $ 14.85 (Δ% +5.2%)'
          ],
          chart: 'Gráfico SVG interativo de Latência P95 e Consumo de Tokens por Hora com tooltips em tabular-nums',
          gridColumns: ['ID Execução', 'Agente / Pipeline', 'Modelo', 'Status', 'Tokens', 'Latência (ms)', 'Custo ($)', 'Executado Em', 'Ações'],
          filters: ['Filtro por Modelo (gpt-4o, claude-3-5-sonnet, gemini-1.5-pro)', 'Filtro por Status (Sucesso, Falha, Timeout)', 'Busca debounce'],
          drawerContent: 'Slide-Over Drawer com visualizador em cascata de Spans, prompt completo de entrada, resposta gerada e métricas de token',
          modalContent: 'Modal de Nova Execução de Teste com seleção de agente, variáveis de prompt e modelo',
          seedSummary: '30 execuções detalhadas com traces, status e custos calculados'
        },
        {
          code: '02',
          name: 'Agentes',
          tabId: 'agentes',
          kpis: [
            'Agentes Ativos: 6',
            'Templates de Prompt: 14',
            'Versões Homologadas: 8',
            'Execuções/min Médio: 42'
          ],
          chart: 'Gráfico SVG de distribuição de chamadas por agente e taxa de erro',
          gridColumns: ['Código', 'Nome do Agente', 'Modelo Base', 'Versão', 'Temperatura', 'Execuções Totais', 'Status', 'Ações'],
          filters: ['Todos os Agentes', 'Filtro por Status Ativo/Inativo'],
          drawerContent: 'Drawer com editor de System Prompt, histórico de versões e métricas de acurácia',
          modalContent: 'Modal de Criação de Agente com parametrização de temperatura, top_p e max_tokens',
          seedSummary: '6 agentes de IA configurados (Extrator, Classificador, Resumidor, Auditor, Roteirista, Pesquisador)'
        },
        {
          code: '03',
          name: 'Operações',
          tabId: 'operacoes',
          kpis: [
            'Lotes Processados: 48',
            'Spans Auditados: 1.250',
            'Timeouts Evitados: 12',
            'Throughput Máx.: 120 req/s'
          ],
          chart: 'Gráfico SVG de taxa de transferência (Throughput req/s) nas últimas 24h',
          gridColumns: ['ID Lote', 'Pipeline', 'Itens', 'Sucesso', 'Falhas', 'Duração (s)', 'Data', 'Ações'],
          filters: ['Status do Lote', 'Busca debounce'],
          drawerContent: 'Visualizador de logs brutos da execução e traceback de eventuais exceções',
          modalContent: 'Modal de Disparo de Lote de Avaliação (Eval Benchmark)',
          seedSummary: '15 operações em lote de avaliação com percentuais de sucesso'
        },
        {
          code: '04',
          name: 'Auditoria',
          tabId: 'auditoria',
          kpis: [
            'Eventos Registrados: 420',
            'Atores: 3',
            'Alterações de Prompt: 18',
            'Tokens Revogados: 0'
          ],
          chart: 'Gráfico SVG de frequência temporal de eventos de auditoria',
          gridColumns: ['Timestamp', 'Ator', 'Ação', 'Entidade', 'ID Alvo', 'Diff JSON', 'Ações'],
          filters: ['Ação (CREATE, UPDATE, DELETE)', 'Entidade (ai_agents, prompt_templates, runs)'],
          drawerContent: 'Visualizador de JSON diff com destaque de mutações de prompt e hiperparâmetros',
          modalContent: 'Modal de Exportação de Logs de Auditoria para conformidade e SOC2',
          seedSummary: '35 logs de auditoria imutáveis com registros de alterações e deploys de modelos'
        },
        {
          code: '05',
          name: 'Configuracoes',
          tabId: 'configuracoes',
          kpis: [
            'Provedores Ativos: OpenAI, Anthropic, Google',
            'Fallback Automático: Habilitado',
            'Rate Limit Pessoal: 200 req/min',
            'Banco de Dados: SQLite WAL'
          ],
          chart: 'Gráfico SVG de consumo de cota por provedor de IA',
          gridColumns: ['Provedor', 'Chave Mascarada', 'Status', 'Cota Restante', 'Ações'],
          filters: ['Geral', 'Provedores de LLM', 'Webhooks'],
          drawerContent: 'Painel de parametrização de timeouts de inferência e política de retries',
          modalContent: 'Modal de Cadastro de Chave de API de Provedor de LLM com teste de conectividade',
          seedSummary: 'Configurações de modelos, limites de gastos e chaves mock determinísticas'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - AI Automation & LLM Observability
CREATE TABLE IF NOT EXISTS ai_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  model_name TEXT NOT NULL DEFAULT 'gpt-4o',
  system_prompt TEXT NOT NULL,
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 2048,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS execution_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  prompt_input TEXT NOT NULL,
  response_output TEXT,
  model_used TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES ai_agents (id)
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  template TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES ai_agents (id)
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

CREATE INDEX IF NOT EXISTS idx_execution_runs_agent ON execution_runs (agent_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_status ON execution_runs (status);
CREATE INDEX IF NOT EXISTS idx_execution_runs_created ON execution_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Healthcheck de integridade operacional do backend e SQLite'
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
          responseBody: '{ totalRuns: number, p95Latency: number, successRate: number, totalCostUsd: number }',
          description: 'Métricas analíticas consolidadas para os cards de BI'
        },
        {
          method: 'GET',
          path: '/api/runs',
          requestBody: 'Query: ?agentId=&status=&model=&q=&page=&limit=',
          responseBody: 'Array<{ id: string, agent_id: string, model_used: string, total_tokens: number, latency_ms: number, cost_usd: number, status: string }>',
          description: 'Listagem de execuções com paginação e busca debounce'
        },
        {
          method: 'POST',
          path: '/api/runs',
          requestBody: '{ agentId: string, promptInput: string, model?: string }',
          responseBody: '{ id: string, responseOutput: string, latencyMs: number, tokens: number } (Status 201)',
          description: 'Disparo de nova inferência de agente com medição de latência'
        },
        {
          method: 'GET',
          path: '/api/agents',
          requestBody: 'N/A',
          responseBody: 'Array<{ id: string, name: string, model_name: string, temperature: number, is_active: number }>',
          description: 'Listagem de agentes configurados'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "execution_runs" | "audit_logs" }',
          responseBody: 'Content-Type: text/csv',
          description: 'Exportação em lote de execuções e custos em formato CSV'
        }
      ],
      formulas: [
        'p95_latency_ms = percentile_95(latencies)',
        'cost_usd = ((prompt_tokens * 0.005) + (completion_tokens * 0.015)) / 1000',
        'success_rate = (runs_sucesso / total_runs) * 100',
        'variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100'
      ],
      validations: [
        'name deve ter pelo menos 3 caracteres (HTTP 400)',
        'model_name deve ser um modelo suportado (HTTP 400)',
        'temperature deve estar entre 0.0 e 2.0 (HTTP 400)'
      ],
      envKeys: ['PORT=4000', 'DATABASE_PATH=./data/ai_agents.db', 'OPENAI_API_KEY=mock_key'],
      archetype: 'dark-telemetry',
      accentColor: '#8b5cf6'
    },

    edtech_learning: {
      domainKey: 'edtech_learning',
      domainName: 'EdTech, Cursos Online & Aprendizado Adaptativo',
      targetAudience: 'Instrutores, estudantes, gestores de treinamento corporativo e escolas online que acompanham engajamento, retenção em aulas e domínio de competências.',
      referenceApps: ['Teachable', 'Coursera', 'Duolingo', 'Anki', 'Notion'],
      marketBenchmark: 'Líderes de EdTech oferecem trilhas de aprendizado modulares, retenção por repetição espaçada (flashcards), acompanhamento analítico de progresso de aulas e emissão de certificados com validação de conclusão.',
      differentials: [
        'Trilhas pedagógicas modulares com verificação instantânea de conclusão e retenção',
        'Sistema de flashcards com algoritmo de repetição espaçada integrado a cada módulo',
        'Dashboard analítico do instrutor com taxa de desistência por aula e notas médias de quizzes'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Alunos Matriculados: 1.280 (Δ% +16.2%)',
            'Taxa de Conclusão: 74.5% (Δ% +5.1%)',
            'Horas de Aula Assistidas: 3.450h (Δ% +12.0%)',
            'Nota Média em Avaliações: 8.6/10'
          ],
          chart: 'Gráfico SVG interativo de Horas de Estudo por Dia e Curva de Retenção de Alunos',
          gridColumns: ['ID', 'Aluno', 'Curso', 'Progresso (%)', 'Última Aula', 'Status', 'Ações'],
          filters: ['Todos os Cursos', 'Status (Ativo, Concluído, Em Risco)', 'Busca debounce'],
          drawerContent: 'Drawer com ficha completa do aluno, notas em quizzes e histórico de frequência',
          modalContent: 'Modal de Matrícula Rápida de Aluno',
          seedSummary: '25 alunos com matrículas e progresso calculado'
        },
        {
          code: '02',
          name: 'Cursos',
          tabId: 'cursos',
          kpis: [
            'Cursos Ativos: 8',
            'Módulos Cadastrados: 32',
            'Aulas Gravadas: 142',
            'Flashcards Disponíveis: 310'
          ],
          chart: 'Gráfico SVG de alunos ativos por curso',
          gridColumns: ['Código', 'Título do Curso', 'Instrutor', 'Módulos', 'Aulas', 'Alunos', 'Status', 'Ações'],
          filters: ['Categoria de Curso', 'Status'],
          drawerContent: 'Drawer com ementa do curso, links de vídeo e materiais complementares',
          modalContent: 'Modal de Criação de Novo Curso com ementa modular',
          seedSummary: '8 cursos completos com módulos e aulas'
        },
        {
          code: '03',
          name: 'Operações',
          tabId: 'operacoes',
          kpis: [
            'Quizzes Respondidos: 840',
            'Taxa de Acerto Geral: 81.2%',
            'Certificados Emitidos: 92',
            'Dúvidas Pendentes: 3'
          ],
          chart: 'Gráfico SVG de distribuição de notas em avaliações',
          gridColumns: ['ID Tentativa', 'Aluno', 'Quiz / Módulo', 'Nota', 'Data', 'Status', 'Ações'],
          filters: ['Status de Aprovação', 'Busca debounce'],
          drawerContent: 'Visualizador de respostas de quiz do aluno e feedback pedagógico',
          modalContent: 'Modal de Emissão Manual de Certificado de Conclusão',
          seedSummary: '20 registros de tentativas de quizzes e avaliações'
        },
        {
          code: '04',
          name: 'Auditoria',
          tabId: 'auditoria',
          kpis: [
            'Logs Registrados: 280',
            'Atores: 3',
            'Certificados Auditados: 92',
            'Alterações de Notas: 4'
          ],
          chart: 'Gráfico SVG de eventos de matrícula e conclusões diárias',
          gridColumns: ['Timestamp', 'Ator', 'Ação', 'Entidade', 'ID Alvo', 'Diff JSON', 'Ações'],
          filters: ['Ação (CREATE, UPDATE, DELETE)', 'Busca debounce'],
          drawerContent: 'Visualizador de diff JSON com alterações de notas ou matrículas',
          modalContent: 'Modal de Exportação de Trilha de Auditoria Acadêmica',
          seedSummary: '30 logs de auditoria imutáveis com histórico de matrículas e notas'
        },
        {
          code: '05',
          name: 'Configuracoes',
          tabId: 'configuracoes',
          kpis: [
            'Portal de Alunos: Online',
            'Certificação Automática: Habilitada (>=70%)',
            'Repetição Espaçada: Ativa',
            'Banco de Dados: SQLite WAL'
          ],
          chart: 'Gráfico SVG de consumo de largura de banda de streaming de aulas',
          gridColumns: ['Parâmetro', 'Valor', 'Status', 'Última Atualização', 'Ações'],
          filters: ['Geral', 'Critérios de Certificação', 'Notificações'],
          drawerContent: 'Painel de configuração de nota mínima de corte e regras de certificado',
          modalContent: 'Modal de Ajuste de Critérios de Aprovação',
          seedSummary: 'Configurações acadêmicas e critérios de nota mínima'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - EdTech & Learning Management
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  instructor_name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0.0,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (course_id) REFERENCES courses (id)
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  title TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 10,
  video_url TEXT,
  order_index INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (module_id) REFERENCES modules (id)
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  progress_percent REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'dropped')),
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (student_id) REFERENCES students (id),
  FOREIGN KEY (course_id) REFERENCES courses (id)
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

CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments (student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments (course_id);
CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons (module_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Healthcheck de integridade operacional'
        },
        {
          method: 'GET',
          path: '/api/audit-logs',
          requestBody: 'Query: ?entity=&limit=',
          responseBody: 'Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>',
          description: 'Trilha de auditoria educacional'
        },
        {
          method: 'GET',
          path: '/api/kpis',
          requestBody: 'N/A',
          responseBody: '{ totalStudents: number, completionRate: number, totalHours: number, avgScore: number }',
          description: 'Métricas acadêmicas e de engajamento'
        },
        {
          method: 'GET',
          path: '/api/courses',
          requestBody: 'Query: ?q=&page=&limit=',
          responseBody: 'Array<{ id: string, title: string, instructor_name: string, is_published: number }>',
          description: 'Catálogo de cursos com busca debounce'
        },
        {
          method: 'POST',
          path: '/api/courses',
          requestBody: '{ title: string, instructor_name: string, description?: string, price?: number }',
          responseBody: '{ id: string, title: string, ... } (Status 201)',
          description: 'Cadastro de curso com validação'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "courses" | "students" | "enrollments" }',
          responseBody: 'Content-Type: text/csv',
          description: 'Exportação em lote de registros em CSV'
        }
      ],
      formulas: [
        'completion_rate = (alunos_concluintes / total_matriculados) * 100',
        'average_score = sum(notas_avaliacoes) / total_avaliacoes',
        'variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100'
      ],
      validations: [
        'title deve ter pelo menos 3 caracteres (HTTP 400)',
        'instructor_name deve ser informado (HTTP 400)',
        'email deve ser um formato de email válido (HTTP 400)'
      ],
      envKeys: ['PORT=4000', 'DATABASE_PATH=./data/edtech.db'],
      archetype: 'clean-saas',
      accentColor: '#10b981'
    },

    logistics_operations: {
      domainKey: 'logistics_operations',
      domainName: 'Logística, Gestão de Frotas & Operações de Entrega',
      targetAudience: 'Operadores logísticos, despachantes, transportadoras e gestores de armazém que necessitam rastrear encomendas, despachos, rotas e custos de frete.',
      referenceApps: ['Flexport', 'ShipBob', 'Samsara', 'Uber Freight'],
      marketBenchmark: 'Líderes de logística oferecem telemetria de veículos em tempo real, cálculo dinâmico de frete por SLA e cubagem, rastreamento de status de remessas e otimização de paradas de entrega.',
      differentials: [
        'Telemetria de remessas em tempo real com SLA dinâmico e alertas preditivos de atraso',
        'Cálculo de custo de frete por rota, cubagem e consumo de combustível por km rodado',
        'Rastreamento de status de pacotes ponta a ponta com comprovante digital de entrega'
      ],
      sections: [
        {
          code: '01',
          name: 'Dashboard',
          tabId: 'dashboard',
          kpis: [
            'Remessas em Trânsito: 342 (Δ% +8.5%)',
            'Entregas no Prazo (OTD): 96.8% (Δ% +1.2%)',
            'Custo Médio / km: R$ 4,12 (Δ% -2.5%)',
            'Veículos Ativos: 28 / 30'
          ],
          chart: 'Gráfico SVG interativo de Remessas Despachadas vs Entregues por Dia com tooltips',
          gridColumns: ['Código Rastreio', 'Origem', 'Destino', 'Status', 'SLA Estimado', 'Veículo', 'Ações'],
          filters: ['Status (Em Trânsito, Entregue, Atrasado, Pendente)', 'Busca debounce'],
          drawerContent: 'Drawer com timeline de rastreamento da remessa, paradas, dados do motorista e comprovante de entrega',
          modalContent: 'Modal de Despacho Rápido de Carga',
          seedSummary: '25 remessas em trânsito com rotas e status realistas'
        },
        {
          code: '02',
          name: 'Remessas',
          tabId: 'remessas',
          kpis: [
            'Total Remessas (Mês): 1.480',
            'Entregas Concluídas: 1.390',
            'Ocorrências / Disputas: 12',
            'Tempo Médio de Rota: 4.2h'
          ],
          chart: 'Gráfico SVG de distribuição de entregas por estado/região',
          gridColumns: ['ID', 'Cliente', 'Destinatário', 'Volume (kg)', 'Valor Frete', 'Status', 'Data', 'Ações'],
          filters: ['Região', 'Status da Remessa', 'Busca debounce'],
          drawerContent: 'Drawer com detalhes da nota fiscal, cubagem e coordenadas de destino',
          modalContent: 'Modal de Cadastro de Nova Remessa',
          seedSummary: '30 remessas detalhadas com volumes e valores de frete'
        },
        {
          code: '03',
          name: 'Operações',
          tabId: 'operacoes',
          kpis: [
            'Rotas Otimizadas: 54',
            'Km Totais Percorridos: 18.420 km',
            'Economia de Combustível: 12.4%',
            'Paradas Concluídas: 412'
          ],
          chart: 'Gráfico SVG de eficiência de combustível e tempo de entrega',
          gridColumns: ['ID Rota', 'Motorista', 'Placa', 'Paradas', 'Status', 'Início', 'Ações'],
          filters: ['Status da Rota', 'Motorista'],
          drawerContent: 'Visualizador do manifesto de carga e sequência de paradas planejadas',
          modalContent: 'Modal de Otimização e Planejamento de Nova Rota',
          seedSummary: '12 rotas de entrega com lista de paradas'
        },
        {
          code: '04',
          name: 'Auditoria',
          tabId: 'auditoria',
          kpis: [
            'Ocorrências Auditadas: 310',
            'Atores Registrados: 4',
            'Comprovantes Anexados: 298',
            'Divergências Resolvidas: 14'
          ],
          chart: 'Gráfico SVG de volume diário de registros de entrega auditados',
          gridColumns: ['Timestamp', 'Ator', 'Ação', 'Entidade', 'ID Alvo', 'Diff JSON', 'Ações'],
          filters: ['Ação (CREATE, UPDATE, DELETE)', 'Busca debounce'],
          drawerContent: 'Visualizador de diff estruturado com alterações de SLA e rotas',
          modalContent: 'Modal de Exportação de Trilha de Auditoria Logística',
          seedSummary: '30 logs de auditoria imutáveis com registros de despacho e entrega'
        },
        {
          code: '05',
          name: 'Configuracoes',
          tabId: 'configuracoes',
          kpis: [
            'API de Rastreio: Conectada',
            'Algoritmo de Rota: Dijkstra Otimizado',
            'SLA Alerta Automático: 30 min',
            'Banco de Dados: SQLite WAL'
          ],
          chart: 'Gráfico SVG de consumo de cota de geocodificação e mapas',
          gridColumns: ['Parâmetro', 'Valor', 'Status', 'Atualizado Em', 'Ações'],
          filters: ['Geral', 'Tabelas de Frete', 'Integrações GPS'],
          drawerContent: 'Painel de configuração de parâmetros de cubagem e custo de frete base',
          modalContent: 'Modal de Ajuste de Tabela de Preço por Peso e Região',
          seedSummary: 'Configurações de frotas e tabelas de frete padrão'
        }
      ],
      sqliteSchema: `-- Esquema Relacional SQLite - Logística & Gestão de Frotas
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  tracking_code TEXT NOT NULL UNIQUE,
  sender_name TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  destination_city TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  weight_kg REAL NOT NULL DEFAULT 1.0,
  shipping_fee REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'delivered', 'failed', 'returned')),
  estimated_delivery TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id TEXT PRIMARY KEY,
  license_plate TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  capacity_kg REAL NOT NULL DEFAULT 1000.0,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_route', 'maintenance')),
  driver_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_routes (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  total_stops INTEGER NOT NULL DEFAULT 1,
  completed_stops INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed')),
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles (id)
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

CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments (tracking_code);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments (status);
CREATE INDEX IF NOT EXISTS idx_routes_vehicle ON delivery_routes (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity, entity_id);`,
      restContracts: [
        {
          method: 'GET',
          path: '/api/health',
          requestBody: 'N/A',
          responseBody: '{ status: "ok", uptime: number, database: "connected", timestamp: string }',
          description: 'Healthcheck de integridade operacional'
        },
        {
          method: 'GET',
          path: '/api/audit-logs',
          requestBody: 'Query: ?entity=&limit=',
          responseBody: 'Array<{ id: string, actor: string, action: string, entity: string, entity_id: string, diff_json: string, created_at: string }>',
          description: 'Trilha de auditoria logística'
        },
        {
          method: 'GET',
          path: '/api/kpis',
          requestBody: 'N/A',
          responseBody: '{ activeShipments: number, onTimeRate: number, avgCostKm: number, activeFleet: number }',
          description: 'Métricas analíticas de desempenho de frota e entregas'
        },
        {
          method: 'GET',
          path: '/api/shipments',
          requestBody: 'Query: ?status=&q=&page=&limit=',
          responseBody: 'Array<{ id: string, tracking_code: string, recipient_name: string, status: string, weight_kg: number }>',
          description: 'Listagem de remessas com busca debounce'
        },
        {
          method: 'POST',
          path: '/api/shipments',
          requestBody: '{ recipient_name: string, destination_city: string, destination_address: string, weight_kg: number }',
          responseBody: '{ id: string, tracking_code: string, ... } (Status 201)',
          description: 'Despacho de nova remessa com geração de código de rastreio'
        },
        {
          method: 'POST',
          path: '/api/export/csv',
          requestBody: '{ entity: "shipments" | "fleet_vehicles" | "delivery_routes" }',
          responseBody: 'Content-Type: text/csv',
          description: 'Exportação em lote de remessas em formato CSV'
        }
      ],
      formulas: [
        'on_time_rate = (entregas_no_prazo / total_entregas_concluidas) * 100',
        'cost_per_km = custo_total_operacao / total_km_rodados',
        'variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100'
      ],
      validations: [
        'recipient_name deve ter pelo menos 3 caracteres (HTTP 400)',
        'destination_city deve ser informada (HTTP 400)',
        'weight_kg deve ser número positivo maior que zero (HTTP 400)'
      ],
      envKeys: ['PORT=4000', 'DATABASE_PATH=./data/logistics.db'],
      archetype: 'clean-saas',
      accentColor: '#f59e0b'
    }
  };

  /**
   * Dynamically constructs or specializes a domain blueprint strictly faithful to the user's briefing.
   * Ensures that SQLite tables, filters, and screens match what was requested,
   * while STRICTLY forbidding the injection of MRR, accounting records, or banking entries
   * into projects whose core business is not accounting/fintech.
   */
  public static buildCustomBriefingBlueprint(briefing: string, baseBlueprint?: DomainSpecBlueprint): DomainSpecBlueprint {
    const raw = briefing || '';
    const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const base: DomainSpecBlueprint = baseBlueprint
      ? JSON.parse(JSON.stringify(baseBlueprint))
      : JSON.parse(JSON.stringify(this.DOMAIN_SPECS.youtube_viral_intelligence || this.DOMAIN_SPECS.creator_viral_video || this.DOMAIN_SPECS.general_saas));

    // PROIBIÇÃO ESTRITA: Se o core business do produto não for contabilidade/banco digital,
    // purgar qualquer métrica de MRR ou lançamentos contábeis.
    const isPureFintech = /contabilidade|escritorio\s*contabil|banco\s*digital|erp\s*financeiro|conciliacao\s*bancaria|livro\s*caixa/i.test(text);

    if (!isPureFintech && base.domainKey !== 'fintech') {
      // Eliminar fórmulas com MRR ou termos contábeis
      base.formulas = (base.formulas || []).filter((f: string) => !/mrr|conciliacao|contabil|saldo_liquido/i.test(f));
      if (!base.formulas.some((f: string) => /variacao_percentual_delta/i.test(f))) {
        base.formulas.push('variacao_percentual_delta = ((valor_atual - valor_anterior) / valor_anterior) * 100');
      }

      // Remover MRR de KPIs e seções
      for (const sec of base.sections || []) {
        sec.kpis = (sec.kpis || []).map((k: string) =>
          k.replace(/MRR:\s*R\$\s*[\d\.,]+/i, 'Receita Operacional: R$ 14.850')
           .replace(/\bMRR\b/g, 'Faturamento')
           .replace(/Lançamentos Contábeis/i, 'Registros de Operação')
        );
      }
    }

    return base;
  }

  /**
   * Sanitiza qualquer menção a MRR para projetos que não sejam estritamente contabilidade/fintech pura.
   */
  private static sanitizeZeroMrr(content: string, briefing: string, blueprint: DomainSpecBlueprint): string {
    const text = (briefing || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const isPureFintech = blueprint.domainKey === 'fintech' && /\b(contabilidade|escritorio\s*contabil|banco\s*digital|erp\s*financeiro|conciliacao\s*bancaria|livro\s*caixa)\b/i.test(text);

    if (!isPureFintech) {
      return content
        .replace(/\bMRR:\s*R\$\s*[\d\.,]+/gi, 'Receita Operacional: R$ 14.850')
        .replace(/\bmrr\s*=\s*sum\([^)]+\)/gi, 'receita_total = sum(assinaturas_ativas_valor_mensal)')
        .replace(/\bMRR\b/g, 'Faturamento');
    }
    return content;
  }

  /**
   * Resolves the best domain blueprint based on the user's briefing and context.
   * Strictly prevents SaaS infrastructure mentions (banco de dados, sqlite, pix, etc.)
   * from misclassifying the project as fintech.
   */
  public static resolveDomainBlueprint(briefing: string): DomainSpecBlueprint {
    const raw = briefing || '';
    const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    // 1. YouTube / Vídeos Virais / Creator Economy (Prioridade Máxima)
    if (/youtube|video|viral|engajamento|views?|likes?|transcri|transcript|roteiro|nicho|canal|thumbnail|tiktok|reels|creator|copywriting|headline|outlier/i.test(text)) {
      const blueprint = this.DOMAIN_SPECS.youtube_viral_intelligence || this.DOMAIN_SPECS.creator_viral_video || this.DOMAIN_SPECS.creator_video_analytics || this.DOMAIN_SPECS.creator_economy;
      return this.buildCustomBriefingBlueprint(briefing, blueprint);
    }
    // 2. IA / LLM / Agentes
    if (/ia|ai|llm|prompt|agente|agent|openai|claude|gemini|rag|embeddings|automacao\s*de\s*ia|langsmith/i.test(text)) {
      return this.buildCustomBriefingBlueprint(briefing, this.DOMAIN_SPECS.ai_automation_agents);
    }
    // 3. EdTech / Cursos
    if (/curso|aula|aluno|estud|flashcard|mentoria|prova|trilha|ead|educa|edtech|quiz/i.test(text)) {
      return this.buildCustomBriefingBlueprint(briefing, this.DOMAIN_SPECS.edtech_learning);
    }
    // 4. Logística
    if (/logistica|frete|entrega|rastreio|frota|remessa|carga|veiculo|motorista|armazem/i.test(text)) {
      return this.buildCustomBriefingBlueprint(briefing, this.DOMAIN_SPECS.logistics_operations);
    }
    // 5. Devtools
    if (/dev|bug|issue|task|kanban|sprint|scrum|deploy|repositorio|git|engenharia|codigo|commit|backlog|linear/i.test(text)) {
      return this.buildCustomBriefingBlueprint(briefing, this.DOMAIN_SPECS.devtools);
    }
    // 6. Saúde
    if (/saude|clinic|medico|paciente|consulta|prontuario|odont|dentist|terapia|hospital|remedio|receita/i.test(text)) {
      return this.buildCustomBriefingBlueprint(briefing, this.DOMAIN_SPECS.health);
    }

    // 7. Fintech: Somente se o core business do produto for explicitamente contabilidade, banco digital ou ERP financeiro!
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
      return this.buildCustomBriefingBlueprint(briefing, this.DOMAIN_SPECS.fintech);
    }

    // Fallback: Custom Briefing Blueprint sobre general_saas (sem MRR nem banco contábil!)
    return this.buildCustomBriefingBlueprint(briefing, this.DOMAIN_SPECS.general_saas);
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

    const content = `# ESPECIFICAÇÃO DE PRODUTO, SEÇÕES & REA (CONTEUDO.MD)

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
    return this.sanitizeZeroMrr(content, briefing, blueprint);
  }

  /**
   * Generates the DESIGN.md document (Archetype, CSS Tokens, Typography & States).
   */
  public static buildDesignMd(projectName: string, briefing: string, blueprint: DomainSpecBlueprint): string {
    return this.generateDesignSpec(projectName, briefing, blueprint);
  }

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

## 4. Anatomia Visual de Componentes & Especificações Detalhadas
- **Grid de Cards e Linhas (Data Grid):**
  - **Preview de Thumbnail 16:9 (\`96x54px\`):** Proporção estrita \`aspect-ratio: 16/9\`, cantos arredondados (\`--radius-sm\`), borda sutil (\`--border-subtle\`) e fallback SVG se imagem offline.
  - **Badge de Duração Monospace:** Posicionado no canto inferior direito da thumbnail com \`font-family: var(--font-mono)\`, tamanho reduzido (\`11px\`), padding \`2px 4px\`, background \`rgba(0, 0, 0, 0.85)\` e contraste \`--text-primary\`.
  - **Pílulas Semânticas de Outlier Multiplier:**
    - \`>= 5.0x\`: **Verde Esmeralda** (\`background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-weight: 700;\`) indicando viral extremo / anomalia de alta performance.
    - \`>= 2.5x\`: **Azul / Cyan** (\`background: rgba(14, 165, 233, 0.15); color: #0ea5e9; border: 1px solid rgba(14, 165, 233, 0.3); font-weight: 600;\`) indicando alta tração.
    - \`< 2.5x\`: **Neutro** (\`background: rgba(148, 163, 184, 0.1); color: var(--text-muted); border: 1px solid var(--border-subtle);\`).
- **Barra de Filtros Compostos de Engajamento:**
  - Input de busca textual com debounce (250ms) por título, palavras-chave ou canal.
  - Seletor de Faixa de Visualizações (Todos, >10k, >100k, >1M).
  - Filtro por Taxa de Engajamento mínima (Engagement %).
  - Filtro por Outlier Score mínimo (>= 2.5x, >= 5.0x, >= 10x).
  - Seletor de Formato: Todos, Shorts, Vídeos Longos.
  - Ordenação dinâmica por Outlier Multiplier, Views, VPH (Views Per Hour) ou Data de Publicação.
- **Slide-Over Inspector Drawer (520px):**
  - Painel lateral deslizante com largura fixa de \`520px\` (\`role="dialog"\` e \`aria-modal="true"\`).
  - Animação CSS suave (\`transform: translateX(0)\` com \`backdrop-filter: blur(4px)\`).
  - Header com preview de thumbnail 16:9 expandida, título completo do vídeo, link canônico e canal.
  - **Abas Internas do Drawer:**
    - **Aba Métricas:** Painel tabular formatado com \`tabular-nums\` exibindo Views, Likes, Comentários, Engagement Rate, Outlier Score e VPH.
    - **Aba Transcrição & Hooks:** Decomposição dos primeiros 30 segundos, ganchos de retenção, tags de tração e notas de roteiro.
    - **Aba Auditoria JSON:** Payload bruto da entidade com visualizador JSON estruturado e diff de mutações.
- **Botões:** Estados \`:hover\`, \`:active\` (\`transform: scale(0.98)\`) e \`:disabled\` com opacidade 0.5.
- **Inputs & Selects:** Borda \`--border-subtle\`, foco com outline de 2px em \`--accent-primary\` e transição suave.
- **Command Palette (\`Ctrl+K\`):** Overlay elevado em \`--bg-elevated\`, pesquisa debounce e atalhos rápidos de navegação.
- **Ícones:** Uso exclusivo de **ícones SVG Lucide inline** (24x24 ou 16x16, stroke-width 2). **Zero emojis nativos como ícones.**

---

## 5. Os 4 Estados Visuais Obrigatórios em Cada Tela
1. **Loading Skeleton:** Shimmer translúcido ocupando a área exata dos cards e tabelas durante requisições.
2. **Empty State:** Ícone SVG temático suave, mensagem explicativa clara e botão primário para criar o primeiro registro.
3. **Populated State:** Grade rica com alta densidade, paginação, busca instantânea e ordenação.
4. **Error Toast:** Alerta flutuante com auto-dismiss (4s) e opção de repetição da ação.

---

## 6. Anatomia Detalhada de Componentes, Hierarquia Visual, Densidade e Micro-Interações do Produto
- **Arquitetura Espacial & Grid CSS:**
  - **Sidebar:** \`240px\` expandida / \`64px\` colapsada com transição fluida (\`150ms ease\`), navegação semântica em abas (\`role="tab"\` e \`data-tab\`) e contadores dinâmicos.
  - **Topbar:** Altura fixa de \`56px\` (\`role="banner"\`), seletor de Workspace com persistência local, status de conectividade em tempo real e sino de notificações.
  - **Container Principal:** \`max-width: 1600px\`, \`padding: 24px\`, \`gap: 16px\` e layout responsivo adaptável a desktops e notebooks.
  - **Bento Grid de KPIs:** \`grid-template-columns: repeat(4, minmax(0, 1fr))\`, cards com \`padding: 16px\`, sparklines SVG inline e badges com variação percentual (\`+Δ%\` verde, \`-Δ%\` vermelho).
- **Anatomia da Barra de Filtros do Domínio:**
  - **Busca Textual com Debounce (250ms):** Campo de busca responsivo para títulos, canais, tags e palavras-chave sem bloquear a thread principal do navegador.
  - **Seletores de Métricas do Domínio:** Faixas de Visualizações (Todos, >10k, >100k, >1M), Taxa de Engajamento mínima, Outlier Multiplier (>= 2.5x, >= 5x, >= 10x) e Formato (Todos, Shorts, Longos).
  - **Pílulas de Filtro Rápido (*Quick Filter Pills*):** Presets em 1 clique ("Top Virais 24h", "Outliers Extremos >5x", "Shorts em Alta Tração").
  - **Ordenação Multicritério:** Por Outlier Multiplier, Views, VPH (Views Per Hour) ou Data de Publicação.
  - **Contador Vivo de Resultados:** Indicador textual em fonte monospace (\`font-variant-numeric: tabular-nums\`) com feedback de registros filtrados.
- **Anatomia dos Cards / Tabela Principal do Domínio:**
  - **Layout Híbrido - Galeria de Cards 16:9:**
    - Preview de thumbnail 16:9 (\`aspect-ratio: 16/9\`, \`border-radius: var(--radius-sm)\`, \`border: 1px solid var(--border-subtle)\`) com fallback SVG gradiente.
    - Badge de duração monospace (\`11px\`, \`padding: 2px 4px\`) posicionado no canto inferior direito com fundo escuro (\`rgba(0, 0, 0, 0.85)\`).
    - Avatar do canal, título completo com line-clamp de 2 linhas e tags de nicho.
    - Pílulas semânticas de *Outlier Score*: \`>= 5.0x\` **Verde Esmeralda** (\`#10b981\`), \`>= 2.5x\` **Azul** (\`#0ea5e9\`), \`< 2.5x\` neutro.
    - Barra sutil de *Engagement Rate %* com preenchimento reativo.
  - **Modo Tabela Analítica (\`tabular-nums\`):**
    - Densidade de linha (\`height: 44px\`), alinhamento numérico à direita, sparklines inline e alternância fluida via botão de toggle Lista/Cards.
- **Anatomia do Slide-Over Inspector Drawer (\`width: 520px\`):**
  - Painel lateral deslizante com largura fixa de \`520px\` (\`role="dialog"\` e \`aria-modal="true"\`) com backdrop blur (\`backdrop-filter: blur(8px)\`).
  - Header fixo com ações rápidas (link externo, copiar dados, favoritar e fechar via \`Esc\`).
  - Grade de mini-cards com métricas do item selecionado formatadas em \`tabular-nums\` (Views, Likes, Comentários, Engagement Rate, Outlier Score, VPH).
  - Abas internas contextualizadas ao domínio:
    - *Aba Métricas & Breakdown:* KPIs detalhados, série histórica e benchmark comparativo com a média do canal.
    - *Aba Conteúdo / Transcrição / Edição:* Decomposição de ganchos nos primeiros 30s, tópicos-chave e campo de notas com salvamento reativo.
    - *Aba Histórico & JSON Audit:* Visualizador do payload bruto em JSON syntax-highlighted com trilha forense imutável de \`audit_logs\`.
  - Estados de Loading Skeleton translúcido e Empty State temático em cada aba.
`;
  }

  /**
   * Generates the BACKEND.md document (SQLite Schemas, REST Contracts & Domain Formulas).
   */
  public static generateBackendSpec(projectName: string, briefing: string, blueprint: DomainSpecBlueprint): string {
    const contractsTable = blueprint.restContracts
      .map(c => `| \`${c.method}\` | \`${c.path}\` | \`${c.requestBody}\` | \`${c.responseBody}\` | ${c.description} |`)
      .join('\n');

    const content = `# ESPECIFICAÇÃO DE BACKEND, BANCO SQLITE & CONTRATOS REST (BACKEND.MD)

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
- **Nicho & Domínio Ativo (DOCSIMP):** Adaptadores de **${blueprint.domainName}** (${blueprint.domainKey === 'health' ? 'HEALTHCARE_APPOINTMENTS' : blueprint.domainKey === 'devtools' ? 'DEVTOOLS_ISSUES' : blueprint.domainKey === 'creator_economy' ? 'CREATOR_YOUTUBE_ANALYTICS' : 'FINANCE_SAAS'}) provisionados autonomamente pelo MarketDiscoveryService na Onda 0.

### Chaves de Ambiente & Graceful Mock Fallback
O backend deve operar de modo 100% autônomo e offline através de Graceful Mock Fallback:
\`\`\`bash
${blueprint.envKeys.join('\n')}
\`\`\`
- Se as chaves externas não forem configuradas no ambiente, o sistema não deve falhar nem lançar exceções; ele deve utilizar geradores determinísticos em memória garantindo resposta aos endpoints REST.
`;
    return this.sanitizeZeroMrr(content, briefing, blueprint);
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

    const content = `# JORNADAS DE TESTE, VALIDAÇÃO VISUAL & HOMOLOGAÇÃO (JORNADAS.MD)

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
    return this.sanitizeZeroMrr(content, briefing, blueprint);
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

    // 7. Sincroniza specs ricas diretamente para a raiz da memória (.ai-dev-hub/project.md, architecture.md, decisions.md)
    try {
      ProjectLivingSpecService.syncSpecsToRootMemory(resolvedProjectPath);
    } catch (syncErr: any) {
      Logger.warn(`[ProjectLivingSpecService] Falha não bloqueante ao sincronizar specs com raiz: ${syncErr.message}`);
    }

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
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecService",
          error: (err as any)?.message || String(err)
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
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "projectLivingSpecService",
          error: (err as any)?.message || String(err)
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

  /**
   * Sincroniza os arquivos ricos de .ai-dev-hub/specs/ para os arquivos canônicos da raiz .ai-dev-hub/
   * (project.md, architecture.md, decisions.md)
   */
  public static syncSpecsToRootMemory(projectPath: string): boolean {
    if (!projectPath || !fs.existsSync(projectPath)) return false;
    const aiDevHubDir = path.join(projectPath, '.ai-dev-hub');
    const specsDir = path.join(aiDevHubDir, 'specs');
    if (!fs.existsSync(specsDir)) return false;

    const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '');

    const conteudo = read(path.join(specsDir, 'CONTEUDO.md'));
    const jornadas = read(path.join(specsDir, 'JORNADAS.md'));
    const market = read(path.join(aiDevHubDir, 'market-research-rea.md')) || read(path.join(projectPath, 'market-research-rea.md'));

    const backend = read(path.join(specsDir, 'BACKEND.md'));
    const design = read(path.join(specsDir, 'DESIGN.md')) || read(path.join(projectPath, 'DESIGN.md'));
    const reaBlueprint = read(path.join(aiDevHubDir, 'rea-blueprint.md')) || read(path.join(projectPath, 'rea-blueprint.md'));

    const principios = read(path.join(specsDir, 'PRINCIPIOS.md'));

    // 1. project.md
    if (conteudo || jornadas || market) {
      const projectMdContent = [
        '# Visão Geral e Escopo do Produto (DecoHUB Living Spec)',
        '',
        conteudo ? `## Especificação de Conteúdo e REA\n\n${conteudo}` : '',
        jornadas ? `## Jornadas de Usuário e Homologação\n\n${jornadas}` : '',
        market ? `## Pesquisa de Mercado e Diferenciais\n\n${market}` : ''
      ].filter(Boolean).join('\n\n');
      fs.writeFileSync(path.join(aiDevHubDir, 'project.md'), projectMdContent, 'utf-8');
    }

    // 2. architecture.md
    if (backend || design || reaBlueprint) {
      const archMdContent = [
        '# Arquitetura Técnica e Engenharia de Sistema (DecoHUB Living Spec)',
        '',
        backend ? `## Contratos de Banco de Dados e API REST\n\n${backend}` : '',
        design ? `## Design System e Interface Visual\n\n${design}` : '',
        reaBlueprint ? `## SaaS Blueprint & Pilares REA\n\n${reaBlueprint}` : ''
      ].filter(Boolean).join('\n\n');
      fs.writeFileSync(path.join(aiDevHubDir, 'architecture.md'), archMdContent, 'utf-8');
    }

    // 3. decisions.md
    if (principios) {
      const decisionsMdContent = [
        '# Log de Decisões Técnicas e Princípios Invariantes (DecoHUB Living Spec)',
        '',
        principios
      ].join('\n\n');
      fs.writeFileSync(path.join(aiDevHubDir, 'decisions.md'), decisionsMdContent, 'utf-8');
    }

    Logger.info(`[ProjectLivingSpecService] Sincronização de specs para memória raiz (.ai-dev-hub/) concluída em ${projectPath}.`);
    return true;
  }
}
