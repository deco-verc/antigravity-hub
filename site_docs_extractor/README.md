# Site Docs Extractor

Aplicacao desktop local para extrair documentacao publica de sites e salvar o conteudo em Markdown.

## Instalacao Rapida

No Windows, use:

```bat
setup_windows.bat
```

Esse script cria `.venv`, instala `requirements.txt` e mostra uma mensagem final quando terminar.
Ele tambem instala o Chromium usado pelo Playwright, o que pode demorar alguns minutos.

Depois rode:

```bat
run_app.bat
```

## Instalar Manualmente

```bash
cd C:\Users\DECO\Documents\MarketingOS\site_docs_extractor
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install chromium
```

Se as dependencias ja estiverem instaladas no Python global, voce pode rodar direto sem criar o ambiente virtual.

## Rodar Com Python

```bash
python app.py
```

## Rodar Com run_app.bat

```bat
run_app.bat
```

O launcher entra na pasta do projeto, ativa `.venv` se existir e roda `python app.py`. Se acontecer erro, a janela fica aberta para leitura da mensagem.

## Atalho na Área de Trabalho

Para criar um atalho chamado `Site Docs Extractor.lnk` na Área de Trabalho do Windows, rode:

```bat
create_desktop_shortcut.bat
```

O script escolhe automaticamente o melhor destino:

- se existir `dist\SiteDocsExtractor\SiteDocsExtractor.exe`, o atalho aponta para o executável;
- se o executável não existir, o atalho aponta para `run_app.bat`.

A pasta inicial do atalho fica configurada como a pasta do projeto.

## Fluxo Recomendado

Para uso diário, siga este caminho:

1. Escolha um preset ou informe uma URL inicial manualmente.
2. Cole a URL inicial e revise o nome do projeto e o prefixo sugeridos automaticamente.
3. Rode primeiro sem Playwright, porque o fluxo padrão é mais leve e costuma bastar para documentação estática.
4. Se vier pouco conteúdo ou páginas vazias, marque `Usar navegador Playwright` e rode novamente.
5. Se vier muito menu, rodapé ou conteúdo repetido, use `CSS para remover`, `CSS para incluir` e filtros por termo.
6. Abra a última saída e use o arquivo `*_knowledge_ready.md` como principal arquivo para GPT, Claude Project, Codex ou bases de conhecimento.

## Nome E Prefixo Automaticos

Quando voce cola ou digita uma URL inicial, o app tenta preencher:

- `Nome do projeto`, usando dominio + parte relevante do path + `_docs`.
- `Prefixo permitido`, usando trechos comuns como `/docs/`, `/reference/`, `/pushinpay/` ou a primeira parte do path.

Exemplos:

```text
https://app.theneo.io/pushinpay/pix/pix -> app_theneo_io_pushinpay_docs | /pushinpay/
https://devs.pagniv.com/docs/ -> devs_pagniv_com_docs | /docs/
https://appmax.readme.io/reference/ -> appmax_readme_io_reference_docs | /reference/
https://integre.cashinpaybr.com/ -> integre_cashinpaybr_com_docs | prefixo vazio
```

Se voce editar manualmente o nome do projeto ou prefixo, o app evita sobrescrever esses campos enquanto voce continua ajustando a URL.

## Configuracoes Persistentes

O app salva automaticamente em `config.json` as ultimas configuracoes usadas:

- URL inicial, nome do projeto e prefixo.
- Maximo de paginas, delay e paths bloqueados.
- Preset selecionado e modo de extracao.
- Checkboxes de links e tabelas.

Ao abrir novamente, esses valores sao carregados na interface.

## Extracao Padrao

Use o modo `Documentacao padrao` para sites de documentacao publica.

Campos principais:

