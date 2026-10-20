# DecoHUB — resultado da homologação e entrega 1.0.5

2026-10-09. **Instalação bloqueada.** As entregas reais do Worker existem, mas a API falhou em um teste adversarial ampliado. A revisão final real do Supervisor e o fluxo nativo pela interface normal não foram executados nesta etapa. Nenhuma nova inferência ou conversa física foi realizada.

## Resultado por requisito

| Requisito | Resultado | Evidência e alcance |
|---|---|---|
| SUPERVISOR_REAL | BLOCKED | Planejamento real anterior confirmado; transcript termina em DONE, passo 1. Revisão final ainda não realizada. |
| WORKER_REAL | PASS | Calculadora corrigida e API produzidas na mesma sessão real. Último turno: DONE, passo 57, sem ferramentas pendentes no último evento. Isto comprova execução real, não aprovação integral da API. |
| EVALUATOR_REAL | PASS | Evaluator empacotado 1.0.4 executou comandos reais contra a entrega. Evaluator empacotado 1.0.5 rejeitou a verificação HTTP ampliada com FAIL, exit 1 e taskIsDone=false. |
| API_HTTP | FAIL | Quatro operações, entradas inválidas, divisão por zero, overflow e limites passaram. Requisição com alvo `http://[` causa ERR_INVALID_URL não tratado e encerra o servidor. |
| NATIVE_SESSION_REUSE | PASS | Mesmos dois IDs; três continuações confirmadas no histórico do ledger; nenhuma chamada real adicional nesta etapa. |
| NORMAL_CHAT_FLOW | BLOCKED | React/Electron reais passaram offline. Na base nativa há zero Autonomous Runs e zero Tasks: nenhum resultado do controlador externo foi apresentado como execução nativa do Chat. |
| AUTONOMOUS_RUNNER | BLOCKED | Pipeline, falha, reparo e conclusão passaram com respostas de modelo simuladas. Uso nativo do scheduler segue não testado. |
| TASK_ORCHESTRATION | BLOCKED | Persistência, dependências, avaliação e revisão passaram offline; ainda falta comprovação nativa pelo produto. |
| ERROR_RECOVERY | PASS | Offline: turno pendente não vira tarefa pronta; DONE tardio é recuperado sem reenviar implementação; evidência sobrevive a processo novo; outro proprietário ativo impede reconciliação. Validação nativa destas correções: NOT_TESTED. |
| FRONTEND_ELECTRON | PASS | Pacotes 1.0.4 e 1.0.5: Chat, Tarefas, Atividade, erros e reinício com mesmo Run e sessões. Zero RPCs reais. |
| ACCOUNT_RUNTIME_ISOLATION | PASS | Google Pro 1 vinculado ao diretório padrão exato; Language Server 19616 associado ao Antigravity 20896. Identidade da conta/plano/créditos: confirmação humana anterior, não prova automática de OAuth ou cobrança. |
| NEW_PHYSICAL_CONVERSATIONS | PASS | Zero adicionais; reservas permanentes 2/2, ambas CONFIRMED. Nenhum reset, exclusão ou renovação do limite. |
| OFFLINE_TESTS | PASS | 275/275 testes do produto, 30 suites; 28/28 testes da barreira/isolamento contra o pacote 1.0.5; typechecks e builds aprovados. |
| LIVE_TESTS | FAIL | Entrega real existente reavaliada; nova falha HTTP comprovada. Nenhum novo turno enviado. Homologação nativa completa permanece BLOCKED. |
| BUGS_FIXED | PASS | Correções no produto descritas abaixo e cobertas por regressões. A falha da API entregue pelo Worker permanece pendente. |
| REMAINING_BLOCKERS | BLOCKED | Permissões ALLOW/EAGER incompatíveis com a guarda; reparo real da API; revisão final; teste nativo pelo Chat/scheduler; reconfirmação humana antes de novas chamadas. |
| READY_FOR_INSTALLATION | BLOCKED | Build preparado e verificado, sem instalação. Aprovação operacional depende dos testes nativos pendentes. |

## Evidências reais da entrega

Supervisor: `5489a5ca-40ad-431a-bbd7-f9dcea2b28e5`, nível `pro`.

