# Release Checklist

Use este checklist antes de considerar uma versão local pronta.

- [ ] Rodar `python -m compileall site_docs_extractor`
- [ ] Rodar `python -m unittest discover -s tests`
- [ ] Abrir o app com `python app.py`
- [ ] Abrir o app com `run_app.bat`
- [ ] Testar extração curta com `https://example.com/`, `max_pages=1`, `delay=0`
- [ ] Verificar criação de `pages/`
- [ ] Verificar criação de `*_completo.md`
- [ ] Verificar criação de `*_knowledge_ready.md`
- [ ] Verificar criação de `extraction_report.md`
- [ ] Verificar criação de `*_index.json`
- [ ] Verificar criação de `run_config.json`
- [ ] Verificar criação de `extraction_log.txt`
- [ ] Testar `Preview`
- [ ] Testar `Reprocessar`
- [ ] Testar `Histórico`
- [ ] Testar preset editável
- [ ] Testar `Abrir última saída`
- [ ] Rodar `build_exe.bat`
- [ ] Abrir `dist\SiteDocsExtractor\SiteDocsExtractor.exe`
- [ ] Verificar que `config.json` e `presets.json` existem ao lado do executável
- [ ] Verificar que novos outputs não sobrescrevem outputs antigos
