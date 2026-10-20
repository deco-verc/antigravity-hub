# DecoHUB 1.0.5 — continuação preparada, sem reiniciar a homologação

2026-10-09. **Homologação nativa ainda BLOCKED; instalação não aprovada.** Nenhuma chamada real ou conversa nova foi criada nesta etapa.

## Estado reconciliado

- Supervisor `5489a5ca-40ad-431a-bbd7-f9dcea2b28e5`: DONE, passo 1; nível pro.
- Worker `d4cbb8f9-a415-4693-876c-2105fc517212`: DONE, passo 57; nível flash.
- Ambos ACTIVE no mesmo projeto e perfil `acc-pro-1`, associados ao ID nativo `40c0f5fe-4585-4ad5-ade5-879a36e0b316`.
- Duas reservas CONFIRMED, três continuações CONFIRMED, nenhuma chamada ativa ou lease de backend. Restam seis continuações.
- O congelamento NATIVE_TURN_AMBIGUOUS foi reconciliado em transação auditável, somente após confirmar DONE e recibos externos não ambíguos. Reservas, envios, IDs, âncora, triggers e histórico foram preservados. Nenhuma autorização de inferência foi emitida.
- Banco de produção aberto somente para leitura: 31 Runs históricos preservados; fingerprint anterior inalterado. FinanceFlow e AutoAdapt não executados nem alterados.

Reconciliar o congelamento não libera o teste: as verificações de autorização específica, permissões, identidade, créditos e runtime continuam obrigatórias antes das chamadas.

## Funcionamento real já comprovado

O Supervisor planejou anteriormente as entregas; o Worker corrigiu a calculadora e escreveu a API na mesma sessão. A calculadora continua com 13/13 testes aprovados. Os seis testes originais da API também passam, mas não cobriam a URL malformada. O Evaluator real executou comandos locais contra os arquivos reais e detectou FAIL na avaliação ampliada.

A implementação original do Worker permanece inalterada. Sua API ainda derruba o processo em `src/server.cjs:9` ao receber `GET http://[`. O reparo ainda não foi enviado.

## Preparação independente e resultados offline

Foi acrescentado **pelo controlador**, antes do próximo turno, `project/test/controller-http-acceptance.test.cjs`. Ele não é atribuído ao Worker. Reproduz a exceção real em um subprocesso e exige HTTP 400 seguido de /health 200. Também verifica operações, entradas inválidas, overflow, bytes de corpo em Content-Length/streaming, rotas, métodos e JSON numérico. Não altera os arquivos previamente entregues.

Baseline atual: npm test encontra 23 testes, 22 passam e um falha na URL malformada. Os testes existentes não foram modificados. A aceitação independente ficará protegida por hash no contrato do Runner e na guarda de continuação.

Em uma **cópia temporária do mesmo sandbox**, o Electron 1.0.5 foi testado com os dois IDs e registros de sessão copiados. Somente respostas de modelo, edição da API e aprovação terminal foram simuladas. Chat, rotas, criação do Run, tarefa, Runner, parser, inventário, SQLite, Evaluator e execução npm test foram os do produto empacotado.

Resultado: PASS, um Run, uma tarefa, quatro mensagens simuladas, zero criações. A tarefa aguardou ferramenta, o backend reiniciou e o botão normal de retomada recuperou DONE sem reenviar o Worker. O Evaluator executou os testes reais na cópia e aprovou o reparo simulado. Apenas src/server.cjs foi atribuído à alteração; o teste preparado pelo controlador e arquivos preexistentes ficaram excluídos da produção do Worker. Os IDs e metadados das sessões foram preservados.

Esta prova é **offline**, não demonstra execução Gemini pela interface. Não foi criado Run nativo no sandbox original; ele continua sem Runs/Tasks normais.

## Inicialização segura do pacote

O Electron empacotado ignora NODE_OPTIONS para carregar a guarda. Essa tentativa foi reproduzida e recusada antes de qualquer inferência. Nenhum fuse, instalador ou arquivo distribuído foi alterado.

Foi validado o suporte existente de conexão a backend do mesmo banco e modo: iniciar `index.js` do pacote 1.0.5 com a guarda explicitamente carregada e conectar o Electron 1.0.5 a esse serviço. Planejamento, despacho e avaliação continuam no código normal do produto; o iniciador não implementa um controlador de tarefas nem envia prompts aos agentes.

O teste desse bootstrap passou offline, sem fixture de modelos e sem prompt. Confirmou guarda ativa, banco correto, duas reservas, três continuações, zero Runs, perfis preservados e encerramento seguro do backend próprio com liberação de sua lease. A instalação atual permaneceu intacta.

