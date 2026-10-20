# Changelog

## 1.0.0-local

### Fase 1
- Criado app desktop local com CustomTkinter.
- Separada a lógica em crawler, extractor, exporter e utils.
- Geração de páginas Markdown, arquivo completo, index, configuração da execução e log.

### Fase 2
- Adicionado cancelamento cooperativo.
- Melhorados logs de UI e validação de campos.
- Adicionados presets rápidos e modo especial Livro dos Sonhos A-Z.

### Fase 3
- Persistência de configurações em `config.json`.
- Histórico de extrações em `outputs/extraction_history.json`.
- Botões para histórico e abrir última saída.
- Retry simples para falhas de request.
- Nomes de arquivos mais legíveis e testes básicos.

### Fase 4
- Adicionados `run_app.bat`, `setup_windows.bat` e `build_exe.bat`.
- Documentado empacotamento local com PyInstaller.
- Revisados pontos de estabilidade para Windows.

### Fase 5
- Adicionado suporte opcional a Playwright.
- Criado `extractor/browser_extractor.py`.
- Mantido fluxo padrão com requests, BeautifulSoup e trafilatura.

### Fase 6
- Criado limpador conservador de Markdown.
- Gerado arquivo `*_knowledge_ready.md`.
- Gerado `extraction_report.md`.
- Adicionados Preview e Reprocessar última saída.

### Fase 7
- Adicionados filtros por termos obrigatórios e bloqueados.
- Adicionados filtros CSS simples para incluir/remover blocos.
- Migrados presets para `presets.json` editável pela UI.
- Relatório de qualidade expandido.

### Fase 8
- Padronizados labels principais da UI.
- Melhoradas mensagens para `config.json`, `presets.json`, saída ausente e reprocessamento sem `pages/`.
- Incluído `presets.json` no build com PyInstaller.
- Criados `VERSION`, `CHANGELOG.md` e `RELEASE_CHECKLIST.md`.
- Adicionada seção de fluxo recomendado ao README.
