# AUDITORIA INTEGRAL DO SISTEMA — DECOHUB AUTONOMOUS IDE

**Data**: 2026-10-07
**Branch**: `feat/decohub-native-autonomy-final`
**Commit Base**: `a9e8c522a78fe4182532b87b525816e17cb6dfd2`
**Baseline Protegida**: `decohub-core-operational-v1` (`876ae3944cf6a7f521371a434db74b54bad54a8c`)

---

## 1. Classificação Geral dos Subsistemas

| Subsistema | Classificação | Evidência / Diagnóstico Técnico |
|---|:---:|---|
| **Frontend (React/TypeScript/Vite)** | **PARTIAL** | UI rica e modular compilando sem erros em Vite (12.5s). Porém, botões de ação ("AVANÇAR 1 CICLO", "LOOP CONTÍNUO") chamavam endpoints que ainda invocavam a simulação legada mockada `AutonomousAgentRunner`. |
| **Backend (Node/Express/TypeScript)** | **WORKING** | Servidor Express em `http://127.0.0.1:3001` com CORS restrito, rotas estruturadas e servindo client estático. Compilação TypeScript com 0 erros. |
| **SQLite Persistence (`hub.db`)** | **WORKING** | Schema robusto com WAL ativo, chaves estrangeiras e integridade referencial em `~/.ai-dev-hub/hub.db`. Tabelas completas (`projects`, `conversations`, `workers`, `worker_leases`, `autonomous_runs`, `autonomous_tasks`, `runner_heartbeats`). |
| **Electron Desktop Integration** | **PARTIAL** | Processo principal em `desktop/main.cjs` e `serviceManager.cjs` implementados com single-instance lock e splash screen. Requer confirmação de inicialização autônoma ponta a ponta sem comandos manuais. |
| **Gerenciamento de Projetos** | **WORKING** | Criação e abertura de projetos com validação de caminho seguro, `git init` automático e scaffold da memória permanente `.ai-dev-hub/`. |
| **AccountProfileManager** | **WORKING** | Isolamento de ambientes de SO (`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `HOME`) por conta (`acc-pro-1`, etc.). Conexão real ao `language_server.exe` em portas dedicadas (ex: 2109). |
| **WorkerRegistry** | **WORKING** | Gestão de workers no banco, matching atômico de tarefas via leases, detecção de leases vencidas e recuperação autônoma de workers offline via probe. |
| **ConversationManager** | **WORKING** | Reutilização de conversations persistentes por role/contexto, 1 probe oculta por conta, rotação controlada em `PROMPT_VERSION_CHANGE` e resolução de project mismatch sem explosão de chats. |
| **AutonomousManager** | **WORKING** | Decomposição de runs, gestão de eventos auditáveis, controle de políticas de aprovação (Green/Yellow/Orange/Red) e registro de relatórios de builder. |
| **AutonomousRunnerService** | **WORKING** | Loop contínuo com scheduler a cada 3s, heartbeat a cada 15s, watchdog a cada 30s e recuperação autônoma de tarefas travadas no boot. |
| **AutonomousAgentRunner (Legado)** | **BROKEN / UNNECESSARY** | Código de protótipo antigo em `server/src/autonomousAgentRunner.ts` que simulava execução com dados fictícios (12 testes mockados). Deve ser removido e redirecionado integralmente para `AutonomousRunnerService`. |
| **GeminiSupervisorProvider** | **WORKING** | Planejamento DAG real via modelo Gemini (`planTasks`) e revisão objetiva de relatórios de builder (`reviewBuilderReport`) respeitando vereditos do Evaluator. Sem planos ou revisões fictícias em caso de indisponibilidade. |
| **AntigravityProvider** | **PARTIAL** | Envio de tarefas via `agentapi send-message` e polling de conclusão via transcrição. Necessário suporte oficial à variante `native` e refinamento do tratamento de timeout de transcrição. |
| **IndependentEvaluator** | **PARTIAL** | Execução real de testes protegidos e verificação objetiva no terminal com detecção de adulteração (`TAMPERING_DETECTED`). Necessário diferenciar claramente `PASS`, `FAIL`, `TIMEOUT`, `INCONCLUSIVE`, `BLOCKED`. |
| **Scheduler & Watchdog** | **WORKING** | Despacho multi-worker, auto-recuperação de tarefas `in_progress` interrompidas e expiração atômica de leases stale. |
| **Heartbeats & Leases** | **WORKING** | Tabela `worker_leases` com leases renovadas periodicamente a cada 15s durante a execução real do builder. |
| **Git Management (`GitManager`)** | **WORKING** | Verificação estrita de workspace (`project_path = workspace = Git root = runtime cwd`), criação de branches dedicadas (`ai/<issue>-<slug>`) e captura real de commits. |
| **MCP Integration** | **WORKING** | Servidor `ai-dev-hub` MCP ativo expondo ferramentas de memória contínua, checkpoints e tarefas. |
| **Memória Permanente (`.ai-dev-hub/`)** | **WORKING** | Arquivos Markdown (`project.md`, `architecture.md`, `tasks.md`, `decisions.md`, `changes.md`, `session-summary.md`) mantendo o contexto histórico de cada projeto. |

---

## 2. Diagnóstico Detalhado dos Problemas Encontrados

### Problema 1: Dualidade de Runners (Mock vs Real)
- **Evidência**: O arquivo `server/src/autonomousAgentRunner.ts` continha lógica simulada legada (linhas 78-100: gerava listas mockadas de arquivos e fingia "12 unit tests executados").
- **Impacto**: As rotas de UI `POST /api/autonomous/runs/:id/step` e `POST /api/autonomous/runs/:id/loop/start` chamavam esse mock antigo em vez do motor autônomo real `AutonomousRunnerService`.
- **Correção**: Desativar/eliminar o `AutonomousAgentRunner` e repassar 100% das chamadas da API e da UI para o `AutonomousRunnerService.executeAutonomousStep()`.

### Problema 2: Dependência de System Prompts Experimentais
- **Evidência**: O `AutonomousRunnerService` ainda possuía ramificações legadas que tentavam injetar `fable-worker-v1` ou `fable-worker-v2-flash` e regras de diretório `.agents/rules/decohub-worker.md`.
- **Impacto**: O modelo sofria sobrecarga de instruções e exploração desnecessária, contrariando o comportamento nativo do Antigravity.
- **Correção**: Implementar `worker_prompt_variant = 'native'` como padrão incondicional de produção. O Worker Antigravity operará com suas instruções nativas, recebendo apenas o contrato da tarefa (objetivo, critérios de aceitação, comando de verificação).

### Problema 3: Ambiguidade no Veredicto do Evaluator
- **Evidência**: Quando o polling de transcrição atingia 300s (como visto no Cenário 3 do benchmark anterior), o `antigravityProvider` retornava `status: 'failure'` com `AGENT_EXECUTION_TIMEOUT`. O `IndependentEvaluator` transformava isso em `FAIL`, misturando problemas de transporte/polling com falhas lógicas no código (que havia passado nos testes).
- **Correção**: Expandir os vereditos do Evaluator para diferenciar `PASS`, `FAIL`, `TIMEOUT`, `INCONCLUSIVE` e `BLOCKED`.

### Problema 4: Alinhamento das Ações da UI com o Backend Real
- **Evidência**: Botões de controle de ciclo na interface precisam acionar o loop de fundo real e refletir o estado de execução atômico do SQLite sem atrasos ou dados inconsistentes.
- **Correção**: Assegurar que `/autonomous/runs/:id/step` execute o passo real e que o polling do frontend reflita o heartbeat do runner e dos workers em tempo real.

---

## 3. Plano de Execução com Dependências e Prioridades

### Fase A — Padrão Nativo do Worker (Prioridade Máxima)
1. Configurar `worker_prompt_variant = 'native'` como default absoluto em `PromptManager` e `AutonomousRunnerService`.
2. Assegurar que nenhuma regra experimental seja injetada em `.agents/rules/decohub-worker.md` para novos projetos, limpando apenas arquivos experimentais gerenciados e preservando arquivos legítimos do usuário (`AGENTS.md`, `GEMINI.md`).
3. O Worker recebe estritamente a mensagem da tarefa estruturada via `agentapi send-message`.

### Fase B — Unificação do Runner Autônomo
1. Eliminar a rota para o mock `AutonomousAgentRunner` em `server/src/routes.ts`.
2. Fazer `/autonomous/runs/:id/step` executar `AutonomousRunnerService.executeAutonomousStep(req.params.id)`.
3. Fazer `/autonomous/runs/:id/loop/start` garantir que o runner de background esteja ativo e o run em status `running`.

### Fase C — Refinamento do Evaluator e Diagnóstico de Falhas
1. Atualizar `IndependentEvaluator` para emitir vereditos granulares: `PASS`, `FAIL`, `TIMEOUT`, `INCONCLUSIVE`, `BLOCKED`.
2. Não aprovar tarefas sem evidência e não reprovar código válido por simples timeout de transporte de transcrição.

### Fase D — Validação Desktop e UI End-to-End
1. Validar inicialização do backend pelo `desktop/main.cjs` / `serviceManager.cjs`.
2. Comprovar que um projeto criado pela UI com solicitação de desenvolvimento avance do planejamento à execução autônoma sem scripts externos.

### Fase E — Execução das Provas Obrigatórias (Testes 1 a 9)
1. Executar as 9 provas em projetos isolados temporários (`C:\IA\test-projects\...`).
2. Documentar cada evidência no relatório final `docs/engineering/DECOHUB_FINAL_FUNCTIONAL_VALIDATION.md`.
