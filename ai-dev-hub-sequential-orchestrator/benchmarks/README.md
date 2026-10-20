# AI DEV FIXED BENCHMARK SUITE (FASE 6)

Este diretório contém a suíte oficial e imutável de benchmarks do **AI DEV HUB**.

## 🎯 Objetivo
Responder de forma reproduzível e científica à pergunta:
> *"Esta versão do AI DEV programa melhor que a anterior?"*

## 📁 Estrutura de Cada Benchmark
Cada benchmark possui:
- `briefing`: Instrução ou prompt recebido pelo agente
- `project_seed`: Código inicial do projeto
- `success_contract`: Critérios de aceitação e passos de verificação
- `protected_tests`: Testes unitários imutáveis (Golden Evaluator)
- `expected_behavior`: Comportamento funcional esperado
- `time_limit`: Tempo máximo de execução
- `risk_level`: Nível de risco da tarefa
- `category`: Categoria técnica avaliada

## 📊 Categorias Avaliadas (10 Categorias Oficiais)
1. `BUG_FIX`: Correção de defeito existente sem alterar testes
2. `FEATURE`: Implementação de funcionalidade nova com testes estritos
3. `FRONTEND`: Renderização visual e semântica de componentes
4. `BACKEND`: Middlewares, rate limiters e lógica de servidor
5. `REFACTOR`: Simplificação de código idiomático mantendo compatibilidade
6. `PERFORMANCE`: Otimização de complexidade algorítmica (ex: O(N²) para O(1))
7. `TESTING`: Validação de limites numéricos e casos de borda
8. `CODE_UNDERSTANDING`: Introspecção e entendimento de contratos legados
9. `CONTEXT_CONTINUITY`: Continuação de tarefa a partir de checkpoint prévio
10. `MULTI_FILE_CHANGE`: Coordenação cirúrgica entre múltiplos arquivos

## 🔒 Golden Evaluator & Holdouts
- 8 Benchmarks Públicos de Desenvolvimento (usados em iterações normais)
- 4 Benchmarks Holdout Protegidos (usados para validar generalização e impedir overfitting)
- **Regra de Ouro:** O agente **NÃO pode alterar** os arquivos de testes protegidos nem a definição do benchmark. Tentativas de adulteração resultam em desqualificação imediata (*TAMPERING_DETECTED / FAIL*).