- URL inicial: pagina de onde a descoberta de links comeca.
- Nome do projeto: nome usado na pasta e nos arquivos gerados.
- Prefixo permitido: opcional, por exemplo `/pushinpay/`.
- Maximo de paginas: limite de URLs a descobrir e extrair.
- Delay entre paginas: pausa em segundos para evitar scraping agressivo.
- Paths bloqueados extras: separados por virgula.
- Termos obrigatorios: separados por virgula; mantem apenas paginas cujo texto contenha pelo menos um termo.
- Termos bloqueados: separados por virgula; paginas com esses termos sao marcadas como ignoradas.
- CSS para incluir: seletores CSS simples, separados por virgula; tenta extrair apenas esses blocos antes do trafilatura.
- CSS para remover: seletores CSS simples, separados por virgula; remove esses elementos antes do trafilatura.
- URLs manuais: uma URL por linha; quando preenchido, o app ignora o crawler e extrai exatamente essa lista.
- Ignorar prefixo para URLs manuais: permite extrair URLs manuais do mesmo dominio sem aplicar o prefixo permitido.
- Incluir links no Markdown: preserva links extraidos pelo trafilatura.
- Incluir tabelas: preserva tabelas quando a extracao conseguir identifica-las.
- Usar navegador Playwright: opcional; carrega cada pagina em Chromium headless antes da extracao.
- Limpar ruido do Markdown: remove repeticoes e textos comuns de menu antes de salvar.

O botao `Cancelar extracao` interrompe a execucao de forma limpa. A pagina atual pode terminar antes do cancelamento ser aplicado, e os arquivos ja gerados sao preservados.

O app tenta novamente ate 2 vezes em falhas de request, com pausa de 1 segundo entre tentativas. As tentativas aparecem no log da execucao.

## URLs Manuais

Use `URLs manuais` quando o site nao expoe todas as rotas internas no HTML inicial. Isso e comum em:

- documentacoes SPA;
- sites que carregam menu por JavaScript;
- documentacoes que renderizam a navegacao depois do carregamento;
- casos como `https://devs.pagniv.com/docs/`, em que Playwright pode renderizar a pagina, mas o crawler ainda encontra apenas a rota inicial.

Cole uma URL por linha. Linhas vazias sao ignoradas. URLs invalidas ficam registradas no index, no relatorio e no log como ignoradas.

Quando o campo tem URLs, o app:

- nao chama a descoberta automatica;
- registra `Modo URLs manuais ativado` no log;
- respeita o mesmo dominio da URL inicial;
- aplica o prefixo permitido, a menos que `Ignorar prefixo para URLs manuais` esteja marcado;
- continua aplicando Playwright, limpeza, filtros CSS e filtros por termo normalmente.

Exemplo:

```text
https://devs.pagniv.com/docs/
https://devs.pagniv.com/docs/authentication
https://devs.pagniv.com/docs/webhooks
```

## Filtros Por Termo

Use `Termos obrigatorios` quando voce quer manter somente paginas que mencionem assuntos especificos. Exemplo:

```text
pix, webhook, authorization
```

Se esse campo for preenchido, uma pagina so sera salva se o texto extraido contiver pelo menos um termo.

Use `Termos bloqueados` para ignorar paginas que contenham palavras indesejadas, como:

```text
login, checkout, billing
```

Paginas filtradas por termo aparecem no index como `ignored` e tambem no `extraction_report.md`.

## Filtros CSS

Use `CSS para remover` para tirar menus, banners ou rodapes antes da extracao:

```text
nav, footer, .sidebar, .cookie-banner
```

Use `CSS para incluir` quando o conteudo principal esta em um bloco conhecido:

```text
main, article, .docs-content
```

Esses filtros sao opcionais e seguros: seletores invalidos sao ignorados. Use CSS apenas quando a extracao vier com ruido claro ou quando voce souber onde o conteudo fica no HTML.

## Limpeza De Markdown

A opcao `Limpar ruido do Markdown` vem marcada por padrao. Ela aplica uma limpeza conservadora que:

- remove linhas repetidas;
- reduz excesso de linhas em branco;
- remove menus comuns quando aparecem como texto;
- remove pequenos blocos repetitivos;
- preserva titulos, listas, tabelas e links.

