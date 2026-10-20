# DecoHUB 1.0.6 — evolução do produto e aceite offline

A candidata 1.0.6 passou no fluxo normal do produto em ambiente offline isolado. Chat React/Electron, rotas HTTP, SQLite, Autonomous Runner, parser de transcript e Independent Evaluator executaram o código do produto. Supervisor e Worker externos foram substituídos por fixtures explícitas. Isso não constitui aprovação da integração nativa com Gemini nem autorização para instalar.

## Entrega

Branch: `codex/product-evolution`. Commit do código: `852abba9727210774b8ff26ebbe5fa433d477ffa`. Base anterior preservada: `d7fcd0f` (1.0.5). A instalação atual não foi substituída. A configuração do Antigravity foi mantida conforme a última instrução do usuário.

| Problema | Comportamento entregue | Evidência |
|---|---|---|
| Envio repetido ou resposta HTTP perdida | Identificador persistente por solicitação; mensagem única; resposta concluída pode ser recuperada; resultado incerto bloqueia reenvio | Regressão e duplo Enter + repetição da rota na interface empacotada |
| Instrução consumida antes de existir continuidade | Consumo e Run de destino na mesma transação; reutilização do destino após falha de planejamento | Regressão de falha e retomada sem novo planejamento |
| Cancelamento liberando uma operação ainda em execução | Pedido persistente; lease preservado até fronteira segura; turno ambíguo continua bloqueado | Regressões de reserva ativa e turno incerto |
| Verificador executando shell e herdando ambiente | Operações delimitadas, argumentos e caminhos validados, ambiente mínimo, cópia de verificação, permissões Node | Testes de shell, caminhos externos, subprocessos, escrita original e timeout |
| Verificação bloqueada provocando outro ciclo do agente | Run pausado; entrega em revisão preservada; Continuar reavalia a entrega, sem reenvio ao Worker | Runner real em regressão, zero chamadas ao modelo |
| Operação bloqueada apresentada como defeito reproduzido | Baseline bloqueada/interrompida não conta como teste executado ou reprodução do bug | Regressão específica |
| Backend indisponível durante avaliação | Avaliação normal assíncrona; prazo e saída limitados; execução registrada | Regressão do event loop e deadline |
| Revisão e reparo recebendo apenas feedback genérico | Critérios reprovados, comandos, arquivos e trecho limitado da saída independente | Código dos prompts e resultados persistidos do fluxo |
| Dependências compartilhadas reavaliadas repetidamente | Validação do DAG mantém nós visitados e detecta ciclos | Suíte do planejamento |
| Apresentação de tarefas e estados confusa | Plano real orienta contador; novas memórias não inventam trabalho pendente; conclusão e cancelamento explícitos; detalhes técnicos recolhidos | Capturas da interface e suíte |
| Integração remota criada implicitamente | GitHub opcional, desativado por padrão no novo projeto | Criação do projeto pela UI sem publicação |

## Aceite executado

- Suíte completa: **284/284**, zero falhas, zero testes ignorados.
- Barreira absoluta no servidor empacotado: **24/24**, inclusive terceira criação recusada antes da operação externa, reinício, expiração, resultados ambíguos e associação exata de runtime.
- Typecheck do backend e frontend: PASS. Builds: PASS.
- Electron **empacotado**: PASS. Projeto novo criado pela interface; Chat iniciou o Run; duas tarefas dependentes; código defeituoso realmente falhou em uma asserção independente; reparo passou; segunda tarefa passou; revisão e conclusão persistidas.
- Reinício durante a primeira tarefa: mesmo Run e mesmas sessões; resultado externo de teste reconciliado uma única vez; primeira tarefa recebeu somente uma implementação inicial e um reparo; segunda recebeu uma implementação.
- Segundo reinício após conclusão: nenhuma repetição das tarefas nem nova sessão de teste.
- Falta de autorização, autenticação expirada, plano inválido e provider desconectado apareceram como bloqueios na interface.
- Tela de tarefa nativa pendente foi verificada com um registro de teste explícito, sem interação com o Antigravity real.
- Integridade do pacote: 57 arquivos compilados do servidor e todos os assets do cliente iguais aos gerados pelo build. Scripts de teste e bancos não foram incluídos no pacote.

Run da prova pela interface: `f497bf11-389b-480a-8d9f-c8962c55c2b7`.
Projeto da prova: `7e1d1a78-c91e-4064-b849-ecb80f498d4d`.
Diretório: `C:\IA\DecoHUB-evolution-offline-20261009\decohub-electron-proof-VmEU2J\ui-created-project`.
Avaliações: **FAIL → PASS → PASS**. Sessões da prova têm prefixo `conv-fake-` e telemetria de origem TEST; nenhuma representa conversa real.

O teste de navegador anterior dependia de uma instalação de Chrome que recusou o perfil de depuração. O fixture agora utiliza o Chromium do Electron com perfil próprio, porta dinâmica e limpeza do processo que pertence ao teste. As asserções funcionais e adversariais foram mantidas. Dois fixtures que usavam `node -e` foram convertidos em arquivos locais com asserções reais, preservando o resultado FAIL esperado.

## Executor do produto

O executor está integrado ao Independent Evaluator; não depende do controlador externo de homologação. Aceita arquivos Node locais, Node Test e scripts npm que resolvam a uma operação suportada. Também resolve TypeScript local para typecheck/build. Não aceita instalação de pacotes, composição de shell, código inline, lifecycle npm, argumentos arbitrários, symlinks/hardlinks ou projeto que contenha o banco do controlador.

