# Pesquisa Comparativa: Benchmarks de Agentes Autônomos de Codificação

**Projeto:** AutoAdapt  
**Módulo:** Auditoria e Benchmarks  
**Data:** 08/10/2026  
**Status:** Concluído  

---

## 1. Objetivo da Pesquisa Comparativa

Mapear o estado da arte e avaliar sistematicamente os principais benchmarks industriais e acadêmicos voltados à avaliação de agentes autônomos de engenharia de software e raciocínio multi-etapa. A meta é extrair métricas de desempenho, padrões de arquitetura de alta eficácia e lições aprendidas para nortear o design do motor autônomo do AutoAdapt.

---

## 2. Benchmarks de Referência Analisados

### 2.1 SWE-bench (Standard, Lite e Verified)
- **Origem / Autores:** Princeton NLP (Carlos E. Jimenez et al., 2024).
- **Escopo e Metodologia:** Avalia a capacidade de resolver issues reais do GitHub em 12 repositórios populares de Python (como Django, SymPy, scikit-learn, Sphinx). O agente recebe a descrição da issue e o codebase completo, precisando gerar um patch `git diff` que passe em testes de validação previamente falhos sem quebrar testes existentes.
- **Variações:**
  - *SWE-bench Full:* 2.294 tarefas.
  - *SWE-bench Lite:* Subconjunto selecionado de 300 tarefas para iteração rápida.
  - *SWE-bench Verified:* 500 tarefas rigorosamente auditadas por humanos para eliminar testes ambíguos ou flaky tests.
- **Resultados de Ponta no Mercado (2024-2026):**
  - Modelos sem ferramentas (Zero-shot): < 3% de resolução.
  - Agentes autônomos com busca em árvore e execução de testes (ex: Claude 3.5 Sonnet com harness especializado, Devin, SWE-agent, Agentless): alcançam entre 38% e 53% no SWE-bench Verified.
- **Lição para o AutoAdapt:** O ciclo fechado de teste (executar `git diff` e rodar a suíte de testes do projeto) é o maior preditor de sucesso no benchmark. Agentes que testam ativamente superam agentes que geram código em passada única em mais de 10x.

### 2.2 HumanEval e HumanEval+
- **Origem / Autores:** OpenAI (Chen et al., 2021) / EvalPlus (Jiawei Liu et al.).
- **Escopo e Metodologia:** 164 problemas de geração de funções de programação com testes unitários em docstrings. O HumanEval+ expande drasticamente os testes com fuzzing e geradores de propriedades.
- **Métricas:** pass@1, pass@10. Modelos modernos de ponta atingem > 90% em pass@1.
- **Limitações:** Avalia apenas funções isoladas e algoritmos simples, não capturando refatoração multi-arquivo, manipulação de repositório, dependências ou navegação de terminal.
- **Lição para o AutoAdapt:** Útil como sanidade sintática e algorítmica, mas insuficiente como validação de engenharia de software autônoma.

### 2.3 GAIA (General AI Assistants)
- **Origem / Autores:** Meta FAIR, Hugging Face, AutoGPT (Mialon et al., 2023).
- **Escopo e Metodologia:** 466 tarefas de mundo real que requerem capacidades gerais: raciocínio multimodal, navegação na web, execução de ferramentas, inspeção de arquivos multiformato (PDF, planilhas, código).
- **Métricas:** Taxa de acerto binária (perguntas objetivas com resposta exata verificável).
- **Resultados:** Humanos atingem 92%, enquanto modelos autônomos puros ficam entre 30% e 45% nas tarefas de nível 3.
- **Lição para o AutoAdapt:** O rigor da resposta final depende da ausência de suposições tácitas; verificação de estado é obrigatória antes de declarar a tarefa pronta.

