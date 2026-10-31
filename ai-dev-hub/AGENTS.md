# AGENTS.md — DecoHUB: Regras Obrigatórias para Agentes de IA

## ⚠️ REGRA CRÍTICA: EXECUÇÃO 100% SÍNCRONA NO ANTIGRAVITY IDE

### PROIBIDO: Encerrar turno com tarefa em segundo plano ("1 task running")

No Antigravity IDE, quando `run_command` ultrapassa `WaitMsBeforeAsync` e vai para
Background Task, **se você emitir uma resposta de texto final ao usuário, o seu turno
se encerra definitivamente**. O Antigravity NÃO acorda o agente novamente após o turno acabar.

**NUNCA faça:**
```
"Acabei de disparar os testes em segundo plano e trarei o resumo assim que finalizarem."
```
Isso é uma armadilha de Background Task Órfã — o agente nunca será acordado.

**SEMPRE faça:**
- Use `WaitMsBeforeAsync: 10000` (ou maior) no `run_command` para comandos de teste/build.
- Execute apenas o(s) arquivo(s) de teste afetados pela mudança, não a suíte completa.
- Se o comando for para background, use `manage_task` com `Action: status` no **mesmo turno**
  para aguardar a conclusão ANTES de responder ao usuário.

---

### EXECUÇÃO CORRETA DE TESTES (comandos rápidos, <10s)

```bash
# ✅ CORRETO — rodar apenas os arquivos afetados
npm --prefix server test -- test/agentSessionManager.test.ts test/nativeTurnRecovery.test.ts

# ✅ CORRETO — via node direto
node --import tsx --import ./test/testSetup.ts --test test/agentSessionManager.test.ts

# ❌ ERRADO — roda os 75+ testes e estoura o WaitMsBeforeAsync
npm --prefix server test
npm --prefix server run test:full
```

> **Por quê:** `npm --prefix server test` sem argumentos executa a suíte completa
> (75+ arquivos). Com a correção em `package.json`, quando você passa arquivos como
> argumentos (`npm test -- test/foo.test.ts`), apenas esses arquivos são executados,
> terminando em <2 segundos.

---

### ARMADILHA DO `nativeTurnRecovery.test.ts` (Deadlock de 1500s)

O teste em `server/test/nativeTurnRecovery.test.ts` chama:
```ts
await provider.getResult('pending-command', 0, project)
```
Com `timeoutMs = 0`. A versão antiga de `AntigravityProvider.getResult` usava
`Math.max(timeoutMs, 1500000)` — tornando `0` em 1500 segundos (25 min)!

**A correção em `antigravityProvider.ts` garante:**
- `timeoutMs = 0` → leitura imediata única, saída em 0ms (sem heartbeat, sem Quiet Window)
- `timeoutMs <= 5000` → `allowHeartbeatExtension = false`, sem extensão de teto
- Apenas `timeoutMs > 5000` com modo online → ativa heartbeat de até 1500s

---

## Arquitetura e Especificações Oficiais do Projeto (DecoHUB Living Specs)

Consulte obrigatoriamente as especificações canônicas abaixo antes de modificar qualquer arquivo:
- Princípios e Invariantes: `specs/PRINCIPIOS.md`
- Conteúdo, Seções e REA: `specs/CONTEUDO.md`
- Design System e UI: `specs/DESIGN.md`
- Contratos de Banco e API: `specs/BACKEND.md`
- Jornadas de Teste e Homologação: `specs/JORNADAS.md`