Desmarque essa opcao quando quiser preservar o Markdown cru produzido pelo trafilatura.

## Deduplicacao Global

A opcao `Remover textos repetidos entre paginas` vem marcada por padrao e atua principalmente no `*_knowledge_ready.md`.

Diferença prática:

- `Limpar ruido do Markdown` limpa cada página individualmente.
- `Remover textos repetidos entre paginas` compara todas as páginas e remove blocos comuns que aparecem em 4 páginas ou mais, mantendo a primeira ocorrência.

Essa deduplicação evita repetir textos de navegação, chamadas como `Was this section helpful?`, `On this page`, `Previous`, `Next`, `Edit this page`, `Copy` e blocos comuns de rodapé. Ela preserva código, JSON, tabelas, endpoints, URLs, headers e linhas técnicas.

O `extraction_report.md` mostra se a deduplicação estava ligada, quantos blocos duplicados foram encontrados, quantas repetições foram removidas e quantas páginas foram afetadas.

## Modo Playwright

Por padrao, o app usa `requests`, BeautifulSoup e trafilatura. Esse modo e mais leve e deve ser a primeira escolha.

Marque `Usar navegador Playwright` quando o site renderizar conteudo via JavaScript e o modo padrao retornar pouco conteudo. Com essa opcao ligada:

- a descoberta de links continua usando o crawler atual;
- a extracao de cada pagina abre Chromium headless;
- o HTML renderizado e capturado com `page.content()`;
- o HTML capturado e enviado para o trafilatura.

Se aparecer erro de Chromium ausente, rode:

```bash
python -m playwright install chromium
```

Durante a execucao, o log mostra quando o modo Playwright esta ativo, quando o navegador abre, qual URL esta carregando, quando o HTML e capturado e quando o browser fecha.

## Presets

Os presets ficam em `presets.json` e podem ser editados pela interface no botao `Editar presets`.

Cada preset pode salvar:

- nome;
- URL;
- projeto;
- prefixo;
- modo;
- uso de Playwright;
- limpeza de Markdown.

O seletor `Preset` preenche automaticamente URL, projeto, prefixo e essas opcoes:

- Pushinpay: `https://app.theneo.io/pushinpay/pix/pix`, projeto `pushinpay_docs`, prefixo `/pushinpay/`.
- PagNiv: `https://devs.pagniv.com/docs/`, projeto `pagniv_docs`, prefixo `/docs/`.
- CashinpayBR: `https://integre.cashinpaybr.com/`, projeto `cashinpaybr_docs`, sem prefixo.
- Appmax: `https://appmax.readme.io/reference/`, projeto `appmax_docs`, prefixo `/reference/`.
- Custom: limpa os campos para configuracao manual.

## Livro Dos Sonhos

Use o modo `Livro dos Sonhos A-Z` para extrair automaticamente as letras A ate Z a partir do padrao:

```text
https://www.ojogodobicho.com/sonhos-letra-{letra}.htm
```

A saida fica em:

```text
outputs/
  livro_dos_sonhos/
    pages/
      sonhos_letra_a.md
      sonhos_letra_b.md
      ...
    livro_dos_sonhos_completo.md
    livro_dos_sonhos_index.json
    run_config.json
    extraction_log.txt
```

Esse modo usa uma heuristica propria para remover menus, rodapes, anuncios e textos de navegacao, sem misturar a logica com o crawler generico.

## Saida Da Extracao Padrao

Cada execucao padrao cria uma pasta dentro de `outputs/`. Se o nome ja existir, o app cria um sufixo automatico como `_001`.

```text
outputs/
  pushinpay_docs/
    pages/
      pagina_1.md
      pagina_2.md
    pushinpay_docs_completo.md
    pushinpay_docs_knowledge_ready.md
    pushinpay_docs_index.json
    extraction_report.md
    run_config.json
    extraction_log.txt
```

O arquivo de indice registra URL, status, arquivo, quantidade de caracteres e erro quando houver.

