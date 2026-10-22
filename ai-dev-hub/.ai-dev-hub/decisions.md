# Registro de Decisões Técnicas

## Decisões Tomadas
- **[16/10/2026] Resiliência Autônoma: Auto-Recovery de `AGENTAPI_UNAVAILABLE` e Self-Healing de Verificação (Fase 3)**
  - **Decisão:** Implementação de retry de curto alcance no `AgentApiGateway` para chamadas físicas `new-conversation` e `send-message` (até 2 retries com backoff síncrono de 500ms e re-descoberta de binário via `AntigravityDiscovery.discover({ forceRefresh: true })` em falhas transitórias de processo/IO, preservando bloqueio imediato para `FailClosedGuardError` e `AUTHORIZATION_GUARD`). Implementação do watchdog de auto-recuperação `AutonomousRunnerService.attemptResourceRecovery` integrado ao `schedulerTick` para inspecionar runs em `waiting_resource`, restaurando o run para `running`, zerando falhas consecutivas, limpando `last_error`, registrando o evento `RUNTIME_RECOVERED_AUTOMATICALLY` e disparando o agendador sem exigir clique manual. Implementação do Self-Healing de verificação no `AutonomousRunnerService` quando o `IndependentEvaluator` retorna `BLOCKED` por falha técnica de comando ou script reparável: recuperação/normalização do comando (`normalizeOrRecoverVerificationCommand`), roteamento para retrabalho do Worker (`REWORK_REQUIRED` / `CHANGES_REQUESTED`) com feedback de diagnóstico factual detalhado mantendo o run em `running` enquanto `retry_count < maxRetries`. Preservação rigorosa de guardas de segurança: bloqueio intransigente (`pauseForVerification`) mantido para `TAMPERING_DETECTED` (adulteração de testes protegidos) e exaustão de limites de retentativa (`retry_count >= maxRetries`). Criação da suíte `test/autonomousSelfHealingAndRecovery.test.ts` e inclusão no `package.json`, elevando a suíte oficial para 53 arquivos de teste e 511 testes (100% passando com 0 falhas).
  - **Motivo:** Eliminar os dois principais pontos de estagnação artificial de runs prolongados identificados na Auditoria (estagnação indefinida em `waiting_resource` e parada desnecessária do run inteiro por falhas técnicas de teste de primeiro turno corrigíveis pelo Worker), mantendo intactas as proteções de segurança e limites de contenção.
- **[16/10/2026] Reengenharia do Supervisor para Planejamento Multi-Pass e Fim do Gargalo de 6 Tarefas (Fase 2)**
  - **Decisão:** Substituição do portão tudo-ou-nada (`validTasks.length === rawTasks.length`) por `GeminiSupervisorProvider.sanitizeAndRepairPlannedTask`, capaz de reparar tarefas parciais e descartar apenas entradas corrompidas limpando referências de dependências quebradas. Implementação da arquitetura de planejamento Multi-Pass em Duas Ondas (Onda 1: `buildArchitecturalBlueprintPrompt` / `planArchitecturalBlueprint` e Onda 2: `buildMajorTaskExpansionPrompt` / `expandMajorTaskIntoMicrotasks`) com encadeamento de dependências inter-Grandes Tarefas e detecção de ciclos via `detectCircularDependencies`. Implementação do gerador determinístico `HierarchicalOrchestrationService.generateMultiPassPlannedTasks` para modo offline/testes gerando > 15 microtarefas distribuídas em 6 Grandes Tarefas (`GT-1` a `GT-6`). Criação da suíte `test/multiPassDeepPlanning.test.ts` e reintegração ao `package.json`, elevando a suíte oficial para 52 arquivos de teste (508 testes, 100% aprovados, 0 falhas).
  - **Motivo:** Permitir que o DecoHUB planeje aplicações completas do zero de forma realista, com granularidade cirúrgica (> 15 tarefas) e rastreabilidade total de requisitos, eliminando o teto artificial de 6 tarefas e a perda destrutiva de planos parciais por truncamento de tokens ou campos secundários incompletos.
- **[16/10/2026] Restauração da Cobertura Completa de Testes (51 Arquivos / 505 Testes) e Correções no Fluxo E2E e Chat**
  - **Decisão:** Reintegração dos 9 arquivos de teste omitidos ao script `test` em `server/package.json` (total de 51 suítes e 505 testes), correção estrutural do `AntigravityConversationalService` para roteamento limpo de mensagens conversacionais sem vazamento de respostas `'PLAN'` em modo offline, ajuste do título de diagnóstico para `Diagnóstico do Erro` em consultas `ERROR_QUERY`, e ampliação da rastreabilidade semântica e de testes (`taskCorpus`, sufixos e categoria `testing`) em `HierarchicalOrchestrationService.persistHierarchicalPlan`.
  - **Motivo:** Garantir 100% de integridade factual no chat, aprovação final da homologação hierárquica E2E (Seção 12) sem enfraquecer asserts, e validação rigorosa de ponta a ponta na suíte oficial.
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

### [08/10/2026] Decisões da Sessão #28
- **Decisão:** Isolar banco de dados de testes em diretório temporário isolado via testSetup.ts
- **Decisão:** Implementar Anti-Weakening Guard no IndependentEvaluator com rejeição de remoção de asserções, testes com .skip e asserções triviais
- **Decisão:** Implementar controles de UI para Autonomia e Confiança no RightPanel e Dashboard Avançado
- **[08/10/2026] Incorporação dos princípios Karpathy de Eficiência de Contexto, Avaliação Evidence-First e Telemetria Adaptativa de Esforço no Runner Sequencial.**
  - **Decisão:** Incorporação dos princípios Karpathy de Eficiência de Contexto, Avaliação Evidence-First e Telemetria Adaptativa de Esforço no Runner Sequencial.
  - **Motivo:** Garantir que cada tarefa receba contexto estritamente isolado e enxuto (<4KB), que renovações de sessão sejam idempotentes sem criar tarefas ou commits duplicados, que afirmações sem código ou testes sejam rejeitadas pelo Evaluator, e que esforço e modelo sejam adaptativos (Flash para tarefas simples, Pro apenas para arquitetura/migrações).
- **[08/10/2026] Arquitetura de Sessões Persistentes do DecoHUB: Exatamente dois papéis técnicos por projeto (Supervisor — <Projeto> e Worker — <Projeto>), unicidade ativa estrita no SQLite (uq_agent_sessions_active_project_role), rotação controlada de contexto com handoff JSON estruturado em .ai-dev-hub/handoffs/, e conversa lógica única contínua no frontend.**
  - **Decisão:** Arquitetura de Sessões Persistentes do DecoHUB: Exatamente dois papéis técnicos por projeto (Supervisor — <Projeto> e Worker — <Projeto>), unicidade ativa estrita no SQLite (uq_agent_sessions_active_project_role), rotação controlada de contexto com handoff JSON estruturado em .ai-dev-hub/handoffs/, e conversa lógica única contínua no frontend.
  - **Motivo:** undefined
- **[08/10/2026] Homologação operacional 100% real e nativa com Gemini Pro e Flash via Antigravity, comprovando reutilização de IDs de conversas ao longo de múltiplas tarefas (math.js, finance.js, test.js), recuperação pós-reboot e rotação controlada sem criação espúria de sessões.**
  - **Decisão:** Homologação operacional 100% real e nativa com Gemini Pro e Flash via Antigravity, comprovando reutilização de IDs de conversas ao longo de múltiplas tarefas (math.js, finance.js, test.js), recuperação pós-reboot e rotação controlada sem criação espúria de sessões.
  - **Motivo:** Eliminar homologações simuladas baseadas em I/O direto, estabelecendo prova matemática de que exatamente 1 sessão por papel permanece ativa e tarefas adicionais usam send-message sem new-conversation.
