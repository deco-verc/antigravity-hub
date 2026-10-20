# DecoHUB 1.0.5 — automação delimitada da homologação

O executor local foi implementado e testado. A continuação com modelos permanece bloqueada por divergência de permissões do Antigravity. Nenhuma chamada adicional ou criação física foi feita.

## Execução automática preparada

`scripts/native-preflight/qa-safe-executor.cjs` aceita exclusivamente `npm test`, `node --test` e `node --test test/<arquivo>.test.cjs`, na pasta QA fixa. `npm test` é resolvido para o script comprovado `node --test`, com os arquivos enumerados e argumentos adicionais de proteção; não executa lifecycle scripts do npm ou comandos arbitrários.

- Copia o projeto existente e verifica hashes antes/depois. Os arquivos do Worker não são reparados pelo controlador.
- Recusa diretórios diferentes, comandos compostos, argumentos extras, scripts de lifecycle, dependências, hard links e links/reparse points encontrados.
- Valida o código executável e seus módulos antes de executar. Código com acesso de runtime não revisado é bloqueado.
- Usa `shell: false`, ambiente mínimo sem credenciais, permissões Node com escrita/processos arbitrários/worker threads/addons negados e rede limitada aos servidores loopback criados nessa execução.
- O teste independente protegido pode solicitar somente seu processo HTTP fixo. O executor inicia esse processo com as mesmas restrições e encerra apenas processos que criou.
- Limita tempo e saída; registra comandos solicitados/efetivos, hashes, resultados e origem. Lock exclusivo não expira automaticamente; encerramento ambíguo mantém o bloqueio.

O modelo de permissões do Node e as verificações de rede são defesa em profundidade para código revisado. **Não constituem isolamento de sistema operacional contra código malicioso.** Não há Docker/Podman disponível e WSL não está instalado; nada foi instalado. Código que exceda a política exige revisão antes de execução.

`qa-verification-bridge.cjs` conecta esse executor às verificações do IndependentEvaluator do pacote 1.0.5 no sandbox. O Chat, Runner, planejamento, tarefas, revisões e conclusão continuam pertencendo ao produto. Essa preparação externa da homologação não é uma funcionalidade distribuída adicional nem prova de execução nativa completa.

`offline-product-jobs.cjs` executa somente os jobs fixos `test`, `typecheck` e `build` do código revisado do DecoHUB. Usa dados temporários isolados, bloqueia processos AgentAPI e evita herdar credenciais e configurações globais do Git. Esses jobs são separados do executor de código QA; builds não são liberados no terminal do Worker.

## Permissões: fatos e limite da investigação

Runtime Google Pro 1: Language Server 19616, processo pai Antigravity 20896. Projeto único identificado: `40c0f5fe-4585-4ad5-ade5-879a36e0b316`, DecoHUB Native QA, somente `C:\IA\DecoHUB-native-sandbox-20261009\project`.

O JSON oficial desse projeto continua em `AGENT_SETTING_POLICY_ALLOW` e `CASCADE_COMMANDS_AUTO_EXECUTION_EAGER`, com data de modificação 09/10/2026 18:44:44. A configuração global também registra ALLOW/EAGER e liberações de terminal/MCP. Não há um segundo projeto QA com a mesma pasta. Não se atribuiu à interface uma causa não observada: o motivo exato da diferença visual ainda não foi comprovado.

A documentação oficial distingue configurações gerais e por projeto. Projetos herdam permissões globais, e Deny prevalece sobre Ask/Allow. O AgentAPI instalado oferece metadata/new-conversation/send-message, sem operação documentada de edição das configurações do projeto. A documentação de edição direta de `settings.json` pertence ao CLI e não comprova um mecanismo equivalente para editar o JSON do aplicativo Windows. Não houve escrita nesses JSONs nem troca de autenticação.

O controle de interface nativa não está disponível nesta sessão. Portanto, a correção suportada das permissões persistidas depende de uma única interação na interface oficial. Nenhuma aprovação manual foi contornada.

## Ação única necessária na interface oficial

Na mesma instância da conta Google Pro 1: **Settings → Projects → DecoHUB Native QA**. Conferir a pasta acima. Em Agent Settings/Custom:

