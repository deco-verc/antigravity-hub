# Antigravity HUB (DecoHUB Engine)

Ambiente integrado de auto-evolução, desenvolvimento autônomo e orquestração de agentes de inteligência artificial com persistência de memória contínua, governança de cotas multi-conta e guardiões de integridade.

---

## 🏛️ Estrutura do Repositório

| Módulo / Diretório | Descrição |
| :--- | :--- |
| **`ai-dev-hub/`** | **DecoHUB Engine:** Plataforma completa com servidor Node/TypeScript, interface React/Vite, cliente Electron Desktop e suíte de mais de 83 baterias de teste automatizadas. |
| **`DOCSIMP/`** | Biblioteca de documentação técnica concisa e simplificada voltada ao consumo rápido por agentes autônomos. |
| **`Skills/`** | Catálogo corporativo de playbooks e habilidades especializadas para agentes (Design Systems, Playwright, API REST, Pentest, etc.). |
| **`SystemPrompt/`** | Arquitetura unificada de prompts em camadas (Regras permanentes, Estratégia e Contexto operacional). |
| **`AutoAdapt/`** | Mecanismo de adaptação contínua e isolamento de ambientes de teste. |
| **`site_docs_extractor/`** | Utilitário automatizado para extração e catalogação estruturada de documentações técnicas de websites e APIs. |
| **`.agents/` & `AGENTS.md`** | Diretrizes corporativas, contratos de execução segura no Windows e sincronização com o AI DEV HUB. |

---

## 🚀 Como Iniciar

### Modo Rápido (Scripts de Inicialização)
- **`INICIAR_AI_DEV_HUB.bat`** ou **`Iniciardecohub.bat`**: Inicia os serviços do backend e abre a interface do DecoHUB em ambiente local.

### Desenvolvimento Local na Engine (`ai-dev-hub/`)
```bash
# Instalar dependências
npm --prefix ai-dev-hub/server install
npm --prefix ai-dev-hub/client install

# Executar suíte de testes
npm --prefix ai-dev-hub/server test

# Compilar para produção
npm --prefix ai-dev-hub/server run build
npm --prefix ai-dev-hub/client run build
```

---

## 🔒 Segurança e Governança

- **Segurança de Segredos:** Arquivos de variáveis de ambiente (`.env`), chaves privadas (`*.key`, `*.pem`), tokens de acesso e bancos locais de dados (`hub.db`) são protegidos e excluídos do controle de versão.
- **Fail-Safe Multi-Conta:** Mecanismo de Rapid Switch e Auto-Failover para continuidade ininterrupta de tarefas autônomas.
- **Self-Healing Guard:** Validação e rollback automático caso alterações de código quebrem a integridade de tipagem do TypeScript (`tsc --noEmit`).

---

**DecoHUB / Antigravity HUB** — Repositório Privado