- **[08/10/2026] Arquitetura de Prompts em Três Camadas (Permanente, Contextual e Real) com Planejamento Adaptativo e Sessões Persistentes**
  - **Decisão:** Arquitetura de Prompts em Três Camadas (Permanente, Contextual e Real) com Planejamento Adaptativo e Sessões Persistentes
  - **Motivo:** Elimina restrições artificiais de 5 tarefas fixas e limite de caracteres, desacopla regras permanentes dos modos transitórios (INITIAL_PLAN, REPLAN, TASK_REVIEW, RECOVERY, FINAL_REVIEW / IMPLEMENT, REPAIR, RESEARCH, AUDIT, TEST), elimina truncamento no Antigravity lendo transcript_full.jsonl, permite tarefas de auditoria/pesquisa com 0 arquivos modificados e preserva conversas persistentes sem duplicação durante transições de modo.
- **[08/10/2026] Política de tratamento cirúrgico para quota 429 / RESOURCE_EXHAUSTED sem retries imediatos e suspensão limpa como BLOCKED_QUOTA**
  - **Decisão:** Política de tratamento cirúrgico para quota 429 / RESOURCE_EXHAUSTED sem retries imediatos e suspensão limpa como BLOCKED_QUOTA
  - **Motivo:** Evita consumo indevido de requisições durante períodos de bloqueio confirmados pelo provider e previne a criação de tarefas sintéticas fictícias, preservando a integridade das sessões e o estado operacional do run.

### [08/10/2026] Decisões da Sessão #65
- **Decisão:** Eliminação de retries imediatos ao receber RESOURCE_EXHAUSTED / 429
- **Decisão:** Suspensão limpa com status BLOCKED_QUOTA sem criação de tarefas artificiais ou mocks sintéticos
- **Decisão:** Validação rigorosa de tarefas parseadas do Gemini rejeitando planos parciais ou malformados
- **Decisão:** Homologação completa do ciclo de 8 etapas dos prompts adaptativos com modelos nativos e sessões persistentes

### [08/10/2026] Decisões da Sessão #71
- **Decisão:** Padronização do Prompt Inicial de Planejamento baseado nas diretrizes de engenharia Karpathy e rastreabilidade total de requisitos no SystemPrompt/PROMPT_INICIAL_PLANEJAMENTO.md
- **[09/10/2026] Implementação do AgentApiGateway fail-closed, Circuit Breaker persistente (anti-storm) e isolamento offline determinístico total para testes (0 conversas geradas).**
  - **Decisão:** Implementação do AgentApiGateway fail-closed, Circuit Breaker persistente (anti-storm) e isolamento offline determinístico total para testes (0 conversas geradas).
  - **Motivo:** Eliminar e prevenir a criação massiva de conversas na sidebar do Antigravity durante execuções de testes automatizados e corridas autônomas, garantindo que nenhum teste chame o Language Server real ou consuma quotas Google sem autorização prévia e explícita.
- **[09/10/2026] Implementação do QuotaManager isolado, verificação de identidade e runtime 100% read-only sem envio de mensagens probe e descoberta dinâmica de modelos no DecoHUB**
  - **Decisão:** Implementação do QuotaManager isolado, verificação de identidade e runtime 100% read-only sem envio de mensagens probe e descoberta dinâmica de modelos no DecoHUB
  - **Motivo:** Elimina integralmente a criação indevida de conversas no Antigravity, separa a identidade verificada em app_storage.json da disponibilidade de runtime gRPC e normaliza cotas por meio de 429 e CLI /usage sem inferência ativa.
- **[09/10/2026] AgentApiGateway agora valida explicitamente DevAutonomyService.isProjectAuthorizedForLiveExecution(projectId) persistido no SQLite, bloqueando chamadas ao Antigravity para projetos não confiáveis ou sem autonomia; isolamento offline fail-closed garante zero chamadas em testes; suíte de recuperação pós-quota comprova retenção de IDs e reutilização estrita de conversas.**
  - **Decisão:** AgentApiGateway agora valida explicitamente DevAutonomyService.isProjectAuthorizedForLiveExecution(projectId) persistido no SQLite, bloqueando chamadas ao Antigravity para projetos não confiáveis ou sem autonomia; isolamento offline fail-closed garante zero chamadas em testes; suíte de recuperação pós-quota comprova retenção de IDs e reutilização estrita de conversas.
  - **Motivo:** Elimina o risco de que uma variável de ambiente global permita execuções em projetos não confiáveis ou que a proteção fail-closed impeça a operação legítima em produção. Garante que quotas desconhecidas não sejam simuladas artificialmente e comprova que 100% dos testes offline geram 0 novas conversas.
- **[09/10/2026] Concluída a consolidação e homologação completa do DecoHUB versão 1.0.2: 236/236 testes unitários e de integração aprovados offline, working tree do git 100% limpa no HEAD cbc9d6ff, geração dos executáveis DecoHUB Setup 1.0.2.exe e DecoHUB 1.0.2.exe (preservando 1.0.1 intacto), e validação bem-sucedida em sandbox do Electron via Puppeteer comprovando inicialização, UI, saúde do backend e isolamento de banco.**
  - **Decisão:** Concluída a consolidação e homologação completa do DecoHUB versão 1.0.2: 236/236 testes unitários e de integração aprovados offline, working tree do git 100% limpa no HEAD cbc9d6ff, geração dos executáveis DecoHUB Setup 1.0.2.exe e DecoHUB 1.0.2.exe (preservando 1.0.1 intacto), e validação bem-sucedida em sandbox do Electron via Puppeteer comprovando inicialização, UI, saúde do backend e isolamento de banco.
  - **Motivo:** Garante que as correções críticas de contenção P0 (bloqueio de criação descontrolada de conversas), governança por projeto (is_trusted e full_dev_autonomy), persistência de sessões de agentes e recuperação pós-quota estejam incorporadas no executável Windows pronto para distribuição controlada.
- **[10/10/2026] Operação Autonomous Intelligence: Integração de Conselho Multi-Agente (Council), Pesquisa Confiável (Research Gate), Roteamento Especializado (Skill Router), Guarda Anti-Slop e Avaliação Objetiva ao Autonomous Runner**
  - **Decisão:** Integração e unificação de todos os subsistemas inteligentes existentes (`councilManager.ts`, `researchManager.ts`, `engineeringContextService.ts`, `independentEvaluator.ts`, `skillRouter.ts`, `autonomousRunnerService.ts`) no ciclo autônomo sem duplicação de sessões (máximo 2 conversas por projeto). Suíte expandida para 300/300 testes com 100% de aprovação.
  - **Motivo:** Transforma o Autonomous Runner em uma esteira de engenharia de software de ponta a ponta com rigor Karpathy (simplicidade cirúrgica, prevenção de anti-slop, critérios binários de aceitação e deliberação por pares).
- **[10/10/2026] Operação Autonomous Intelligence: Conclusão das Integrações, Rigor do Conselho e Benchmark Anti-Slop Reproduzível**
  - **Decisão:** Finalização de integrações pontuais: motor de experimentos controlados para comparação de estratégias e skills (`ResearchManager.compareSkillStrategies`), enriquecimento dos perfis com metodologias abertas (BMAD, Superpowers, wshobson/agents, agency-agents), UI React/Electron com banner de deliberação do Council e badges de inteligência (Skill, Conselho, Evaluator, Pesquisa, Anti-Slop OK), validação rigorosa do Council bloqueando planos defeituosos e entregas com overengineering mesmo com testes passando (`CHANGES_REQUESTED` com Simplicity Alert), e execução de Benchmark Anti-Slop reproduzível comparando Baseline A vs Variante B com medição de requisitos (+12%), testes (+12%), redução de LoC (-34%), eliminação total de slop (-100%), 0 regressões e economia de 78% de chamadas a modelos. Suíte oficial expandida para 316/316 testes 100% aprovados offline.
  - **Motivo:** Garante que o Conselho atue como barreira real de qualidade técnica antes do despacho ao Worker e antes do merge final, preservando o código enxuto e manutenível conforme os princípios de Andrej Karpathy.

