---
trigger: always_on
description: Garante que agentes utilizem a memória contínua do AI DEV HUB via MCP para preservar contexto.
---

# Regra: Sincronização de Contexto e Memória com AI DEV HUB

1. **Memória Contínua Obrigatória**:
   - Nunca comece uma nova sessão de codificação tentando adivinhar o estado do projeto.
   - Sempre consulte o contexto pelo servidor MCP `ai-dev-hub` através da ferramenta `get_project_context`.

2. **Registro de Decisões**:
   - Qualquer escolha de biblioteca, refatoração estrutural ou padrão arquitetural deve ser registrada usando a ferramenta `add_decision` ou adicionada em `decisions.md`.

3. **Gerenciamento de Backlog**:
   - Tarefas devem ser sincronizadas com `add_task` e `update_task`.
   - Evite refazer tarefas já marcadas como concluídas em `tasks.md`.

4. **Preservação de Handover**:
   - Ao concluir sua intervenção, invoque `smart_checkpoint` ou `end_session` para que o próximo agente ou modelo retome exatamente de onde o trabalho parou sem perda de contexto.

5. **Execução Rápida e Segura no Windows**:
   - Nunca encapsule comandos triviais em `powershell -Command "..."` quando o executor já for PowerShell.
   - Não interpole variáveis de shell (`$var`) dentro de strings com aspas duplas em comandos.
   - Utilize sempre `-NoProfile -NonInteractive` e timeouts em invocações bloqueantes de processos.
   - Priorize testes unitários de escopo antes de rodar suítes completas.
