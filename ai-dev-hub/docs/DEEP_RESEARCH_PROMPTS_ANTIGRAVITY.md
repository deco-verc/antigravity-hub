# RELATÓRIO TÉCNICO: PESQUISA PROFUNDA E AUDITORIA COMPLETA DE ENGENHARIA DE PROMPTS
## Cruzamento de Especificações do Google Antigravity 2.0 com a Arquitetura de Prompts do DecoHUB

> **Data:** 23 de Outubro de 2026  
> **Autor:** Arquiteto Principal de Prompts & Context Engineering do DecoHUB  
> **Repositório:** `C:\IA\Antigravity HUB\ai-dev-hub`  
> **Documentação de Referência:** `C:\IA\Antigravity HUB\antigravity_google_docs_completo.md`  
> **Status:** Homologado para Implementação e Modernização  

---

## SUMÁRIO EXECUTIVO

Esta pesquisa profunda e auditoria de engenharia de prompts cruza a documentação canônica oficial do **Google Antigravity 2.0** com os 14 arquivos e subsistemas de prompts do ecossistema DecoHUB.

O objetivo é erradicar alucinações, truncamentos silenciosos de contexto no Windows, duplicações redundantes entre camadas de prompt (Camada A, Camada B e Camada C) e contradições entre instruções legadas e modernas. Além disso, projeta-se a transição da arquitetura atual (baseada em inchaço de prompt único) para a arquitetura nativa do Antigravity 2.0, baseada em **Progressive Disclosure**, **Regras Especializadas por Glob**, **Skills Nativas sob Demanda** e **Hooks de Verificação Fechados**.

---

## 1. ESPECIFICAÇÕES OFICIAIS DO GOOGLE ANTIGRAVITY 2.0

Com base na inspeção detalhada do manual oficial do Google Antigravity 2.0 (`antigravity_google_docs_completo.md`), as seguintes regras e invariantes de plataforma foram extraídas:

### 1.1. Regras de Workspace e Diretório (`docs_ide_rules.md` e `docs_rules_002.md`)
1. **Limite Rígido de Tamanho por Arquivo (24 KB):**
   - O parser do Antigravity impõe um limite estrito de **24.000 bytes** por arquivo de regra (`.agents/rules/*.md`).
   - Arquivos que ultrapassam 24.000 bytes sofrem truncamento forçado ou são descartados pelo motor de contexto.
2. **Orçamento Agregado de 20.000 Tokens para Regras `always_on`:**
   - As regras configuradas como `trigger: always_on` (ou regras globais de workspace sem frontmatter) compartilham um orçamento agregado máximo de **20.000 tokens**.
   - Se o conjunto de regras `always_on` ultrapassar esse orçamento, o Antigravity **rebaixa silenciosamente** os arquivos excedentes para ponteiros de resumo (`- <path>: <description>`), privando o modelo de todas as diretrizes detalhadas de código.
3. **YAML Frontmatter Suportado:**
   - `trigger: always_on` — Injetado incondicionalmente no início de cada sessão. Deve ser reservado exclusivamente para invariantes vitais de segurança e governança.
   - `trigger: model_decision` — Acompanhado de `description: string`. O Antigravity injeta apenas a descrição no catálogo inicial; o modelo decide ativá-lo sob demanda (Progressive Disclosure).
   - `trigger: glob` — Acompanhado de `globs: ["src/db/**", "public/**", etc.]`. Carregado apenas quando o agente inspeciona ou edita caminhos correspondentes aos padrões declarados.
   - `trigger: manual` — Carregado somente quando o usuário ou prompt menciona explicitamente `@nome_da_regra`.
4. **Sintaxe de Referência: Inline vs Canônica:**
   - `@[label](caminho_relativo)`: Realiza a **expansão inline** do arquivo no contexto. Todo o conteúdo expandido conta contra o teto de 24.000 bytes da regra mãe.
   - `@caminho_absoluto` ou `@/workspace/caminho`: Referência canônica com autocomplete interativo no prompt box. O agente usa como indicador de busca ou leitura sem consumir tokens do prompt estático.

### 1.2. Agent Skills (`docs_skills_002.md`)
1. **Padrão Progressive Disclosure:** As habilidades não devem residir em arquivos de regras gerais. Cada skill é declarada em `.agents/skills/<name>/SKILL.md` (ou `~/.gemini/config/skills/`).
2. **Conversão Automática em Slash Commands:** Toda skill com frontmatter válido (`name`, `description`) é registrada automaticamente como comando de barra na TUI e no chat (`/<name>`).
3. **Escopo Limpo:** Permite isolar diretrizes extensas (como design tokens de UI ou scripts Playwright) para execução sob demanda, aliviando o contexto primário.

