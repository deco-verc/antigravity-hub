# Lições Operacionais Aprendidas (Memória Autônoma)

> Registro estruturado de causas-raiz confirmadas, estratégias que falharam e reparos validados em produção.

### [EM ABERTO] [SUPERVISOR_REVIEW/PLANNING_GAP] Revisão reprovada em "Implementar motor de transações e cálculo de saldo em src/financeEngine.cjs" (Tentativa 1/3)
- **Causa-raiz confirmada:** REWORK_REQUIRED: A função withdraw não valida saldo insuficiente (INSUFFICIENT_FUNDS) e a função transfer não valida amount <= 0.
- **Estratégia que falhou (EVITAR):** Implementação sem cobertura suficiente
- **Ocorrências:** 3 | **Atualizado em:** 2026-10-16T18:51:15.008Z
