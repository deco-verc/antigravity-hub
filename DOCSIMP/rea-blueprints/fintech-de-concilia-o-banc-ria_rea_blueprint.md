# DOSSIÊ CONSOLIDADO DE ARQUITETURA SAAS MASTER (ENGENHARIA REVERSA REA)

---

> Diretrizes canônicas extraídas via morluto/rea de referências líderes (Linear, Stripe, Notion, Cal.com).

---

# Blueprint de Engenharia Reversa: Enterprise App Shell & Reactive Client State

> Extraído via engenharia reversa estática e comportamental (REA) de interfaces líderes de mercado (Linear, Stripe Dashboard, Notion, Cal.com).

## 1. Arquitetura do App Shell Enterprise
O shell da aplicação não é um layout estático simples de cabeçalho e rodapé. Ele é composto por subsistemas coordenados:

### A. Sidebar Colapsável & Navegação Hierárquica
- **Navegação Modular**: Lista de seções estruturadas (ex: Dashboard, Clientes/Contatos, Transações/Operações, Relatórios & BI, Auditoria de Atividades, Configurações).
- **Contadores Vivos (Badges)**: Itens de navegação contêm contadores reativos atualizados pela Store (ex: "Transações Pendentes: 4", "Auditoria: 12").
- **Colapso Suave com Teclado e Botão**: Suporte a atalho (ex: `[` ou `Ctrl+B`) para recolher a barra lateral para modo mini/ícones, liberando espaço visual para visualizações densas de dados.

### B. Topbar de Comando e Status Global
- **Barra de Busca / Gatilho Command Palette**: Input ou botão central estilizado exibindo `Buscar ou executar ação... (Ctrl+K)`.
- **Filtro de Contexto / Período Rápido**: Dropdown ou pill selector de período (Hoje, Últimos 7 dias, Este Mês, Todo o Histórico).
- **Indicador de Sistema**: Ponto verde/âmbar de conexão com API em tempo real (`Online • Sync`), status de persistência e atalhos rápidos.

### C. Command Palette (`Ctrl+K` / `Cmd+K`)
- **Modal Flutuante de Alta Velocidade**: Abre instantaneamente ao pressionar `Ctrl+K` (ou `Cmd+K`), ou ao clicar na busca da Topbar.
- **Busca Preditiva por Teclado**: Filtra em tempo real navegação entre telas, ações imediatas (ex: "Novo Registro", "Exportar CSV", "Limpar Filtros", "Ver Auditoria") e pesquisa de entidades.
- **Navegação com Setas e Enter**: Setas `Cima`/`Baixo` selecionam itens com destaque visual e `Enter` aciona o comando ou fecha a paleta com `Escape`.

### D. Slide-Over Detail Drawers (Painéis Laterais Deslizantes)
- **Zero Navegação Cega**: Clicar em qualquer registro de uma tabela ou card não deve trocar de página para uma tela vazia.
- **Painel Lateral Fluido**: Um drawer abre da direita com animação suave de slide (`transform: translateX(0)`), overlay semi-transparente de fundo e foco automático.
- **Conteúdo Estruturado**:
  - Cabeçalho com título da entidade, status em badge colorido e botão de fechar (`Esc`).
  - Abas internas rápidas (Geral, Histórico/Timeline, Metadados JSON brutos).
  - Ações inline imediatas (Editar campo, Mudar status, Reenviar evento, Excluir).

### E. Optimistic UI & Atalhos de Teclado
- **Feedback Imediato**: Alterações de status e edições inline refletem instantaneamente no DOM local enquanto a requisição assíncrona é enviada ao servidor.
- **Rollback Transparente**: Se a requisição falhar com erro 4xx/500, a Store restaura o estado anterior e exibe um toast de alerta sem travar a interface.

---

## 2. Padrão Canônico: Reactive Client Store (Vanilla JS Sem Frameworks Pesados)
Código frontend corporativo (`public/app.js`) deve seguir arquitetura previsível orientada a fluxo unidirecional:

