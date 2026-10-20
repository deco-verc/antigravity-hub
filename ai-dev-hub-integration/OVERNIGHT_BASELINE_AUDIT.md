# OVERNIGHT BASELINE AUDIT — DECOHUB
**Data da Auditoria:** 2026-10-07 02:49 (Horário Local)  
**Branch de Execução:** `overnight/fix-everything`  
**Commit Base:** `13ad5e3`  
**Alvo:** Auditoria Funcional Profunda de Todos os Subsistemas do DecoHUB

---

## 1. Resumo Executivo da Auditoria de Baseline

| Subsistema | Classificação | Evidência Funcional Real |
|---|---|---|
| **Contas (Multi-Account)** | **FAIL** / **BLOCKED_LOGIN** | Conta `acc-pro-1` (Google Pro 1) funciona perfeitamente (autenticada em Roaming padrão). Conta `acc-pro-2` (Google Pro 2) está em `WAITING_LOGIN`. O arquivo `app_storage.json` contém `ald.clothingg@gmail.com`, porém o `verifyProfile` falhava na heurística de contagem de chaves e a instância do Antigravity em perfil secundário não mantinha o LS ativo com porta gRPC exportada para o DecoHUB. |
| **Antigravity (Runtime)** | **PASS** | `language_server.exe` v2.19.1 localizado e funcional em `C:\Users\Deco\AppData\Local\Programs\antigravity\resources\bin\language_server.exe`. Processo principal PID 15492 ativo. |
| **agentapi** | **PASS** | Comandos `agentapi new-conversation`, `send-message` e `get-conversation-metadata` respondem instantaneamente quando fornecido o endereço gRPC e CSRF token do Language Server ativo. |
| **Models (ModelRegistry)** | **PASS** | Suporte e verificação direta dos 3 modelos aceitos pelo runtime: `flash_lite`, `flash` e `pro`. Resolução automática: Pro para Supervisor/Reviewer, Flash para Builder. |
| **Workers (WorkerRegistry)** | **PASS** | Worker `worker-2994ff2c` (Antigravity Alpha) online e trabalhando em tarefas reais com leases ativas e renovação a cada 15s. |
| **Worker Bootstrap** | **PASS** | Inicialização sob demanda implementada no `AutonomousRunnerService`, criando sessões com nomes contextualizados por tarefa e projeto. |
| **Scheduler (DAG & Leases)** | **PASS** | Scheduler autônomo executa iterações incrementais, claim de tarefas `ready`, criação de branches dedicadas (`ai/3-...`, `ai/4-...`) e renovação de leases com heartbeat. |
| **Autonomous Build** | **PASS** | Ciclo completo comprovado: Planejamento DAG -> Task Ready -> Claim -> Antigravity Provider -> Alteração real de arquivos -> Testes -> Evaluator Independente -> Supervisor Review -> PR no GitHub. |
| **Context & Memory (MCP)** | **PASS** | Camada de memória permanente (`.ai-dev-hub/*.md`) e servidor MCP `ai-dev-hub` sincronizando sessões, decisões e checkpoints sem perda de estado. |
| **Git & Checkpoints** | **PASS** | 15 testes unitários passando (`npm test` no servidor). Gestão de branches, diffs unificados e checkpoints operacionais. |
| **Auto-Recovery** | **PASS** | Watchdog do `AutonomousRunnerService` detecta workers travados e leases expiradas, liberando tarefas e recuperando processos automaticamente. |
| **Desktop Services** | **PARTIAL** | Servidor Node (porta 3001) operacional com Auto-Restart. O executável instalado `%LOCALAPPDATA%\Programs\ai-dev-hub-root\DecoHUB.exe` existe no disco, mas o launch de instâncias gráficas isoladas do Antigravity sofre conflito com a instância padrão já aberta pelo Electron. |
| **Model Telemetry** | **PASS** | Preferências por papel e conta salvas no SQLite (`model_preferences`). Supervisor utiliza Pro e Builder utiliza Flash com registro comprovado. |
| **Usage Telemetry** | **PASS** | Eventos gravados em `usage_events` com duração exata em milissegundos e status. Totalizador `getTodayExecutionCount()` exibindo contagem verificada. |

---

## 2. Detalhamento dos Problemas Identificados (FAIL / PARTIAL)

### 2.1 Subsistema: Contas / Multi-Account (`accountProfileManager.ts`)
* **Classificação:** `FAIL` / `BLOCKED_LOGIN`
* **Root Cause 1 (Verificação de Sessão):**  
  Em `accountProfileManager.ts` linha 586:
  ```typescript
  if (content['jetski.onboarding.lastLoginUsername'] && Object.keys(content).length > 3)
  ```
  O arquivo real `app_storage.json` gerado pelo perfil secundário após o login contém exatamente 3 chaves:
  ```json
  {
    "ide-install-wizard-shown": "true",
    "jetski.onboarding.lastLoginUsername": "ald.clothingg@gmail.com",
    "jetski.onboarding.lastLoginIsGcpTos": "false"
  }
  ```
  A checagem `Object.keys(content).length > 3` avaliava para `false`, impedindo que a conta fosse reconhecida como `READY` e mantendo-a incorretamente em `WAITING_LOGIN`.
* **Root Cause 2 (Instância do Language Server para Perfis Isolados):**  
  O Antigravity é uma aplicação Electron com trava de instância única (`single-instance lock`). Quando o Antigravity principal já está aberto, iniciar outro `Antigravity.exe` repassa o foco para a janela existente e encerra o processo secundário, de modo que nenhum `language_server.exe` independente fica rodando no perfil secundário.  
  Para que perfis secundários executem chamadas reais de `agentapi`, o DecoHUB precisa iniciar diretamente o `language_server.exe` isolado com as variáveis de ambiente e diretórios daquele perfil (`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`), ou iniciar o Antigravity com isolamento completo de `userData` e flag desativadora de lock.
* **Arquivo Envolvido:** `server/src/accountProfileManager.ts`
* **Teste de Reprodução:**
  ```javascript
  const p = AccountProfileManager.getProfile('acc-pro-2');
  AccountProfileManager.verifyProfile('acc-pro-2'); // Retornava WAITING_LOGIN mesmo com ald.clothingg@gmail.com presente
  ```
* **Correção Necessária:**
  1. Corrigir a validação em `verifyProfile`: aceitar o perfil se `jetski.onboarding.lastLoginUsername` existir e for um email válido, independentemente do número de chaves acessórias.
  2. Implementar em `accountProfileManager.ts` o gerenciador de processo autônomo do `language_server.exe` para perfis isolados: se o usuário alternar para o perfil secundário ou um worker requisitá-lo, o DecoHUB garante que um `language_server.exe` dedicado seja iniciado apontando para o `environment_path` do perfil secundário, descobre sua porta e injeta `ANTIGRAVITY_LS_ADDRESS` e `ANTIGRAVITY_CSRF_TOKEN`.

---

## 3. Baseline de Compilação e Testes

* **Backend Build:** `npm run build` em `server/` -> **PASS** (Zero erros de compilação TypeScript).
* **Frontend Build:** `npm run build` em `client/` -> **PASS** (Zero erros de tipos e build do Vite concluído com sucesso).
* **Testes Automatizados:** `npm test` em `server/` -> **PASS** (15 testes passando em 5 suites, 100% de sucesso).
* **Banco SQLite (`hub.db`):** Todas as tabelas (`projects`, `autonomous_runs`, `workers`, `worker_leases`, `account_profiles`, `model_preferences`, `usage_events`) inicializadas e íntegras.
