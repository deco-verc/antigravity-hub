# Pré-flight nativo 1.0.3 — preparação offline

Atualização posterior: o seletor foi corrigido no código principal, com correspondência completa de diretórios normalizados, processo principal/Language Server únicos e redescoberta sem cache. 41 regressões do backend e 24 testes do limite passaram. O sandbox carrega os dois módulos compilados corrigidos como complemento auditado ao backend 1.0.3 original, preservado sem instalação e sem reset das reservas.

O usuário confirmou conta aldxmir.s2@gmail.com, Google AI Pro, créditos extras desativados e modelos individuais na interface. Isso é evidência humana, não prova automática de OAuth/cobrança. Os 31 running foram classificados como 24 históricos órfãos do AutoAdapt e 7 fixtures; run-state-beta ainda é referenciado por um controlador legado vivo com heartbeat busy. Nenhum estado de produção foi alterado.

Relatório atual: `C:/IA/DecoHUB-native-sandbox-20261009/ATUALIZACAO_PREFLIGHT_RUNTIME.md`. Bloqueios restantes: scheduler legado concorrente, workspace nativo outside-of-project sem vínculo da pasta temporária e equivalência dos aliases pro/flash às variantes da conta não comprovada. READY_FOR_LIVE_AUTHORIZATION permanece BLOCKED. O texto abaixo registra a etapa inicial.

O relatório completo desta etapa está em `C:/IA/DecoHUB-native-sandbox-20261009/RESULTADO_PREFLIGHT.md`.

Sandbox offline preparado com projeto separado, banco novo, guarda adicional persistente e limite absoluto de duas criações, sem alterar o artefato 1.0.3. 23 testes focados passaram; zero inferências e zero conversas reais. O backend empacotado iniciou e encerrou offline sem fixture de provider instalado. Preparação repetida não reseta o contador.

Implementação adicional: `scripts/native-preflight/`. `prepare.cjs` preserva sandbox existente; `launch-offline.cjs` força offline; `ledger.cjs` persiste reservas antes da fronteira externa; `guard.cjs` instrumenta gateway/processos e bloqueia alterações de autenticação/conta. O código original empacotado não foi modificado e não existe launcher nativo autorizado.

Comandos de validação offline:

```powershell
node --test scripts/native-preflight/offline.test.cjs
node scripts/native-preflight/prepare.cjs
node scripts/native-preflight/smoke-offline.cjs
node scripts/native-preflight/inspect.cjs
```

Homologação real = BLOCKED: identidade autenticada, política de créditos efetiva, modelos/quotas, ausência de tarefas concorrentes e workspace nativo ainda exigem evidência. Conta 02 não tem runtime próprio ativo. Os metadados mostram diretórios/arquivos distintos; último login igual não comprova vazamento nem autenticação. Existem 31 runs históricos/atuais cadastrados como running; não foram modificados. Casos extremos do seletor original de runtime falham por substring/aspas/múltiplos candidatos; a guarda do sandbox exige caminho exato e runtime único, bloqueando discrepâncias.

Esta etapa não concede autorização para inferência, instalação, exclusão de conversas, AutoAdapt, alteração do FinanceFlow ou mudanças financeiras/autenticação.