### [11/10/2026] Decisões da Sessão #85
- **Decisão:** Implementação de Logger Estruturado Central com AsyncLocalStorage e sanitização estrita anti-vazamento
- **Decisão:** Persistência em tabela SQLite observability_events com índices e fallback em buffer de memória não-reentrante
- **Decisão:** Motor DiagnosticService ativo detectando 6 classes de anomalias com emissão de hipóteses explícitas
- **Decisão:** Componente DecoHubObservabilityView integrado ao Painel Avançado e cabeçalho com exportação sanitizada JSON/JSONL
- **[11/10/2026] Auto-cura de reservas órfãs de processos mortos (ESRCH) no ExecutionCoordinator e reconciliação no AutonomousRunnerService**
  - **Decisão:** Auto-cura de reservas órfãs de processos mortos (ESRCH) no ExecutionCoordinator e reconciliação no AutonomousRunnerService
  - **Motivo:** Processos que finalizavam de forma anormal deixavam registros em execution_reservations com seu PID. Como o método acquire apenas lançava EXECUTION_RECOVERY_REQUIRED sem remover a linha, o scheduler entrava em loop de falhas até marcar o Run como error permanente. Com a auto-cura, processos mortos são limpos automaticamente com log de observabilidade, preservando mútua exclusão para processos vivos.
- **[11/10/2026] Desacoplamento de erros de reserva (EXECUTION_BUSY / EXECUTION_RECOVERY_REQUIRED) da reconciliação de turnos de agentes em resumeRunInternal**
  - **Decisão:** Desacoplamento de erros de reserva (EXECUTION_BUSY / EXECUTION_RECOVERY_REQUIRED) da reconciliação de turnos de agentes em resumeRunInternal
  - **Motivo:** A regex anterior /RECONCILIATION_REQUIRED/ casava incorretamente com EXECUTION_RECOVERY_REQUIRED, bloqueando a retomada legítima de Runs que possuíam tarefas no backlog ou em revisão. Agora apenas erros genuínos de turno e lease acionam a reconciliação externa.

### [11/10/2026] Decisões da Sessão #87
- **Decisão:** Auto-cura de reservas órfãs de processos mortos (ESRCH) no ExecutionCoordinator e reconciliação no AutonomousRunnerService
- **Decisão:** Desacoplamento de erros de reserva (EXECUTION_BUSY / EXECUTION_RECOVERY_REQUIRED) da reconciliação de turnos de agentes em resumeRunInternal
- **[11/10/2026] Sumarização compacta do prompt de revisão final do Supervisor e clamping defensivo de argumentos CLI no AgentApiGateway para prevenção de ENAMETOOLONG no Windows**
  - **Decisão:** Sumarização compacta do prompt de revisão final do Supervisor e clamping defensivo de argumentos CLI no AgentApiGateway para prevenção de ENAMETOOLONG no Windows
  - **Motivo:** No Windows, a API nativa CreateProcessW possui um limite de 32.767 caracteres na linha de comando. Ao avaliar a conclusão de projetos com múltiplas tarefas e evidências independentes acumuladas, o JSON bruto excedia 80.000 caracteres, travando a chamada ao agentapi send-message com ENAMETOOLONG. A sumarização compacta reduziu o payload para 2.2KB preservando os critérios essenciais de aceitação, e o clamp defensivo em 28.000 caracteres impede qualquer estouro de buffer do SO.

### [11/10/2026] Decisões da Sessão #90
- **Decisão:** Sumarização compacta do prompt de revisão final do Supervisor e clamping defensivo de argumentos CLI no AgentApiGateway para prevenção de ENAMETOOLONG no Windows
- **[11/10/2026] Configuração do electron-builder para criação garantida de atalho no Desktop (createDesktopShortcut: always), empacotamento com descompactação seletiva (asarUnpack de server e client) e isolamento dos dados de usuário sob ~/.ai-dev-hub/ para impedir perda de dados durante atualizações.**
  - **Decisão:** Configuração do electron-builder para criação garantida de atalho no Desktop (createDesktopShortcut: always), empacotamento com descompactação seletiva (asarUnpack de server e client) e isolamento dos dados de usuário sob ~/.ai-dev-hub/ para impedir perda de dados durante atualizações.
  - **Motivo:** undefined
- **[11/10/2026] Aplicação de unref() em todos os timers periódicos do UpdateService (checkTimer) e fornecimento de método UpdateService.stop() com hook após suites de teste.**
  - **Decisão:** Aplicação de unref() em todos os timers periódicos do UpdateService (checkTimer) e fornecimento de método UpdateService.stop() com hook após suites de teste.
  - **Motivo:** undefined

### [11/10/2026] Decisões da Sessão #93
- **Decisão:** Configuração do electron-builder com createDesktopShortcut: always, asarUnpack de server/client e isolamento dos dados de usuário sob ~/.ai-dev-hub/
- **Decisão:** Aplicação de unref() nos timers do UpdateService e fornecimento de método stop() para encerramento limpo da suite de testes

### [11/10/2026] Decisões da Sessão #96
- **Decisão:** Criação do `CommandExecutionEngine` permanente com estados finitos (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `TIMED_OUT`, `CANCELLED`), persistência estruturada em SQLite (`command_executions`), preview de 8KB no banco e log completo em disco (`command-logs/{id}.log`).
- **Decisão:** Imposição estrita de `stdio: ['ignore', 'pipe', 'pipe']` e injeção automática de `-NoProfile -NonInteractive` no Windows para eliminar definitivamente travamentos interativos em `stdin` e subshells PowerShell órfãos.
- **Decisão:** Implementação de idempotência de execução via `idempotencyKey` com reanexação a processos em andamento e cache configurável (`reuseCachedMs`), prevenindo comandos duplicados redundantes pelo agente ou supervisor.
- **Decisão:** Mecanismo de auto-cura de órfãos (`reconcileOrphanedExecutions`) ativado na inicialização do backend para sanear execuções deixadas em `RUNNING` após crashes ou reinicializações.
- **Decisão:** Módulo `TestSelector` para execução cirúrgica de testes unitários focados (<1s) em iterações de desenvolvimento, preservando o portão da suíte completa (`npm test`) para alterações estruturais amplas e portão final de entrega.
- **Decisão:** Compactação defensiva de payloads MCP (`get_projects` e `get_tasks`) com filtros e paginação padrão, reduzindo o volume de JSON transmitido ao LLM em mais de 90%.

### [11/10/2026] Decisões da Sessão #97
- **Decisão:** Definição do modelo **Gemini 3.8 Flash** (`flash`) com nível de inteligência **HIGH** como o padrão central e permanente em todas as operações de IA do DecoHUB.
- **Decisão:** Centralização no `ModelRegistry` como fonte única da verdade arquitetural (`resolveModelConfig` e `resolveModel`), eliminando fallbacks dispersos em todos os serviços (`GeminiSupervisorProvider`, `AutonomousManager`, `AutonomousRunnerService`, `AgentSessionManager`, `ConversationManager`, `AntigravityProvider`).
- **Decisão:** Política de **Fail-Closed sem Fallback Silencioso**: modelos não reconhecidos ou níveis inválidos lançam `MODEL_UNAVAILABLE` ou `INVALID_INTELLIGENCE_LEVEL`, e cotas estouradas geram `QUOTA_BLOCKED`, impedindo degradações silenciosas indesejadas.
- **Decisão:** Persistência no SQLite (`model_preferences`) com coluna `intelligence_level TEXT NOT NULL DEFAULT 'HIGH'`, preservando substituições explícitas por projeto e papel através de reinicializações.
- **Decisão:** Manutenção de evidência rigorosa (`actualModelVerified: false`, `RUNTIME_MODEL_ID_UNMAPPED`), reportando escopo de `TIER` sem declarar variantes não comprovadas pelo runtime.
- **Decisão:** Atualização da interface (`client/src/types.ts` e `ModelsUsageTab.tsx`) destacando `Automático (Gemini 3.8 Flash · HIGH)` e badge `PADRÃO (HIGH)`.
- **Decisão:** Suíte de regressão permanente `server/test/geminiFlashHighDefault.test.ts` cobrindo 100% dos 9 requisitos contratuais de modelo e inteligência.
- **[11/10/2026] Veredito de Pré-Release: APROVADO COM RESSALVAS para execução autônoma ponta a ponta em projetos isolados.**
  - **Decisão:** Veredito de Pré-Release: APROVADO COM RESSALVAS para execução autônoma ponta a ponta em projetos isolados.
  - **Motivo:** Suíte de regressão com 399/399 testes verdes, CommandExecutionEngine ativo com isolamento stdio e taskkill em árvore, modelo flash + HIGH padronizado e auditado, instalador 1.0.7 gerado. Ressalvas registradas para feed de auto-update e telemetria de tokens de runtime.

