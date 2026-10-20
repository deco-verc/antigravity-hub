- **[16/10/2026] Implementação das operações financeiras atômicas e imutabilidade de extratos em CommonJS**
  - **Decisão:** Implementação das operações financeiras atômicas e imutabilidade de extratos em CommonJS
  - **Motivo:** Garantir consistência contábil, isolamento de estado com resetLedger e estrita conformidade com os testes unitários sem dependências externas.

### [16/10/2026] Decisões da Sessão #1
- **Decisão:** Implementação das operações financeiras atômicas e imutabilidade de extratos em CommonJS

### [16/10/2026] Decisões da Sessão #2
- **Decisão:** Implementação em JavaScript puro (CommonJS) do motor financeiro com atomicidade em transferências e validação estrita de valores

### [16/10/2026] Decisões da Sessão #5
- **Decisão:** Implementação do motor financeiro em CommonJS puro com validações estritas de amount numérico e finito, atomicidade de transferências e projeção exata do extrato bancário
- **[17/10/2026] Arquitetura e homologação do UserExperienceSimulator acoplado ao IndependentEvaluator, Supervisor e Worker com execução assíncrona, teardown estrito de portas/processos no Windows e suporte a 572 testes unitários 100% verdes.**
  - **Decisão:** Arquitetura e homologação do UserExperienceSimulator acoplado ao IndependentEvaluator, Supervisor e Worker com execução assíncrona, teardown estrito de portas/processos no Windows e suporte a 572 testes unitários 100% verdes.
  - **Motivo:** Garante que as aplicações geradas pelo DecoHUB não apenas passem nos testes de desenvolvedor, mas funcionem de ponta a ponta na experiência do usuário final no navegador sem regressões de API ou perda de dados após F5.
- **[17/10/2026] Implementação da FASE 11 (ProjectOperationsService, One-Click App Preview Launcher com porta dinâmica e teardown limpo, DOCSIMP .env Studio e Galeria de Homologação com 4 selos de qualidade). 592 testes passando em 68 suítes com 0 regressões.**
  - **Decisão:** Implementação da FASE 11 (ProjectOperationsService, One-Click App Preview Launcher com porta dinâmica e teardown limpo, DOCSIMP .env Studio e Galeria de Homologação com 4 selos de qualidade). 592 testes passando em 68 suítes com 0 regressões.
  - **Motivo:** Permitir que o usuário rode aplicações geradas em 1 clique, visualize evidências e screenshots de homologação e configure API Keys finais diretamente na interface do DecoHUB com hot-reload.
- **[17/10/2026] Entrega Automática de Screenshots Playwright no Chat e Visualizador Lightbox com 4 Selos de Homologação (FASE 14)**
  - **Decisão:** Entrega Automática de Screenshots Playwright no Chat e Visualizador Lightbox com 4 Selos de Homologação (FASE 14)
  - **Motivo:** undefined
- **[17/10/2026] Implementação de servidor estático SPA ultraleve embutido (http.createServer puro) no ProjectOperationsService para projetos sem script de backend ou package.json, com fallback de roteamento client-side, rastreamento ativo de sockets e encerramento forçado no teardown para eliminar ECONNRESET no Windows.**
  - **Decisão:** Implementação de servidor estático SPA ultraleve embutido (http.createServer puro) no ProjectOperationsService para projetos sem script de backend ou package.json, com fallback de roteamento client-side, rastreamento ativo de sockets e encerramento forçado no teardown para eliminar ECONNRESET no Windows.
  - **Motivo:** Garante que projetos puramente estáticos ou SPAs sem backend executem previews sem falhas e sem dependências pesadas, suportando healthcheck e navegação SPA, prevenindo colisões de sockets no pool de conexões do Node.js/undici no Windows.

### [17/10/2026] Decisões da Sessão #22
- **Decisão:** Implementação de servidor estático SPA ultraleve embutido (http.createServer puro) no ProjectOperationsService para projetos sem script de backend ou package.json, com fallback de roteamento client-side, rastreamento ativo de sockets e encerramento forçado no teardown para eliminar ECONNRESET no Windows.
- **[18/10/2026] Dual Rendering de Screenshots do Playwright (Chat e Card de Atividade de Run), eliminação de deadlock síncrono no servidor efêmero e upgrade retroativo com idempotência**
  - **Decisão:** Dual Rendering de Screenshots do Playwright (Chat e Card de Atividade de Run), eliminação de deadlock síncrono no servidor efêmero e upgrade retroativo com idempotência
  - **Motivo:** Garante visualização nativa dos screenshots tanto no fluxo conversacional quanto no widget de atividade persistente do run, resolve deadlock do loop de eventos Node.js desacoplando o servidor alvo em processo filho isolado e retroalimenta projetos legados sem duplicação de mensagens.

### [18/10/2026] Decisões da Sessão #25
- **Decisão:** Dual Rendering de Screenshots do Playwright (Chat e Card de Run Concluído)
- **Decisão:** Execução desacoplada do servidor efêmero no PlaywrightVisualInspector via processo filho externo para eliminar deadlock de event loop
- **Decisão:** Cache-busting rigoroso com headers no backend e parâmetro ?t=... no frontend
- **Decisão:** Fallback automático de URL para Electron empacotado no protocolo file://

### [19/10/2026] Decisões da Sessão #27
- **[19/10/2026] Implementação do DecoBench (FASE 18): Motor Científico de Avaliação e Benchmark Multi-LLM**
  - **Decisão:** Criação de `BenchmarkService` com catálogo canônico de 4 Tiers, 6 métricas de inteligência (`passAt1`, `passAt3`, `selfHealingGain`, `fourGateCompositeScore`, `trajectoryEfficiency`, `decoHubIqScore`), tabelas dedicadas `benchmark_runs` e `benchmark_model_results`, estudo de ablação e slash command `/benchmark`.
  - **Motivo:** Avaliar empiricamente se o DecoHUB evolui a cada versão e quantificar o ganho real de inteligência proporcionado pelo harness (Multi-Pass, REA, Anti-Slop, 4-Gates).

- **[19/10/2026] Fusão das Arquiteturas open-gsd/gsd-core e garrytan/gstack no DecoHUB (FASE 19)**
  - **Decisão:** Implementação de envelopes frescos de subagentes (`FreshContextEnvelope`) com extração de assinaturas de escopo e trava de context rot (< 40% da janela); estruturação de tarefas com contratos XML atômicos `<gsd_atomic_task type="auto">`; agrupamento em Ondas de Execução no `DagAutoHealer` com File-Lock Wave Shift anti-colisão concorrente; adição dos Cognitive Gears do GStack (`/plan-ceo`, `/plan-eng`) e do portão de liberação (`/ship`) com geração de `.ai-dev-hub/RELEASE_READY.md`.
  - **Motivo:** Prevenir degradação cognitiva por excesso de contexto (Context Rot), desbloquear paralelismo determinístico seguro sem concorrência destrutiva em arquivos e incorporar modos de produto 10-Star e travamento de engenharia antes do release.
