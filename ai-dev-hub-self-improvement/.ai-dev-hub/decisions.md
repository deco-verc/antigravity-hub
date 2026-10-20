# Registro de Decisões Técnicas

## Decisões Tomadas
- **[05/10/2026] Estrutura Inicial**
  - **Decisão:** Uso de arquivos Markdown locais para memória permanente do projeto.
  - **Motivo:** Leitura direta por qualquer agente de IA, controle de versão transparente via Git e independência de provedores em nuvem.
- **[05/10/2026] Arquitetura Multi-Agente com Supervisor Gemini e Executor Antigravity (Fase 4)**
  - **Decisão:** Arquitetura Multi-Agente com Supervisor Gemini e Executor Antigravity (Fase 4)
  - **Motivo:** Coordenação autônoma de desenvolvimento contínuo desacoplada em planejamento estratégico (Gemini) e execução técnica/QA (Antigravity Builder), com ciclo DAG não-bloqueante e Approval Inbox para riscos ORANGE e RED.
- **[06/10/2026] Implementação da arquitetura Productization / Simple IDE com layout de 3 colunas, Diff Modal, Terminal Drawer e preservação de sessão**
  - **Decisão:** Implementação da arquitetura Productization / Simple IDE com layout de 3 colunas, Diff Modal, Terminal Drawer e preservação de sessão
  - **Motivo:** Interface focada em Projetos, Chat, Arquivos e Conta, ocultando a complexidade técnica no menu Settings -> Advanced. Todas as capacidades avançadas (Multi-Worker, Multi-Account, Autonomous Runner, MCP, Checkpoints) foram preservadas com zero quebra.
- **[06/10/2026] Arquitetura Desktop Productization: Empacotamento standalone completo com Electron 44.5.1 (NSIS + Portable .exe + win-unpacked). ProcessManager executa o backend Node silenciosamente utilizando o runtime interno do Electron (ELECTRON_RUN_AS_NODE=1), aproveitando suporte nativo do Node 24 a node:sqlite e evitando dependência de terminais ou Node instalado no host.**
  - **Decisão:** Arquitetura Desktop Productization: Empacotamento standalone completo com Electron 44.5.1 (NSIS + Portable .exe + win-unpacked). ProcessManager executa o backend Node silenciosamente utilizando o runtime interno do Electron (ELECTRON_RUN_AS_NODE=1), aproveitando suporte nativo do Node 24 a node:sqlite e evitando dependência de terminais ou Node instalado no host.
  - **Motivo:** Permite ao usuário abrir o AI DEV com um duplo clique no executável de forma 100% autônoma, sem janelas cmd piscando, sem comandos manuais e com inicialização transparente.
- **[06/10/2026] Separação de Dados e Confiabilidade: Isolamento estrito entre executáveis (dist-desktop) e dados mutáveis de usuário armazenados centralmente em C:\Users\Deco\.ai-dev-hub (hub.db, logs com rotação de 5MB, perfis de contas Google e config.json). Implementação de Single-Instance Lock e Auto-Recovery com reconexão automática em caso de crash.**
  - **Decisão:** Separação de Dados e Confiabilidade: Isolamento estrito entre executáveis (dist-desktop) e dados mutáveis de usuário armazenados centralmente em C:\Users\Deco\.ai-dev-hub (hub.db, logs com rotação de 5MB, perfis de contas Google e config.json). Implementação de Single-Instance Lock e Auto-Recovery com reconexão automática em caso de crash.
  - **Motivo:** Garante persistência íntegra entre upgrades de binários, evita corrupção por múltiplas instâncias concorrentes e provê alta disponibilidade.