Manifesto preparado: `control/native-normal-1.0.5.json`. Prompt preparado: `control/normal-chat-prompt-1.0.5.txt`. Iniciador: `scripts/launch_native_normal.mjs`; sem `--authorized-start` ele somente informa que nada foi iniciado. A inicialização real exige autorização específica e prova humana atual em live-approval.json. O manifesto anterior 1.0.4 permanece como registro histórico; o candidato usa exatamente o pacote 1.0.5, sem overlay no produto distribuído.

Não houve nova alteração no código distribuído 1.0.5, portanto não foi gerada outra versão nem repetido o build. Seu SHA256 continua `3656ef31c16c3dc4b70a6ccfccd1da5c088cea0ca21ecd27ab647e5e01595a59`. Os 275 testes completos anteriores permanecem evidência dessa mesma versão. Nesta preparação passaram mais 36 regressões direcionadas da barreira, reconciliação, isolamento e sequência limitada, além dos dois testes Electron específicos descritos acima.

## Plano exato de chamadas reais — ainda não autorizado

Enviar **uma vez** o prompt preparado no Chat normal do projeto existente. Nenhuma calculadora ou API será reimplementada. O Supervisor deve produzir somente uma tarefa de reparo de URL, com verificationCommand npm test. Qualquer outro plano bloqueia o Worker antes de uma chamada externa.

| Chamada | Sessão existente | Ação |
|---|---|---|
| 1 | Supervisor / pro | Planejar uma única tarefa de reparo da API existente. |
| 2 | Worker / flash | Corrigir a exceção, preservando código e testes protegidos; aguardar aprovações manuais de terminal. |
| — | Evaluator local | Executar npm test/aceitação independente contra os arquivos reais, conferir hashes e atribuição. Não consome continuação. |
| 3 | Supervisor / pro | Revisar a tarefa com avaliação independente persistida. |
| 4, se aprovado | Supervisor / pro | Aceitação final das duas entregas existentes e conclusão do Run. |

Caso a chamada 3 peça uma correção factual, a chamada 4 será o único reparo adicional pelo mesmo Worker; chamada 5 será a segunda revisão; chamada 6 será a aceitação final, somente com PASS. Nesse caso não há outra continuação disponível. Sem aprovação específica para esse ramo, serão usadas somente as quatro chamadas do caminho aprovado de primeira. Quota, autenticação, criação inesperada, mudança de runtime, arquivo protegido modificado, resultado ambíguo ou plano fora do escopo interrompem o fluxo. Nenhuma sétima continuação ou terceira criação será permitida. Esperas por aprovação não implicam reenvio da tarefa.

## Bloqueios que dependem do usuário

Os metadados oficiais continuam ALLOW/EAGER. Para retomar, no projeto **DecoHUB Native QA**, selecionar **Security Preset → Custom**, **Outside of folders file access policy → Deny** e **Terminal Command Auto Execution → Require Review**, mantendo somente project/. A guarda não será flexibilizada.

Confirmar na mesma janela **aldxmir.s2@gmail.com / Google AI Pro**, **AI Credit Overages desativado** e **nenhum agente trabalhando**. Esta é evidência humana, não comprovação automática de OAuth nem garantia absoluta de cobrança. A validade de confirmação não será renovada silenciosamente durante esperas longas.

Depois dessa confirmação e da validação dos metadados, autorizar especificamente o Run normal 1.0.5 descrito acima, incluindo ou recusando o ramo corretivo que usa as seis chamadas. Nada real será enviado antes disso.

## Evidências e decisão

`C:/IA/DecoHUB-native-sandbox-20261009/logs/finish-1.0.5/`: `calculator-13.log`, `api-original-6.log`, `npm-test-baseline.log`, `http-independent-baseline.log`, `safety-regressions.log`, `existing-session-adoption-offline.json`, `adoption-native-wait.png`, `adoption-completed.png` e `native-normal-guard-smoke.json`.

Reconciliação: `control/reconciliation-1.0.5.json` e evento COMPLETED_NATIVE_TURN_RECONCILED no ledger original. Prepared files não constituem autorização de inferência.

READY_FOR_INSTALLATION = **BLOCKED**. Falta o reparo real, os testes independentes aprovados, a revisão final real e a comprovação do fluxo pelo Chat/Runner nativos. A preparação permite avançar dentro das restrições sem começar outro projeto ou recriar sessões.