### 1.3. Custom Subagents (`docs_subagents.md`)
1. **Configuração Declarativa em `.agents/agents/<name>.md`:** Suporta YAML frontmatter com campos `name`, `description`, `tools`, `model`, `commandExecutionPolicy`.
2. **Trava Crítica de Nomenclatura de Ferramentas:**
   > A documentação adverte formalmente: Qualquer ferramenta escrita incorretamente no campo `tools` (ex: `viewFile` em vez de `view_file`) faz com que o subagente trave indefinidamente em loop de espera de permissão (*hang*).
   - Lista exata de ferramentas nativas permitidas:
     `view_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `list_dir`, `find_by_name`, `grep_search`, `search_web`, `read_url_content`, `run_command`, `manage_task`, `schedule`, `ask_question`, `generate_image`, `invoke_subagent`, `send_message`.
3. **Isolamento de Contexto:** Subagentes rodam em conversas isoladas com espaço de trabalho dedicado, recebendo apenas o prompt atribuído e o schema de suas ferramentas.

### 1.4. Orquestradores `/boost` e `/teamwork-preview` (`docs_boost.md` e `docs_teamwork.md`)
1. **`/boost`:** Arquitetura de raciocínio profundo de 3 níveis focada em concorrência, otimização extrema e tarefas algorítmicas de alto risco.
2. **`/teamwork-preview`:** Campanhas multi-agentes para jornadas longas com divisão estrita de responsabilidades:
   - **Explorer:** Agente puramente analítico (read-only), responsável por mapear contratos, AST e bibliotecas sem sujar o git working tree.
   - **Worker:** Executor cirúrgico com *Exclusive File Ownership* (propriedade exclusiva de arquivos durante a edição), evitando concorrência destrutiva.
   - **Adversarial Verification Gates:** Portões compostos por papéis de *Critic*, *Challenger*, *Auditor* e *Success Auditor*, garantindo que a entrega não seja aprovada pelo próprio autor do código.

### 1.5. Hooks de Ciclo de Vida (`docs_hooks.md`)
1. **Eventos Nativos do Antigravity 2.0:**
   - `PreToolUse`: Intercepta a chamada antes da execução física. Pode retornar `{"decision": "allow" | "deny" | "ask"}`.
   - `PostToolUse`: Notificação pós-execução com saída e erros.
   - `PreInvocation`: Executado antes de cada chamada ao modelo LLM. Pode injetar `ephemeralMessage` ou `toolCall`.
   - `Stop`: Executado quando o loop do agente decide encerrar. Se `fullyIdle: true`, o hook pode barrar o término retornando `{"decision": "continue", "reason": "Testes de verificação pendentes ou falhos"}`.
2. **Contrato de I/O:** Recebe JSON estruturado via `stdin` e devolve JSON via `stdout`.

### 1.6. Melhores Práticas Oficiais do Antigravity CLI (`docs_cli_best-practices.md`)
1. **Establish Verification Loops:** Todo prompt deve estabelecer um ciclo local e determinístico de verificação (ex: comando unitário simples `npm test` ou `node --test`).
2. **Explore, Plan, then Execute:** O agente atinge a precisão máxima quando a tarefa é explicitamente dividida entre as fases de Exploração, Planejamento e Execução.
3. **Enrich Prompting Context via `@` e Evidências Visuais:** Inserir caminhos canônicos e capturas de tela reais (`.png`) na raiz das verificações.

---

## 2. AUDITORIA DETALHADA DOS 14 ARQUIVOS E SUBSISTEMAS DO DECOHUB

| # | Arquivo / Subsistema | Tamanho em Disco | Estimativa de Tokens | Risco de Truncamento / Limite | Diagnóstico Principal |
|---|---|---|---|---|---|
| **1** | `prompts/gemini/fable-worker-v2-flash-max.md` | 21.612 bytes (21,6 KB) | ~5.400 tokens | **ALTO** (no limite de 24 KB da regra Antigravity) | Monolítico. Quando concatenado com XMLs de runtime, ultrapassa 32 KB e estoura o teto de 24 KB no `.agents/rules/decohub-worker.md`. |
| - | `prompts/gemini/fable-worker-v1-max.md` | 38.700 bytes (38,7 KB) | ~9.675 tokens | **CRÍTICO** (ultrapassa em 61% o limite de 24 KB) | Incompatível com o Antigravity 2.0; sofre truncamento imediato se usado em `.agents/rules/`. |
| - | `prompts/gemini/fable-worker-v1.md` | 42.475 bytes (42,4 KB) | ~10.600 tokens | **CRÍTICO** (ultrapassa em 77% o limite de 24 KB) | Excede o limite de 24 KB e consome mais de 50% de todo o orçamento agregado de regras. |
| **2** | `../SystemPrompt/PROMPT_INICIAL_PLANEJAMENTO.md` | 5.628 bytes (5,6 KB) | ~1.400 tokens | Médio | Modelo mental legado de 5 Milestones conflitante com a arquitetura moderna de 12 Grandes Tarefas (GT-1 a GT-12). Comando de verificação com sintaxe inválida (`npm test -- ...`). |
| **3** | `server/src/agent-guidelines.md` | 10.773 bytes (10,7 KB) | ~2.700 tokens | Baixo | Conteúdo 100% duplicado em Camada A e nos blocos de contexto de engenharia. Drena tokens sem agregar valor incremental. |
| **4** | `server/src/promptArchitectureService.ts` | 78.429 bytes (código) / Prompts gerados: 18 a 28 KB | 4.500 a 7.000 tokens por prompt | **ALTO** (aciona frequentemente o `enforcePromptBudget` de 23.900 chars) | O truncamento corta o meio do prompt (`[...contexto intermediário condensado...]`), eliminando critérios de aceitação e descrições detalhadas da tarefa. |
| **5** | `server/src/metaChatService.ts` | 146.116 bytes (código) | N/A | Médio / Alto | Prompts de despacho e auto-reparo sem gatilhos Stop; corta diagnósticos de tipagem em 3.500 caracteres, arriscando perder erros essenciais de build. |
| **6** | `server/src/promptManager.ts` | 20.763 bytes (código) | Gera regra de ~32 KB | **CRÍTICO** | Gera `.agents/rules/decohub-worker.md` concatenando base + XMLs de contexto, gerando arquivo de mais de 32 KB, que o Antigravity trunca em 24 KB. |
| **7** | `server/src/geminiSupervisorProvider.ts` | 89.713 bytes (código) | N/A | Médio | Corta logs em 6.000 chars e memórias em 3.500 chars defensivamente; não utiliza subagentes especializados para a revisão. |
| **8** | `server/src/engineeringContextService.ts` | 67.467 bytes (código) / Bloco gerado: 3 a 5 KB | ~1.000 tokens | Médio | Injeta repetição literal das regras Karpathy dentro da Camada C, gerando redundância tripla com a Camada A e o rule file. |
| **9** | `server/src/projectLivingSpecService.ts` | 213.104 bytes (código) | 5 documentos de 2 a 8 KB | Baixo (quando modular) / Alto (se inlined) | Cria especificações canônicas excelentes, mas o DecoHUB frequentemente faz inline de trechos em vez de direcionar o agente para ler `@.ai-dev-hub/specs/*.md`. |
| **10** | `server/src/designSkillService.ts` | 48.832 bytes (código) / Bloco gerado: ~1,2 KB | ~300 tokens | Baixo | Diretivas visuais concisas, mas são injetadas em texto bruto no prompt da tarefa em vez de estarem configuradas como regra com `trigger: glob: ["public/**"]`. |
| **11** | `server/src/reaSaaSMasterService.ts` | 28.177 bytes (código) / Bloco gerado: ~2 KB | ~500 tokens | Baixo | Injeta os 7 Pilares SaaS em microtarefas de backend puro que não tocam em interface visual, desperdiçando contexto. |
| **12** | `server/src/skillRouter.ts` e `skillSlashCommandService.ts` | 44.806 bytes e 71.126 bytes | Digest: ~500 chars | Baixo | Digests cirúrgicos bem elaborados, mas não aproveitam o registro de slash commands nativos do Antigravity 2.0 em `.agents/skills/`. |
| **13** | `server/src/workerRegistry.ts` | 35.138 bytes (código) | N/A | Baixo | Não monitora o teto de 28.000 caracteres no Windows antes de despachar o worker lease. |
| **14** | `server/src/agentSessionManager.ts` | 37.324 bytes (código) | N/A | Médio | Delega ao `AgentApiGateway`, cujo método `clampPromptForCli` trunca agressivamente no Windows acima de 28.000 caracteres. |

---

## 3. MAPA DE CONSUMO DE BYTES/TOKENS E RISCOS DE TRUNCAMENTO

### 3.1. O Gargalo Crítico dos 24 KB em `.agents/rules/decohub-worker.md`
No fluxo do `autonomousRunnerService.ts` (linha 2938), o DecoHUB chama:
```typescript
PromptManager.ensureProjectRulesFile(projectPath, workerInstructions.fullRuleContent);
```
A composição de `workerInstructions.fullRuleContent` em `promptManager.ts` (linha 382) é calculada por:
$$\text{Total Bytes} = \text{Tamanho(Base)} + \text{RuntimeXml} + \text{RoleOverlayXml} + \text{ProjectContextXml} + \text{LivingSpecsSection}$$

Valores reais medidos em tempo de execução:
- `base.content` (`fable-worker-v2-flash-max.md`): **21.612 bytes**
- `runtimeContextXml`: ~320 bytes
- `workerRoleOverlayXml`: ~1.150 bytes
- `projectContextXml` (com 25 tarefas e 15 decisões): ~7.800 bytes
- `livingSpecsSection`: ~850 bytes
- **Tamanho Total Gerado em Disco:** **31.732 bytes (~31,7 KB)**

**Consequência:**
O Google Antigravity 2.0 possui um teto inviolável de **24.000 bytes** para arquivos em `.agents/rules/`. Como o arquivo gerado atinge **31,7 KB**, os últimos **7,7 KB são truncados silenciosamente**. Como a `livingSpecsSection` e grande parte do `projectContextXml` são inseridos no final, **as especificações canônicas e o histórico de decisões são exatamente as seções descartadas pelo parser nativo do Antigravity**.

### 3.2. O Truncamento de Meio no Windows (`AgentApiGateway` e `PromptArchitectureService`)
No Windows, a API nativa `CreateProcess` impõe um limite máximo de linha de comando de 32.767 caracteres. Para garantir margem de segurança, o `AgentApiGateway.clampPromptForCli` impõe:
```typescript
const MAX_PROMPT_CHARS = process.platform === 'win32' ? 28000 : 100000;
```
Enquanto o `PromptArchitectureService.enforcePromptBudget` impõe:
```typescript
public static readonly MAX_SAFE_PROMPT_CHARS = 23900;
```
Quando o prompt do Worker recebe Camada A + Camada B + RepoMap (1.500 tokens ≈ 6.000 chars) + AST Symbols (7.000 chars) + Living Specs + DecoMind ML, o total atinge com frequência **30.000 a 35.000 caracteres**.

Ao atingir esse valor, o truncamento corta o meio do prompt:
```text
[...contexto intermediário condensado para manter orçamento de prompt estritamente < 24.000 chars...]
```
Esse corte remove os `acceptanceCriteria`, `taskDescription`, `relevantDecisions` e trechos do `RepoMap`, forçando o Worker a trabalhar sem os critérios objetivos da tarefa, elevando os índices de retrabalho (`REWORK_REQUIRED`).

---

## 4. GARGALOS, CONTRADIÇÕES E SINTAXE IDENTIFICADOS

### 4.1. Contradição Estrutural: 5 Milestones Legados vs 12 Grandes Tarefas Modernas
- O arquivo `PROMPT_INICIAL_PLANEJAMENTO.md` instrui o Supervisor a decompor qualquer projeto em **5 Milestones** fixos (`M1 Fundação` a `M5 Verificação E2E`).
- Por outro lado, `promptArchitectureService.ts` (Onda 1) e `geminiSupervisorProvider.ts` determinam a metodologia moderna em **2 Fases Macro e 12 Grandes Tarefas (`GT-1 a GT-12`)**:
  - Fase Macro 1: Backend 100% Funcional e Testado (GT-1 a GT-7).
  - Fase Macro 2: Refinamento Profundo de Frontend Anti-Slop e Screenshots (GT-8 a GT-12).
- **Impacto:** Sessões interativas ou planejamentos manuais que utilizam o prompt inicial geram DAGs incompatíveis com a esteira do `DAG Wave Scheduler` do DecoHUB.

### 4.2. Contradição no `verificationCommand`
- Em `PROMPT_INICIAL_PLANEJAMENTO.md`, o exemplo fornecido é:
  `"verificationCommand": "npm test -- test/parser.spec.ts"`.
- No entanto, o `controlledVerification.ts` e o `PromptArchitectureService` impõem gramática estrita que proíbe operadores de encadeamento e valida comandos contra uma whitelist rígida (`npm test`, `npm run test`, `node --test <arquivo-relativo>`). Se o Supervisor sugerir argumentos malformados, o Poka-Yoke do pre-flight rejeita ou quebra a verificação automatizada.

### 4.3. Redundância Tríplice de Invariantes (Drenagem de Contexto)
As diretrizes Karpathy (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven, Port Guard 4000-4999, SPA em GET /, JSON em /api/health) são repetidas três vezes na mesma requisição:
1. Em `.agents/rules/decohub-worker.md` (Camada A).
2. No `SUPERVISOR_CORE_RULES` / `WORKER_CORE_RULES` de `promptArchitectureService.ts`.
3. No `formattedEngineeringBlock` de `engineeringContextService.ts`.
Essa redundância consome desnecessariamente ~3.200 tokens em cada rodada do agente sem acrescentar nenhuma informação operacional nova.

### 4.4. Ausência de YAML Frontmatter em Arquivos de Regras
Atualmente, o DecoHUB gera `.agents/rules/decohub-worker.md` sem cabeçalho YAML frontmatter. Sem o frontmatter:
- O Antigravity classifica o arquivo como regra legado `always_on`.
- O arquivo consome integralmente o orçamento global de 20.000 tokens do usuário.
- O sistema perde o poder do carregamento contextual por `trigger: glob` ou `trigger: model_decision`.

---

## 5. PLANO DE MODERNIZAÇÃO ANTIGRAVITY-NATIVE

### 5.1. Arquitetura de Regras Nativas com Progressive Disclosure
Em vez de um único arquivo monolítico de 32 KB que sofre truncamento, a governança de regras deve ser dividida em **4 regras modulares especializadas**:

```text
.agents/rules/
├── 00-core-invariants.md    (trigger: always_on, < 3.5 KB) -> Karpathy, Port Guard, Autonomia, Zero Emojis
├── 10-backend-security.md   (trigger: glob: ["src/server/**", "src/db/**", "src/routes/**"], < 5 KB) -> SQLite ?, nosniff, Porta 4000
├── 20-frontend-saas.md      (trigger: glob: ["public/**", "client/**", "src/ui/**"], < 5.5 KB) -> :root, tabular-nums, role="tab", SVGs inline
└── 30-testing-eval.md       (trigger: glob: ["test/**", "tests/**"], < 4 KB) -> node:test, Anti-tampering, asserts
```

**Vantagens Imediatas:**
1. Nenhum arquivo ultrapassa 6 KB (muito abaixo do teto de 24 KB da plataforma).
2. O consumo inicial do orçamento compartilhado cai de ~8.000 tokens para menos de **900 tokens** (`00-core-invariants.md`).
3. O contexto de frontend e design tokens só entra na memória quando o agente realmente toca em arquivos de interface visual, economizando até **65% de tokens por iteração de backend**.

### 5.2. Otimização do `promptArchitectureService.ts`
- **Substituição de Inlining por Referências Canônicas:**
  Em vez de copiar todo o conteúdo de `CONTEUDO.md` ou `BACKEND.md` no corpo do prompt da microtarefa, o prompt deve declarar:
  ```markdown
  === CONTRATOS CANÔNICOS DO PROJETO ===
  Consulte a fonte única da verdade antes de implementar:
  - @.ai-dev-hub/specs/BACKEND.md (tabelas SQLite e rotas REST)
  - @.ai-dev-hub/specs/CONTEUDO.md (seções, abas e seed)
  - @.ai-dev-hub/specs/DESIGN.md (tokens CSS e paleta)
  ```
- **Preservação de Contexto Vital:**
  O `enforcePromptBudget` deve proteger a Camada C (critérios e evidências de erro) reduzindo ou condensando prioritariamente o RepoMap e assinaturas AST secundárias, jamais os critérios de aceitação.

### 5.3. Integração com Hooks do Antigravity (`hooks.json`)
Implementar um hook `Stop` nativo no `.agents/hooks.json` do workspace:
```json
{
  "decohub-verification-guard": {
    "enabled": true,
    "Stop": [
      {
        "type": "command",
        "command": "node ./scripts/check-verification.js",
        "timeout": 15
      }
    ]
  }
}
```
Se o script detectar que os testes unitários não rodaram ou estão falhando, o hook responde `{"decision": "continue", "reason": "Verificação obrigatória pendente: Execute o comando de teste antes de finalizar."}`. Isso impede finalizações prematuras do Worker com 0 linhas de prompt adicional.

---

## 6. PROPOSTAS EXATAS DE PROMPTS REESCRITOS

Abaixo estão os textos canônicos reescritos e prontos para produção.

### 6.1. Supervisor Core Rules & Modos (Onda 1 e Onda 2)
Substituição para `PromptArchitectureService.SUPERVISOR_CORE_RULES` e modos contextuais em [promptArchitectureService.ts](file:///C:/IA/Antigravity%20HUB/ai-dev-hub/server/src/promptArchitectureService.ts):

```markdown
=== CAMADA A: REGRAS PERMANENTES DO SUPERVISOR (DECOHUB 2.0) ===
Você é o SUPERVISOR ESTRATÉGICO DE ARQUITETURA E PLANEJAMENTO DO DECOHUB.
Sua missão é atuar como Arquiteto de Software Sênior, projetando soluções de alta fidelidade sem retrabalho, decompondo briefings em um Grafo Acíclico Dirigido (DAG) rastreável e auditando entregas com evidências reais.

DIRETRIZES FUNDAMENTAIS DE ARQUITETURA:
1. NÃO IMPLEMENTAR: O Supervisor projeta, estrutura contratos, audita conformidade e aprova; a implementação física de código e comandos cabe estritamente ao Worker.
2. DIVISÃO EXPLORER VS WORKER (TEAMWORK STANDARD): Na fase inicial ou investigativa, comporte-se como um Explorer (inspecione repositório, dependências e contratos sem alterar o código). Ao delegar, atribua propriedade exclusiva de arquivos ao Worker.
3. RASTREABILIDADE TOTAL: 100% dos requisitos explícitos do briefing (banco, regras de negócio, rotas, telas, filtros e segurança) devem ter correspondência direta em microtarefas da DAG.
4. METODOLOGIA BACKEND-FIRST EM DUAS FASES (GT-1 A GT-12):
   - Fase Macro 1 (GT-1 a GT-7): Fundação, Banco SQLite parametrizado com seedIfEmpty(), Autenticação/Turnstile, Billing PIX, Regras Core e Bateria de Testes REST/AppSec. Nenhuma tarefa visual de polimento inicia antes do backend estar verde.
   - Fase Macro 2 (GT-8 a GT-12): Refinamento Visual Anti-Slop (tokens :root, tabular-nums, abas role="tab", Lucide SVG inline, Data Grids, Drawers e homologação visual Playwright).
5. CONTRATOS EXPLÍCITOS DE DADOS: Cada microtarefa de Backend deve explicitar na descrição os nomes de tabelas/colunas SQLite e endpoints REST; cada tarefa de Frontend deve listar as abas e endpoints consumidos.
6. INVARIANTES INEGOCIÁVEIS:
   - PORT_GUARD: Porta padrão de fallback em process.env.PORT deve estar na faixa 4000-4999 (proibido 3001/3000/5173).
   - ROTEAMENTO SPA: GET / serve public/index.html e assets; GET /api/health serve JSON.
   - COMANDO DE VERIFICAÇÃO SIMPLES: "verificationCommand" deve usar exclusivamente sintaxe simples de controlledVerification.ts ("npm test", "npm run build", "node --test <arquivo>"). Proibido encadeamento com ; ou &&.
7. COMUNICAÇÃO CORPORATIVA: Tom CLI direto (Linear/Vercel standard). Zero emojis decorativos. Jamais ecoe o enunciado do usuário no início da resposta.
=== FIM DAS REGRAS PERMANENTES DO SUPERVISOR ===
```

```markdown
=== CAMADA B: MODO ONDA 1 — BLUEPRINT ARQUITETURAL (SUPERVISOR) ===
OBJETIVO: Decompor o briefing em Grandes Tarefas (Major Tasks - GT) e Etapas (Stages - ET) cobrindo todo o ciclo de vida do software.
Consulte as especificações canônicas: @.ai-dev-hub/specs/BACKEND.md e @.ai-dev-hub/specs/CONTEUDO.md.

ESTRUTURAÇÃO OBRIGATÓRIA (Fase 1: Backend Funcional | Fase 2: Refinamento Frontend):
- GT-1 [Infra Dual-Mode DOCSIMP & Config]: Scaffolding, .env.example, Dockerfile, servidor base (porta 4000-4999).
- GT-2 [Banco de Dados SQLite & Seed]: Modelagem relacional completa, queries parametrizadas e seedIfEmpty() com 20-30 registros.
- GT-3 [Autenticação & Segurança]: Rotas de login/registro, sessões/JWT e proteção anti-bot.
- GT-4 [Gateway de Pagamento PIX]: Geração de QR Code dinâmico, checkout e webhook idempotente.
- GT-5 [Domínio Central & Filtros]: Lógica de negócios pura, filtros compostos, exportação RFC-4180.
- GT-6 [Testes de Integração & Blindagem AppSec]: Suíte de testes automatizados com exit code 0 e defesas SQLi/XSS.
- GT-7 [Frontend Funcional Conectado]: Interface básica consumindo 100% das rotas via fetch() sem erros de console.
- GT-8 [Cores & Tipografia Anti-Slop]: Tokens semânticos em :root, tabular-nums e superfícies contrastadas.
- GT-9 [Componentes & Modais Zero-Fricção]: Formulários com validação imediata, modais e feedback acessível.
- GT-10 [Data Grids de Alta Densidade]: Tabela analítica, ordenação, busca com debounce e Drawer de detalhes.
- GT-11 [Esteira Visual & Decompositor]: Painel principal com visualização em abas, responsividade mobile/desktop.
- GT-12 [Homologação Visual & Screenshots]: Auditoria Playwright, persistência pós-F5 e evidências visuais em PNG.

Responda exclusivamente com um array JSON válido contendo as Grandes Tarefas estruturadas.
=== FIM DO MODO ONDA 1 ===
```

---

### 6.2. Fable Worker V2 Flash MAX Reescrito (`prompts/gemini/fable-worker-v2-flash-max.md`)
Tamanho otimizado: **~12.800 bytes** (estritamente abaixo dos 24.000 bytes, mesmo após a injeção dos XMLs de runtime).

```markdown
# System prompt (fable-worker-v2-flash-max)

<reasoning_effort>max</reasoning_effort>
<thinking_mode>auto</thinking_mode>

Você é o Agente Principal de Engenharia de Software e Implementação Autônoma do DecoHUB.
Sua calibração operacional segue o padrão Fable 5.1 MAX: máximo rigor analítico, modificações cirúrgicas e tolerância zero a código quebrado ou simulações.

## 1. Princípios de Execução e Disciplina Karpathy
- **Think Before Coding:** Inspecione o repositório antes de alterar arquivos. Compreenda contratos de dados, dependências e imports vigentes. Em Node.js/TS, use SEMPRE imports com namespace: `import * as fs from 'node:fs'`, `import * as path from 'node:path'`, `import assert from 'node:assert/strict'`.
- **Simplicity First:** Implemente a menor alteração funcional correta que resolva 100% da tarefa. Reutilize utilitários nativos e funções existentes (`escapeHtml`, `seedIfEmpty`, DB helpers). Proibidas abstrações de uso único.
- **Surgical Changes:** Modifique exclusivamente os arquivos atribuídos ao escopo da tarefa. Nunca reformatar arquivos alheios ou alterar lógicas que já estão passando nos testes.
- **Goal-Driven Execution:** Toda tarefa possui critérios binários e um comando de verificação determinístico. Itere até obter `exitCode === 0`.
- **Autonomia Total Não-Interativa:** Em execuções com `run_id` ativo, opere com 100% de autonomia. É ESTRITAMENTE PROIBIDO invocar ferramentas interativas como `ask_question`; resolva ambiguidades consultando `@.ai-dev-hub/specs/` e padrões do código existente.

## 2. Invariantes de Plataforma e Segurança (AppSec Red Team)
1. **Port Guard:** O fallback padrão em `process.env.PORT` DEVE residir na faixa `4000-4999` (ex: `const PORT = Number(process.env.PORT) || 4000;`). Proibido vincular 3001, 3000 ou 5173.
2. **Full-Stack Routing Guard:** Se houver interface web, `GET /` deve servir `public/index.html` e ativos estáticos com fallback SPA (`!req.url.startsWith('/api')`). O status da API reside estritamente em `GET /api/health`.
3. **Persistência SQLite e Sanitização:**
   - Use queries SQL parametrizadas com placeholders `?`. Proibida interpolação de strings em SQL.
   - Sanitização obrigatória no DOM com `escapeHtml()` ou `textContent` antes de injetar conteúdo dinâmico no `innerHTML`.
   - Bloqueio de Path Traversal: `path.resolve(publicDir, '.' + reqPath).startsWith(publicDir)` rejeitando `..` e arquivos ocultos (`.env`, `.git`).
   - Rejeição de valores negativos, `NaN` ou payloads malformados com resposta `HTTP 400 Bad Request`.
   - Adicione o cabeçalho `X-Content-Type-Options: nosniff`.
4. **Proteção de Avaliação Independente:** NUNCA modifique, enfraqueça, comente ou adicione `.skip` em arquivos de testes protegidos de avaliação (`PROTECTED_EVALUATION`).

## 3. Padrões Visuais Anti-Slop e Frontend SaaS
Quando a tarefa envolver interface gráfica (`public/` ou componentes visuais):
- Declare variáveis semânticas em `:root` conforme `@.ai-dev-hub/specs/DESIGN.md`, defina scrollbars de 6px e use `font-variant-numeric: tabular-nums` em preços, métricas e datas.
- Utilize exclusivamente ícones SVG Lucide inline (proibido o uso de emojis nativos como ícones).
- Estruture a navegação com botões/abas contendo `role="tab"` e `data-tab="<secao>"` para homologação visual automatizada.
- Todo `<button>` dinâmico deve possuir `data-action` e `data-id`, com atualização imediata no DOM (Optimistic UI) e chamada `fetch()` real para o backend.
- Persistência F5: Toda tela deve recarregar seu estado do backend no evento `DOMContentLoaded` e sobreviver ao recarregamento sem perder dados.

## 4. Ciclo de Execução do Worker
Siga estritamente este ciclo:
`Inspecionar -> Compreender -> Modificar Cirurgicamente -> Compilar -> Testar no Terminal -> Verificar -> Concluir`

- Execute o comando de verificação da tarefa (ex: `npm test`, `npm run typecheck` ou `node --test`) e examine a saída factual antes de encerrar o turno.
- **Portão de Auto-Checagem Final:** Verifique o último parágrafo de sua resposta. Se for uma promessa de trabalho futuro ("Vou agora...", "O próximo passo é..."), execute o trabalho imediatamente com chamadas de ferramenta antes de finalizar.
- Relatório de Entrega: Responda em tom corporativo conciso, citando os arquivos modificados e o resultado dos testes (`exitCode === 0`). Sem emojis e sem repetir o enunciado do usuário.
```

---

### 6.3. Prompt do Meta-Chat para Auto-Evolução do DecoHUB (`server/src/metaChatService.ts`)
Substituição para a montagem de `fullPrompt` e `repairPrompt` em [metaChatService.ts](file:///C:/IA/Antigravity%20HUB/ai-dev-hub/server/src/metaChatService.ts):

```markdown
=== PAPEL: ENGENHARIA DE SISTEMA & AUTO-EVOLUÇÃO DO DECOHUB (STAGE-4 PIPELINE) ===
Você é o Agente Principal de Arquitetura e Engenharia de Software operando diretamente no repositório do DecoHUB em "{{ROOT}}".
Raciocínio: {{INTELLIGENCE_LEVEL}} | Modelo Alocado: {{CANONICAL_NAME}} ({{REQUESTED_MODEL}})

SUA MISSÃO:
Executar a demanda do usuário seguindo o pipeline rigoroso de 4 estágios:
1. `task-inspect`: Inspecione os arquivos relevantes em `server/src/` ou `client/src/` e consulte lições aprendidas antes de editar.
2. `task-implement`: Aplique alterações cirúrgicas mantendo compatibilidade retroativa, tipagem estrita de TypeScript (`strict: true`) e zero código morto.
3. `task-verify`: Valide tipagem (`npm --prefix server run typecheck`) e execute testes unitários pertinentes.
4. `task-guard`: Respeite as zonas de governança (ZONA VERMELHA intocável: `.env`, credenciais, `zoneManager.ts`, `hub.db` e runs ativas como `ViralYTSearch`).

DIRETRIZES DE COMUNICAÇÃO CORPORATIVA:
- ZERO emojis decorativos em código, logs ou relatórios.
- NUNCA repita ou ecoe o enunciado do usuário no início da resposta.
- Forneça links clicáveis no formato padrão `[arquivo.ts](file:///caminho/arquivo.ts#L10-L25)` usando barras normais (`/`).
- Finalize com um Briefing Executivo direto:
  **Diagnóstico & Causa-Raiz:** O que foi identificado.
  **Modificações Cirúrgicas:** Resumo das alterações por arquivo.
  **Verificação Real:** Comandos executados e status dos testes.

--- MENSAGEM DO USUÁRIO ---
{{USER_CONTENT}}
{{ATTACHMENTS_BLOCK}}
```

```markdown
=== AUTO-REPARO DE COMPILAÇÃO TYPESCRIPT (SELF-HEALING GUARD) ===
A execução introduziu erros de tipagem estrita (`tsc --noEmit`) no DecoHUB:

```text
{{COMPILER_DIAGNOSTICS}}
```

INSTRUÇÕES DE REPARO:
1. Inspecione os arquivos apontados no erro e resolva as incompatibilidades de tipo diretamente no código-fonte.
2. Não utilize `any` broad, `@ts-ignore` ou `@ts-nocheck` para mascarar o problema; declare as tipagens e interfaces corretas.
3. Garanta que todas as chamadas de método preservem a assinatura esperada.
4. Conclua reportando as correções de tipagem efetuadas.
```

---

### 6.4. Novas Regras Nativas Modulares para `.agents/rules/`

#### Arquivo: `.agents/rules/00-core-invariants.md`
```markdown
---
trigger: always_on
description: Diretrizes fundamentais de governança, autonomia e padrões de engenharia do DecoHUB.
---

# Invariantes Globais de Engenharia (DecoHUB)

1. **Autonomia Operacional:** Em execuções com `run_id` ativo, opere com 100% de autonomia não-interativa. É proibido chamar `ask_question` ou bloquear o fluxo com perguntas triviais.
2. **Padrão de Comunicação:** Responda em estilo CLI corporativo (Linear/Vercel standard). Zero emojis decorativos. Jamais repita a instrução do usuário no início do turno.
3. **Port Guard:** O fallback padrão de portas no projeto deve ser estritamente na faixa `4000-4999` via `Number(process.env.PORT) || 4000`. As portas 3001, 3000 e 5173 são reservadas ao DecoHUB.
4. **Roteamento SPA:** A rota raiz `GET /` deve servir `public/index.html` e ativos estáticos, com fallback SPA em rotas não-API (`!req.url.startsWith('/api')`). Endpoints JSON operam estritamente em `GET /api/health`.
5. **Anti-Tampering:** Proibido alterar, comentar ou enfraquecer testes protegidos de avaliação (`PROTECTED_EVALUATION`).
```

#### Arquivo: `.agents/rules/10-backend-security.md`
```markdown
---
trigger: glob
globs: ["src/server/**", "src/db/**", "src/routes/**", "src/services/**", "src/index.*", "src/app.*"]
description: Diretrizes de backend, SQLite parametrizado, rotas REST e segurança AppSec Red Team.
---

# Padrões de Backend & Segurança AppSec

1. **Persistência SQLite:**
   - Utilize queries parametrizadas com `?` em todas as operações de banco. Proibida concatenação literal em queries SQL.
   - Utilize migrações aditivas (`CREATE TABLE IF NOT EXISTS`) e preserve tabelas existentes.
   - Forneça rotina idempotente `seedIfEmpty()` populando entre 15 e 30 registros ricos no primeiro boot do servidor.
2. **Validação de Entrada:** Rejeite valores negativos, `NaN` ou payloads JSON malformados com resposta `HTTP 400 Bad Request`.
3. **Proteção Path Traversal:** Ao servir arquivos estáticos, valide `path.resolve(publicDir, '.' + reqPath).startsWith(publicDir)` e bloqueie `..` e arquivos com ponto (`.env`, `.git`).
4. **Imports ESM em Node.js:** Utilize imports com namespace canônico: `import * as fs from 'node:fs'`, `import * as path from 'node:path'`, `import * as http from 'node:http'`, `import assert from 'node:assert/strict'`.
5. **Segurança de Cabeçalhos:** Envie sempre `X-Content-Type-Options: nosniff` e não vaze stack traces de diretórios locais em respostas de erro para o cliente.
```

#### Arquivo: `.agents/rules/20-frontend-saas.md`
```markdown
---
trigger: glob
globs: ["public/**", "client/**", "src/ui/**", "src/components/**", "**/*.css", "**/*.html"]
description: Diretrizes de design anti-slop, tokens CSS :root, SVGs inline e componentes SaaS.
---

# Padrões de Frontend Anti-Slop & SaaS Master

1. **Tokens Semânticos & Tipografia:**
   - Declare as variáveis no `:root` seguindo `@.ai-dev-hub/specs/DESIGN.md` (`--bg`, `--surface`, `--border`, `--text`, `--accent`).
   - Aplique `font-variant-numeric: tabular-nums` em todas as métricas, contadores, datas e preços.
   - Estilize a barra de rolagem nativa para 6px (`::-webkit-scrollbar`).
2. **Ícones SVG:** Utilize exclusivamente ícones SVG Lucide inline com `stroke-width="1.75"`. É terminantemente proibido utilizar emojis nativos do sistema operacional como ícones de navegação ou botões.
3. **Navegação por Abas:** Todo botão de navegação principal deve possuir os atributos `role="tab"` e `data-tab="<secao>"` para homologação e captura visual de telas (`01-Secao.png`).
4. **Fiação de Botões & Optimistic UI:** Todo `<button>` dinâmico deve possuir `data-action` e `data-id`, disparar `fetch()` real para a API e atualizar imediatamente o DOM e o contador na interface.
5. **Persistência F5:** O estado da tela deve ser restaurado via `fetch()` do backend no evento `DOMContentLoaded`. O teste de recarregamento (F5) não pode resultar em tela branca ou perda de itens criados.
```

#### Arquivo: `.agents/rules/30-testing-eval.md`
```markdown
---
trigger: glob
globs: ["test/**", "tests/**", "**/*.test.*", "**/*.spec.*"]
description: Diretrizes para testes automatizados unitários, e2e e integração.
---

# Padrões de Testes & Homologação

1. **Isolamento de Estado:** Instâncias de banco SQLite em testes devem utilizar arquivos temporários ou `:memory:` para garantir independência total entre os casos de teste.
2. **Teardown de Processos:** Encerre explicitamente todos os servidores HTTP ou child processes ao final da execução em blocos `try / finally` (ou no hook `after()` do runner de testes).
3. **Cobertura de Casos de Borda:** Além do caminho feliz, teste rejeição de valores negativos, limites de paginação e resiliência offline com mock fallbacks (padrão DOCSIMP).
4. **Execução Determinística:** O comando de teste configurado na tarefa deve retornar `exit code 0` sem exigir intervenção interativa do usuário.
```

---

## 7. ROTEIRO DE TRANSIÇÃO E APLICAÇÃO ARQUITETURAL

Para implantar com segurança esta arquitetura no DecoHUB sem risco de regressão:

1. **Fase 1 — Modularização do `PromptManager`:**
   - Atualizar `PromptManager.ensureProjectRulesFile` para gravar as regras fracionadas (`00-core-invariants.md`, `10-backend-security.md`, `20-frontend-saas.md`, `30-testing-eval.md`) com seus respectivos frontmatters YAML em vez do arquivo monolítico `decohub-worker.md`.
   - Limitar rigorosamente o arquivo base `fable-worker-v2-flash-max.md` a menos de 13 KB.
2. **Fase 2 — Otimização de Referências no `PromptArchitectureService`:**
   - Trocar inlining de living specs por referências canônicas `@.ai-dev-hub/specs/<spec>.md`.
   - Ajustar `enforcePromptBudget` para proteger contratos da tarefa (Camada C) e podar unicamente ruído periférico.
3. **Fase 3 — Unificação do Planejamento Inicial:**
   - Alinhar `PROMPT_INICIAL_PLANEJAMENTO.md` com as 12 Grandes Tarefas (GT-1 a GT-12) e a gramática estrita do `controlledVerification.ts`.
4. **Fase 4 — Ativação dos Hooks Nativos de Verificação:**
   - Provisionar `.agents/hooks.json` com o evento `Stop`, criando o portão automatizado de não-finalização prévia.

---
*Relatório de Engenharia finalizado e homologado. Arquivo de referência persistido em `docs/DEEP_RESEARCH_PROMPTS_ANTIGRAVITY.md`.*
