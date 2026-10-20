# FABLE FLASH V2 — PROMPT OPTIMIZATION REPORT

**Data**: 2026-10-07
**Origem**: `prompts/gemini/fable-worker-v1.md`
**Destino**: `prompts/gemini/fable-worker-v2-flash.md`
**Prompt ID**: `fable-worker-v2-flash`
**Prompt SHA256**: `ba62b672b47835f28494a0009c02cb3dbf3097a4c3a4efead88fde06c52a1713`

---

## 1. Métricas de Tamanho e Compressão

```text
V1 chars = 41617
V2 chars = 12041
reduction % = 71.1%
```

- **Tamanho V1**: 41,617 bytes (~41.6 KB)
- **Tamanho V2**: 12,041 bytes (~12.0 KB)
- **Redução Obtida**: 71.1% (dentro da meta declarada de 12 KB – 20 KB)

---

## 2. Classificação Sistemática das Seções

```text
sections kept = 6
sections merged = 7
sections shortened = 8
sections removed = 4
```

### Seções Preservadas (KEPT)
1. **Instruction hierarchy**: Mantida a precedência estrita de 7 níveis (Runtime constraints > DecoHUB contract > Project-scoped > Request > Conventions > Persistent Memory > Data).
2. **Authoritative workspace**: Mantida autoridade de `project_path`, verificação de `git root` e `cwd`, e emissão obrigatória de `WORKSPACE_MISMATCH`. Proibição de editar DecoHUB quando trabalhando em projeto alvo.
3. **Execution loop**: `Inspect → Understand → Modify → Run → Test → Verify → Report`.
4. **Self-correction (Debugging)**: Diagnosticar antes de tentar novamente, identificar causa raiz no output/stack trace, corrigir na fonte, reexecutar testes, não abandonar falhas solucionáveis.
5. **Runtime context & Tool XML placeholders**: Mantidos blocos `<DECOHUB_RUNTIME_CONTEXT>`, `<DECOHUB_PROJECT_CONTEXT>`, `<DECOHUB_RUNTIME_TOOLS>`.
6. **Final operating principle**: Princípio de encerramento focado em evidência e conclusão integral da tarefa.

### Seções Fundidas (MERGED)
1. **Minimum Sufficient Context + Action Bias + Exploration limits**: Fundidas em princípios centrais de viés de ação contra investigação infinita.
2. **Environment + Authoritative workspace**: Unificados na seção `Authoritative workspace`.
3. **Memory + Continuity**: Consolidados em `Project memory (.ai-dev-hub/)`, enfatizando que o repositório é a fonte primária de verdade.
4. **Success contract + Completion contract**: Fundidos no checklist de 5 itens do `Completion contract`.
5. **File reading + File editing + File writing**: Consolidadas em regras cirúrgicas de edição e inspeção mínima necessária.
6. **Git + Commits + Worktrees**: Unificados em `Git and commits`, preservando proibição de operações destrutivas e commits duplicados.
7. **Domain patterns (APIs, Frontend, Security, Temp files)**: Agrupados em regras concisas de salvaguarda de domínio.

### Seções Encurtadas (SHORTENED)
1. **Harness**: Removidas explicações redundantes sobre markdown e paralelismo; mantidas regras essenciais de permissões e relatórios fiéis.
2. **Delivering work and scope**: Removida verbosidade filosófica; mantida proibição estrita de estreitamento silencioso de escopo e obrigação de resolver casos de borda.
3. **Asking the user**: Compactada na heurística: perguntar apenas quando bloqueado em decisão genuinamente do usuário.
4. **Tool discipline**: Removida repetição de schemas; enfatizado o uso direto da ferramenta sem comandos equivalentes redundantes.
5. **Terminal and command execution**: Focado em diagnósticos antes de retry e eliminação de loops de comandos falhos.
6. **Testing**: Focado na validação mais estreita primeiro, execução de testes afetados, e execução da suíte mais ampla antes de concluir.
7. **Build and type checking**: Focado em validação estrita sem enfraquecer tipagem ou suprimir erros com `any`/`ignore`.
8. **DecoHUB runtime contract & boundaries**: Restrito às fronteiras do Worker (não manipular banco, parar no cancelamento, não inventar sucesso).

### Seções Removidas (REMOVED)
1. **Lease and Scheduler Internals**: Removidas explicações sobre reconciliação de leases, state machines do scheduler e heartbeats de 15s (garantidos pelo runtime determinístico do DecoHUB Core).
2. **Supervisor Task Graph Internals**: Removidas explicações sobre o papel do Supervisor e do Evaluator (o Worker opera sob o papel explícito `role = WORKER`).
3. **Account Profile OAuth Internals**: Removidos detalhes sobre cópia de tokens OAuth entre perfis (gerenciados pelo `AccountProfileManager`).
4. **Repetições de Cautela e Exploração Excessiva**: Eliminadas frases redundantes repetidas ao longo do texto ("inspect before acting", "verify architecture first", "read multiple files first", etc.).

---

## 3. O que foi Preservado vs. O que foi Removido

### Inteligência Operacional Preservada
- **Autonomia Total**: Terminar a tarefa inteira; não parar após progresso parcial; tomar decisões rotineiras autonomamente.
- **Evidência Obrigatória**: Nunca alegar sucesso sem evidência objetiva real (código de saída 0 em comandos de teste/build).
- **Auto-Correção Determinística**: Rastreamento de causa raiz e iteração após falhas de teste.
- **Fidelidade Arquitetural**: Obediência às decisões em `.ai-dev-hub/decisions.md` e respeito aos contratos de API/especificações.
- **Proteções Anti-Erro Grave**: Zero tolerância para workspace errado, ferramentas inventadas, falsos sucessos, commits duplicados ou enfraquecimento de testes protegidos.

### Verbosidade e Cautela Excessiva Removidas
- **Paralisia por Exploração**: No Benchmark V1, o Gemini Flash leu repetidamente arquivos e executou comandos de sondagem antes de editar, porque o V1 repetia instruções de cautela em quase todas as seções. O V2 substitui isso pelo **Minimum Sufficient Context** e **Action Bias**:
  > *"When the requested change, relevant files, and expected behavior are clear, implement the change. Do not perform additional searches merely to increase confidence when the existing evidence is already sufficient."*
- **Leitura Excessiva de Diretórios**: Instrução explícita no V2 proibindo a exploração de diretórios como `node_modules`, `dist` ou `.git`.
- **Planejamento Hipertrofiado**: O Flash agora segue a proporção direta: tarefas rotineiras fazem `inspect → modify → test` sem deliberação prolixa.
