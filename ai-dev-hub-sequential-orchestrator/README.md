# AI DEV HUB

> **Central de Projetos Assistidos por IA com Memória Permanente Local**  
> Inspirado em Cursor, ChatGPT, Antigravity e Claude Code.

---

## 💡 O que é o AI DEV HUB?

O **AI DEV HUB** resolve o maior gargalo no desenvolvimento de software assistido por IA: a **perda de memória e contexto entre sessões**.

Em vez de depender do histórico volátil de uma conversa ou janela de contexto que se encerra, o AI DEV HUB armazena e sincroniza continuamente a memória do projeto diretamente na própria pasta do código (`.ai-dev-hub/`) e em banco de dados SQLite local.

---

## 🚀 Como Iniciar

### Início Rápido (Windows)
Basta clicar duas vezes em:
- `INICIAR_AI_DEV_HUB.bat` (na raiz) ou
- `ai-dev-hub/start.bat`

### Ou via Linha de Comando:
```powershell
cd "c:\IA\Antigravity HUB\ai-dev-hub"
node start.js
```

O script irá iniciar o Backend e o Frontend, e abrir automaticamente seu navegador padrão em:
👉 **`http://localhost:5173`** (ou `http://localhost:3001`)

---

## 🏛️ Estrutura de Memória Permanente (`.ai-dev-hub/`)

Em cada projeto registrado ou criado pelo Hub, a pasta `.ai-dev-hub/` é criada com 6 arquivos de controle:

| Arquivo | Propósito |
|---|---|
| `project.md` | Objetivo principal, contexto do produto e funcionamento esperado |
| `architecture.md` | Stack técnica, componentes, frontend, backend, banco e portas |
| `decisions.md` | Registro formal de decisões técnicas tomadas e justificativas |
| `tasks.md` | Divisão de tarefas em **Pendente**, **Fazendo** e **Concluído** |
| `changes.md` | Arquivos alterados recentemente e histórico de mudanças |
| `session-summary.md` | Estado consolidado da última sessão e checkpoint atual |

---

## ⚡ Principais Funcionalidades

1. **Sistema de Projetos (+ NOVO PROJETO)**:
   - Registro de qualquer pasta do computador.
   - Análise inteligente automática de pastas existentes.
   - Detecção de stack (React, Node, Python, FastAPI, Docker, Rust, Go, etc.).
   - Leitura de README, scripts (`package.json`) e árvore de arquivos.

2. **Gerenciador de Tarefas (Kanban Interativo)**:
   - Colunas: **Pendente**, **Fazendo**, **Concluído**.
   - Adicionar tarefas pelo painel ou pelo chat (`tarefa: sua tarefa`).
   - Sincronização bidirecional instantânea com `tasks.md`.

3. **Gerar Checkpoint (Sessão)**:
   - Consolida o estado atual: Implementado, Alterações, Problemas, Próxima Tarefa, Decisões e Instrução para o próximo agente.
   - Armazena no histórico do SQLite e atualiza `session-summary.md`.
   - Botão para **Copiar Checkpoint** com um clique.

4. **Continuar Projeto (Handover entre IAs)**:
   - Gera um prompt rico e padronizado contendo Objetivo, Arquitetura, Decisões, Tarefas e o Checkpoint anterior.
   - Pronto para colar em nova sessão do **Cursor**, **ChatGPT**, **Claude Code** ou **Antigravity**.

5. **Histórico de Sessões**:
   - Linha do tempo com data, número da sessão, itens implementados, arquivos afetados, tarefas concluídas e próximo passo.

6. **Git Status em Tempo Real**:
   - Exibe branch atual, último commit local e contagem de modificações:
     - Modificados
     - Novos / Untracked
     - Deletados
   - *Garantia de segurança*: Sem push remoto automático.

7. **Editor de Memória Integrado**:
   - Visualize e edite diretamente os 6 arquivos Markdown de memória.
   - Modo de visualização renderizada ou código-fonte.

8. **Área de Instruções / Chat**:
   - Envio de comandos rápidos como `tarefa: ...`, `gerar checkpoint` ou `continuar`.

---

## 🛠️ Stack Tecnológica

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide React
- **Backend**: Node.js, Express, TypeScript, `node:sqlite` (SQLite embutido nativo do Node 24)
- **Persistência**: SQLite (`~/.ai-dev-hub/hub.db`) + Arquivos Markdown versionáveis no diretório de cada projeto (`.ai-dev-hub/`)
- **Git**: Integração local via `child_process` sem chamadas remotas de rede.
