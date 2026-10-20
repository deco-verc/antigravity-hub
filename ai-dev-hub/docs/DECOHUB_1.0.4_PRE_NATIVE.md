# DecoHUB 1.0.4 — preparação da homologação

Relatório de entrega: `C:/IA/DecoHUB-native-sandbox-20261009/ENTREGA_1.0.4_PRE_NATIVE.md`.

Build posterior ao 1.0.3, sem instalação e sem alterar a instalação atual. Seletor exato incorporado ao bundle; NativeWorkspaceBinding valida projeto oficial, pasta única exata, perfil, acesso externo negado e revisão de comandos. Nenhuma tarefa nativa usa fallback outside-of-project. O ID nativo é persistido nas sessões; configurações ou vínculos diferentes exigem reconciliação.

266 testes offline completos, 28 testes de barreira/isolamento contra o pacote e Electron em sandbox passaram. Instalador extraído sem execução, arquivos críticos conferidos. O contador persistente original permanece 0/2, sem reset e sem respostas de modelo reais.

Pendências reais: o backend 1.0.2 ainda referencia run-state-beta como busy; suspensão não foi autorizada nem executada. O projeto temporário ainda precisa ser associado pela interface oficial. A ajuda local oferece somente níveis pro/flash/flash_lite: variantes exatas não estão comprovadas. ModelRegistry declara explicitamente essa limitação. Documentação oficial: https://antigravity.google/docs/sidecars/ e https://antigravity.google/docs/projects/.

Os 31 running e seus dados foram preservados; nenhum AutoAdapt/FinanceFlow foi executado ou alterado. READY_FOR_LIVE_TEST permanece BLOCKED e aprovação operacional depende da homologação nativa futura autorizada.
