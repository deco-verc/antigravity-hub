# DecoHUB 1.0.3 — recuperação e evidências

Data: 9 de outubro de 2026, America/Sao_Paulo. A entrega corrige o fluxo demonstrado pelo FinanceFlow e valida a lógica interna com banco temporário e providers externos explicitamente simulados. **A integração nativa com Gemini não foi homologada nesta missão. Não há aprovação operacional nem autorização de instalação.**

## Estado recuperado e causa demonstrada

O checkout inicial era `feat/decohub-native-autonomy-final`, HEAD `cbc9d6ff2e8a2f402729865f6c0ac90d89b3994d`. Os quatro arquivos de memória já estavam modificados antes do trabalho e foram preservados, inclusive com comparação do patch inicial e final. A instalação aberta continuou sendo a 1.0.2, com seu próprio backend em `resources/app.asar.unpacked/server/dist/index.js`. Os hashes de `routes.js`, `sessionCircuitBreaker.js` e `agentApiGateway.js` instalados correspondiam ao build inicial do checkout.

O banco de produção foi aberto somente com `DatabaseSync(..., {readOnly:true})`. Uma cópia consistente foi criada com a API de backup SQLite em `C:\IA\DecoHUB-recovery-20261009\hub-before.db`, incluindo o estado do WAL. A integridade retornou `ok`. A produção não recebeu migração, limpeza nem restauração.

FinanceFlow: projeto `bcfd09a0-2ac1-4800-9c8f-0e960b094ad0`; Run `81ea4117-5417-441e-b14b-981974f2387f`. A mensagem completa chegou ao backend em **02:07:28**. O Run foi persistido, mas ficou em `error`, ciclo zero, sem tarefas autônomas e sem sessões Supervisor/Worker.

Às **02:06:33**, selecionar a conta havia criado uma conversa extra, `6edffbd2-f3d2-4120-84dd-cf52fe204c03`, fora dos dois papéis do pipeline. O breaker antigo somava `AGENT_CONVERSATION_CREATE_ATTEMPT` e `CREATE_SUCCESS` como duas criações e registrava a tentativa atual antes da decisão. Portanto, a primeira criação física contribuía com dois registros; a tentativa de criar o Supervisor acrescentava o terceiro e era bloqueada pelo limite três. O log confirma `SESSION_CREATION_STORM` antes de qualquer criação física do Supervisor. O provider substituiu esse erro por `SUPERVISOR_UNAVAILABLE`, e a rota respondeu com “Memória do projeto sincronizada”. O frontend ainda emitia um toast de sucesso e o cabeçalho tinha “Em andamento” fixo.

Isso demonstra uma interrupção no início do planejamento. **Não demonstra que o Worker do FinanceFlow recebeu uma tarefa e falhou**, nem que a autenticação foi a causa desse caso.

As criações “Worker — Dedup Project” (`026dfc7e...`, 02:04:48) e “Worker — Project Beta DB” (`1415e86b...`, 02:09:37) são atribuídas nos registros aos projetos `proj-dedup` e `proj-iso-beta-uuid`, respectivamente. O backend instalado recuperou registros antigos de testes. São evidência de contaminação histórica do banco de produção, não conversas do FinanceFlow. Nenhum desses registros foi apagado.

Evidências: `docs/recovery-evidence/financeflow-readonly.json`, `historical-test-projects.json`, `regressions-before.log` e logs originais em `C:\Users\Deco\.ai-dev-hub\logs\backend.log`.

## Contrato completo da instrução