As paginas individuais usam nomes derivados do path da URL quando possivel, por exemplo `docs_api_reference.md`. Se houver repeticao, o app adiciona sufixos como `_002`.

## Arquivo Completo Vs Knowledge Ready

Use `*_completo.md` quando quiser uma copia mais fiel da extracao, incluindo separadores e frontmatter das paginas.

Use `*_knowledge_ready.md` quando quiser colar o conteudo em GPT, Claude Project, Codex ou uma base de conhecimento. Ele inclui:

- titulo claro;
- indice simples das paginas;
- `Source URL` por secao;
- frontmatter duplicado removido;
- limpeza extra de ruido.

## Relatorio De Qualidade

Toda extracao padrao gera `extraction_report.md` com:

- total de URLs encontradas;
- paginas extraidas;
- falhas;
- paginas muito curtas;
- paginas muito longas;
- paginas ignoradas por termo;
- paginas candidatas a Playwright;
- prefixo usado;
- termos usados;
- CSS usado;
- top 10 paginas por tamanho;
- URLs que falharam;
- recomendacao geral, como `extracao boa`, `extracao parcial`, `talvez usar Playwright` ou `talvez ajustar prefixo`.

## Historico

Cada execucao concluida ou cancelada adiciona uma entrada em:

```text
outputs/extraction_history.json
```

O historico registra data/hora, modo, projeto, URL inicial, pasta de saida, total encontrado, sucessos, falhas e se foi cancelado.

Na interface:

- `Histórico` abre uma janela simples com as ultimas execucoes.
- `Abrir última saída` abre a pasta da ultima execucao registrada.
- `Abrir pasta de saída` abre a pasta de saida atual, ou `outputs/` quando nenhuma execucao foi feita na sessao.
- `Preview` mostra o inicio do `knowledge_ready`; se ele nao existir, mostra o arquivo completo.
- `Reprocessar` recria o arquivo completo, o `knowledge_ready` e o `extraction_report` a partir de `pages/`, sem acessar a internet.

## Testes

Os testes usam `unittest` e nao dependem de internet.

```bash
cd C:\Users\DECO\Documents\MarketingOS\site_docs_extractor
python -m unittest discover -s tests
```

## Criar Executavel

Para gerar um executavel local com PyInstaller:

```bat
build_exe.bat
```

O script:

- ativa `.venv` se existir;
- instala `pyinstaller` se necessario;
- gera o app em modo `onedir`;
- inclui `config.json` e `presets.json`;
- cria a pasta `outputs` ao lado do executavel.

Ao terminar, o executavel fica em:

```text
dist\SiteDocsExtractor\SiteDocsExtractor.exe
```

Nesta fase isso nao cria instalador final. Para distribuir, copie a pasta inteira `dist\SiteDocsExtractor`, nao apenas o `.exe`.

### Playwright No Executavel

O executavel com Playwright pode ficar maior e pode exigir que o Chromium esteja instalado no ambiente. Nesta fase, o modo recomendado para testar Playwright e rodar com Python:

```bash
python app.py
```

Depois instale o browser:

```bash
python -m playwright install chromium
```

O `build_exe.bat` nao tenta embutir os browsers do Playwright para evitar um build grande e instavel.

## Limitacoes Atuais

- Playwright e opcional; sites JavaScript podem exigir esse modo para retornar conteudo util.
- O build com PyInstaller nao empacota browsers do Playwright.
- O crawler respeita o dominio da URL inicial e ignora arquivos estaticos como imagens, PDFs e ZIPs.
- Falhas em paginas individuais sao registradas no indice e no log, sem interromper a execucao.

## Quando Usar Playwright

Use Playwright quando o site depender fortemente de JavaScript para renderizar menus, conteudo ou rotas internas. Evite quando HTML estatico, `requests`, BeautifulSoup e trafilatura ja forem suficientes, porque navegador automatizado aumenta peso, tempo de execucao e complexidade de empacotamento.
