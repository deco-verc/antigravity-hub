# Plano de Evolução e Backlog Priorizado

**Projeto:** AutoAdapt  
**Módulo:** Plano de Evolução do Sistema  
**Data:** 08/10/2026  
**Status:** Baseline Estabelecida & Backlog Selecionado  
**Diretriz de Restrição:** Máximo 2 melhorias de alto impacto (Karpathy Simplicity First)  

---

## 1. Sumário Executivo

Com base na auditoria arquitetural e na pesquisa comparativa de benchmarks (SWE-bench, GAIA e paradigmas RLVR/Karpathy), este plano estabelece a **Baseline Oficial** do AutoAdapt e define estritamente as **duas melhorias de maior retorno sobre investimento (ROI)** para guiar as próximas iterações autônomas. 

Para evitar dispersão de escopo e complexidade acidental, melhorias secundárias foram postergadas, concentrando 100% da capacidade do sistema em robustez de verificação e isolamento concorrente.

---

## 2. Baseline Documentada do Sistema

A Baseline documenta as capacidades, métricas e restrições operacionais verificadas na versão atual (v0.1.0):

### 2.1 Métricas de Referência da Baseline

| Métrica | Valor Baseline | Fonte de Verificação |
|---|:---:|---|
| **Tempo de Execução de Testes (Total)** | ~230ms - 250ms | `npm test` (Node.js native test runner) |
| **Cobertura de Testes Automatizados** | 24 testes unitários e de integração | `test/**/*.test.js` |
| **Dependências Externas no `package.json`** | 0 (Zero third-party dependencies) | `package.json` |
| **Mecanismo de Testes** | `node:test` e `node:assert/strict` | Runtime Node.js v24 LTS |
| **Isolamento de Worktree** | Suporte a 1 worktree estático (`ai-dev-hub-self-improvement`) | `src/worktreeIsolation.js` |
| **Ciclo de Autocorreção (Self-Healing)** | Manual / Não orquestrado em runtime | N/A |
| **Resolução Autônoma Estimada** | Nível Passivo (Tarefas pré-escritas) | Auditoria arquitetural G-01 a G-05 |

### 2.2 Capacidades Estabelecidas
1. **Estrutura de Memória Permanente:** Persistência em arquivos Markdown locais (`.ai-dev-hub/`) sincronizada via checkpoints.
2. **Inspeção de Worktrees Git:** Parser porcelain determinístico e validação de ponteiros `.git` no filesystem.
3. **Validação de Documentação Técnica:** Módulo `src/auditAndBenchmarks.js` que verifica a integridade de relatórios contra regressões.

### 2.3 Gargalos e Limitações da Baseline
- **Ausência de Self-Healing em Runtime:** Se um teste falhar durante a execução de uma tarefa, o sistema ainda não possui um loop fechado autônomo para capturar a stacktrace, aplicar patch e retestar em worktree efêmero.
- **Ciclo de Vida Manual de Worktrees:** Criação e desmontagem de worktrees dependem de comandos manuais ou scripts estáticos, carecendo de gestão de ciclo de vida (setup -> run -> merge/discard -> cleanup).

---

## 3. Backlog Priorizado: As 2 Melhorias de Alto Impacto

Seguindo estritamente a restrição de **no máximo 2 melhorias de alto impacto**, foram selecionadas:

```
+----------------------------------------------------------------------------------------------------+
| SELEÇÃO DO BACKLOG DE ALTO IMPACTO (LIMITE ESTRITO: 2 ITENS)                                       |
+-----+-------------------------------------------------------+---------------+----------------------+
| ID  | Título da Melhoria                                    | Prioridade    | Impacto Esperado     |
+-----+-------------------------------------------------------+---------------+----------------------+
| M-1 | Loop de Autocorreção Guiado por Verificador (RLVR)    | P0 (Crítica)  | Sucesso autônomo >75%|
| M-2 | Gerenciador de Ciclo de Vida de Worktrees Efêmeros    | P0 (Crítica)  | Risco de colisão = 0%|
+-----+-------------------------------------------------------+---------------+----------------------+
```

---

### 3.1 Melhoria 1: Loop de Autocorreção Guiado por Verificador (Self-Healing Debug Loop)

- **Identificador:** `IMP-01-SELF-HEALING-LOOP`
- **Justificativa Técnica (Alto ROI):**
  A literatura do SWE-bench e os princípios de RLVR comprovam que agentes com verificação determinística e autocorreção fechada superam modelos de passada única em mais de 10x. Permitir que o AutoAdapt execute testes, analise erros e tente correções pontuais em loop limitado (máximo 5 iterações) eleva a taxa de resolução de tarefas sem demandar supervisão humana constante.
- **Escopo e Componentes:**
  1. Captura de stacktrace e saída de `stdout`/`stderr` do runner de teste.
  2. Mecanismo de diagnóstico de causa raiz (sintaxe vs tipagem vs asserção falha).
  3. Limite estrito de segurança: máximo 5 iterações de autocorreção antes de registrar bloqueio e escalar.
  4. Garantia de inviolabilidade de testes (proibido desabilitar ou enfraquecer o harness de teste).
- **Critérios Binários de Aceitação:**
  - [ ] Captura e parseia saídas de teste com falha.
  - [ ] Executa iterações de reparo até retorno de saída 0 ou limite de 5 tentativas.
  - [ ] Reverte alterações automaticamente caso o loop atinja o limite sem convergência.

---

### 3.2 Melhoria 2: Gerenciador de Ciclo de Vida de Worktrees Efêmeros (Ephemeral Worktree Lifecycle Manager)

- **Identificador:** `IMP-02-EPHEMERAL-WORKTREES`
- **Justificativa Técnica (Alto ROI):**
  Contenção de recursos e conflitos de arquivo no Windows (`.git/index.lock`, `node_modules` bloqueados) representam o gargalo crítico de estabilidade (G-03). Transformar o isolamento de worktree em um serviço efêmero automatizado garante que cada iteração ocorra em sandbox limpa e descartável.
- **Escopo e Componentes:**
  1. Criação dinâmica de branch e diretório de worktree com prefixo temporal/tarefa (ex: `sandbox/task-{id}`).
  2. Validação automática de integridade do worktree antes da execução do código.
  3. Estratégia de conclusão atômica: se testes passarem, mescla ou gera patch cirúrgico para a branch principal; se falharem, desmonta e remove o worktree com `git worktree remove --force` sem poluir o repositório.
- **Critérios Binários de Aceitação:**
  - [ ] Criação e remoção atômica de worktrees temporários sem lock residual.
  - [ ] Verificação de isolamento completo de dependências e estado git.
  - [ ] Rollback e limpeza garantidos mesmo em caso de exceções não tratadas.

---

## 4. Matriz de Rejeição / Itens Postergados (Out of Scope)

Para manter a conformidade rigorosa com a regra de no máximo 2 melhorias, as seguintes iniciativas foram formalmente arquivadas para marcos posteriores:
- *Postergado:* Interface gráfica com dashboard de telemetria em tempo real (baixa relevância para autonomia de engenharia).
- *Postergado:* Suporte a múltiplos provedores em nuvem (viola o princípio de operação local soberana).
- *Postergado:* Mecanismo de geração automática de documentação Swagger/OpenAPI (não prioritário no MVP).

---

## 5. Próximos Passos Imediatos

1. Manter a suite de testes atual passando com 100% de sucesso.
2. Implementar as interfaces e contratos das duas melhorias no módulo de orquestração do AutoAdapt.
3. Validar a conformidade com as diretrizes da Karpathy Layer.