```javascript
// Exemplo canônico de Reactive Store corporativa no public/app.js
const Store = {
  state: {
    currentView: 'dashboard',
    selectedId: null,
    drawerOpen: false,
    commandPaletteOpen: false,
    filters: { query: '', status: 'all', dateRange: '30d' },
    items: [],
    metrics: {},
    auditLogs: [],
    loading: false
  },
  subscribers: [],
  subscribe(fn) {
    this.subscribers.push(fn);
    return () => { this.subscribers = this.subscribers.filter(s => s !== fn); };
  },
  dispatch(action, payload) {
    switch (action) {
      case 'NAVIGATE':
        this.state.currentView = payload;
        break;
      case 'OPEN_DRAWER':
        this.state.selectedId = payload;
        this.state.drawerOpen = true;
        break;
      case 'CLOSE_DRAWER':
        this.state.drawerOpen = false;
        this.state.selectedId = null;
        break;
      case 'SET_ITEMS':
        this.state.items = payload;
        break;
      case 'SET_METRICS':
        this.state.metrics = payload;
        break;
      case 'SET_AUDIT_LOGS':
        this.state.auditLogs = payload;
        break;
      case 'UPDATE_FILTERS':
        this.state.filters = { ...this.state.filters, ...payload };
        break;
    }
    this.notify();
  },
  notify() {
    this.subscribers.forEach(fn => fn(this.state));
  }
};
```

---

# Blueprint de Engenharia Reversa: Enterprise Data Tables & BI Analytics

> Extraído via engenharia reversa estática e comportamental (REA) de suítes analíticas líderes (Stripe Dashboard, Linear Insights, TradingView, Retool).

## 1. Engenharia de Tabelas Enterprise (Data Grids Avançados)
Uma tabela corporativa de SaaS Master não é um elemento `<table>` estático desprovido de ferramentas. Ela deve oferecer controle total sobre grandes volumes de informação:

### A. Barra de Controle e Filtros Compostos
- **Busca com Debounce**: Input de busca textual aplicando filtro após 250-300ms de inatividade do usuário, sem travar digitação.
- **Filtro Multi-Dimensão**: Pelo menos dois filtros por seleção (ex: Status: `Todos | Ativo | Pendente | Cancelado` e Categoria/Tipo).
- **Contador Dinâmico de Resultados**: Exibição clara `Exibindo 12 de 45 registros encontrados` atualizada instantaneamente.
- **Reset Rápido de Filtros**: Botão visível `Limpar Filtros` quando qualquer critério estiver ativo.

### B. Ordenação Interativa por Colunas (Sortable Headers)
- Cabeçalhos clicáveis com setas visuais indicando estado (`asc` ▲ / `desc` ▼ / neutro).
- Ordenação alfanumérica, por data ISO ou valores numéricos (com `font-variant-numeric: tabular-nums`).

### C. Paginação e Controles de Visualização
- Seletor de registros por página (ex: 10, 25, 50).
- Navegação entre páginas (`Anterior`, `1`, `2`, `3`, `Próximo`) com desativação correta de botões nos extremos.

### D. Seleção em Lote (Batch Operations) & Ações Inline
- Checkbox mestre no cabeçalho ("Selecionar todos").
- Barra flutuante de ações em lote quando >= 1 item selecionado:
  - Botão de exportação em lote (`Exportar Seleção (.csv)`).
  - Ação em massa (`Alterar Status`, `Arquivar`).
- Botões de ação rápida em cada linha (Ícone de visualização detalhada abrindo Drawer lateral, edição rápida e exclusão segura).

### E. Exportação CSV Nativa em 1 Clique
- Botão visível `Exportar CSV` que formata o conjunto de dados filtrado conforme a RFC-4180 e inicia o download imediato via Blob no cliente (`data:text/csv;charset=utf-8`).

---

## 2. Visualização Analítica Real (BI & Métricas Executivas)
Telas analíticas não podem depender de mockups ou apenas números isolados.