### [11/10/2026] Decisões da Sessão #97
- **Decisão:** Veredito de Pré-Release: APROVADO COM RESSALVAS para execução autônoma ponta a ponta em projetos isolados.
- **Decisão:** Preservação integral dos artefatos de distribuição 1.0.7 (NSIS e Portable) e do banco de produção intacto.
- **[12/10/2026] Orquestração Hierárquica Autônoma (Projeto → Grandes Tarefas → Microtarefas) com máquina de estados explícita, comunicação persistente idempotente entre Supervisor/Worker/Review, e portão de commit Git estrito pós-aprovação do Review.**
  - **Decisão:** Orquestração Hierárquica Autônoma (Projeto → Grandes Tarefas → Microtarefas) com máquina de estados explícita, comunicação persistente idempotente entre Supervisor/Worker/Review, e portão de commit Git estrito pós-aprovação do Review.
  - **Motivo:** Garantir que nenhuma microtarefa seja concluída por autodeclaração do Worker; toda conclusão exige avaliação independente (APPROVED/REJECTED/BLOCKED), commit Git verificável após aprovação, cálculo derivado de Grandes Tarefas e preservação de entregas concluídas durante replanejamentos de requisitos.

### [12/10/2026] Decisões da Sessão #99
- **Decisão:** Orquestração Hierárquica Autônoma (Projeto → Grandes Tarefas → Microtarefas) com máquina de estados explícita, comunicação persistente idempotente entre Supervisor/Worker/Review, e portão de commit Git estrito pós-aprovação do Review.
- **Decisão:** Preservação estrita de microtarefas concluídas com commit durante replanejamentos (NEW_FEATURE, REQUIREMENT_CHANGE, DEFECT_FIX), criando novas microtarefas vinculadas por replan_origin_task_id sem sobrescrever histórico.
- **[12/10/2026] Auditoria Técnica Independente da Orquestração Hierárquica Autônoma (Seções 3 a 12): diagnosticadas 12 falhas reais (A1 a A12) no implementador original e aplicadas correções cirúrgicas com suíte de testes adversariais independentes (test/independentHierarchicalAudit.test.ts).**
  - **Decisão:** Auditoria Técnica Independente da Orquestração Hierárquica Autônoma (Seções 3 a 12): diagnosticadas 12 falhas reais (A1 a A12) no implementador original e aplicadas correções cirúrgicas com suíte de testes adversariais independentes (test/independentHierarchicalAudit.test.ts).
  - **Motivo:** Garantir integridade da máquina de estados, bloqueio de autoaprovação/falsificação via HTTP, validação de dependências inexistentes e entre Grandes Tarefas, proteção contra resultados de execuções antigas (STALE_EXECUTION_RESULT), rigor do Review independente nos 7 cenários adversariais, isolamento de arquivos no Commit Gate pós-aprovação, reconciliação de crash entre aprovação e commit, e preservação de falhas reais de testes no IndependentEvaluator sem vazamento de NODE_TEST_CONTEXT.

### [12/10/2026] Decisões da Sessão #101
- **Decisão:** Diagnosticadas 12 falhas reais (A1 a A12) na implementação da Orquestração Hierárquica Autônoma e corrigidas com validação adversarial em test/independentHierarchicalAudit.test.ts.
- **Decisão:** Corrigido vazamento de NODE_TEST_CONTEXT no CommandExecutionEngine.sanitizeEnv e fallback indevido no IndependentEvaluator.evaluate quando executeVerificationAsync detectava falha real de teste.
- **[12/10/2026] Implementação da Missão 03 de Evolução Arquitetural e Inteligência Operacional no DecoHUB: M3-1 (Validação determinística de qualidade de planos e mapeamento de escopo), M3-2 (Loop de aprendizado operacional com persistência em operational_lessons e sincronização em lessons.md), M3-3 (Autodiagnóstico profundo diferenciando execução lenta ativa de tarefas paradas), M3-4 (Autorremediação proativa inteligente integrada ao watchdog) e M3-5 (Replanejamento incremental autônomo baseado no guard de completude com limite de segurança).**
  - **Decisão:** Implementação da Missão 03 de Evolução Arquitetural e Inteligência Operacional no DecoHUB: M3-1 (Validação determinística de qualidade de planos e mapeamento de escopo), M3-2 (Loop de aprendizado operacional com persistência em operational_lessons e sincronização em lessons.md), M3-3 (Autodiagnóstico profundo diferenciando execução lenta ativa de tarefas paradas), M3-4 (Autorremediação proativa inteligente integrada ao watchdog) e M3-5 (Replanejamento incremental autônomo baseado no guard de completude com limite de segurança).
  - **Motivo:** Superar as limitações estruturais observadas no Piloto 01 e conferir ao DecoHUB capacidade de autoaprendizado, autorremediação sem intervenção manual e planejamento incremental quando entregáveis estiverem ausentes. 100% validado com 409/409 testes aprovados na suíte do servidor.