| Transição | Arquivo / função | Entrada, saída e persistência | Bloqueio e próxima ação |
|---|---|---|---|
| Chat → handler | `client/src/components/DecoHubChatView.tsx::handleSubmit` | Texto integral; bloqueia duplo envio no componente | Exibe erro do handler; não considera envio prova de implementação |
| Handler → cliente HTTP | `client/src/App.tsx::handleSendMessage` | Chama `api.sendMessage`, incorpora mensagens, Run e resultado de execução | Ignora resposta de projeto que já deixou de estar selecionado; toast e cabeçalho mostram bloqueio |
| Cliente → backend | `client/src/services/api.ts::sendMessage` | POST `/api/projects/:id/messages` | Tipo e conteúdo inválidos são rejeitados |
| Rota → mensagem | `server/src/routes.ts` | Valida projeto, grava `messages`, retorna `execution` com estado e causa | Mensagem salva não é tratada como execução concluída |
| Mensagem → Run | `autonomousManager.ts::createRun/createReservedRun` | Exige confiança e autonomia explícitas, reserva criação, persiste Run em `planning` | Reutiliza Run não terminal; não cria duplicata em pedidos concorrentes |
| Run → planejamento | `autonomousManager.ts::generateInitialTasks` | Objetivo integral, perfil selecionado, reserva global de execução | Falha fica no Run original; `resumeRun` replaneja o mesmo Run se ainda não há tarefas |
| Planejamento → Supervisor | `geminiSupervisorProvider.ts::planTasks` | Briefing, memória, decisões, constituição, arquitetura, Git e arquivos existentes | Erro original é propagado; JSON inválido não gera plano fictício |
| Supervisor → sessão | `agentSessionManager.ts::getOrCreateAgentSession` | Uma sessão por projeto/papel, vínculo com perfil/modelo e geração | Reserva persistente antes da chamada externa; resultado ambíguo impede nova criação |
| Sessão → gateway | `agentApiGateway.ts::newConversation/sendMessage` | Telemetria, autorização, breaker e diretório do projeto | Offline sem mock explícito falha fechado; mock não pode substituir execução nativa |
| Gateway → Antigravity | CLI AgentAPI já existente no produto | Conversa física somente no caminho autorizado; continuação usa conversationId persistido | Não foi chamado fisicamente nos testes offline |
| Plano → Task | Persistência transacional em `autonomous_tasks` | Títulos, descrições, critérios, dependências reais, comando de verificação e condição de término | Rejeita duplicatas, dependências inexistentes e ciclos; não impõe quantidade fixa |
| Task → Worker | `autonomousRunnerService.ts`, `workerRegistry.ts`, `antigravityProvider.ts` | Lease, perfil/runtime correto, sessão Worker reutilizada, prompt específico | Captura início do turno antes do envio; lê somente eventos novos |
| Worker → Evaluator | `independentEvaluator.ts::evaluate` | Comandos executados independentemente, arquivos verificados, proteção dos testes de aceitação | Relato textual, ausência de verificação e exit(0) de fachada não aprovam; timeout mantém execução incerta |
| Evaluator → Supervisor → próxima Task | `executeSupervisorReview`, `submitSupervisorReview`, DAG | Aprovação exige PASS independente persistido; reprovação conserva Task e limita reparos | Task concluída não pode ser reclamada/reaberta por relatório; dependências impedem avanço antecipado |
| Última Task → conclusão | `reviewProjectCompletion` | Todos os resultados independentes + briefing integral + revisão final na mesma sessão | Última Task aprovada não finaliza automaticamente o projeto |

Seleção de conta, verificação de prontidão e mudanças de versão do prompt não abrem conversas extras. Rotação automática não usa bytes como prova de limite de tokens. Uma mudança de perfil/modelo incompatível é bloqueada e exige handoff explícito.

## Validação e diferenças em relação aos testes anteriores

O baseline de 236 testes passava. As novas regressões falharam no código antigo: contagem duplicada no breaker e prompt com “contexto/continuar” interceptado pelo helper local. O fluxo HTTP agora devolve o Run bloqueado e o erro original. Cinco retomadas simultâneas mantêm um único Run e um único plano.

O teste completo percorre a rota HTTP, planejamento, sessões, despacho, parser de transcript, escrita de arquivos e Evaluator. O provider externo de teste entrega **dez tarefas específicas**. Na primeira entrega ele escreve uma soma incorreta. As asserções reais falham, a Task não avança, o Worker corrige a mesma Task, e o ciclo chega à avaliação final. Resultado: **11 entregas, dez PASS, um FAIL esperado, uma sessão Supervisor e uma Worker**, inclusive durante reparo.

Casos adicionais cobrem autorização sem autonomia total; isolamento entre projetos/perfis; reserva entre processos; crash com criação externa ambígua; 429 durante continuação; reinício com preservação de IDs; plano inválido; ausência de resposta mock configurada; validação factual de arquivos; rejeição de aprovação sem Evaluator; e timeout com código parcial que já passaria nos testes. Neste último caso o Evaluator não é executado e a reserva global fica retida para impedir outro agente enquanto o estado externo permanece incerto.

Os casos antigos que aceitavam `process.exit(0)` e somente relatórios textuais foram fortalecidos. Os casos positivos de aprovação receberam verificações reais de código; os negativos agora exigem que evidência insuficiente não conclua a Task. Não foram removidas asserções para mascarar falhas.

O teste Electron antigo selecionava o banco legado ignorando `AI_DEV_HUB_DATA_DIR` e podia anexar a uma porta de produção. Foi substituído por um teste que valida banco, modo e perfil Electron isolados. A primeira tentativa de preparação falhou porque Electron empacotado rejeita a injeção por NODE_OPTIONS; a injeção explícita atual exige offline e diretório temporário, e o fixture permanece fora do instalador.