### A. Cards de KPIs Executivos com Variação Percentual (`Δ%`)
- **Valor Absoluto Primário**: Número grande com tipografia tabular (`font-variant-numeric: tabular-nums`).
- **Badge de Tendência**: Indicador com seta e percentual `+14.2% vs mês anterior` (verde) ou `-3.8%` (vermelho).
- **Subtítulo Descritivo**: Contexto claro do indicador (ex: `Receita Recorrente Líquida`, `Transações Processadas`).

### B. Gráficos Interativos SVG/Canvas Nativos (Sem Dependências Pesadas)
- **Gráficos de Linha / Área**: SVG vetorial com curvas suavizadas, gradiente sob a curva e pontos de dados interativos com hover.
- **Gráficos de Barra / Distribuição**: Barras proporcionais animadas com representação por categoria.
- **Tooltips Flutuantes**: Hover sobre qualquer barra ou ponto exibe tooltip com data, valor exato e métrica secundária.
- **Layout Responsivo e Adaptativo**: Gráficos com `viewBox="0 0 600 240"` ou Canvas com redimensionamento dinâmico.

---

# Blueprint de Engenharia Reversa: Enterprise Backend & Business Workflows

> Extraído via engenharia reversa estática e comportamental (REA) de arquiteturas de backend SaaS líderes (Stripe API, GitHub Enterprise, Supabase, Linear Sync).

## 1. Arquitetura de Domínio & Máquinas de Estado
Em aplicações SaaS profissionais, entidades de negócio centrais não sofrem mutações cegas:
- **Transições de Estado Explícitas**: Entidades possuem ciclos de vida rigorosos (ex: `DRAFT -> PENDING_APPROVAL -> APPROVED -> ACTIVE -> COMPLETED / CANCELLED`).
- **Validação de Transições Proibidas**: Tentativas de mover diretamente de `DRAFT` para `COMPLETED` ou alterar entidades arquivadas disparam erros 400 sem corromper o banco.
- **Histórico de Transições**: Toda alteração de estado registra timestamp, usuário responsável e motivo da mudança.

---

## 2. Audit Trail Automático (`/api/audit-logs`)
Todo SaaS de nível corporativo implementa trilha de auditoria em conformidade com padrões de governança (SOC2 / ISO 27001):
- **Tabela Dedicada `audit_logs`**:
  ```sql
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE'
    actor TEXT NOT NULL,
    details TEXT, -- JSON com snapshot do diff { before, after }
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  ```
- **Middleware / Helper de Auditoria Transparente**: Toda rota que cria, atualiza ou exclui registros invoca `recordAuditLog({ entity, entityId, action, actor, details })`.
- **Endpoint REST `/api/audit-logs`**: Exposição segura com suporte a paginação e filtros para alimentar a aba ou timeline de atividades recentes no frontend.

---

## 3. Webhooks & Barramento de Eventos Internos
- **Event Dispatcher**: Publicação de eventos internos síncronos/assíncronos (ex: `eventBus.emit('transaction:completed', payload)`).
- **Consistência e Resiliência**: Falhas em webhooks secundários não devem abortar a transação principal do banco de dados SQLite.

---

## 4. Agregações SQL Avançadas e Exportação de Dados
- **Agregações em Tempo Real**: Uso de queries SQL com `strftime('%Y-%m', created_at)`, `COUNT()`, `SUM()`, `AVG()` e `GROUP BY` para gerar dados dos gráficos em menos de 10ms.
- **Exportação CSV no Servidor**: Rota `/api/<resource>/export?format=csv` gerando streams de dados com cabeçalhos apropriados (`Content-Type: text/csv`, `Content-Disposition: attachment; filename="export.csv"`).

---

## 5. Densidade de Seed Determinística (`seedIfEmpty`)
- Para que o SaaS não inicie com telas e gráficos estéreis, o seeder de inicialização deve popular entre **15 a 30 registros ricos e interconectados**:
  - Clientes / Contas com nomes e metadados realistas;
  - Transações distribuídas ao longo dos últimos 30-90 dias com valores variados;
  - Logs de auditoria refletindo o ciclo de vida dessas entidades;
  - Planos e configurações pré-definidos.