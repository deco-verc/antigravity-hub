# REA (Reverse Engineer Anything) Engine & CLI Reference

O pacote `rea-agents` (`https://github.com/morluto/rea`) é a suíte de engenharia reversa estática e dinâmica para inspeção profunda de aplicações web, binários, runtimes JavaScript e ecossistemas corporativos.

## Comandos Principais do CLI REA
- `rea recover-javascript-sources <bundlePath> <outputDir>`: Decompila e recupera módulos JavaScript legíveis com proveniência de código e estrutura de arquivos.
- `rea trace-javascript-semantics <inputJson>`: Rastreia relações semânticas estáticas entre views, stores de estado, rotas e manipuladores de evento.
- `rea inspect-web-page <cdpEndpoint> <targetId>`: Inspeciona passivamente a árvore DOM, layout, listeners e recursos via Chrome DevTools Protocol.
- `rea inspect-sqlite-database <dbPath>`: Mapeia schemas, tabelas, índices e dados persistidos de snapshots locais.
- `rea inspect-web-network-capture <harPath> <format>`: Inspeciona tráfego HTTP/REST, payloads e contratos de API de capturas de rede.
- `rea --llms-full`: Exibe o manifesto completo de capacidades legíveis por modelos de IA.

## Modo de Operação no DecoHUB
O DecoHUB utiliza o `ReaSaaSMasterService` como camada de orquestração:
1. **Cache-First & Offline Resilience**: Blueprints consolidados de arquiteturas líderes (Linear, Stripe, Notion, Cal.com) são pré-extraídos e armazenados em `DOCSIMP/rea-blueprints/`.
2. **Inspeção Sob Demanda**: Quando uma URL ou bundle local de referência é fornecido no briefing, o `ReaSaaSMasterService` invoca `rea` para extrair árvore de componentes, modelos e fluxos de interação, salvando a descoberta em cache.
3. **Injeção de Síntese de Alta Densidade**: O dossiê completo é gravado no projeto (`.ai-dev-hub/rea-blueprint.md`), enquanto uma síntese arquitetural compacta (~1.200 caracteres) é injetada no prompt dos agentes, respeitando os limites de caracteres do CLI (`clampPromptForCli` < 28.000 chars).
