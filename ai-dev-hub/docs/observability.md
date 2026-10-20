# Sistema Central de Observabilidade e Diagnóstico do DecoHUB

## 1. Visão Geral e Arquitetura

O **DecoHUB Observability & Diagnostic Engine** é um subsistema integrado e de alto desempenho projetado para rastrear, persistir, correlacionar e diagnosticar toda a cadeia de execução autônoma do DecoHUB:
- Orquestrador de Runs Autônomos (`autonomousRunnerService`, `autonomousManager`).
- Agentes Especializados: Supervisor (`pro`), Worker Builder (`flash`), Evaluator Independente (`pro`), AI DEV Council.
- Chamadas Nativas e Transporte com o Google Antigravity (`agentApiGateway`, `agentTurnState`).
- Concorrência, Leases e Reservas Globais (`workerRegistry`, `executionCoordinator`).
- Avaliação de Critérios de Aceitação e Guarda Anti-Slop (`independentEvaluator`).

```
                    ┌───────────────────────────────┐
                    │      DecoHUB Orchestrator     │
                    │   (Runs, Tasks, Watchdog)     │
                    └──────────────┬────────────────┘
                                   │ TraceContext (AsyncLocalStorage)
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 ┌─────────────┐            ┌─────────────┐            ┌─────────────┐
 │  Supervisor │            │   Worker    │            │  Evaluator  │
 │  Gemini Pro │            │   Builder   │            │   (Anti-    │
 └──────┬──────┘            └──────┬──────┘            │ Tampering)  │
        │                          │                   └──────┬──────┘
        ▼                          ▼                          ▼
 ┌───────────────────────────────────────────────────────────────────┐
 │                   ObservabilityService / Sanitizer                │
 └─────────────────┬───────────────────────────────┬─────────────────┘
                   │                               │
                   ▼                               ▼
       ┌────────────────────────┐      ┌────────────────────────┐
       │     SQLite Database    │      │  Rotating File Logger  │
       │ (observability_events) │      │  (events.jsonl & log)  │
       └───────────┬────────────┘      └───────────┬────────────┘
                   │                               │
                   ▼                               ▼
       ┌────────────────────────────────────────────────────────┐
       │ REST API (/api/observability/*) & DiagnosticService    │
       │        (Anomalias, Timeline, Erros Agrupados)          │
       └───────────────────────────┬────────────────────────────┘
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │   Frontend UI (DecoHubObservabilityView Component)     │
       └────────────────────────────────────────────────────────┘
```

---

## 2. Esquema Unificado de Eventos Estruturados

Cada evento de observabilidade é estruturado com campos estritamente tipados:

| Campo | Tipo | Descrição |
| :--- | :--- | :--- |
| `id` | `TEXT` | Identificador único do evento (`obs-<uuid>`). |
| `timestamp` | `TEXT` | Carimbo ISO 8601 UTC do momento do evento. |
| `level` | `TEXT` | Nível de severidade: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. |
| `event` | `TEXT` | Código semântico padronizado do evento (ex: `agent.native_call_started`). |
| `message` | `TEXT` | Descrição humana clara e contextualizada. |
| `service` | `TEXT` | Componente emissor: `runner`, `worker`, `agent-gateway`, `turn-state`, `evaluator`, `autonomous-manager`, `diagnostic`, `core`. |
| `environment` | `TEXT` | Ambiente de execução (`production`, `development`, `test`). |
| `processId` | `INTEGER` | PID do processo do backend emissor. |
| `sessionId` | `TEXT` | Identificador da sessão ativa (se aplicável). |
| `correlationId`| `TEXT` | Identificador unificador de uma cadeia ponta a ponta. |
| `traceId` | `TEXT` | Identificador de trace distribuído (propagado via AsyncLocalStorage). |
| `spanId` | `TEXT` | Identificador do span específico da operação atual. |
| `parentSpanId` | `TEXT` | Identificador do span pai que originou a operação. |
| `runId` | `TEXT` | Identificador do Autonomous Run correlacionado. |
| `taskId` | `TEXT` | Identificador da tarefa correlacionada. |
| `milestone` | `TEXT` | Marco do projeto (ex: `MVP`, `M1`, `M2`). |
| `projectId` | `TEXT` | Identificador do projeto ativo. |
| `conversationId`| `TEXT`| ID da conversa com o Antigravity (se aplicável). |
| `attempt` | `INTEGER` | Número da tentativa da operação. |
| `durationMs` | `INTEGER` | Duração observada da operação em milissegundos. |
| `status` | `TEXT` | Estado ou veredicto resultante (`PASS`, `FAIL`, `COMPLETED`, etc.). |
| `error` | `JSON` | Objeto com `{ name, message, code, stack, cause, isRetryable }`. |
| `metadata` | `JSON` | Metadados arbitrários estruturados e sanitizados. |
| `createdAt` | `TEXT` | Carimbo ISO da inserção no banco de dados. |

