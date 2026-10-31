# ai-dev-hub.md — Regras do Workspace para Agentes Antigravity

## ⚠️ REGRA CRÍTICA: NUNCA ENCERRAR TURNO COM BACKGROUND TASK ATIVA

No Antigravity IDE, uma vez que você emite uma resposta de texto ao usuário,
o turno se encerra e o agente **não é acordado novamente automaticamente**,
mesmo que haja uma tarefa em segundo plano rodando.

### Protocolo Obrigatório para Comandos de Teste/Build

1. **`WaitMsBeforeAsync: 10000`** — sempre use 10s ou mais para `npm test` e `npm run build`.
2. **Argumentos explícitos** — nunca rode `npm test` sem `-- test/<arquivo>.test.ts`.
3. **Se for para background** — chame `manage_task` Action: `status` no mesmo turno.
4. **Nunca diga** "disparei em segundo plano, trarei o resumo depois".

### Comandos Corretos

```bash
# Teste específico (< 2s, 100% síncrono):
npm --prefix server test -- test/agentSessionManager.test.ts

# Múltiplos testes específicos:
npm --prefix server test -- test/agentSessionManager.test.ts test/nativeTurnRecovery.test.ts

# Build:
npm --prefix server run build

# Typecheck:
npm --prefix server run typecheck
```

### Armadilhas Conhecidas

| Armadilha | Causa | Solução |
|-----------|-------|---------|
| `npm test` roda 75+ arquivos | Script `"test"` original tinha lista fixa | Usar `npm test -- arquivo.ts` |
| `getResult(id, 0)` travava 25min | `Math.max(0, 1500000) = 1500000` | `effectiveTimeoutMs` + `allowHeartbeatExtension` |
| Turno encerrado com task ativa | Resposta de texto finaliza o turno no AGY IDE | Usar `manage_task status` antes de responder |
