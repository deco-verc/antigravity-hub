# Arquitetura do Sistema

## Stack Tecnológica
- **Desktop Wrapper:** Electron 44 com splash screen personalizada, system tray, healthcheck integrado e suporte a empacotamento NSIS/Portable (`dist-desktop/AI DEV Setup 1.0.0.exe`).
- **Frontend:** React 18 + TypeScript + Vite 6 + Tailwind CSS + Lucide Icons.
- **Backend:** Node.js (v22+) + TypeScript (`tsx`) + Express 4.
- **Banco de Dados:** SQLite nativo via módulo `node:sqlite` (`DatabaseSync`) em `~/.ai-dev-hub/hub.db`.
- **Protocolos & Extensões:** Model Context Protocol (MCP) JSON-RPC 2.0 (stdio + HTTP), GitHub MCP Server, Antigravity Language Server RPC.
- **Controle de Versão:** Git CLI integrado via `GitManager` com diff unificado, numstat, branches dedicadas e status porcelain.

## Componentes Arquiteturais
1. **Simple IDE Frontend (`client/src`):**
   - Layout em 3 colunas: Sidebar de Projetos, Chat & Execution Stream, File Explorer recolhível.
   - Componentes chave: `SimpleIdeChat.tsx`, `FileExplorerPanel.tsx`, `DiffModal.tsx`, `TerminalDrawer.tsx`, `AccountDropdown.tsx`, `HealthCheckModal.tsx`.
2. **Backend Engine (`server/src`):**
   - `accountProfileManager.ts`: Descoberta dinâmica de perfis Antigravity (Google Pro 1, Pro 2, etc.), verificação de portas de Language Server e handover contínuo de conversas com checkpoints.
   - `autonomousRunnerService.ts` / `autonomousManager.ts`: Scheduler em background, watchdog de saúde, ciclo DAG de tarefas e loop de revisão.
   - `workerRegistry.ts`: Coordenação multi-worker com leases atômicas de 15s e renovação contínua.
   - `policyEngine.ts`: Classificação de risco e Approval Inbox para proteção de comandos críticos.
   - `gitManager.ts`: Utilitários Git síncronos para inspeção de repositórios, numstat, diffs unificados e commits.
   - `memoryManager.ts` / `checkpointManager.ts`: Persistência dual (SQLite + arquivos Markdown `.ai-dev-hub/`).
3. **Desktop Host (`desktop/`):**
   - `main.cjs`: Ciclo de vida Electron, trava de instância única (`requestSingleInstanceLock`), encerramento gracioso e bandeja do sistema.
   - `processManager.cjs`: Inicialização e monitoramento do servidor backend como processo filho isolado.
   - `healthCheck.cjs`: Validação de portas, integridade de arquivos e status do runtime.

## Portas e Comunicação
- **Porta 3001:** Servidor HTTP Express (API REST e entrega estática de build do cliente).
- **Porta 5173:** Servidor de desenvolvimento Vite (quando em modo dev).
- **Portas Dinâmicas (ex: 38308):** Conexões RPC locais para perfis de Language Server de agentes Antigravity.