### 2.4 AgentBench e WebArena
- **Origem / Autores:** Tsinghua University (Liu et al., 2023) / CMU (Zhou et al., 2023).
- **Escopo e Metodologia:** Avalia agentes em ambientes interativos de sistema operacional (Bash/PowerShell), bancos de dados SQL, comércio eletrônico simulado e navegação web.
- **Lição para o AutoAdapt:** Ambientes de terminal reais exigem tolerância a falhas na captura de stdout/stderr e tratamento estrito de timeout de processos assíncronos.

### 2.5 Karpathy Autoregressive Self-Refinement & RLVR Loops
- **Origem / Princípios:** Arquitetura proposta por Andrej Karpathy e avanços em Reinforcement Learning with Verifiable Rewards (RLVR).
- **Escopo e Metodologia:** Loop de auto-aperfeiçoamento onde o agente gera uma solução candidata em branch/worktree isolado, executa um verificador determinístico (linter + compilador + testes) e, se a pontuação for superior ao baseline, incorpora a alteração. Caso contrário, faz rollback limpo e ajusta a estratégia.
- **Lição para o AutoAdapt:** Base teórica e prática para o isolamento em Git Worktrees implementado na camada M1 do AutoAdapt.

---

## 3. Matriz Comparativa de Benchmarks

| Benchmark | Domínio Principal | Escopo de Avaliação | Verificador Determinístico | Dificuldade Real | Relevância para o AutoAdapt |
|---|---|---|:---:|:---:|:---:|
| **SWE-bench (Verified)** | Engenharia de Software | Repositórios reais, multi-arquivo, git diff | Sim (Testes do Repo) | Muito Alta | **Crítica (10/10)** |
| **HumanEval+** | Algoritmos e Sintaxe | Funções isoladas | Sim (Unit tests estritos) | Média | **Média (6/10)** |
| **GAIA** | Assistente Geral / Tools | Multimodal, CLI, web, documentos | Sim (Ground truth exato) | Alta | **Alta (8/10)** |
| **AgentBench (OS/DB)** | Ambiente Operacional | Shell, banco de dados, OS | Sim (Estado do SO) | Alta | **Alta (8/10)** |
| **WebArena** | Navegação Web E2E | Tarefas em aplicações web completas | Sim (Validação DOM/DB) | Alta | **Média (5/10)** |

---

## 4. Comparativo de Arquiteturas de Agentes

| Arquitetura | Taxa de Resolução (SWE-bench) | Custo Médio por Tarefa | Tolerância a Falhas | Complexidade de Implementação |
|---|:---:|:---:|:---:|:---:|
| **Single-Turn Prompting** | < 4% | $0.05 | Quase Nula | Mínima |
| **ReAct Clássico (Iterativo)** | 15% - 25% | $0.80 - $2.50 | Moderada (Deriva de contexto) | Baixa |
| **Supervisor / Worker (Hierárquico)** | 35% - 48% | $1.50 - $4.00 | Alta (Isolamento de escopo) | Média |
| **Search-Based + Test Verification (Self-Healing)** | 45% - 55%+ | $2.00 - $6.00 | Máxima (Rollback em caso de quebra) | Média-Alta |

---

## 5. Diretrizes e Recomendações para o AutoAdapt

1. **Arquitetura Orientada a Verificadores (Verifier-Driven):**
   Adotar a metodologia comprovada pelo SWE-bench e RLVR: nenhum código é promovido sem validação por um verificador independente com saída binária (código 0).
2. **Isolamento via Git Worktree (Worktree Sandbox):**
   Garantir que os loops de self-improvement ocorram em cópias de trabalho dedicadas (como o worktree `ai-dev-hub-self-improvement`), eliminando o risco de colisão e rollback imperfeito.
3. **Mecanismo de Autocorreção Limitado (Self-Healing Debug Loop):**
   Permitir no máximo 5 iterações de autocorreção guiadas pela stacktrace do terminal antes de interromper e registrar o bloqueio, prevenindo loops infinitos e queima desnecessária de tokens.
4. **Preservação de Contexto Compacto:**
   Utilizar resumos estruturados persistentes (`.ai-dev-hub/session-summary.md` e `tasks.md`), evitando passar todo o histórico de conversas passadas na janela de contexto.