Worker: `d4cbb8f9-a415-4693-876c-2105fc517212`, nível `flash`.

Os metadados das sessões mantêm `acc-pro-1` e o projeto nativo `40c0f5fe-4585-4ad5-ade5-879a36e0b316`. As preferências persistidas do sandbox também são Supervisor=pro e Builder=flash. Nenhuma variante comercial exata é presumida.

`npm test` usa `node --test` e passou 19/19 testes: 13 da calculadora e 6 da API. A suíte independente da calculadora passou 3.567 verificações; a verificação original passou 1.681 combinações. O teste HTTP independente inicial passou 18 verificações. O teste ampliado passou nove verificações e falhou na décima, identificando uma exceção não tratada.

O sinal de -0 é preservado pelo módulo matemático e foi comparado com JavaScript. No transporte HTTP, `JSON.stringify` serializa -0 como 0. Não se afirma preservação do sinal no JSON numérico recebido pelo cliente.

O inventário SHA256 capturado antes do turno da API atribui somente `src/server.cjs` e `test/server.test.cjs` a essa entrega. `BRIEFING.md`, `package.json` e os arquivos da calculadora preexistiam e ficaram inalterados nesse turno. Os sete hashes atuais continuam iguais aos da avaliação. Nenhum arquivo produzido pelo Worker foi corrigido manualmente pelo controlador.

Reprodução independente da falha: iniciar a fábrica `createServer()` em processo temporário separado, enviar `GET http://[`, observar ECONNRESET e encerramento do processo com exit 1. A origem é `src/server.cjs:9`, onde `new URL(req.url, ...)` fica fora de tratamento de erro. O Evaluator 1.0.5 registrou FAIL; a API não está concluída para homologação.

## Correções incorporadas ao produto

1. Seletor de runtime exige correspondência exata dos diretórios normalizados e associação inequívoca entre processo principal e Language Server. Vínculo nativo exige pasta, perfil, ID e permissões esperados, sem fallback para outro projeto.
2. Inventário de arquivos e posição inicial do transcript persistem antes de send-message. Arquivos preexistentes inalterados não são atribuídos ao Worker. Junctions/symlinks são recusados na captura e descoberta de testes.
3. DONE com ferramenta pendente continua em execução. Timeout ou resposta externa ambígua preserva estado e reserva; não autoriza novo despacho. Quota/autenticação impedem conclusão.
4. Aprovação nativa pendente mantém tarefa e leases protegidas. O watchdog não devolve a tarefa para READY por simples expiração. Retomar consome apenas um resultado concluído e verificável, com avaliação independente, sem novo send-message ao Worker.
5. A avaliação passa a persistir no relatório recuperado. A regressão reproduziu a perda dessa evidência, que antes provocava rejeição e trabalho duplicado. A migração foi testada em banco antigo isolado, preservando seus registros.
6. `node --test test` e `node --test tests/` são convertidos em lista explícita de arquivos reais. Diretório vazio não resulta em aprovação. Falhas dos testes permanecem falhas.
7. Heartbeat informa atividade efetiva; a interface explica turno nativo pendente. Os prompts do produto respeitam Require Review e Deny, removendo a orientação de ignorar aprovações humanas.
8. Capturas da suíte operacional usam diretório temporário próprio, em vez de escrever em uma conversa Antigravity preexistente.

Regressões: `server/test/nativeTurnRecovery.test.ts`, `recoverySafety.test.ts`, `runtimeProfileSelector.test.ts`, `nativeWorkspaceBinding.test.ts` e testes do ledger. Não houve refatoração geral nem alteração no projeto entregue pelo Worker.

## Isolamento e bloqueios

PID legado 19248 ausente, porta 3001 livre e nenhum processo DecoHUB remanescente ao encerrar os testes próprios. Produção foi aberta somente para leitura: 31 Runs continuam running, sem leases ou Workers ativos. FinanceFlow, AutoAdapt, banco de produção e sessões existentes foram preservados.

Sandbox nativo: `C:/IA/DecoHUB-native-sandbox-20261009/data/hub.db`; projeto: `C:/IA/DecoHUB-native-sandbox-20261009/project`; ledger: `control/control.sqlite`. Nenhuma chamada ativa ou lease de backend permanece no ledger. O bloqueio NATIVE_TURN_AMBIGUOUS foi preservado: há evidência de DONE, mas a guarda não foi reaberta com permissões incompatíveis.

