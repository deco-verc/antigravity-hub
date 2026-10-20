# AUDITORIA DA DISTRIBUIÇÃO ATUAL, EMPACOTAMENTO E ATUALIZAÇÃO AUTOMÁTICA
**Data:** 11 de Outubro de 2026  
**Ambiente:** DecoHUB v1.0.7 (`C:\IA\Antigravity HUB\ai-dev-hub`)  
**Base de Dados:** `C:\Users\Deco\.ai-dev-hub\hub.db`  

---

## 1. Mecanismo de Empacotamento Atual (Electron)

- **Empacotador:** `electron-builder` (`v26.15.3`) com `electron` (`v44.5.1`).
- **Arquivos de Configuração:**
  - `package.json` raiz (seção `"build"`):
    - `appId`: `com.aidev.hub`
    - `productName`: `DecoHUB`
    - `directories.output`: `dist-desktop`
    - `win.target`: `["nsis", "portable"]`
    - `win.icon`: `desktop/assets/icon.png`
    - `nsis.oneClick`: `true`
    - `nsis.perMachine`: `false` (instalação per-user no Windows)
    - `nsis.createDesktopShortcut`: `true`
    - `nsis.createStartMenuShortcut`: `true`
    - `nsis.shortcutName`: `DecoHUB`
    - `asar`: `true`
    - `asarUnpack`: `["server/**/*", "client/**/*"]`
- **Scripts de Distribuição:**
  - `npm run build`: Compila servidor (`tsc`) e cliente (`vite build`).
  - `npm run desktop:build`: Executa `npm run build` e empacota com `electron-builder --win`.
  - `npm run desktop:dist`: Executa `npm run build` e empacota instalador NSIS e executável portable.

---

## 2. Requisitos de Execução e Arquitetura em Produção

O DecoHUB instalado opera com um modelo de dois processos acoplados e supervisionados:
1. **Processo Principal Electron (`desktop/main.cjs`):**
   - Cria janelas gráficas (`splashWindow` e `mainWindow`).
   - Gerencia bandeja do sistema (`tray.cjs`) e encerramento seguro (`safeShutdown`).
   - Monitora limites de tela e preferências do usuário em `config.json`.
2. **Processo Filho Backend Node.js (`desktop/serviceManager.cjs`):**
   - Disparado a partir de `process.execPath` (o próprio binário do Electron) utilizando a variável de ambiente `ELECTRON_RUN_AS_NODE: '1'`.
   - Executa `server/dist/index.js` descompactado de `app.asar.unpacked/server/`.
   - Serve a API REST e os WebSockets na porta `3001` (com alocação dinâmica em caso de conflito).
   - Serve estaticamente o frontend compilado do React a partir de `app.asar.unpacked/client/dist/`.
   - Conecta-se diretamente ao banco de dados SQLite nativo `hub.db` via `node:sqlite` (`DatabaseSync`).

---

## 3. Localização dos Dados e Garantia de Preservação

- **Diretório de Instalação dos Binários:**
  - `%LOCALAPPDATA%\Programs\ai-dev-hub-root\` (contém `DecoHUB.exe`, `resources/app.asar`, bibliotecas Chromium).
- **Diretório de Dados Persistentes do Usuário:**
  - `C:\Users\Deco\.ai-dev-hub\` (gerenciado por [appDataPaths.cjs](file:///c:/IA/Antigravity%20HUB/ai-dev-hub/desktop/appDataPaths.cjs)).
  - Contém:
    - `hub.db`: Banco SQLite com todo o histórico de Runs, tarefas, relatórios, revisões, avaliações e perfis.
    - `config.json`: Preferências do usuário (portas, minimização, contas).
    - `profiles/`: Perfis de autenticação do Google Antigravity.
    - `logs/`: Logs de auditoria e observabilidade.
- **Isolamento e Segurança:**
  - O desinstalador NSIS (`Uninstall DecoHUB.exe`) opera estritamente dentro da pasta do executável em `%LOCALAPPDATA%\Programs\ai-dev-hub-root\`.
  - As atualizações e reinstalações sobrescrevem apenas os binários da aplicação, **preservando integralmente `C:\Users\Deco\.ai-dev-hub\`**.

---

## 4. Estado Atual do Canal de Releases e Auto-Update

- **Repositório Remoto:** Atualmente `git remote -v` está vazio (nenhum upstream ou remote configurado).
- **Canal de Releases:** Nenhuma URL pública ou chave `publish` do GitHub Releases está definida no `electron-builder`.
- **Mecanismo de Atualização Atual:**
  - Não existia implementação de auto-update em `desktop/main.cjs` ou no backend.
  - A versão em `desktop/main.cjs` continha valor fixo (`'1.0.0'`) desincronizado do `package.json` (`1.0.7`).

---

## 5. Análise de Riscos de Atualização com Backend em Execução

1. **Bloqueio de Arquivos no Windows (`EBUSY` / `Access Denied`):**
   - Se o instalador tentar substituir `DecoHUB.exe` ou arquivos em `app.asar.unpacked/` enquanto o processo Electron ou o backend Node.js estiverem em execução, o sistema operacional Windows bloqueia a escrita, corrompendo a instalação.
2. **Interrupção de Tarefas Autônomas:**
   - Se uma atualização for forçada durante um turno de Worker ativo ou durante a compilação de um projeto, a lease expira e o estado pode entrar em inconsistência.
3. **Mitigação Arquitetural Necessária:**
   - O `UpdateService` deve consultar `AutonomousManager.hasActiveRuns()` e `serviceManager.queryActiveWork()`.
   - Se houver trabalho ativo, a atualização é retida e o usuário é notificado.
   - Quando o sistema estiver ocioso (ou com consentimento do usuário), o `safeShutdown()` é invocado para finalizar todos os processos filhos antes de disparar o instalador com flags silenciosas.
