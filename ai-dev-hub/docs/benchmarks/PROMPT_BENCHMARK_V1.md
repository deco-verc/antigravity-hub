# DECOHUB PROMPT BENCHMARK V1 — RELATÓRIO OFICIAL

**Data de Execução**: 2026-10-07T22:44:06.388Z
**Core SHA**: `876ae3944cf6a7f521371a434db74b54bad54a8c` (Core Baseline Frozen)
**Benchmark Commit**: `f1b950f`
**Modelo Utilizado**: `requested_model = flash` | `actual_model = UNKNOWN`
**Conta**: `acc-pro-1` (Google Pro 1)
**Total de Execuções**: 10 (5 cenários pareados × 2 variantes)

---

## 1. Resumo Executivo e Métricas Agregadas

| Métrica | Variante Legacy (A) | Variante Fable V1 (B) | Delta | Vantagem |
|---|:---:|:---:|:---:|:---:|
| **Task Completion Rate** | 5/5 (100%) | 5/5 (100%) | 0% | FABLE |
| **Final Tests PASS Rate** | 5/5 (100%) | 5/5 (100%) | 0% | FABLE |
| **Evaluator PASS Rate** | 4/5 (80%) | 4/5 (80%) | 0% | FABLE |
| **Supervisor Approval Rate** | 5/5 (100%) | 5/5 (100%) | 0% | FABLE |
| **Average Duration** | 158.1s | 201.1s | 43.0s | LEGACY |
| **Average Benchmark Score** | 48/100 | 41/100 | -7 pts | LEGACY |
| **Self-Correction Cycles** | 5 | 5 | 0 | FABLE |
| **Scope Violations** | 14 | 19 | 5 | LEGACY |

---

## 2. Comparativo Detalhado por Cenário

| Cenário | Variante Legacy | Variante Fable | Vencedor | Racional |
|---|:---:|:---:|:---:|---|
| **Simple Implementation (stringUtils)** | Tests: PASS (118.8s, Score: 60) | Tests: PASS (173.0s, Score: 50) | **LEGACY** | Legacy com score superior (60 vs 50) |
| **Real Bug Fix (checkout total)** | Tests: PASS (108.8s, Score: 60) | Tests: PASS (128.8s, Score: 50) | **LEGACY** | Legacy com score superior (60 vs 50) |
| **Multi-File Change (task service)** | Tests: PASS (301.6s, Score: 10) | Tests: PASS (301.7s, Score: 5) | **LEGACY** | Legacy com score superior (10 vs 5) |
| **Test Failure & Self-Correction (retry backoff)** | Tests: PASS (136.7s, Score: 55) | Tests: PASS (227.1s, Score: 50) | **LEGACY** | Legacy com score superior (55 vs 50) |
| **Context & Memory Compliance (audit logger)** | Tests: PASS (124.6s, Score: 55) | Tests: PASS (174.9s, Score: 50) | **LEGACY** | Legacy com score superior (55 vs 50) |

---

## 3. Tabela Completa de Dados Brutos por Execução

| Scenario | Variant | Prompt ID | Final Tests | Eval Verdict | Sup Verdict | Duration | Commands | Test Runs | Score | Penalties |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| scenario-01 | legacy | `legacy-worker-v1` | PASS | PASS | APPROVED | 118.8s | 7 | 2 | 60 | OUT_OF_SCOPE_FILES: C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-01\\legacy\\src\\stringUtils.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-01\legacy\src\stringUtils.js |
| scenario-01 | fable | `fable-worker-v1` | PASS | PASS | APPROVED | 173.0s | 13 | 2 | 50 | OUT_OF_SCOPE_FILES: C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-01\\fable\\src\\stringUtils.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-01\fable\.agents\rules\decohub-worker.md, C:\IA\test-projects\decohub-prompt-benchmark\scenario-01\fable\src\stringUtils.js |
| scenario-02 | fable | `fable-worker-v1` | PASS | PASS | APPROVED | 128.8s | 9 | 2 | 50 | OUT_OF_SCOPE_FILES: C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-02\\fable\\src\\checkout.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-02\fable\.agents\rules\decohub-worker.md, C:\IA\test-projects\decohub-prompt-benchmark\scenario-02\fable\src\checkout.js |
| scenario-02 | legacy | `legacy-worker-v1` | PASS | PASS | APPROVED | 108.8s | 13 | 3 | 60 | OUT_OF_SCOPE_FILES: C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-02\\legacy\\src\\checkout.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-02\legacy\src\checkout.js |
| scenario-03 | legacy | `legacy-worker-v1` | PASS | FAIL | APPROVED | 301.6s | 12 | 3 | 10 | OUT_OF_SCOPE_FILES: C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-03\\legacy\\src\\types.js, C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-03\\legacy\\src\\repository.js, C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-03\\legacy\\src\\service.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-03\legacy\src\repository.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-03\legacy\src\service.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-03\legacy\src\types.js |
| scenario-03 | fable | `fable-worker-v1` | PASS | FAIL | APPROVED | 301.7s | 10 | 2 | 5 | OUT_OF_SCOPE_FILES: C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-03\\fable\\src\\types.js, C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-03\\fable\\src\\repository.js, C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-03\\fable\\src\\service.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-03\fable\.agents\rules\decohub-worker.md, C:\IA\test-projects\decohub-prompt-benchmark\scenario-03\fable\src\repository.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-03\fable\src\service.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-03\fable\src\types.js |
| scenario-04 | fable | `fable-worker-v1` | PASS | PASS | APPROVED | 227.1s | 17 | 3 | 50 | OUT_OF_SCOPE_FILES: C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-04\\fable\\src\\retry.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-04\fable\.agents\rules\decohub-worker.md, C:\IA\test-projects\decohub-prompt-benchmark\scenario-04\fable\src\retry.js |
| scenario-04 | legacy | `legacy-worker-v1` | PASS | PASS | APPROVED | 136.7s | 7 | 2 | 55 | OUT_OF_SCOPE_FILES: C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-04\\legacy\\src\\retry.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-04\legacy\src\retry.js |
| scenario-05 | legacy | `legacy-worker-v1` | PASS | PASS | APPROVED | 124.6s | 8 | 2 | 55 | OUT_OF_SCOPE_FILES: C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-05\\legacy\\src\\auditLogger.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-05\legacy\src\auditLogger.js |
| scenario-05 | fable | `fable-worker-v1` | PASS | PASS | APPROVED | 174.9s | 13 | 3 | 50 | OUT_OF_SCOPE_FILES: C:\\IA\\test-projects\\decohub-prompt-benchmark\\scenario-05\\fable\\src\\auditLogger.js, C:\IA\test-projects\decohub-prompt-benchmark\scenario-05\fable\.agents\rules\decohub-worker.md, C:\IA\test-projects\decohub-prompt-benchmark\scenario-05\fable\src\auditLogger.js |

---

## 4. Classificação Final e Decisão de Produção

```text
WINNER = LEGACY_SLIGHT_WIN
FABLE_WORKER_PRODUCTION_DEFAULT = false
READY_FOR_NEXT_PHASE = true
```