---

## 3. Catálogo Oficial de Eventos Instrumentados

### Ciclo de Vida do Run & Tarefas
- `run.created`: Autonomous Run instanciado e reservado.
- `run.started`: Execução do Run iniciada pelo runner loop.
- `run.progress_updated`: Progresso do Run atualizado (tarefa, marco, ciclo).
- `run.completed`: Run concluído com sucesso e todas as tarefas finalizadas.
- `run.failed`: Run abortado por erro irrecuperável ou falhas consecutivas.
- `task.dispatched`: Tarefa despachada pelo Runner para o Worker atribuído.
- `task.started`: Início da execução da tarefa pelo Worker.
- `task.completed`: Tarefa concluída e aprovada após avaliação e revisão.
- `task.failed`: Tarefa falhou e atingiu o limite de retentativas.
- `task.retry_scheduled`: Retentativa de tarefa agendada após falha recuperável.

### Chamadas Nativas & Agentes
- `agent.native_call_started`: Início da chamada de transporte ao Antigravity Language Server.
- `agent.native_call_completed`: Resposta do Antigravity recebida com sucesso.
- `agent.native_call_failed`: Falha de transporte, protocolo, timeout ou recusa da API nativa.
- `agent.native_call_blocked`: Chamada bloqueada antes do envio por política de segurança offline.
- `agent.turn_state_changed`: Transição formal do ciclo do turno nativo (`PREPARED`, `IN_FLIGHT`, `COMPLETE`, `CONSUMED`, `UNCERTAIN`).

### Leases & Concorrência
- `lease.acquired`: Worker adquiriu lease exclusiva para executar uma tarefa.
- `lease.renewed`: Worker renovou com sucesso a lease via heartbeat.
- `lease.released`: Lease liberada normalmente pelo Worker ao terminar.
- `lease.expired`: Watchdog detectou expiração de lease por ausência de batimento.
- `reservation.acquired`: Reserva global de execução exclusiva adquirida por processo.
- `reservation.released`: Reserva global liberada após ciclo de execução.

### Avaliação & Revisão
- `builder.report_received`: Relatório de entrega submetido pelo Builder.
- `evaluation.started`: Início da verificação independente pelo Evaluator.
- `evaluation.completed`: Parecer independente emitido (`PASS`, `FAIL`, `TAMPERING_DETECTED`).
- `supervisor.review_received`: Revisão formal do Supervisor concluída com veredicto.
- `reconciliation.started`: Início do processo de reconciliação de estado pelo Runner.
- `reconciliation.completed`: Reconciliação concluída e consistência restabelecida.

### Diagnósticos
- `diagnostic.stalled_operation_detected`: Anomalia detectada pelo motor forense.

---

## 4. Rastreamento e Diagnóstico de Chamadas Nativas do Antigravity

Para cada interação com o Antigravity Language Server, o DecoHUB registra explicitamente:

1. **Modo de Execução Real vs Simulado**:
   - `metadata.isOffline`: Se o sistema está em modo offline fail-closed.
   - `metadata.isSimulated`: Se a chamada foi interceptada por fixture/mock de teste.
   - `metadata.physicalCall`: Indica execução real contra o executável local.