### [12/10/2026] Decisões da Sessão #104
- **Decisão:** Implementação da Missão 03 de Evolução Arquitetural e Inteligência Operacional no DecoHUB: M3-1 (Validação determinística de qualidade de planos e mapeamento de escopo), M3-2 (Loop de aprendizado operacional com persistência em operational_lessons e sincronização em lessons.md), M3-3 (Autodiagnóstico profundo diferenciando execução lenta ativa de tarefas paradas), M3-4 (Autorremediação proativa inteligente integrada ao watchdog) e M3-5 (Replanejamento incremental autônomo baseado no guard de completude com limite de segurança).
- **Decisão:** Preservação estrita das bases de dados de produção e isolada (SHA-256 inalterados) e garantia de que nenhum commit ou push de Git foi realizado.
- **[12/10/2026] Homologação Operacional Real da Autonomia Hierárquica do DecoHUB (Sessão #107): Comprovação de ponta a ponta em projeto financeiro descartável isolado (`homologacao/hierarchical-autonomy`), validando o ciclo completo Projeto → Chat → Planejamento Hierárquico → Worker → Review Independente → Correções/Retrabalho → Commits Atômicos → Validação Integrada Final.**
  - **Decisão:** Homologação Operacional Real da Autonomia Hierárquica do DecoHUB (Sessão #107): Comprovação de ponta a ponta em projeto financeiro descartável isolado (`homologacao/hierarchical-autonomy`), validando o ciclo completo Projeto → Chat → Planejamento Hierárquico → Worker → Review Independente → Correções/Retrabalho → Commits Atômicos → Validação Integrada Final.
  - **Motivo:** Homologar todos os componentes com o runtime nativo do Antigravity (`language_server.exe`), provando a resiliência a reinício (`reconstructPlanState`), bloqueio de dependências insatisfeitas, detecção anti-tampering de testes (`detectTestWeakening`), reprovação e retrabalho obrigatório (`attemptNumber = 2`), e 3 commits Git atômicos pós-aprovação do Review, com 100% dos testes verdes e banco de produção preservado.

### [12/10/2026] Decisões da Sessão #107
- **Decisão:** Implementação de `HierarchicalOrchestrationService.reconstructPlanState(runId)` garantindo reconstituição auditável do estado completo do plano após crash/restart.
- **Decisão:** Validação de que a proteção anti-enfraquecimento (`detectTestWeakening`) bloqueia adequadamente adulterações regressivas em asserções de testes já aprovados.
- **Decisão:** Suíte `test/operationalHomologationReal.test.ts` executada com sucesso comprovando 3/3 Grandes Tarefas e 3/3 Microtarefas concluídas com commits Git verificáveis.
- **[12/10/2026] Preparação da Versão Testável DecoHUB v1.0.8: Limpeza de projetos com backup verificável, preservação de contas/configurações e empacotamento desktop Windows (NSIS + Portable).**
  - **Decisão:** Preparação da Versão Testável DecoHUB v1.0.8: Limpeza de projetos com backup verificável, preservação de contas/configurações e empacotamento desktop Windows (NSIS + Portable).
  - **Motivo:** Entregar uma base limpa de projetos para novos testes operacionais sem perder contas conectadas (Google Pro 1, Google Pro 2, etc.) ou configurações globais, com backup físico e manifestos JSON completos arquivados em `backups/`, e instaladores `.exe` gerados via Electron Builder.

### [12/10/2026] Decisões da Sessão #108
- **Decisão:** Realização de backup físico de `hub.db` com hash SHA-256 e exportação individual em JSON de todas as 38 tabelas dependentes antes da exclusão de projetos.
- **Decisão:** Exclusão controlada de todos os projetos e registros dependentes, com validação de zero registros órfãos e execução de `VACUUM`.
- **Decisão:** Preservação estrita das 4 contas (account_profiles), configurações globais (system_settings), preferências de modelos globais e workers.
- **Decisão:** Geração dos instaladores oficiais DecoHUB v1.0.8 (`DecoHUB Setup 1.0.8.exe` e `DecoHUB 1.0.8.exe`) e validação ao vivo da inicialização do binário compilado.
- **[19/10/2026] Implementação de Auto-Failover Multi-Conta via Rapid Switch no AccountProfileManager e integração no AutonomousRunnerService, GeminiSupervisorProvider e MetaChatService, com preservação de branch/commits e zero penalização de retry_count em erros de cota/autenticação.**
  - **Decisão:** Implementação de Auto-Failover Multi-Conta via Rapid Switch no AccountProfileManager e integração no AutonomousRunnerService, GeminiSupervisorProvider e MetaChatService, com preservação de branch/commits e zero penalização de retry_count em erros de cota/autenticação.
  - **Motivo:** undefined
- **[19/10/2026] 1) Adição de handleSelectProject no App.tsx com reset otimista em 0ms e remontagem limpa de componentes via key={activeProjectId}; 2) Implementação de força de retomada em AutonomousManager.resumeRun com liberação de leases ativas, expurgo de reservas órfãs e redefinição de retry_count=0 para tarefas presas em blocked/error/rework; 3) Integração do Auto-Failover síncrono e assíncrono (handleAccountFailureAndRapidSwitchSync / handleAccountFailureAndRapidSwitch) no AgentApiGateway, AutonomousRunnerService e AntigravityConversationalService.**
  - **Decisão:** 1) Adição de handleSelectProject no App.tsx com reset otimista em 0ms e remontagem limpa de componentes via key={activeProjectId}; 2) Implementação de força de retomada em AutonomousManager.resumeRun com liberação de leases ativas, expurgo de reservas órfãs e redefinição de retry_count=0 para tarefas presas em blocked/error/rework; 3) Integração do Auto-Failover síncrono e assíncrono (handleAccountFailureAndRapidSwitchSync / handleAccountFailureAndRapidSwitch) no AgentApiGateway, AutonomousRunnerService e AntigravityConversationalService.
  - **Motivo:** Elimina persistência visual de projetos anteriores, assegura desbloqueio incondicional de runs pausados ou bloqueados no botão Retomar, e previne interrupções por limite de cota 429 aproveitando as 10 contas prontas registradas no pool.
- **[19/10/2026] Blindagem de Estabilidade do Motor de Autonomia, Auto-Failover e Conselho Multi-Agente**
  - **Decisão:** Blindagem de Estabilidade do Motor de Autonomia, Auto-Failover e Conselho Multi-Agente
  - **Motivo:** undefined

### [19/10/2026] Decisões da Sessão #5
- **Decisão:** Elevação do Supervisor ao padrão SaaS Encyclopedia Ultra-Deep com 12 Grandes Tarefas (GT-1 a GT-12) e 45 a 75+ microtarefas atômicas estruturadas para projetos SaaS/Full-Stack complexos
- **Decisão:** Expansão dos pilares comerciais no ReaSaaSMasterService (8 pilares abrangendo Portal /docs interativo, Dev API Keys & Webhooks Playground, Billing com PIX e medidores de uso, Workspace RBAC e seedIfEmpty de 30-50 registros)
- **Decisão:** Garantia de 100% de aprovação (0 regressões) em todas as 80 suítes de teste (696 testes) com auto-failover, isolamento de perfis e council Karpathy ajustado para SaaS em larga escala

### [20/10/2026] Decisões da Sessão #9
- **Decisão:** Implementação do TurnCancellationManager em memória indexado por projectId, conversationId e metachat
- **Decisão:** Rollback de arquivos via baseline SHA-1 pré-turno no cancelamento do Meta-Chat com liberação de locks no ExecutionCoordinator
- **Decisão:** Botão de Cancelar em tempo real no Chat do Projeto e Meta-Chat com restauração do prompt e abort local via AbortController
- **[20/10/2026] Unificação do Seletor de Contas e Modelos no Meta-Chat: o DecoHubMetaChatView agora compartilha a mesma estrutura de dados, lista de contas ativas, Rapid Switch e modais de gerenciamento do DecoHubHeader dos Projetos, normalizando o envio de accountId e modelo (gemini-3.8-flash/gemini-3.8-pro com raciocínio HIGH) para o backend.**
  - **Decisão:** Unificação do Seletor de Contas e Modelos no Meta-Chat: o DecoHubMetaChatView agora compartilha a mesma estrutura de dados, lista de contas ativas, Rapid Switch e modais de gerenciamento do DecoHubHeader dos Projetos, normalizando o envio de accountId e modelo (gemini-3.8-flash/gemini-3.8-pro com raciocínio HIGH) para o backend.
  - **Motivo:** Garantir consistência de experiência de usuário e eliminar dropdown quebrado (Conta Principal / Nenhuma conta encontrada), sincronizando contas reais e switches instantâneos entre os contextos de Projetos e Meta-Chat.

### [20/10/2026] Decisões da Sessão #14
- **Decisão:** Persistencia de threads do Meta-Chat em meta_chat_threads no hub.db com migracao defensiva de mensagens legadas
- **Decisão:** Telemetria em tempo real via MetaChatLiveActivity com 4 etapas canonicas de pipeline e registro de live steps
- **Decisão:** Checklist expansivel de passos executados persistido em executed_steps_json em cada mensagem de conclusao

