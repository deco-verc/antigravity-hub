# Arquitetura e Especificações Oficiais do Projeto (DecoHUB Living Specs)
Consulte obrigatoriamente as especificações canônicas abaixo antes de modificar qualquer arquivo:
- Princípios e Invariantes: @.ai-dev-hub/specs/PRINCIPIOS.md
- Conteúdo, Seções e REA: @.ai-dev-hub/specs/CONTEUDO.md
- Design System e UI: @.ai-dev-hub/specs/DESIGN.md
- Contratos de Banco e API: @.ai-dev-hub/specs/BACKEND.md
- Jornadas de Teste e Homologação: @.ai-dev-hub/specs/JORNADAS.md


---

## ⚠️ REGRA CRÍTICA: EXECUÇÃO 100% SÍNCRONA NO ANTIGRAVITY IDE

### PROIBIDO: Encerrar turno com tarefa em segundo plano ("1 task running")

No Antigravity IDE, quando `run_command` ultrapassa `WaitMsBeforeAsync` e vai para
Background Task, **emitir uma resposta de texto final encerra o turno definitivamente**.
O Antigravity NÃO acorda o agente novamente após isso.

**NUNCA diga:** "Disparei os testes em segundo plano e trarei o resumo depois."

**SEMPRE:**
- `WaitMsBeforeAsync: 10000` para comandos de teste/build
- Passe arquivos explícitos: `npm --prefix server test -- test/foo.test.ts`
- Se for para background, chame `manage_task` `status` no mesmo turno antes de responder

### Armadilha `getResult(id, 0)` — Deadlock de 1500s (CORRIGIDO)

`AntigravityProvider.getResult` com `timeoutMs = 0` usava `Math.max(0, 1500000)`
tornando a chamada de probe em um loop de 25 minutos. Corrigido com:
```ts
const effectiveTimeoutMs = typeof timeoutMs === 'number' && !isNaN(timeoutMs)
  ? Math.max(0, timeoutMs) : 180000;
const allowHeartbeatExtension = effectiveTimeoutMs > 5000 && !AgentApiGateway.isOfflineMode();
```