1. Outside of folders file access policy: **Deny / Always Deny**.
2. Terminal Command Auto Execution: **Require Review / Request Review**.
3. Em permissões **do projeto**, lista **Deny**: `command(*)` e `mcp(*)`.
4. Fechar e reabrir o painel desse projeto e conferir que os valores persistiram. Não alterar General, outras contas, projetos ou regras globais.

Os dois Deny adicionais impedem que permissões globais liberem terminal ou MCP no Worker. O Worker fará somente edições com as ferramentas de arquivo. Os testes serão executados pelo Evaluator local autorizado, sem aprovação repetitiva de terminal do Antigravity. Outras operações que ainda demandem aprovação não serão automaticamente aprovadas.

Se essas opções ou listas não aparecerem nesse projeto, não substituí-las por Turbo, Always Proceed ou edição manual de metadados. É necessário informar a diferença observada.

Depois da correção, confirmar novamente conta `aldxmir.s2@gmail.com`, Google AI Pro, Overages desativado e ausência de agentes. A evidência humana de identidade/créditos não é prova automática de OAuth nem garantia absoluta de cobrança.

`reconcile-native-policy-binding.cjs` está preparado para atualizar somente o hash da prova de vínculo no SQLite isolado, após restauração oficial das políticas: exige evidência fresca, duas sessões correspondentes, turnos DONE, ausência de chamadas/controladores/Run e mesma pasta/conta/modelos/ID nativo. Não modifica o Antigravity, sessões ou ledger; registra a transação. Regressões cobrem alterações inseguras e estado ambíguo. Não foi aplicado ao sandbox enquanto a política estiver divergente.

## Validação executada

- Suíte completa do produto: **275/275**.
- Regressões de barreira, runtime, reconciliação, sequência e executor: **46/46**.
- Typecheck e build: **PASS**.
- Pacote 1.0.5: 54 módulos do servidor e 55 arquivos do instalador comparados, sem divergência; nenhum fixture empacotado. Instalador não executado.
- Electron 1.0.5: guarda carregada, banco temporário isolado, nenhuma chamada; encerramento controlado do backend criado para o teste. **Offline somente**.
- Evaluator real do pacote, com execução local controlada e banco de avaliação separado: rejeitou a API existente. **Integração offline do Evaluator, não um Run nativo**.
- Código QA atual: **22/23**; todos os 13 testes da calculadora e os seis testes originais da API passam. A avaliação independente confirma `ERR_INVALID_URL` ao receber `http://[` e queda do servidor. O defeito permanece para reparo pelo mesmo Worker.

Evidências em `C:\IA\DecoHUB-native-sandbox-20261009\logs\safe-executor`, `logs\finish-1.0.5`, `logs\packaging-integrity-1.0.5.json` e `logs\full-system-qa\final-readonly-evidence.json`.

O pacote 1.0.5 permanece byte a byte compatível com os módulos principais atuais; não foi gerada versão desnecessária. A automação QA permanece fora do pacote. Não houve instalação, alteração de produção, execução de FinanceFlow/AutoAdapt, remoção de sessões ou limpeza de Runs.

## Continuação autorizada pendente

As duas conversas físicas permanecem em **2/2**, com três continuações históricas confirmadas e **seis restantes**. Após satisfazer as condições, enviar o prompt preparado uma única vez pelo Chat normal. Sequência: Supervisor planeja uma tarefa; Worker repara a URL sem terminal; Evaluator executa testes/avaliação; Supervisor revisa a tarefa e a conclusão. Quatro continuações se aprovado. Um único ramo corretivo autorizado pode usar mais duas, totalizando seis. Nenhuma criação, rotação de conta/modelo ou replanejamento adicional é permitido.

**Não pronto para instalação:** a API ainda falha no teste adversarial e o fluxo real Chat → Runner → Supervisor → Worker → Evaluator → conclusão ainda não foi demonstrado.

Fontes oficiais consultadas: [Agent settings](https://www.antigravity.google/docs/agent-settings), [Settings](https://www.antigravity.google/docs/settings), [Projects](https://www.antigravity.google/docs/projects), [Permissions](https://www.antigravity.google/docs/permissions), [Node permissions](https://nodejs.org/docs/latest-v24.x/api/permissions.html).