Executa uma cópia do código, sem modificar os originais; exclui Git, dependências da cópia e arquivos usuais de segredos. Dependências existentes são somente leitura. O ambiente não herda credenciais. Limites: 45 segundos na avaliação normal, 256 MiB de heap, saída de 2 MiB e inventário de até 10.000 entradas/50 MiB. Permite apenas comunicação local delimitada para testes em portas efêmeras do próprio processo. Registra argumentos, diretório, PID, tempo, saída, status e hashes.

**Limite técnico:** cópia, permissões Node e guarda de rede não equivalem a sandbox de segurança do sistema operacional. Não são prova de contenção contra código deliberadamente hostil. Ferramentas que precisam de recursos não permitidos, scripts compostos, subprocessos ou ferramentas não reconhecidas continuam bloqueadas para revisão. Builds Vite/ESBuild e suítes TSX não têm liberação genérica automática. O baseline síncrono legado permanece limitado a 30 segundos; a avaliação normal é assíncrona.

## Preservação e migrações

Nenhuma inferência ou criação física real ocorreu nesta etapa. A homologação original não foi usada nem copiada para os testes de desenvolvimento. O ledger foi consultado somente em leitura, com hash preservado:

`020071153bbd12870e7e5d9bbabac07f436510e70ef3ae14c2b78725657f3b9a`

- Supervisor real preservado: `5489a5ca-40ad-431a-bbd7-f9dcea2b28e5`.
- Worker real preservado: `d4cbb8f9-a415-4693-876c-2105fc517212`.
- Criações físicas: **2/2**, ambas CONFIRMED.
- Continuações históricas registradas: **3**. Novas nesta etapa: **0**. O limite de seis adicionais informado pelo usuário não foi consumido.
- Chamadas ativas e leases do ledger: **0**.
- FinanceFlow, AutoAdapt, banco de produção e 31 Runs históricos não receberam alterações.

As migrações adicionam somente `chat_submissions` e `run_control_requests`; não apagam Runs, Tasks ou sessões. Foram aplicadas nos bancos offline, não na produção. Eventos antigos de fila permanecem intactos e não passam a executar automaticamente pela atualização. Somente novos eventos de continuidade marcados pelo produto entram no despacho durável.

Backup criado apenas do banco da prova offline: `C:\IA\DecoHUB-evolution-offline-20261009/backups/offline-packaged-proof.db`. O banco original da prova e suas cópias de verificação foram preservados. Nenhum backup de produção foi necessário para esta etapa, pois a produção não foi migrada. Antes de uma instalação futura autorizada, preparar backup consistente do banco de produção. Reversão do código disponível pela base Git preservada; não remover tabelas ou registros para reverter.

## Artefatos e rastreabilidade

Instalador e portátil foram preparados, sem execução do instalador. O manifesto registra hashes completos dos executáveis, ASAR, logs e backup: `C:\IA\DecoHUB-evolution-offline-20261009/release-manifest-1.0.6.json`.

- `C:\IA\Antigravity HUB\ai-dev-hub\dist-desktop-1.0.6\DecoHUB Setup 1.0.6.exe` — SHA-256 `bf199fbd6d9d32d11131e507fb564a7841461689066c85f0c7f04c48cd13a4b1`.
- `C:\IA\Antigravity HUB\ai-dev-hub\dist-desktop-1.0.6\DecoHUB 1.0.6.exe` — SHA-256 `d4b8f807d5294d666d82688ca7d9436500e9dd7891a18c8218626ebfe34c5ac6`.
- `C:\IA\Antigravity HUB\ai-dev-hub\dist-desktop-1.0.6\win-unpacked\DecoHUB.exe` — SHA-256 `9cc343a117feb19be491734a92d89a68bddf5d682329260b51ea0eea1ccc1137`.
- `C:\IA\Antigravity HUB\ai-dev-hub\dist-desktop-1.0.6\win-unpacked\resources\app.asar` — SHA-256 `580cdf1b62ee931bc9437f4ad5535d8366c07eed0fb9f1f87e2937a12531c105`.

Evidência detalhada do Run: `C:\IA\DecoHUB-evolution-offline-20261009/normal-flow-evidence.json`.
Prova Electron: `C:\IA\DecoHUB-evolution-offline-20261009/electron-packaged/electron-sandbox.json`.
Capturas: `C:\IA\DecoHUB-evolution-offline-20261009/electron-packaged/`.
Logs completos, testes e integridade: `C:\IA\DecoHUB-evolution-offline-20261009/`.

## O que ainda exige comprovação nativa

As entregas reais anteriores do Supervisor e Worker continuam sendo as evidências da homologação original; nenhuma nova entrega Gemini foi obtida nesta etapa. O reparo da URL malformada da API original continua pendente de execução pelo mesmo Worker e de avaliação independente. Não foi feito reparo manual nesse projeto para substituir a entrega do agente.

A candidata passou no aceite offline do fluxo normal. Ainda falta comprovar a mesma sequência com AgentAPI real pelo Chat/Runner, na homologação preservada, incluindo autoria do reparo HTTP e revisão final. Não está operacionalmente aprovada para instalação.

A próxima etapa requer autorização específica para usar a candidata no teste nativo preservado, após reconciliação e validação de identidade, cobrança, runtime, ausência de concorrência e limite persistente. Plano limitado: Supervisor existente planeja o reparo; Worker existente implementa; Evaluator do produto executa verificações independentes; Supervisor revisa a tarefa e a conclusão. Caminho sem reparo adicional: até quatro continuações. Ramo corretivo: até seis no total. Zero novas conversas, sem alteração de conta/modelo, sem instalação e sem execução de projetos de produção. Qualquer resultado externo ambíguo interrompe a sequência.