No executável final, o teste digita e envia pela **interface React real**. Confirma plano, escrita de código, reprovação/reparo, conclusão e duas sessões; testa erros visíveis de autorização, autenticação, planejamento inválido e runtime ausente. Modelos reais permanecem “Não confirmado”. Capturas e resultados estão em `docs/recovery-evidence/electron-*.png` e `electron-sandbox.json`.

## Contas, quotas e limites da prova

`lastLoginUsername` é histórico; não prova OAuth atual. READY/ACTIVE históricos são expostos como AUTH_UNKNOWN em modo nativo. A verificação de arquivos/runtime não inventa token válido. O fim do cooldown permite tentar novamente, preservando Run, Task e sessões, mas não declara quota restaurada nem Worker READY automaticamente. Não há troca silenciosa de conta/modelo.

`agy` não foi encontrado no PATH nem no diretório de instalação documentado. Nenhum CLI foi instalado. A documentação oficial descreve [usage como painel interativo](https://antigravity.google/docs/cli/commands/usage/) e [credits como painel de créditos](https://antigravity.google/docs/cli/commands/credits/). O parser de payload estruturado continua sendo um normalizador testado, **não prova de consulta real integrada**. Valores por modelo, identidade autenticada e créditos ficam UNKNOWN/null; um 429 não fornece um saldo numérico por modelo.

Continuam pendentes: autenticação e identidade atuais do perfil real; modelo efetivamente utilizado pelo runtime; quota/credits reais; reutilização física durante várias tarefas nativas; execução e avaliação do FinanceFlow completo; reconciliação externa de uma chamada que termine ambígua; e limpeza dos registros históricos de testes em produção. Esses pontos não recebem PASS nativo. O trabalho não criou o FinanceFlow manualmente para encobrir a falha de orquestração.

Instruções recebidas durante um Run são enfileiradas para a continuidade após esse Run. Não há promessa de replanejamento imediato no meio de um turno ativo.

## A. Causas raiz

```text
FINANCEFLOW_ROOT_CAUSE = PASS — primeira sessão Supervisor bloqueada por contagem dupla + tentativa atual
INSTRUCTION_TO_RUN_FAILURE = PASS — causa demonstrada: Run existia, mas falha e identidade do Run eram ocultadas
SUPERVISOR_START_FAILURE = PASS — erro real preservado; breaker corrigido; planejamento retomável no mesmo Run
WORKER_START_FAILURE = PASS — FinanceFlow não tinha Tasks; sem prova de tarefa entregue a Worker nesse caso
ACCOUNT_RUNTIME_FAILURE = BLOCKED — OAuth/identidade atuais requerem verificação nativa autorizada
FRONTEND_STATE_FAILURE = PASS — indicadores fixos/sucesso fictício substituídos por estados e erros reais
SESSION_REUSE_FAILURE = PASS offline; NOT_TESTED nativo — reserva durável, dois papéis e reuse entre dez Tasks
CROSS_PROJECT_ISOLATION = PASS offline e atribuição histórica por IDs; NOT_TESTED para múltiplas contas reais
```

## B. Correções

```text
INSTRUCTION_PIPELINE = PASS — HTTP real, conteúdo integral, Run e bloqueio devolvidos à UI
AUTONOMOUS_RUN_LIFECYCLE = PASS — planning persistido, criação reservada, retomada idempotente
SUPERVISOR_PLANNING = PASS offline — plano específico, validação e persistência atômica
WORKER_DISPATCH = PASS offline — Task correta, diretório correto, turno novo, arquivos reais
EVALUATOR_INTEGRATION = PASS offline — reprovação impede avanço; aprovação sem evidência persistida é rejeitada
SESSION_PERSISTENCE = PASS offline — duas sessões reutilizadas; identidade preservada em reinício
CIRCUIT_BREAKER = PASS — cada operação contada uma vez e antes da tentativa atual
PROJECT_AUTHORIZATION = PASS — confiança isolada não autoriza execução
ACCOUNT_PROFILE_ISOLATION = PASS offline; NOT_TESTED nativo — mismatch bloqueado e runtime vinculado ao perfil
QUOTA_HANDLING = PASS offline — 429 preserva estado; cooldown não inventa READY ou saldo
ERROR_VISIBILITY = PASS — quatro falhas verificadas no Electron empacotado pela interface
CRASH_RECOVERY = PASS para persistência e suspensão sem duplicação; BLOCKED para reconciliar efeito externo ambíguo
```

## C. Evidências

```text
GIT_BRANCH = PASS — feat/decohub-native-autonomy-final
ORIGINAL_HEAD = PASS — cbc9d6ff2e8a2f402729865f6c0ac90d89b3994d
FINAL_HEAD = PASS — registrado no relatório final e delivery.json em C:\IA\DecoHUB-recovery-20261009
FILES_CHANGED = PASS — git show dos commits consolidados; memória anterior não incluída nos commits
TESTS_EXECUTED = PASS — npm test, typecheck, build, testes Electron e migração em cópia
TESTS_PASSED = PASS — 249/249, 30 suítes, zero skip; recovery-evidence/offline-tests.log
TESTS_FAILED = PASS — zero falhas na suíte final; falhas anteriores preservadas na evidência de regressão
REAL_AGENTAPI_CALLS_IN_OFFLINE_TESTS = PASS — zero, com gateway fail-closed e bloqueio de processos físicos
NEW_CONVERSATIONS_IN_OFFLINE_TESTS = PASS — zero físicas; IDs conv-fake são fixtures explicitamente simulados
BACKEND_BUILD = PASS
FRONTEND_BUILD = PASS
ELECTRON_SANDBOX = PASS — UI, API e banco temporário convergem; não valida Gemini real
INSTRUCTION_TO_RUN_E2E = PASS offline
SUPERVISOR_TO_WORKER_E2E = PASS offline
EVALUATOR_E2E = PASS offline — falha concreta, reparo e aprovação independente
```

## D. Entrega

```text
NEW_VERSION = PASS — 1.0.3
INSTALLER_PATH = PASS — C:\IA\Antigravity HUB\ai-dev-hub\dist-desktop\DecoHUB Setup 1.0.3.exe
INSTALLER_SHA256 = PASS — bc44a375bb3c9632119d45e6e9c47c2c5d3c81ce93660bde4cde9b6570e3b6d1
BACKUP_VERIFIED = PASS — backup SQLite consistente e integrity_check=ok
PRODUCTION_DB_PRESERVED = PASS — valores idênticos em todas as tabelas exceto heartbeat normal do backend aberto
AUTOADAPT_PRESERVED = PASS — nenhum reinício, limpeza, execução de tarefa ou escrita no projeto
INSTALLATION_PERFORMED = NOT_TESTED — instalação não realizada
LIVE_SMOKE_AUTHORIZED = BLOCKED — autorização pendente
LIVE_SMOKE_EXECUTED = NOT_TESTED
READY_FOR_INSTALLATION = BLOCKED — aprovação operacional depende da homologação nativa
```

As migrações foram executadas três vezes em cópia do backup: integridade `ok`, preservação de todas as linhas **e seus valores** nas tabelas antigas. O bundle teve seus arquivos comparados ao build fonte. O conteúdo foi também extraído do instalador, sem executá-lo, e comparado ao bundle testado. O relatório de integridade registra versão, lista de arquivos e hashes.

## Homologação nativa preparada — aguardando autorização

Um projeto temporário, banco separado, perfil **Google Pro 1**, modelos solicitados **Pro para Supervisor e Flash para Worker**. Objetivo pequeno: implementar um módulo executável de soma com validação, ampliar com uma API local e verificar ambas as entregas, incluindo entradas inválidas. Nenhuma API externa, nenhum dado financeiro pessoal e nenhuma instalação.

Antes de enviar o primeiro turno, verificar pertencimento do runtime ao perfil escolhido, diretório efetivo da conversa, ausência de trabalho externo em conflito e política de créditos pagos. Não inferir o workspace físico só pelo diretório enviado no prompt. Sem confirmação de que créditos extras estão desativados, suspender. `AUTH_UNKNOWN` não será promovido por inferência.

A instrumentação terá limite total de **duas criações físicas durante todo o teste**, com uma criação por papel. Uma terceira tentativa, qualquer papel inesperado ou troca de perfil/modelo interrompe o teste antes da chamada física. Registrar conversationIds, criação/continuação, arquivos, Git diff, comandos, resultados independentes, falhas e estado final. Um 429 preserva os IDs e encerra a rodada; não aciona troca automática de conta/modelo ou créditos pagos.

O teste usará o artefato novo isolado e o mesmo fluxo do chat. A instalação 1.0.2, o banco de produção, FinanceFlow e AutoAdapt permanecem preservados. Autorização deste teste não é autorização de instalação nem de limpeza de dados.

## Instalação e retorno seguro, somente em etapa autorizada

Quando houver aprovação nativa e autorização separada de instalação: preservar a instalação anterior; encerrar seu backend com supervisão do usuário; gerar novo backup consistente imediatamente antes da atualização; instalar a versão verificada; conferir a versão e o banco efetivamente usados. Não rodar simultaneamente backends antigos e novos contra produção.

Se for necessário retornar ao binário anterior, preservar primeiro também o banco e os arquivos **posteriores** à atualização. As alterações de esquema desta entrega são aditivas; confirmar compatibilidade da versão anterior em uma cópia do estado atual. Não substituir o banco atual pelo backup inicial. Recuperação de dados, limpeza de fixtures históricos e qualquer rollback destrutivo exigem autorização específica.