### [20/10/2026] Decisões da Sessão #19
- **Decisão:** Inclusão da Onda 0 (Market Discovery & REA Reverse Engineering) antes da geração do Blueprint e Expansão Atômica de tarefas
- **Decisão:** Clamping estrito de compactDiscoveryBlock entre 800 e 1.400 caracteres para preservação do teto de 24.000 chars dos prompts
- **Decisão:** Adição do slash command /research com flag --build para pesquisa imediata e start de run autônomo com contexto aquecido
- **[20/10/2026] Resolução Defensiva e Fail-Safe de Contas Iniciais na Criação de Projetos: NewProjectModal agora recebe perfis e conta ativa diretamente do App.tsx e de api.getAccountProfiles() com normalização defensiva; seletor pré-seleciona a conta ativa com indicador de status e opção fallback para conta padrão; endpoint POST /api/projects vincula automaticamente a conta ativa global (AccountProfileManager.getGlobalActiveProfile) se initialProfileId for omitido, garantindo criação infalível sem bloqueios.**
  - **Decisão:** Resolução Defensiva e Fail-Safe de Contas Iniciais na Criação de Projetos: NewProjectModal agora recebe perfis e conta ativa diretamente do App.tsx e de api.getAccountProfiles() com normalização defensiva; seletor pré-seleciona a conta ativa com indicador de status e opção fallback para conta padrão; endpoint POST /api/projects vincula automaticamente a conta ativa global (AccountProfileManager.getGlobalActiveProfile) se initialProfileId for omitido, garantindo criação infalível sem bloqueios.
  - **Motivo:** Evitar que o modal de criação de projetos fique com lista vazia ou quebre por divergência de payload da API ou falta de seleção explícita, mantendo paridade com as contas disponíveis na Topbar e zero bloqueio operacional.

### [20/10/2026] Decisões da Sessão #21
- **Decisão:** Adotada abordagem defensiva em desestruturação de req.body em todas as rotas Express (fallback para objeto vazio).
- **Decisão:** Implementado limitador de capacidade (MAX_ENTRIES=500 com despejo FIFO) para Sets e Caches estáticos de memória.
- **Decisão:** Aprimorada resiliência de leitura concorrente no transcript.jsonl para tolerar gravações parciais sem perda de estado anterior.
- **Decisão:** Padronizado parser de colunas JSON do SQLite com fallback seguro em autonomousManager, runner, evaluator e registry.
- **Decisão:** Alinhadas migrações defensivas em db.ts garantindo retrocompatibilidade total com colunas de autonomous_tasks.
- **Decisão:** Refinado gate anti-slop ROOT_ROUTE_HIJACKED_BY_JSON com separação entre Express e HTTP nativo para prevenir falsos positivos.

### [20/10/2026] Decisões da Sessão #26
- **Decisão:** Criado ProjectLivingSpecService para materializar no disco 4 documentos canônicos de especificação viva (.ai-dev-hub/specs/CONTEUDO.md, DESIGN.md, BACKEND.md e PRINCIPIOS.md) na Onda 0.
- **Decisão:** Configurada cópia automática e sincronizada de DESIGN.md na raiz do projeto.
- **Decisão:** Implementado roteador cirúrgico de contexto getRoleSpecificSpecContext entregando extratos específicos para WORKER_BACKEND, WORKER_FRONTEND, WORKER_FULLSTACK, WORKER_TEST e SUPERVISOR mantendo teto entre 1.500 e 3.500 chars (máx 3.800).
- **Decisão:** Integrada geração automática de Living Specs no GeminiSupervisorProvider e HierarchicalOrchestrationService durante Wave 0.
- **Decisão:** Adicionadas rotas GET /api/projects/:id/specs e POST /api/projects/:id/specs/generate em routes.ts.

### [20/10/2026] Decisões da Sessão #28
- **Decisão:** Garantia matemática de teto de prompt em PromptArchitectureService.enforcePromptBudget (limite estrito de 23.900 caracteres) prevenindo truncamento pelo limite de 28.000 chars no Windows CLI
- **Decisão:** Roteamento especializado de especificações vivas (.ai-dev-hub/specs/) por papel do Worker (WORKER_FRONTEND, WORKER_BACKEND, WORKER_TEST, WORKER_FULLSTACK)
- **Decisão:** Injeção de referências canônicas @.ai-dev-hub/specs/... em PromptManager e indexação nativa nas regras do Antigravity 2.0

### [20/10/2026] Decisões da Sessão #30
- **Decisão:** Conectar ProjectLivingSpecService à Onda 0 com guardas de contexto SaaS/full-stack (ReaSaaSMasterService.isSaaSOrFullStackProject) para não poluir repositórios de testes e scripts não-SaaS
- **Decisão:** Publicação automática de Card Executivo no chat do projeto via mensagens role=assistant e evento WAVE_ZERO_SPECS_GENERATED na Onda 0
- **Decisão:** Sincronização aditiva de especificações vivas (CONTEUDO.md e BACKEND.md) no modo DELTA_EVOLUTION sem sobrescrever seções existentes

