# DecoHUB — Guia de Retomada da Prova E2E

> **Status Atual**: Núcleo determinístico blindado e testado. Pronto para prova E2E real.  
> **Aguardando**: Disponibilidade das cotas dos modelos Gemini / Antigravity.

---

## 1. Identificação do Estado do Repositório

* **Branch Atual**: `repair/gpt-core-rebuild`
* **Commit Base de Retomada**: `7b5b76e9dc158c50f463e60dd9ec70f51b431b9a`
* **Status dos Testes Locais**: 42/42 testes passando (`LOCAL_CORE_TESTS = PASS`)
* **Status de Compilação**: TypeScript Server e Client compilando sem advertências impeditivas (`tsc` + `vite build`)

---

## 2. Estado do Banco de Dados SQLite

* **Arquivo**: `C:\Users\Deco\.ai-dev-hub\hub.db`
* **Integridade**: Verificada via `PRAGMA integrity_check;` (`ok`)
* **Migrações Aplicadas**:
  * Tabela `autonomous_tasks`: colunas `task_commit_sha` (TEXT) e `commit_source` (TEXT) criadas.
  * Tabela `usage_events`: suporte a `tool_calls_count` (INTEGER NULLABLE) preservado.
  * Tabela `worker_leases`: leases ativas limpas e disponíveis.

---

## 3. Profiles de Conta Disponíveis

| ID | Nome de Exibição | E-mail Google | Ambiente / User Data Dir | Status |
|---|---|---|---|---|
| `acc-pro-1` | **Google Pro 1** | `zguh123456@gmail.com` | `C:\Users\Deco\AppData\Roaming\Antigravity` | READY |
| `acc-pro-2` | **Google Pro 2** | `ald.clothingg@gmail.com` | `C:\Users\Deco\.ai-dev-hub\profiles\google_pro_2` | READY |

---

## 4. O Que Fazer Assim Que a Cota Retornar

### Passo 1: Iniciar os Serviços Locais do DecoHUB
No terminal, execute:
```powershell
npm run dev
```
ou, para ambiente desktop:
```powershell
npm run desktop:dev
```

### Passo 2: Verificar Conectividade dos Agentes (Probe Real)
Antes de disparar um Autonomous Build completo, certifique-se de que os workers e o Antigravity estão respondendo:
1. Abra a interface do DecoHUB no navegador (`http://localhost:3000` ou `http://localhost:5173`).
2. Vá até a aba de **Contas / Workers**.
3. Confirme que o Worker está com status `READY` e que o probe de conectividade executou sem erros.

### Passo 3: Disparar Prova E2E Autônoma
1. Crie um novo projeto de teste descartável ou selecione um projeto alvo (ex: projeto de demonstração com Git inicializado).
2. Configure um **Autonomous Build**:
   - Defina o briefing (ex: *"Criar um módulo de cálculo de taxas com testes unitários em TypeScript"*).
   - Modo de autonomia: `Autonomous` ou `Balanced`.
3. Inicie o ciclo autônomo.
4. **Pontos Críticos para Auditoria Durante o Ciclo**:
   - [ ] **Supervisor**: Divide o briefing em DAG de tarefas e gera os critérios de aceitação sem inventar planos fictícios.
   - [ ] **DAG**: Task 1 é despachada para o Builder. Task 2 permanece `pending` até que a Task 1 seja aprovada.
   - [ ] **Lease**: O Builder adquire a lease de Task 1 atomicamente, renovando o heartbeat a cada 15s.
   - [ ] **Git Commit**:
     - Se o Antigravity executar `git commit`, o DecoHUB detecta `commit_source = 'AGENT'` com o SHA correto.
     - Se o agente apenas modificar arquivos, o DecoHUB executa `commit_source = 'DECOHUB'`.
     - A árvore de trabalho é verificada; qualquer sujeira não resolvida deve interromper o ciclo.
   - [ ] **Evaluator**: Executa os testes unitários do projeto de forma independente.
   - [ ] **DAG Desbloqueio**: Com a conclusão de Task 1, Task 2 transiciona automaticamente para `ready` no banco de dados e o próximo worker assume a tarefa.

### Passo 4: Conclusão e Handover
Ao final da prova com sucesso:
- Invoque `smart_checkpoint` ou `end_session` através do servidor MCP `ai-dev-hub`.
- Registre o relatório E2E final confirmando `E2E_AI_VALIDATION = PASS`.
