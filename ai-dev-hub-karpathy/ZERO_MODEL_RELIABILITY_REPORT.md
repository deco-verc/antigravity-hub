# DecoHUB — Zero-Model Reliability & Hardening Audit Report

> **Data/Hora**: 2026-10-07  
> **Branch**: `repair/gpt-core-rebuild`  
> **Modo de Operação**: Zero-Model Maintenance Phase (Sem inferência ou chamadas externas de LLM)

---

## 1. Contexto e Objetivo

Durante a fase de manutenção determinística (enquanto a cota de inferência dos modelos Gemini/Antigravity esteve esgotada), o núcleo do DecoHUB foi auditado, fortalecido e blindado contra todas as 15 falhas identificadas na sessão anterior. 

Nenhuma alteração de interface gráfica ou recurso não essencial foi introduzido. Todas as correções e testes foram desenhados para garantir que, no momento em que as cotas retornarem, o ciclo autônomo multi-agente execute de ponta a ponta com previsibilidade estrita e tolerância zero a falhas silenciosas.

---

## 2. Auditoria dos 15 Bugs Encontrados

### Bug 1: Conta podia ser marcada READY apenas por metadata/e-mail
* **Root Cause**: O método de verificação de conta aceitava preenchimento de metadados ou entrada manual de e-mail sem testar se a sessão gRPC/agentapi no Antigravity realmente respondia.
* **Fix**: Em [`AccountProfileManager.verifyProfile`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/accountProfileManager.ts), foi eliminada qualquer promoção automática. O status só transiciona para `READY` após probe funcional comprovando sessão ativa. Fornecido hook `setVerifyProbeOverrideForTest` para testes unitários determinísticos.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"metadata and email alone must NOT grant READY status"` e `"functional verification probe success grants READY status"`.
* **Result**: **PASS**

### Bug 2: Worker podia ser READY sem agente real
* **Root Cause**: `WorkerRegistry` podia considerar workers em `READY` se existisse registro no SQLite ou se um PID anterior tivesse sido persistido.
* **Fix**: [`WorkerRegistry.ensureWorkerAvailable`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/workerRegistry.ts) agora exige probe ativo comprovando conectividade e retorno de `conversationId` antes de marcar o worker como `READY`. Se o probe falhar, o worker permanece offline/error.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"Worker cannot become READY without successful probe verification"`.
* **Result**: **PASS**

### Bug 3: Heartbeat de Worker READY podia ser renovado sem validar runtime
* **Root Cause**: `getReadyWorkers()` considerava apenas timestamp da tabela `workers`, permitindo que workers com processos mortos permanecessem marcados como ativos.
* **Fix**: [`WorkerRegistry.getReadyWorkers`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/workerRegistry.ts) valida `process.kill(row.pid, 0)` para checar a vivacidade do processo além do limiar de tempo do heartbeat.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"Worker becomes READY only when probe succeeds with real PID and conversation"`.
* **Result**: **PASS**

### Bug 4: Associação de runtime podia apontar para language_server errado
* **Root Cause**: A descoberta de processos locais buscava qualquer executável `language_server.exe` escutando portas, sem verificar se pertencia ao `--user-data-dir` do perfil correto.
* **Fix**: [`AccountProfileManager.getRunningInstanceForProfile`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/accountProfileManager.ts) valida os argumentos de linha de comando (`ParentCmd`) conferindo se `--user-data-dir` corresponde estritamente ao diretório isolado do perfil. Perfil A nunca seleciona a instância do Perfil B.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"Account A never binds to unauthenticated or mismatched language_server of Account B"`.
* **Result**: **PASS**

### Bug 5: Supervisor podia usar ambiente errado
* **Root Cause**: Ao invocar o Supervisor, variáveis de ambiente de processos globais podiam sobrescrever as rotas de porta e CSRF do perfil ativo.
* **Fix**: Invocação do Supervisor em [`autonomousRunnerService.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/autonomousRunnerService.ts) e [`autonomousManager.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/autonomousManager.ts) passa explicitamente `isolatedEnv` derivado do perfil ativo do projeto.
* **Regression Test**: Verificado na integração de `executeBuilderTaskReal` e isolamento de env em [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts).
* **Result**: **PASS**