2. **Contexto de Transporte**:
   - `conversationId`: ID persistente da conversa com o agente.
   - `promptSummary`: Resumo temático seguro do prompt com contagem de caracteres (sem despejo de prompts sensíveis ilimitados).
   - `durationMs`: Latência da viagem de ida e volta da chamada.
   - `error.code`: Códigos como `ETIMEDOUT`, `ECONNREFUSED`, `UNAUTHORIZED`, `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`.
3. **Falhas Parciais e Incertezas**:
   - Se o processo do Antigravity encerra abruptamente, o turno é marcado como `UNCERTAIN`, gerando evento estruturado e impedindo novos despachos sem conciliação prévia.

---

## 5. Sistema de Detecção de Anomalias & Hipóteses Forenses

O `DiagnosticService` executa varreduras ativas sob demanda ou via Watchdog, identificando 6 cenários patológicos de execução:

### 1. `STALLED_RUN`
- **Sintoma**: Run com status ativo (`running`, `building`, etc.) sem atualização por mais de 5 minutos, e sem nenhuma lease ativa nem turno em voo.
- **Hipótese Gerada**: Processo do runner encerrou de forma anômala, bloqueio em I/O síncrono ou loop de eventos travado.
- **Ação**: Verificar estado do processo backend e acionar retomada controlada via `POST /api/autonomous/runs/:id/resume`.

### 2. `STALLED_TASK_WITHOUT_LEASE`
- **Sintoma**: Tarefa em `in_progress` há mais de 3 minutos, mas sem nenhuma lease válida na tabela `worker_leases`.
- **Hipótese Gerada**: O worker morreu inesperadamente ou a lease expirou sem liberação adequada da tarefa.
- **Ação**: Reconciliar o status da tarefa de volta para `ready` para permitir novo despacho.

### 3. `TASK_STUCK_IN_REVIEW`
- **Sintoma**: Tarefa com status `in_review` há mais de 5 minutos.
- **Hipótese Gerada**: O Builder submeteu o relatório, mas o turno do Supervisor para emissão do parecer não foi despachado ou falhou silenciosamente antes de persistir o veredicto.
- **Ação**: Reconciliar a tarefa inspecionando `/api/observability/tasks/:id/events` e redespachar revisão.

### 4. `EXPIRED_LEASE_NOT_RECONCILED`
- **Sintoma**: Registro em `worker_leases` onde `lease_until < now`, mas `status = 'active'`.
- **Hipótese Gerada**: Worker ausente de batimentos cardíacos (heartbeat) aguardando varredura do Watchdog.
- **Ação**: Forçar expiração de leases obsoletas via `WorkerRegistry.expireStaleLeases()`.

### 5. `ORPHAN_EXECUTION_RESERVATION`
- **Sintoma**: Registro ativo em `execution_reservations` cujo PID proprietário já não existe no sistema operacional.
- **Hipótese Gerada**: Queda brusca de processo que detinha o lock global sem executar o hook de saída limpa.
- **Ação**: Liberar a reserva órfã com `ExecutionCoordinator.forceReleaseOrphan()`.

### 6. `RUN_TASK_STATE_DIVERGENCE`
- **Sintoma**: Run marcado como `completed`, mas contendo tarefas filhas com status `pending`, `ready` ou `in_progress`.
- **Hipótese Gerada**: Encerramento prematuro do run ou adição concorrente de tarefas pós-finalização.
- **Ação**: Verificar se as tarefas pendentes devem ser arquivadas ou reabrir o run.

---

## 6. Segurança, Privacidade & Mascaramento Automático

Todos os eventos gerados passam obrigatoriamente pela camada de proteção do `Sanitizer`:

1. **Tokens de Provedores de IA**: Padrões `AIzaSy[A-Za-z0-9_-]{33}` são substituídos por `AIza[REDACTED_GOOGLE_KEY]`.
2. **Tokens GitHub**: Padrões `ghp_[A-Za-z0-9]{36}`, `gho_*`, `ghu_*` são substituídos por `gh*_[REDACTED_GITHUB_TOKEN]`.
3. **Cabeçalhos de Autorização & JWTs**: Padrões `Bearer eyJ...` são substituídos por `Bearer [REDACTED_TOKEN]`.
4. **URIs com Autenticação**: Formatos `protocol://user:password@host` têm suas credenciais ofuscadas para `protocol://[REDACTED_USERINFO]@host`.
5. **Chaves Sensíveis em Objetos JSON**: Qualquer chave de metadados contendo termos como `apikey`, `token`, `password`, `secret`, `cookie`, `auth`, `credential`, `private_key` tem seu valor imediatamente substituído por `[REDACTED_SENSITIVE_FIELD]`.
6. **Proteção Circular**: Evita estouro de pilha (stack overflow) ao serializar estruturas recursivas, marcando nós cíclicos como `[CIRCULAR_REFERENCE]`.

---

## 7. Endpoints da API REST de Observabilidade

Todos os endpoints estão disponíveis sob o prefixo `/api/observability`:

| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `GET` | `/api/observability/events` | Consulta paginada com filtros (`level`, `service`, `event`, `runId`, `taskId`, `search`, `since`, `until`). |
| `GET` | `/api/observability/events/:id` | Recupera os detalhes completos e metadados de um evento específico. |
| `GET` | `/api/observability/runs/:runId/timeline` | Linha do tempo sequencial e ordenada cronologicamente de um Run. |
| `GET` | `/api/observability/tasks/:taskId/events` | Histórico completo de eventos associados a uma tarefa específica. |
| `GET` | `/api/observability/diagnostics/anomalies` | Lista de anomalias ativas detectadas com evidências, hipóteses e recomendações. |
| `GET` | `/api/observability/diagnostics/errors` | Agrupamento de erros recorrentes por assinatura e frequência. |
| `GET` | `/api/observability/health` | Relatório consolidado de integridade da camada de observabilidade e logs de arquivo. |
| `GET` | `/api/observability/export` | Download de eventos sanitizados em formato `json` ou `jsonl` (`?format=jsonl`). |
| `POST`| `/api/observability/cleanup` | Expurga eventos mais antigos que `retentionDays` (padrão: 30 dias). |

---

## 8. Interface de Diagnóstico do Frontend

O componente `DecoHubObservabilityView` está integrado ao **Painel Avançado** do DecoHUB (`AdvancedDashboardModal`) e ao botão **Diagnóstico** no cabeçalho de cada projeto:

- **Faixa de Integridade e Métricas**: Exibe o status da observabilidade (`HEALTHY`, `DEGRADED`, `UNHEALTHY`), contagem de eventos nas últimas 24 horas, erros e anomalias ativas.
- **Aba Eventos Estruturados**: Tabela reativa com busca textual em tempo real, filtros de severidade, serviço e Run ID, além de gaveta expansível para visualização de stack traces e cópia de JSON.
- **Aba Linha do Tempo do Run**: Representação visual do ciclo de vida com deltas temporais entre passos (`+250ms`, `+1.2s`), marcadores de agentes e ligações de spans.
- **Aba Detecção de Anomalias**: Cartões com severidade visual, evidências factuais, hipóteses formuladas e ações corretivas sugeridas.
- **Aba Erros Recorrentes**: Agrupamento por assinatura de erro com contadores e horário da primeira/última ocorrência.
- **Exportação 1-Click**: Botões para download imediato do pacote forense sanitizado em JSON ou JSONL.

---

## 9. Política de Retenção, Rotação e Armazenamento

- **Persistência SQLite**: Os eventos residem na tabela `observability_events` no banco global `~/.ai-dev-hub/hub.db`. Índices dedicados otimizam consultas por timestamp, nível, run, tarefa, correlação e serviço.
- **Logs de Arquivo com Rotação**:
  - Diretório: `~/.ai-dev-hub/logs/`
  - Arquivo estruturado: `events.jsonl`
  - Arquivo legível: `backend.log`
  - Limite de rotação: 5 MB por arquivo, retendo até 5 arquivos rotacionados (`.1`, `.2`, etc.).
- **Retenção e Expurgo**:
  - Período padrão: 30 dias.
  - Expurgo manual via API: `POST /api/observability/cleanup` com corpo `{ "retentionDays": 15 }`.