- **[06/10/2026] Resolução de Dados Multi-Perfil e Suíte de Testes Nativos (Sessão #16 - Google Pro 2)**
  - **Decisão:** Criação de `getHubDataDir()` no backend e desktop para resolver dinamicamente o diretório raiz `~/.ai-dev-hub/hub.db`, independentemente de o processo rodar sob perfil de agente (`profiles/google_pro_2`) ou perfil do sistema operacional. Implementação de suíte de testes com runner nativo `node:test` e TypeScript `tsx` cobrindo GitManager, PolicyEngine, persistência de banco/memória e integridade do runtime.
  - **Motivo:** Previne fragmentação de bancos SQLite quando agentes criam instâncias filhas e assegura validação contínua e rápida (sub-segundo) do código sem dependências pesadas.
- **[06/10/2026] Implementação da Etapa 1 da Karpathy Execution Layer no AI DEV HUB (Global Agent Guidelines + Project Program program.md)**
  - **Decisão:** Implementação da Etapa 1 da Karpathy Execution Layer no AI DEV HUB (Global Agent Guidelines + Project Program program.md)
  - **Motivo:** Estabelecer governança estrita de desenvolvimento com 4 princípios invioláveis: Think Before Coding, Simplicity First, Surgical Changes e Goal-Driven Execution, integrados nativamente em Gemini Supervisor, Antigravity Builder, Autonomous Runs e Simple IDE.

### [06/10/2026] Decisões da Sessão #18
- **Decisão:** Hierarquia de 6 camadas: Safety -> Global Guidelines -> Program.md -> Context -> Task -> User Request
- **Decisão:** Injeção automática nos contratos e prompts do Gemini Supervisor, Antigravity Builder e Simple IDE
- **Decisão:** Validação matemática de diff cirúrgico com rejeição de arquivos fora de escopo
- **Decisão:** Settings -> Project Program modal no frontend Simple IDE
- **[06/10/2026] Implementação da Etapa 2 da Karpathy Execution Layer: Success Contract e Independent Evaluator desacoplado do Builder, com defesa criptográfica contra adulteração de testes (PROTECTED_EVALUATION).**
  - **Decisão:** Implementação da Etapa 2 da Karpathy Execution Layer: Success Contract e Independent Evaluator desacoplado do Builder, com defesa criptográfica contra adulteração de testes (PROTECTED_EVALUATION).
  - **Motivo:** Inspirado nos princípios do Autoresearch (Karpathy), o agente que implementa o código (Builder) não pode controlar a aprovação da tarefa nem adulterar os testes de avaliação. O Evaluator independente valida integridade de hashes SHA-256, estabelece baseline de reprodução com falha para bugs e executa verificação objetiva no terminal com evidência de código de saída e stdout.

### [06/10/2026] Decisões da Sessão #21
- **Decisão:** Criação do módulo IndependentEvaluator e tabelas success_contracts e evaluation_results no SQLite
- **Decisão:** Proteção estrita com hashes SHA-256 (PROTECTED_EVALUATION) bloqueando tentativas de adulteração de testes pelo Builder
- **Decisão:** Ciclo objetivo de bugfix: Baseline FAIL obrigatório antes do fix -> Fix cirúrgico -> Evaluator PASS -> Gemini Supervisor APPROVED
- **[06/10/2026] Implementação da Etapa 3 da Karpathy Execution Layer: Autoresearch Mode para Software (Research Run, Baseline fixo, Experiment Ledger persistido, Rollback automático em DISCARD/CRASH, Simplicity Penalty e UI Dashboard).**
  - **Decisão:** Implementação da Etapa 3 da Karpathy Execution Layer: Autoresearch Mode para Software (Research Run, Baseline fixo, Experiment Ledger persistido, Rollback automático em DISCARD/CRASH, Simplicity Penalty e UI Dashboard).
  - **Motivo:** Adapta o método de experimentação autônoma do Autoresearch (Karpathy) ao desenvolvimento de software no AI DEV HUB. O sistema mede uma métrica objetiva no terminal (latência, bundle size, etc.), estabelece baseline mandatório sem alterações prévias, comita cada hipótese experimental no Git, mede o resultado e mantém o commit (KEEP) se houver melhoria, ou reverte atomicamente via git reset --hard (DISCARD/CRASH) se piorar ou quebrar. Aplica penalidade de complexidade (Simplicity First) se o ganho de métrica for marginal diante de alto acréscimo de linhas de código.

### [06/10/2026] Decisões da Sessão #23
- **Decisão:** Criação do módulo ResearchManager e das tabelas research_runs e research_experiments no SQLite
- **Decisão:** Baseline obrigatório medido antes de qualquer alteração de código (Experimento #0)
- **Decisão:** Loop autônomo com veredito objetivo: KEEP avança commit; DISCARD e CRASH executam git reset --hard automático para o melhor commit estável
- **Decisão:** Penalidade de complexidade (Simplicity First): rejeita melhorias marginais com acréscimo desproporcional de LOC
- **Decisão:** Interface visual completa com ResearchModal, métricas consolidadas (Baseline, Melhor Marca, Melhoria Global) e tabela detalhada de Experiment Ledger
- **[06/10/2026] Implementação da ETAPA 4 da Karpathy Execution Layer: AI DEV COUNCIL (LLM Council Pattern adaptado para revisão de software, com 3 revisores especializados em Corretude, Simplicidade Karpathy e Regressão, classificação por pares anônima e síntese do Presidente).**
  - **Decisão:** Implementação da ETAPA 4 da Karpathy Execution Layer: AI DEV COUNCIL (LLM Council Pattern adaptado para revisão de software, com 3 revisores especializados em Corretude, Simplicidade Karpathy e Regressão, classificação por pares anônima e síntese do Presidente).
  - **Motivo:** Adaptação da arquitetura de LLM Council (Karpathy/llm-council) sem depender de APIs pagas ou OpenRouter, utilizando infraestrutura local multi-agente. Permite resolver a tensão entre funcionalidade e complexidade gratuita, garantindo que código funcional porém super-complexo seja barrado pelo princípio Simplicity First antes do merge.

### [06/10/2026] Decisões da Sessão #25
- **Decisão:** Adotada arquitetura 3-stage LLM Council para revisão por pares independente sem custos ou APIs externas pagas
- **Decisão:** Imposto veto do Chairman por Simplicity Alert quando Reviewer B apontar nota <= 5 mesmo com aprovação funcional do Reviewer A
- **[06/10/2026] Implementação da ETAPA 5 da Karpathy Execution Layer: AI DEV ARENA (Torneio Multi-Candidato com Workspaces Isolados, Evaluator Idêntico, AI DEV Council Anônimo e Promoção Exclusiva do Vencedor)**
  - **Decisão:** Implementação da ETAPA 5 da Karpathy Execution Layer: AI DEV ARENA (Torneio Multi-Candidato com Workspaces Isolados, Evaluator Idêntico, AI DEV Council Anônimo e Promoção Exclusiva do Vencedor)
  - **Motivo:** Para tarefas arquiteturais complexas ou de alta incerteza, múltiplos candidatos independentes (Candidate A, B, C) desenvolvem abordagens concorrentes em git worktrees isolados (.ai-dev-arena/). Todos são submetidos ao mesmo Success Contract e bateria do Independent Evaluator. O AI DEV Council realiza revisão anônima por três perspectivas (Corretude, Simplicidade Karpathy First, Regressão). O Chairman sintetiza os pareceres e seleciona o Vencedor baseado em corretude e menor complexidade cognitivo/LOC. Se todos falharem, o veredicto NO_ACCEPTABLE_CANDIDATE é emitido sem vencedor artificial. Somente o vencedor é integrado na branch principal; candidatos perdedores são descartados. A Arena não é default e é ativada apenas sob recomendação ou solicitação explícita.

### [06/10/2026] Decisões da Sessão #27
- **Decisão:** Implementação da AI DEV ARENA (Etapa 5 Karpathy Execution Layer)
- **Decisão:** Workspaces isolados via git worktree em .ai-dev-arena/ para garantir separação estrita de candidatos
- **Decisão:** Avaliação justa com mesmo Independent Evaluator harness e penalização de complexidade (Simplicity First)
- **Decisão:** Integração do AI DEV Council com 3 perspectivas anônimas e Chairman com veredicto NO_ACCEPTABLE_CANDIDATE
- **Decisão:** Promoção exclusiva do vencedor e descarte seguro de candidatos perdedores
- **[06/10/2026] Implementação da FASE 6: AI DEV BENCHMARK & SELF-IMPROVEMENT LOOP com Suíte Fixa (12 tarefas em 10 categorias oficiais, incluindo 4 holdouts), Golden Evaluator imutável com proteção criptográfica SHA-256 e sandboxing isolado, congelamento da Baseline Oficial AI_DEV_BASELINE_V1, Regression Gate intransigente com política Zero-Regressão, e loop autônomo de auto-aprimoramento com geração de hipóteses e promoção formal para AI_DEV_V2.**
  - **Decisão:** Implementação da FASE 6: AI DEV BENCHMARK & SELF-IMPROVEMENT LOOP com Suíte Fixa (12 tarefas em 10 categorias oficiais, incluindo 4 holdouts), Golden Evaluator imutável com proteção criptográfica SHA-256 e sandboxing isolado, congelamento da Baseline Oficial AI_DEV_BASELINE_V1, Regression Gate intransigente com política Zero-Regressão, e loop autônomo de auto-aprimoramento com geração de hipóteses e promoção formal para AI_DEV_V2.
  - **Motivo:** Garantir que a evolução do AI DEV seja estritamente empírica, reproduzível e orientada por métricas quantitativas, impedindo qualquer regressão funcional em tarefas já dominadas e protegendo os critérios de teste contra adulteração pelo próprio agente.

### [06/10/2026] Decisões da Sessão #29
- **Decisão:** Suíte Fixa de Benchmarks com 12 tarefas cobrindo 10 categorias oficiais e 4 tarefas holdout protegidas.
- **Decisão:** Golden Evaluator com proteção criptográfica SHA-256 e sandboxing em .ai-dev-benchmarks.
- **Decisão:** Regression Gate intransigente: zero regressões permitidas para aprovação.
- **Decisão:** Auto-aprimoramento validado com promoção formal da Baseline V1 para AI_DEV_V2.
- **[06/10/2026] Windows Safe Execution Directive implementada no agentBenchmarkManager e agentGuidelines**
  - **Decisão:** Windows Safe Execution Directive implementada no agentBenchmarkManager e agentGuidelines
  - **Motivo:** Prevenir bloqueios de PSSecurityException (PowerShell ExecutionPolicy) instruindo explicitamente a execução de testes via node diretamente ou cmd /c npm test.

### [06/10/2026] Decisões da Sessão #32
- **Decisão:** Windows Safe Execution Directive implementada no agentBenchmarkManager e agentGuidelines
- **[06/10/2026] Conclusão da FASE 6 com LEVEL 2 AGENT BENCHMARK real e ciclo autônomo de Self-Improvement. Baseline oficial congelada no Git commit e40137c7 com 5 tarefas reais e holdouts físicos. O gargalo de PowerShell ExecutionPolicy foi diagnosticado, formulada hipótese com Gemini Supervisor e executado Candidate A em branch isolada self-improve/exp-5/candidate-a. O Regression Gate aprovou o candidato com zero regressões e 100% pass rate, promovendo o commit real 71ba345e7f4c2a327ef844ac2388fa5373c88327 para AI_DEV_AGENT_V2.**
  - **Decisão:** Conclusão da FASE 6 com LEVEL 2 AGENT BENCHMARK real e ciclo autônomo de Self-Improvement. Baseline oficial congelada no Git commit e40137c7 com 5 tarefas reais e holdouts físicos. O gargalo de PowerShell ExecutionPolicy foi diagnosticado, formulada hipótese com Gemini Supervisor e executado Candidate A em branch isolada self-improve/exp-5/candidate-a. O Regression Gate aprovou o candidato com zero regressões e 100% pass rate, promovendo o commit real 71ba345e7f4c2a327ef844ac2388fa5373c88327 para AI_DEV_AGENT_V2.
  - **Motivo:** Garante avaliação empírica de ponta a ponta através de conversações reais Antigravity, commits rastreáveis, testes protegidos SHA-256 e decisão honesta de promoção ou descarte pelo Regression Gate.
- **[06/10/2026] Implementação do Self-Improvement Governance & Promotion Gate com PromotionContract, Pareto Dominance, Regression Budget e AI DEV Council Synthesis. Reavaliação retrospectiva do Experimento #5 de KEEP para TRADEOFF_REVIEW (Council: DISCARD).**
  - **Decisão:** Implementação do Self-Improvement Governance & Promotion Gate com PromotionContract, Pareto Dominance, Regression Budget e AI DEV Council Synthesis. Reavaliação retrospectiva do Experimento #5 de KEEP para TRADEOFF_REVIEW (Council: DISCARD).
  - **Motivo:** No Experimento #5, uma vitória pontual em bm-04 (-36.4% latência) causou regressão global de +8.8% na suíte inteira (+41.9s) e +99.5% em bm-03, passando despercebida pelo Regression Gate anterior que avaliava apenas corretude binária e composite score arredondado. O novo Promotion Gate estabelece Pareto Dominance, teto de regressão global de +3%, teto individual de +20%, bloqueio automático de promoção em TRADEOFF_REVIEW pelo AI DEV Council, e preservação histórica de dados brutos.
- **[06/10/2026] Implementação e Validação do AUTONOMOUS SELF-IMPROVEMENT ENGINE no AI DEV HUB com orçamentos rigorosos, governança de Zonas (GREEN/YELLOW/RED), contratos congelados a priori, execução de múltiplos candidatos, parada graciosa (STOP), recuperação após reinício e Morning Report.**
  - **Decisão:** Implementação e Validação do AUTONOMOUS SELF-IMPROVEMENT ENGINE no AI DEV HUB com orçamentos rigorosos, governança de Zonas (GREEN/YELLOW/RED), contratos congelados a priori, execução de múltiplos candidatos, parada graciosa (STOP), recuperação após reinício e Morning Report.
  - **Motivo:** O motor autônomo opera em loop contínuo sem intervenção humana: analisa gargalos reais por prioridade, formula hipótese, congela o PromotionContract com hash SHA-256, executa Candidate A e B com estratégias distintas e Antigravity real em worktrees isoladas, verifica zonas de governança (rejeição antecipada em caso de violação de Zona Vermelha), roda benchmarks, aplica o Promotion Gate e o AI DEV Council, e promove somente vencedores sem violar orçamentos de regressão. Teste de 60 minutos validou STOP gracioso e recuperação após reinício. Presets OVERNIGHT, CONSERVATIVE, RESEARCH e TEST_SHORT disponíveis.

### [06/10/2026] Decisões da Sessão #35
- **Decisão:** Implementação do AUTONOMOUS SELF-IMPROVEMENT ENGINE com máquina de estados formal, orçamentos rigorosos, zoneamento GREEN/YELLOW/RED, congelamento de contratos com SHA-256 e diversidade de candidatos.
- **Decisão:** Validação dos presets OVERNIGHT (8h, 10 exps), CONSERVATIVE (3h, 3 exps), RESEARCH (4h, 5 exps) e TEST_SHORT (60m, 2 exps).
- **Decisão:** Comprovação de integridade via testes automatizados de parada graciosa (STOP) e recuperação após reinício (Restart Recovery).

### [06/10/2026] Decisões da Sessão #36
- **Decisão:** Implementação da Estratégia B (Detecção Externa Pré-Prompt) para Candidate B: normalização de caminhos no runtime do provedor (AntigravityProvider.preNormalizePrompt) e redução do overhead de tokens no agentGuidelines.ts

### [06/10/2026] Decisões da Sessão #41
- **Decisão:** Implementação da Estratégia B (Detecção Externa Pré-Prompt) para Candidate B: normalização de caminhos no runtime do provedor (AntigravityProvider.preNormalizePrompt) e redução do overhead de tokens no agentGuidelines.ts
- **[06/10/2026] Implementação da Estratégia A (Injeção Condicional Minimalista) para Candidate A: diretivas de terminal estritamente condicionais a comandos Node/Windows e redução de ruído em tarefas curtas**
  - **Decisão:** Implementação da Estratégia A (Injeção Condicional Minimalista) para Candidate A: diretivas de terminal estritamente condicionais a comandos Node/Windows e redução de ruído em tarefas curtas
  - **Motivo:** Evita bloqueios de ExecutionPolicy do PowerShell no Windows enquanto elimina overhead de tokens, diretivas ruidosas de terminal e sugestões enganosas de npm test em tarefas autocontidas/curtas (reduzindo a latência em até 70% sem regressão de corretude).

### [06/10/2026] Decisões da Sessão #40
- **Decisão:** Implementação da Estratégia A (Injeção Condicional Minimalista) no Candidate A para run-82ea1aad/exp-1/Candidate_A
- **[06/10/2026] Validação Final E2E do Autonomous Self-Improvement Engine com conclusão natural em status COMPLETED e completed_experiments = 1**
  - **Decisão:** Validação Final E2E do Autonomous Self-Improvement Engine com conclusão natural em status COMPLETED e completed_experiments = 1
  - **Motivo:** A rodada de validação E2E (Run ID: 82ea1aad-4232-4232-aa66-d8cc16421b73) rodou de ponta a ponta sem qualquer parada intermediária ou interrupção humana, executando baselining, detecção de gargalo, hipótese cirúrgica com contrato congelado, criação de Candidate A e Candidate B em worktrees isoladas com commits reais, validação das zonas de governança (GREEN_ONLY), execução da suíte Level 2 Agent Benchmarks, avaliação de Pareto no Promotion Gate (que aplicou DISCARD ALL com rigor preservando a baseline estável 71ba345e) e finalização natural da máquina de estados com status COMPLETED e completed_experiments = 1. A infraestrutura provou estar 100% pronta para overnight execution autônoma.

### [06/10/2026] Decisões da Sessão #44
- **Decisão:** Validação Final E2E do Autonomous Self-Improvement Engine com conclusão natural em status COMPLETED e completed_experiments = 1
- **Decisão:** Declaração formal OVERNIGHT_VALIDATED = true após execução ponta a ponta sem interrupções humanas e com governança de Pareto integralmente respeitada
- **[06/10/2026] Reconciliação Cirúrgica da Baseline de Produção (AI_DEV_STABLE_V1) e Reversão da Alteração Rejeitada do Experimento #5**
  - **Decisão:** Reconciliação Cirúrgica da Baseline de Produção (AI_DEV_STABLE_V1) e Reversão da Alteração Rejeitada do Experimento #5
  - **Motivo:** Auditoria do commit 71ba345e confirmou que a otimização de prompt do Candidate A do Experimento #5 causava regressão colateral massiva em tarefas não-alvo (+11.1% na duração global da suíte), tendo sido reavaliada pelo PromotionGate como TRADEOFF_REVIEW e rejeitada pelo AI DEV Council (DISCARD). As alterações foram cirurgicamente revertidas preservando toda a infraestrutura de governança e execução autônoma subsequente. A nova baseline limpa AI_DEV_STABLE_V1 (commit 63fdd47ebc74180a9c911d83da9bd4e1a6f41403) foi validada com 3 confirmation runs (100% pass rate, mediana global 502.1s, P95 135s, precisão cirúrgica 100%) e smoke test do Autonomous Engine. OVERNIGHT_READY = true.

### [06/10/2026] Decisões da Sessão #46
- **Decisão:** Reconciliação Cirúrgica da Baseline de Produção (AI_DEV_STABLE_V1) e Reversão da Alteração Rejeitada do Experimento #5
- **Decisão:** Declaração formal OVERNIGHT_READY = true com baseline imutável limpa 63fdd47ebc74180a9c911d83da9bd4e1a6f41403
- **[06/10/2026] Auditoria de Fonte da Verdade e Resolução Dinâmica de Stable Baseline (Zero Hardcode)**
  - **Decisão:** Auditoria de Fonte da Verdade e Resolução Dinâmica de Stable Baseline (Zero Hardcode)
  - **Motivo:** Auditoria completa comprovou a eliminação de qualquer SHA estático hardcoded como fonte de verdade no código-fonte. A resolução de stable baseline agora é 100% dinâmica via StableBaselineResolver e tabela SQLite stable_version_registry (com fallback dinâmico para git rev-parse HEAD e benchmark_runs). O teste obrigatório de 6 passos provou que novo run lê dinamicamente a baseline ativa no registry (inclusive quando simulada uma versão de teste) e restaura com fidelidade absoluta para 63fdd47e. OVERNIGHT_READY = true.

### [06/10/2026] Decisões da Sessão #48
- **Decisão:** Auditoria de Fonte da Verdade e Resolução Dinâmica de Stable Baseline (Zero Hardcode)
- **Decisão:** Declaração formal OVERNIGHT_READY = true após aprovação de todos os 6 passos do teste dinâmico de baseline
- **[06/10/2026] Conclusão da Fase 8: Desktop Productization & Reliability (Executáveis gerados, Suíte de 7 testes de confiabilidade aprovada e Interface Simple IDE nativa)**
  - **Decisão:** Conclusão da Fase 8: Desktop Productization & Reliability (Executáveis gerados, Suíte de 7 testes de confiabilidade aprovada e Interface Simple IDE nativa)
  - **Motivo:** Permite que qualquer desenvolvedor utilize o AI DEV HUB com um clique duplo no Windows sem abrir terminal, rodar comandos npm/node ou abrir navegador manualmente. Protege contra perda de trabalho overnight e falhas de processo através de supervisão nativa.
- **[06/10/2026] Declaração Formal de Homologação: AI_DEV_DESKTOP_V1 = RELEASE_READY**
  - **Decisão:** Declaração Formal de Homologação: AI_DEV_DESKTOP_V1 = RELEASE_READY
  - **Motivo:** Todos os 20 critérios de aceitação foram cumpridos integralmente com testes automatizados executados sobre o binário instalado oficial em AppData\Local\Programs\ai-dev-hub-root\AI DEV.exe. Zero vazamento de memória e zero processos órfãos.
- **[06/10/2026] undefined**
  - **Decisão:** undefined
  - **Motivo:** undefined

### [06/10/2026] Decisões da Sessão #63
- **Decisão:** Criação do componente AccountManagerModal com suporte a visualização, alternância de conta ativa, sincronização/verificação, edição inline e remoção segura com reatribuição automática de projetos.
- **Decisão:** Revisão do fluxo de adição de contas com suporte a e-mail opcional pré-configurado, confirmação manual assistida, prevenção de colisão de nomes de perfil e inicialização completa da pasta de isolamento .gemini.
- **Decisão:** Resolução dinâmica de executáveis Antigravity (Antigravity.exe e language_server.exe) sem qualquer caminho hardcoded de usuário no sistema.
- **[06/10/2026] Isolamento de ambiente AppData e LocalAppData no launchLogin do Antigravity para permitir janelas simultâneas e login de múltiplas contas sem bloqueio por singleInstanceLock do Electron.**
  - **Decisão:** Isolamento de ambiente AppData e LocalAppData no launchLogin do Antigravity para permitir janelas simultâneas e login de múltiplas contas sem bloqueio por singleInstanceLock do Electron.
  - **Motivo:** undefined
- **[07/10/2026] READY exige conversation agentapi no runtime do perfil**
  - **Decisão:** READY exige conversation agentapi no runtime do perfil
  - **Motivo:** E-mail armazenado e processo existente não comprovam autenticação funcional; workers só podem nascer após probe real.
- [07/10/2026] Fortalecimento Determinístico de Confiabilidade do Núcleo (Fase Zero-Model)
  - **Decisão:** Fortalecimento Determinístico de Confiabilidade do Núcleo (Fase Zero-Model)
  - **Motivo:** Blindagem determinística sem dependência de inferência de IA: tratamento e auditoria dos 15 bugs detectados, com destaque para detecção de commit criado pelo Antigravity (HEAD avançado A->B reconhecido com commit_source='AGENT'), commit seletivo pelo DecoHUB (commit_source='DECOHUB'), bloqueio de working tree suja (DIRTY_WORKING_TREE_UNRESOLVED), isolamento rigoroso de workspace (WORKSPACE_MISMATCH), normalização Windows de caminhos, transição atômica e persistência no SQLite de DAG (PENDING -> READY), atualização imediata de heartbeat no claimTask prevenindo lease expirada, cancelamento seguro com interrupção de tarefas ativas e liberação de leases, e telemetria precisa de tool_calls (null quando desconhecido).
- **[07/10/2026] Integração do Fable Worker V1 System Prompt no DecoHUB via Native Rule Files e Controlled Rotation**
  - **Decisão:** Integração do Fable Worker V1 System Prompt no DecoHUB via Native Rule Files e Controlled Rotation
  - **Motivo:** Antigravity agentapi opera via CLI (new-conversation/send-message) sem flag explícita --system-prompt e com limite de 32KB no Windows CreateProcess. A precedência nativa de regras é atendida escrevendo as diretrizes completas (42KB) em .agents/rules/decohub-worker.md no diretório do projeto alvo, enquanto a inicialização de conversa recebe um bootstrap auditado com XML de contrato de runtime, papel do Worker e contexto do projeto. Mudanças de prompt disparam rotação atômica PROMPT_VERSION_CHANGE preservando persistent conversations.
- **[07/10/2026] DecoHUB Prompt Benchmark V1 Concluído: Legacy Worker mantido como padrão de produção, Fable Worker V1 comprovado funcionalmente como opção experimental**
  - **Decisão:** DecoHUB Prompt Benchmark V1 Concluído: Legacy Worker mantido como padrão de produção, Fable Worker V1 comprovado funcionalmente como opção experimental
  - **Motivo:** O benchmark pareado (10 execuções, 5 cenários, flash/acc-pro-1) comprovou 100% de aprovação funcional e testes (5/5 PASS) para ambas as variantes. O Legacy Worker venceu por margem estreita (Score 48 vs 41, tempo médio 158s vs 201s) devido ao menor overhead de comandos e latência. Fable V1 não substitui Legacy como default de produção neste ciclo.

### [07/10/2026] Decisões da Sessão #4
- **Decisão:** Fable Worker V2 Flash integrado como terceira variante oficial (fable-worker-v2-flash)
- **Decisão:** Métrica de scope violation corrigida no harness para distinguir HARNESS_CONTROLLED_FILES de WORKER_CHANGED_FILES
- **Decisão:** Legacy Worker mantido como default de produção até novo benchmark comparativo (Benchmark V2)

### [07/10/2026] Decisões da Sessão #12
- **Decisão:** Adoção definitiva do modo Gemini Nativo sem injeções artificiais de system prompt
- **Decisão:** Transparência total na telemetria: relatar honestamente 'Não disponibilizado pelo provedor' para janelas contínuas de 5h/semanal sem inventar percentuais
- **Decisão:** Criptografia AES-256-GCM com chave vinculada à máquina para tokens PAT do GitHub no SQLite
- **Decisão:** Escudo de segurança mandatório no .gitignore protegendo .env, *.key, hub.db, credentials.json antes de qualquer push

### [08/10/2026] Decisões da Sessão #14
- **Decisão:** Homologação real no Windows com DecoHUB.exe empacotado e testado via Puppeteer no Electron
- **Decisão:** Repositório privado descartável deco-verc/decohub-homologation-test criado com autorização do usuário e ciclo completo executado com sucesso
- **Decisão:** Merge do PR #3 e fechamento da Issue #2 no GitHub remoto sem force-push ou vazamento de segredos
- **Decisão:** Isolamento estrito entre projetos A e B e persistência pós-reabertura comprovados por screenshots reais

### [08/10/2026] Decisões da Sessão #22
- **Decisão:** Integração consolidada da branch feat/decohub-karpathy-integration (be407a6) em feat/decohub-native-autonomy-final (62eeabd)
- **Decisão:** Adoção do Guard de Conclusão de Projeto e Evaluator com validação de interface visual e persistência em disco SQLite
- **Decisão:** Sincronização bidirecional do GitHub Task Graph com fallback automático para GitHub CLI autenticado