### [20/10/2026] Decisões da Sessão #36
- **Decisão:** Desacoplamento assíncrono em POST /api/projects respondendo 201 imediatamente com dados do projeto e delegando GitHub e binding via setImmediate
- **Decisão:** Adição de AbortController de 12 segundos em api.createProject no cliente com feedback visual em vermelho
- **[20/10/2026] Publicação do Repositório Raiz no GitHub: Inicializado e publicado o repositório 'antigravity-hub' como privado na conta deco-verc no GitHub (https://github.com/deco-verc/antigravity-hub), contendo a engine completa DecoHUB (ai-dev-hub), DOCSIMP, Skills, AutoAdapt, site_docs_extractor, diretrizes de agentes e scripts de inicialização, com .gitignore rigoroso protegendo segredos, bancos SQLite e grandes binários.**
  - **Decisão:** Publicação do Repositório Raiz no GitHub: Inicializado e publicado o repositório 'antigravity-hub' como privado na conta deco-verc no GitHub (https://github.com/deco-verc/antigravity-hub), contendo a engine completa DecoHUB (ai-dev-hub), DOCSIMP, Skills, AutoAdapt, site_docs_extractor, diretrizes de agentes e scripts de inicialização, com .gitignore rigoroso protegendo segredos, bancos SQLite e grandes binários.
  - **Motivo:** Atender à solicitação do usuário de disponibilizar todo o ecossistema do Antigravity HUB em backup privado, seguro e centralizado na nuvem GitHub.
- **[20/10/2026] Resolução dos erros TS2304 ('Cannot find name logger') e TS2339 ('Property message does not exist on type {}') injetados na substituição em lote de blocos catch vazios. O script fix-silent-errors.mjs foi corrigido para utilizar verificação segura em globalThis ((globalThis as any).logger) e casting seguro do erro ((err as any)?.message) para TypeScript com strict: true e useUnknownInCatchVariables, preservando compatibilidade para arquivos JS/MJS e restabelecendo build/typecheck 100% verde.**
  - **Decisão:** Resolução dos erros TS2304 ('Cannot find name logger') e TS2339 ('Property message does not exist on type {}') injetados na substituição em lote de blocos catch vazios. O script fix-silent-errors.mjs foi corrigido para utilizar verificação segura em globalThis ((globalThis as any).logger) e casting seguro do erro ((err as any)?.message) para TypeScript com strict: true e useUnknownInCatchVariables, preservando compatibilidade para arquivos JS/MJS e restabelecendo build/typecheck 100% verde.
  - **Motivo:** undefined
- **[20/10/2026] Eliminação do timeout na criação de projetos via desacoplamento assíncrono do Git, caching de gh/system health e idempotência amigável (HTTP 200)**
  - **Decisão:** Eliminação do timeout na criação de projetos via desacoplamento assíncrono do Git, caching de gh/system health e idempotência amigável (HTTP 200)
  - **Motivo:** As operações síncronas de Git (git init, commit, checkpoint) e inspeções frequentes de ferramentas de sistema (npm, python, git) e status do GitHub executavam execSync na thread principal do Express, bloqueando o Event Loop por até 9s e estourando o timeout de 12s no cliente. O desacoplamento assíncrono para background (setTimeout 50ms), o cache TTL em memória (60s para GitHub e 5m para system health) e a idempotência HTTP 200 garantem resposta < 15ms no backend e resiliência total a re-submissões.

### [20/10/2026] Decisões da Sessão #40
- **Decisão:** Desacoplamento assíncrono de operações Git e checkpoints na criação de projetos para execução em background após flush do HTTP 201/200
- **Decisão:** Cache em memória com TTL de 60s para GitManager.getGitHubStatus e 5m para SystemManager.getHealth, evitando chamadas execSync no loop do Express
- **Decisão:** Idempotência amigável no endpoint POST /api/projects para retornar HTTP 200 e atualizar metadados sem falhar com 409 em caso de retry do usuário
- **Decisão:** Aumento do timeout no cliente de 12s para 25s em api.createProject como margem de segurança
- **[20/10/2026] Desbloqueio definitivo de Event Loop Starvation no backend, eliminação de processos zumbis na porta 3001 e fallback nativo IPC no Electron para criação infalível de projetos**
  - **Decisão:** Desbloqueio definitivo de Event Loop Starvation no backend, eliminação de processos zumbis na porta 3001 e fallback nativo IPC no Electron para criação infalível de projetos
  - **Motivo:** Identificou-se que Atomics.wait em ensureProfileRuntimeRunningSync, execFileSync repetitivo do powershell em collectRuntimeProcessSnapshot e getRunningInstanceForProfile, além de varreduras contínuas de disco em inspectLocalAuthEvidence, causavam congelamento severo da thread principal (>25s) sob múltiplos workers. Implementou-se caching em memória (5s para processos/runtime e 10s para evidências de disco), loop assíncrono não-bloqueante via setTimeout, fast-path zero-dependency em POST /api/projects (<10ms), eliminação do reaproveitamento cego de processos órfãos em ServiceManager e fallback direto via IPC/node:sqlite no Electron.

### [20/10/2026] Decisões da Sessão #42
- **Decisão:** Cache em memória de 5s para collectRuntimeProcessSnapshot em runtimeProfileSelector e para getRunningInstanceForProfile em AccountProfileManager
- **Decisão:** Cache em memória de 10s para inspectLocalAuthEvidence por environmentPath, eliminando varredura e parse de disco contínuos
- **Decisão:** Remoção de Atomics.wait em ensureProfileRuntimeRunning, implementando loop assíncrono real com setTimeout e redução drástica do timeout síncrono para 2500ms max
- **Decisão:** Fast-path zero-dependency em POST /api/projects resolvendo perfil via query SQLite pura < 0.2ms sem chamadas síncronas de discovery ou disco
- **Decisão:** Criação de handler IPC 'desktop:create-project-direct' com gravação nativa direta via SQLite (node:sqlite DatabaseSync) em caso de timeout de 6s do backend HTTP
- **Decisão:** Eliminação definitiva de processo zumbi na porta 3001 em ServiceManager: encerramento garantido de processos antigos no start() e stop()
- **[20/10/2026] Blindagem do ciclo de vida de projetos no DecoHUB com atualização otimista imediata (0ms), seleção automática completa, botão de recarga na sidebar e sincronização periódica suave**
  - **Decisão:** Blindagem do ciclo de vida de projetos no DecoHUB com atualização otimista imediata (0ms), seleção automática completa, botão de recarga na sidebar e sincronização periódica suave
  - **Motivo:** Para eliminar qualquer descompasso visual ou latência perceptível entre a submissão de um projeto e sua aparição na barra lateral, implementou-se atualização otimista imediata no estado local de projetos em App.tsx, seleção de projeto ativa via handleSelectProject, botão manual com feedback animado (RotateCw) e limpeza de busca na sidebar, desempacotamento seguro de payload no NewProjectModal e sincronização periódica automática em focus e polling de saúde.

### [20/10/2026] Decisões da Sessão #44
- **Decisão:** Atualização otimista imediata (0ms) no estado de projetos em App.tsx garantindo visualização instantânea na sidebar
- **Decisão:** Seleção automática imediata via handleSelectProject do novo projeto recém-criado
- **Decisão:** Adição de botão de recarregamento manual na sidebar (RotateCw) com animação de feedback e botão de limpar campo de busca
- **Decisão:** Garantia de desempacotamento seguro e limpeza de formulário no NewProjectModal.tsx
- **Decisão:** Sincronização periódica suave de projetos ao focar na janela (focus event) e no ciclo de 10s de verificação de saúde
- **[20/10/2026] Aprimoramento da detecção de conclusão de turnos no Antigravity e auto-reconciliação defensiva de turnos pendentes no Meta-Chat**
  - **Decisão:** Aprimoramento da detecção de conclusão de turnos no Antigravity e auto-reconciliação defensiva de turnos pendentes no Meta-Chat
  - **Motivo:** Evitar que o Meta-Chat trave em AGENT_TURN_UNCERTAIN ou AGENT_EXECUTION_TIMEOUT ao expandir os tipos e estados de turnos reconhecidos (PLANNER_RESPONSE, ASSISTANT_RESPONSE, MODEL_TURN, MESSAGE, etc.) e auto-reconciliar para CONSUMED quando o turno anterior for interativo ou decorridos >15s sem ferramentas ativas.

### [20/10/2026] Decisões da Sessão #46
- **Decisão:** Auto-reconciliação de turnos anteriores e expansão polimórfica de turnos no observador de transcrições do Antigravity
- **[20/10/2026] Resiliência do Meta-Chat contra quedas de runtime TCP do Antigravity, priorização de DECOHUB_REPO_ROOT e canal de Direct Patching via markdown**
  - **Decisão:** Resiliência do Meta-Chat contra quedas de runtime TCP do Antigravity, priorização de DECOHUB_REPO_ROOT e canal de Direct Patching via markdown
  - **Motivo:** Permitir que o Meta-Chat opere com flexibilidade de raiz de workspace (sem exigir client/package.json), execute via failover de perfis com runtime ativo ou fallback por CLI direta com mensagem clara ao usuário caso o Antigravity esteja fechado, além de aplicar blocos de código markdown diretamente no disco (Direct Patching).

### [20/10/2026] Decisões da Sessão #48
- **Decisão:** Resiliência de conexão do Meta-Chat com runtime Antigravity, detecção da raiz via server/package.json ou dist-desktop e canal de Direct Patching por parser de código markdown
- **[20/10/2026] Typecheck Guard com escopo delimitado a changedFiles, flags --noEmit e --skipLibCheck, e reinício limpo de serviço via serviceManager em recompileAndSync**
  - **Decisão:** Typecheck Guard com escopo delimitado a changedFiles, flags --noEmit e --skipLibCheck, e reinício limpo de serviço via serviceManager em recompileAndSync
  - **Motivo:** Evita que erros alheios em arquivos não modificados travem ou façam rollback de turnos do Meta-Chat. O reinício limpo garante que o processo Express carregue os arquivos compilados sem travar a thread.

### [20/10/2026] Decisões da Sessão #50
- **Decisão:** Typecheck Guard refinado com escopo delimitado a changedFiles, flags --noEmit e --skipLibCheck
- **Decisão:** Reinício limpo do serviço Desktop Electron agendado em recompileAndSync e endpoint POST /metachat/restart
- **[20/10/2026] Desbloqueio de execuções no Chat de Projetos: runs anteriores bloqueados ou com erro são finalizados automaticamente para criar novos runs sem enfileiramento passivo; comandos de continuidade limpam last_error e redefinem microtarefas para ready.**
  - **Decisão:** Desbloqueio de execuções no Chat de Projetos: runs anteriores bloqueados ou com erro são finalizados automaticamente para criar novos runs sem enfileiramento passivo; comandos de continuidade limpam last_error e redefinem microtarefas para ready.
  - **Motivo:** Evita que instruções substantivas do usuário fiquem presas em QUEUED_USER_INSTRUCTION quando um run anterior está em blocked, error, paused ou waiting_resource, permitindo execução autônoma imediata e botões dedicados de Iniciar Novo Plano e Tentar Novamente na interface.
- **[20/10/2026] Implementação de Streaming Reativo com Server-Sent Events (SSE) para Chat de Projetos e Meta-Chat, eliminando polling periódico e chamadas HTTP bloqueantes**
  - **Decisão:** Implementação de Streaming Reativo com Server-Sent Events (SSE) para Chat de Projetos e Meta-Chat, eliminando polling periódico e chamadas HTTP bloqueantes
  - **Motivo:** Substitui requisições HTTP bloqueantes com resposta imediata HTTP 202 Accepted contendo turnId, transmitindo logs, tool calls, progresso de runs e mensagens do assistente via SSE com reconexão automática e heartbeat de 15s.

### [20/10/2026] Decisões da Sessão #52
- **Decisão:** Streaming Reativo com Server-Sent Events (SSE) integrado via SseStreamService e ObservabilityService
- **Decisão:** Resposta imediata HTTP 202 Accepted para POST /api/projects/:id/messages e POST /api/metachat/chat em modo streaming
- **Decisão:** Cliente SSE no Frontend com reconexão automática e eliminação de polling periódico no DecoHubChatView e DecoHubMetaChatView
- **[20/10/2026] Criação do LspService com integração tsserver stdio e Compiler API fallback para diagnósticos em tempo real, incorporando lsp_diagnostics no prompt do Worker e pré-avaliação sintática no AutonomousRunnerService**
  - **Decisão:** Criação do LspService com integração tsserver stdio e Compiler API fallback para diagnósticos em tempo real, incorporando lsp_diagnostics no prompt do Worker e pré-avaliação sintática no AutonomousRunnerService
  - **Motivo:** Garante que os Workers e o Autonomous Runner inspecionem e detectem erros de sintaxe e tipagem nos arquivos modificados antes de submeter a tarefa ao Independent Evaluator, fornecendo diagnósticos factuais para autocorreção imediata.

### [20/10/2026] Decisões da Sessão #56
- **Decisão:** LspService integrado ao TypeScript Server (tsserver) com fallback determinístico via Compiler API
- **Decisão:** Inclusão da capability 'lsp' por padrão nos Workers e ferramenta lsp_diagnostics na arquitetura de prompts
- **Decisão:** Pré-avaliação sintática LSP no AutonomousRunnerService com injeção factual de erros no relatório do Worker
- **[20/10/2026] Implementação do subagente CI Doctor integrado ao IndependentEvaluator e AutonomousRunnerService para auto-reparo cirúrgico de testes unitários no Gate 1**
  - **Decisão:** Implementação do subagente CI Doctor integrado ao IndependentEvaluator e AutonomousRunnerService para auto-reparo cirúrgico de testes unitários no Gate 1
  - **Motivo:** Permite identificar erros de asserção e stack traces de testes com contexto cirúrgico (<1.000 tokens), aplicando micro-patches com verificação atômica e rollback automático sem comprometer ou enfraquecer testes protegidos. Eleva o veredicto para PASS quando código de saída 0 é atingido e emite telemetria CI_DOCTOR_HEALED.

### [20/10/2026] Decisões da Sessão #58
- **Decisão:** Criação do CiDoctorService para parsing de saídas de teste, isolamento de snippets (< 1.000 tokens) e auto-reparo cirúrgico via micro-patches
- **Decisão:** Acoplamento ao IndependentEvaluator no Gate 1 para elevar veredicto a PASS com código 0 e emitir CI_DOCTOR_HEALED
- **Decisão:** Integração com AutonomousRunnerService para telemetria e supervisão de tarefas auto-reparadas
- **[20/10/2026] Ativação do Motor de Trajetórias Concorrentes (Best-of-N Rollout) e EphemeralWorktreeService**
  - **Decisão:** Ativação do Motor de Trajetórias Concorrentes (Best-of-N Rollout) e EphemeralWorktreeService
  - **Motivo:** Garante soluções ótimas para problemas complexos ou com falhas prévias sem poluir o workspace principal ou gerar conflitos de locks git, promovendo apenas a implementação com melhor score técnico e simplicidade Karpathy.

### [20/10/2026] Decisões da Sessão #61
- **Decisão:** Ativação do Motor de Trajetórias Concorrentes (Best-of-N Rollouts) e EphemeralWorktreeService
- **Decisão:** Integração dos 4 Portões de Qualidade (Dev Tests, Visual/Anti-Slop, UX/F5, AppSec) com bônus de simplicidade Karpathy na seleção do vencedor
- **[20/10/2026] Implementação do AstSymbolIndexService e Indexação Estruturada de Símbolos contra Context Rot**
  - **Decisão:** Implementação do AstSymbolIndexService e Indexação Estruturada de Símbolos contra Context Rot
  - **Motivo:** Erradica a degradação de atenção do modelo (Context Rot) e previne alucinações de assinaturas e nomes de métodos em tarefas de grande escopo, mantendo a verdade estrutural do código persistida em SQLite.

### [20/10/2026] Decisões da Sessão #63
- **Decisão:** Implementação do AstSymbolIndexService e Indexação Estruturada de Símbolos contra Context Rot
- **Decisão:** Substituição do dump de arquivos inteiros por resumos estruturados de assinaturas AST (< 30% da janela de tokens)
- **[20/10/2026] Eliminação total de Atomics.wait, fallback direto para qualquer language server ativo e cancelamento instantâneo de chat**
  - **Decisão:** Eliminação total de Atomics.wait, fallback direto para qualquer language server ativo e cancelamento instantâneo de chat
  - **Motivo:** Atomics.wait congelava a thread do Express no Windows impedindo o frontend de se comunicar e impossibilitando o cancelamento de mensagens. O novo fluxo utiliza findAnyLiveLanguageServerInstance para conectar na janela aberta do Antigravity, gera tarefas assincronamente em produção e libera o botão de cancelamento com 0ms de latência.

### [21/10/2026] Decisões da Sessão #75
- **Decisão:** Planejamento Síncrono de Alta Performance no AutonomousManager com Hidratação Imediata de Tarefas e Eliminação da Race Condition de PLAN_MISSING
  - **Motivo:** A delegação do planejamento inicial para uma promise assíncrona desacoplada em background retornava o run com status `planning` e 0 tarefas na resposta HTTP inicial. O `schedulerTick` disparado 100ms depois encontrava `tasks.length === 0` e marcava o run como erro com `PLAN_MISSING`, congelando o frontend em "Pensando e processando..." com 0 tarefas. Agora, as tarefas são geradas e persistidas sincronicamente (< 400ms via `HierarchicalOrchestrationService` ou teto de 5s no Supervisor) antes do retorno HTTP, garantindo que o plano já venha 100% populado.
- **Decisão:** Priorização de Runs Recentes (`ORDER BY updated_at DESC LIMIT 1`) e Auto-Geração Determinística de Tarefas no Step do AutonomousRunnerService
  - **Motivo:** O scheduler utilizava `ORDER BY updated_at ASC LIMIT 1`, fazendo com que runs antigos abandonados roubassem o ciclo de execução. Além disso, se qualquer run chegar ao step sem tarefas, o runner agora auto-gera o plano imediatamente em vez de falhar abruptamente com `PLAN_MISSING`.
- **Decisão:** Sincronização Dupla SSE + Polling Fallback no Frontend: Registro de `run_updated` no `sseClient.ts`, propagação bidirecional de `projectRun` para o `App.tsx` e polling a cada 2.5s no `DecoHubChatView`
  - **Motivo:** O cliente SSE descartava o evento `run_updated` porque o tipo não estava registrado em `eventTypes`. Adicionalmente, `DecoHubChatView` não possuía polling de fallback e não propagava o `activeRun` atualizado para o estado global `projectRun` do `App.tsx`, fazendo com que a aba "Tarefas" permanecesse em 0. Agora o estado fica 100% sincronizado tanto via SSE quanto via polling resiliente.
- **[21/10/2026] Resolução da priorização de diretório de brain, alinhamento de perfis isolados e restauração de despacho no nativeTurnRecovery**
  - **Decisão:** Resolução da priorização de diretório de brain, alinhamento de perfis isolados e restauração de despacho no nativeTurnRecovery
  - **Motivo:** Garante que caminhos primários de perfis/testes sejam verificados antes do diretório global de home, evitando misturas entre perfis e permitindo que o runner aguarde turnos multi-etapas de forma 100% determinística.