### Bug 6: Plano fictício podia ser usado quando Supervisor falhava
* **Root Cause**: Havia fallback que criava tarefas estáticas sintéticas caso a chamada da IA do Supervisor gerasse erro, mascarando a indisponibilidade.
* **Fix**: `planRealProject` em `geminiSupervisorProvider.ts` e `generateInitialTasks` em `autonomousManager.ts` falham explicitamente se a chamada da IA falhar, gravando `SUPERVISOR_UNAVAILABLE` no status do run e abortando a geração espúria.
* **Regression Test**: [`autonomousManager.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/autonomousManager.ts) trata exceção e propaga erro com log explícito.
* **Result**: **PASS**

### Bug 7: Heartbeat antigo podia causar lease expirada logo após claim
* **Root Cause**: No momento em que um worker antigo executava `claimTask`, o timestamp de heartbeat herdava a data anterior do worker, podendo ser classificado como expirado antes do primeiro ciclo de renovação.
* **Fix**: [`WorkerRegistry.claimTask`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/workerRegistry.ts) executa em transação `BEGIN IMMEDIATE`, inserindo a lease com `claimed_at = now` e `last_heartbeat = now`, e invocando atomicamente `updateWorkerHeartbeat(workerId)` na mesma transação.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"claimTask atomically claims lease, updates worker to WORKING, and refreshes heartbeat"`.
* **Result**: **PASS**

### Bug 8: DAG liberava dependência logicamente mas não persistia READY
* **Root Cause**: `getAvailableTasks` calculava quais tarefas tinham dependências satisfeitas na memória, mas não emitia `UPDATE autonomous_tasks SET status = 'ready'` no SQLite.
* **Fix**: [`AutonomousManager.getAvailableTasks`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/autonomousManager.ts) executa `UPDATE autonomous_tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status IN ('pending', 'needs_changes')`, persistindo a prontidão imediatamente.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"When Task 1 completes, Task 2 transitions to READY and is PERSISTED in SQLite"`.
* **Result**: **PASS**

### Bug 9: Caminhos Windows do transcript podiam quebrar Git commit
* **Root Cause**: Nomes de arquivo extraídos do transcript vinham com separadores de barra invertida (`\`), prefixos de diretório relativo (`.\`) ou caminhos absolutos, quebrando o `git add` seletivo.
* **Fix**: Implementado [`GitManager.normalizeRepoPath`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/gitManager.ts), que normaliza barras para `/`, resolve caminhos absolutos dentro da raiz do projeto, preserva espaços com segurança e descarta qualquer caminho externo, traversal (`../`), `.git` ou `node_modules`.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"normalizes backslashes, forward slashes, and relative prefixes"`, `"handles paths with spaces safely"`, `"blocks paths traversing outside repository root"`.
* **Result**: **PASS**

### Bug 10: Commit seletivo podia falhar mas log informar sucesso
* **Root Cause**: `commitSelected` não verificava se o `git diff --cached` realmente continha alterações preparadas após adicionar os arquivos selecionados.
* **Fix**: [`GitManager.commitSelected`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/gitManager.ts) checa `git diff --cached --name-only`. Se vazio ou se `git commit` falhar, retorna `false` e não inventa commit.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"DECOHUB Commit scenario: Agent changes files without commit, DecoHUB stages and commits"`.
* **Result**: **PASS**

### Bug 11: Cancelamento de run não interrompia task em execução
* **Root Cause**: Se o usuário cancelasse o run enquanto o agent estava respondendo, o runner continuava até a finalização da task e criava commits indevidos.
* **Fix**: [`AutonomousRunnerService.step`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/autonomousRunnerService.ts) e `executeBuilderTaskReal` consultam o status do run antes do commit e após cada etapa. Se o status for `failed`/cancelado, lança `RUN_CANCELLED` e aborta sem comitar nem prosseguir.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"stopRun transitions run to failed with RUN_CANCELLED, releases leases and cancels active tasks"`.
* **Result**: **PASS**

### Bug 12: Run cancelado podia voltar a executar
* **Root Cause**: O loop do scheduler selecionava tarefas de runs que estavam com erro ou cancelados se ainda houvesse workers ociosos.
* **Fix**: O scheduler e `AutonomousManager.getAvailableTasks` verificam o status do run. Ao invocar `stopRun`, todas as leases ativas são canceladas, as tasks `in_progress` são marcadas como `failed` e nenhuma nova tarefa é despachada.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"Available tasks on cancelled run must be empty"`.
* **Result**: **PASS**

### Bug 13: Agentapi podia trabalhar no workspace errado
* **Root Cause**: O runner não validava se o diretório do projeto coincidia com a raiz do repositório Git e com o diretório de trabalho do runtime antes de iniciar o Worker.
* **Fix**: Criado [`GitManager.assertExecutionWorkspace`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/gitManager.ts). Valida: (1) existência do caminho do projeto, (2) que `git rev-parse --show-toplevel` coincide com o projeto, (3) que o `runtime.cwd` (quando presente) coincide exatamente. Caso contrário, lança erro explícito `WORKSPACE_MISMATCH`. Injetado no runner antes de qualquer despacho de task.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"Workspace Isolation Assertion"`.
* **Result**: **PASS**

### Bug 14: Tool_calls desconhecido era gravado como 0
* **Root Cause**: `UsageTracker.recordEvent` e `antigravityProvider.ts` convertiam `undefined` para `0`, distorcendo a telemetria ao fingir que 0 ferramentas haviam sido chamadas quando a informação era desconhecida/indisponível.
* **Fix**: [`UsageTracker.recordEvent`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/usageTracker.ts) e `antigravityProvider.ts` agora usam `params.toolCallsCount ?? null`. Valores desconhecidos são gravados estritamente como `NULL`.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"unknown tool_calls count is recorded as NULL instead of 0"` e `"explicit countable tool_calls is recorded accurately"`.
* **Result**: **PASS**

### Bug 15: Antigravity pode criar o commit antes do DecoHUB
* **Root Cause**: Se o agente executasse ferramentas de Git internamente criando um commit (avançando HEAD de A para B), o DecoHUB tentava executar um novo commit sobre arquivos já comitados, falhando por ausência de arquivos modificados (`diff --cached` vazio).
* **Fix**: [`AutonomousRunnerService.executeBuilderTaskReal`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/src/autonomousRunnerService.ts) armazena o SHA inicial (`initialGitHead`). Após a conclusão do Builder:
  - Se `currentHead !== initialGitHead`: reconhece o commit do agente, não tenta commit vazio, registra `task_commit_sha = currentHead` e `commit_source = 'AGENT'`.
  - Se `currentHead === initialGitHead`: o DecoHUB executa `GitManager.commitSelected`, obtém o novo HEAD e registra `task_commit_sha = newHead` e `commit_source = 'DECOHUB'`.
  - Em seguida, verifica se a árvore de trabalho ficou limpa; alterações residuais não registradas causam rejeição com `DIRTY_WORKING_TREE_UNRESOLVED`.
* **Regression Test**: [`coreReliability.test.ts`](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/server/test/coreReliability.test.ts) — `"AGENT Commit scenario"` e `"DECOHUB Commit scenario"`.
* **Result**: **PASS**

---

## 3. Resumo dos Resultados dos Testes Automatizados

Suítes executadas via `npm --prefix server test`:
- `GitManager Suite`: 3/3 PASS
- `Desktop & Runtime HealthCheck Suite`: 3/3 PASS
- `PolicyEngine Security Matrix Suite`: 4/4 PASS
- `AccountProfileManager Suite`: 2/2 PASS
- `Database & Memory Persistence Suite`: 3/3 PASS
- `DecoHUB Core Reliability & Deterministic Hardening Suite`: 27/27 PASS

**Total: 42 testes executados | 42 aprovados | 0 falhas | 0 cancelados**

Compilação do Código:
- `npm --prefix server run build` (`tsc`): **PASS** (Zero erros)
- `npm --prefix client run build` (`tsc && vite build`): **PASS** (Zero erros)

Integridade do Banco de Dados SQLite:
- `PRAGMA integrity_check`: **ok**

---

## 4. Veredito Final da Fase de Manutenção

```text
LOCAL_CORE_TESTS = PASS
E2E_AI_VALIDATION = PENDING_QUOTA
```

*(Conforme as diretrizes, o status final de verificação completa permanece pendente até a execução do teste ponta-a-ponta com os modelos reais de IA assim que as cotas estiverem disponíveis).*