O projeto oficial tem somente a pasta correta, porém os metadados atuais são `AGENT_SETTING_POLICY_ALLOW` e `CASCADE_COMMANDS_AUTO_EXECUTION_EAGER`. Uma pasta vinculada não restringe acesso externo quando a política é ALLOW. Essas configurações foram mantidas conforme solicitado; a guarda continua exigindo Deny e Require Review.

Para permitir retomada, no projeto **DecoHUB Native QA**, abrir configurações de segurança, usar **Custom**, selecionar **Outside of folders file access policy → Deny** e **Terminal Command Auto Execution → Require Review**, mantendo somente project/. Depois confirmar conta aldxmir.s2@gmail.com / Google AI Pro, Overages desativado e ausência de agentes ativos. Nenhuma configuração financeira ou de autenticação foi alterada automaticamente. A confirmação humana não constitui garantia absoluta de cobrança nem prova automática de OAuth.

O limite de continuações existente também foi preservado: teto total de nove send-message, três já registrados, seis restantes. Não existe Run nativo antigo para simplesmente retomar na interface. Um futuro teste deve caber nesse orçamento; não se deve concluir primeiro por controlador externo e depois iniciar outro ciclo completo sem contabilizar todas as chamadas.

Plano futuro proposto, **não iniciado**: após validar permissões, conta e reconciliação auditável, testar um único Run pela interface real com uma tarefa de reparo da API existente. Planejar com o mesmo Supervisor, corrigir com o mesmo Worker, executar avaliação independente de ambas as entregas e solicitar revisão/conclusão ao Supervisor. Previsão de quatro send-message: planejamento, reparo, revisão e aceitação final. Não reenviar a calculadora nem a implementação HTTP já concluída; apenas o defeito factual. Aprovações de terminal continuam manuais. Qualquer plano inesperado, nova criação, quota ou resultado ambíguo interrompe o procedimento. As correções novas devem ser homologadas no build 1.0.5 em sandbox mediante autorização específica; o sandbox nativo original ainda aponta para 1.0.4.

## Build e arquivos de evidência

Build 1.0.5 preparado em diretório separado, preservando 1.0.4 e a instalação atual. O instalador foi extraído e conferido sem executá-lo: 54 arquivos do servidor e app.asar comparados, nenhuma divergência e nenhuma fixture de testes empacotada.

Instalador: `C:/IA/Antigravity HUB/ai-dev-hub/dist-desktop-1.0.5/DecoHUB Setup 1.0.5.exe`.

SHA256: `3656ef31c16c3dc4b70a6ccfccd1da5c088cea0ca21ecd27ab647e5e01595a59`.

Portable: `C:/IA/Antigravity HUB/ai-dev-hub/dist-desktop-1.0.5/DecoHUB 1.0.5.exe`.

SHA256: `245c4bcebc42f49c8cd91a197947b1d3ee9ab5ce84668e97f3ce3589fefe7077`.

Evidências em `C:/IA/DecoHUB-native-sandbox-20261009/logs/full-system-qa/`:

- `npm-test.json`, `calculator-adversarial.json`, `original-adversarial.json`, `http-adversarial.json`, `http-extended.json`.
- `packaged-1.0.4-http-evaluation.json` e `packaged-1.0.5-extended-http-evaluation.json` distinguem aprovação inicial e rejeição ampliada.
- `full-offline-tests.log`, `absolute-cap-regressions.log`, `typecheck.log`, `build.log` e `packaging-build.log`.
- `electron-1.0.4/electron-sandbox.json` e `electron-1.0.5/electron-sandbox.json`, com capturas de Chat, Tarefas, Atividade e reinício. Respostas dos modelos explicitamente simuladas; zero conversas reais.
- `final-readonly-evidence.json`, `legacy-backend-final.json` e `../packaging-integrity-1.0.5.json`.

Novo checkpoint de entrega e reparo pendente em `control/http-delivery-checkpoint.json`; checkpoint anterior preservado. Nenhum desses arquivos libera inferência ou modifica o contador.
