# AI DEV HUB — Diretrizes para Agentes de Programação

Este repositório e todos os projetos vinculados utilizam o **AI DEV HUB** como camada de persistência, auditoria e memória contínua.

## 🧠 Como Agentes de IA Devem Operar

Sempre que iniciar trabalho em qualquer projeto gerenciado:

### 1. Início de Sessão (Bootstrap)
Consulte o estado atual chamando o servidor MCP `ai-dev-hub`:
- Use `get_project_context` com `{ project: "<nome-ou-caminho>", mode: "normal" }` para obter objetivo, arquitetura, tarefas ativas e decisões recentes.
- Registre o início da sessão com `start_session` para obter um `session_id` rastreável.

### 2. Durante o Desenvolvimento
- Se tomar uma decisão arquitetural relevante: registre com `add_decision`.
- Ao criar ou concluir tarefas: atualize com `add_task` ou `update_task`.
- Ao encontrar um bug não resolvido: registre com `add_problem`.
- Para buscar contexto anterior sobre um componente ou decisão: use `search_project_context`.

### 3. Fim da Sessão (Handover)
Antes de finalizar sua resposta ou passar para outro agente:
- Finalize com `end_session` passando o `session_id`, tarefas concluídas (`implemented`), arquivos alterados (`files_changed`) e próximo passo recomendado (`next_task`).
- Se preferir geração automática a partir do Git: use `smart_checkpoint`.
- Para passar o bastão para outra sessão: use `generate_handover`.

## 📁 Estrutura de Memória
A memória permanente reside na pasta `.ai-dev-hub/` de cada projeto:
- `project.md`: Visão geral e escopo do projeto
- `architecture.md`: Stack tecnológica e componentes
- `tasks.md`: Kanban de tarefas (pendente, em andamento, concluído)
- `decisions.md`: Log de decisões técnicas e suas justificativas
- `changes.md`: Histórico de arquivos alterados
- `session-summary.md`: Checkpoint consolidado da última sessão

## ⚡ Diretrizes de Execução Rápida e Segura de Comandos no Windows

Para prevenir travamentos, bloqueios de stdin e lentidão artificial no ambiente Windows:
1. **Sintaxe Direta do Shell**: O executor do Antigravity no Windows já opera em PowerShell. Nunca encapsule comandos triviais em `powershell -Command "..."`. Execute diretamente os binários ou cmdlets (`node`, `git`, `Get-Item`, etc.).
2. **Prevenção de Interpolação Prematura de Variáveis**: Nunca coloque variáveis de PowerShell (`$var`) dentro de aspas duplas em strings de comando do agente, pois o shell pai as substitui por strings vazias antes da execução, quebrando a sintaxe e gerando hangs interativos.
3. **Modo Não-Interativo e Timeouts**: Em qualquer invocação necessária do PowerShell, utilize sempre `-NoProfile -NonInteractive` com timeout delimitado para evitar esperas indefinidas em `stdin`.
4. **Ciclo de Testes por Escopo**: Sempre execute o teste unitário focado da alteração primeiro (duração < 1s). Execute verificações de tipo (`typecheck`) e reserve a suíte completa (`npm test`, ~81s) estritamente para o portão final de entrega.

