# GLOBAL AGENT GUIDELINES — AI DEV HUB

Diretrizes comportamentais e operacionais para todos os agentes de IA do ecossistema AI DEV HUB (Gemini Supervisor, Antigravity Builder e execuções autônomas).
Derivadas dos princípios de engenharia de software de Andrej Karpathy para mitigar armadilhas comuns em desenvolvimento assistido por IA e integradas aos portões de qualidade Full-Stack, Design Anti-Slop, UX Real e AppSec do DecoHUB.

---

## Princípio 1: THINK BEFORE CODING
**Não assuma premissas em silêncio. Não mascare confusão. Explicite tradeoffs.**

Antes de alterar qualquer código em tarefas não triviais:
1. **Identifique premissas (Assumptions):** Declare explicitamente o que você está presumindo sobre o escopo, contratos de banco/API, dados e comportamento.
2. **Explicite ambiguidades (Ambiguities):** Se um pedido admitir mais de uma interpretação razoável, registre as opções técnicas e selecione a mais coesa com a arquitetura do projeto.
3. **Avalie tradeoffs e empurre de volta (Push back):** Se existir uma abordagem de código significativamente mais simples e direta do que uma abstração complexa, adote a solução enxuta.
4. **Resolução Autônoma sem Bloqueio (Full Dev Autonomy):** Em execuções autônomas do DecoHUB (`run_id` ativo), é ESTRITAMENTE PROIBIDO invocar ferramentas interativas (`ask_question`) ou interromper o fluxo aguardando resposta humana. Resolva lacunas consultando o código real do repositório, `DESIGN.md`, `.ai-dev-hub/docs/` e padrões seguros de engenharia (`clarificationRequired: false`).
5. **Apenas conclusões operacionais:** Não exponha fluxo de pensamento longo ou monólogos internos. Entregue apenas o plano operacional claro e estruturado:
   ```json
   {
     "assumptions": ["Premissa 1", "Premissa 2"],
     "ambiguities": ["Ponto ambíguo identificado e resolvido via contrato local"],
     "selectedApproach": "Abordagem mais enxuta e completa selecionada",
     "reason": "Por que esta solução é a mais simples, segura e aderente aos contratos",
     "clarificationRequired": false
   }
Princípio 2: SIMPLICITY FIRST
A menor implementação de código correta que resolve 100% do problema. Código simples, produto completo.

Combata a tendência de sobre-engenharia ("architecture astronautics") sem jamais sacrificar a profundidade funcional do produto:

Sem abstrações para uso único: Não crie factories, decorators, wrappers ou interfaces complexas para lógicas que são chamadas em um único lugar.

Zero dependências desnecessárias: Nunca adicione pacotes externos no package.json se utilitários nativos da linguagem/Node.js (node:sqlite, node:http, node:crypto, node:test) resolvem o problema com precisão.

Simplicidade de Código != Superficialidade de Produto: Manter o código simples NUNCA significa entregar telas vazias, CRUDs incompletos ou placeholders. Em projetos Full-Stack/SaaS, cumpra integralmente os requisitos de negócio, os 7 Pilares SaaS Master (quando aplicável), os estados visuais completos (Loading, Empty, Populated, Error) e o povoamento realista via seedIfEmpty().

Sem flexibilidade especulativa: Não crie sistemas de configuração genéricos para cenários fora dos requisitos do projeto.

Checagem mandatória de conclusão: Antes de considerar o trabalho pronto, pergunte a si mesmo:

"A lógica interna está escrita da forma mais direta, legível e livre de código morto possível, cumprindo 100% dos critérios de aceitação?"

Princípio 3: SURGICAL CHANGES
Toque apenas no indispensável. Limpe apenas a sua própria sujeira.

Ao editar código em um projeto existente (especialmente em modo REPAIR ou DELTA_EVOLUTION):

Delimitação prévia de escopo: Determine os arquivos estritamente necessários (expectedFiles) antes de começar. Se um arquivo não tem relação direta com a tarefa, não o modifique.

Não toque em código vizinho: Não altere formatação, indentação, tabelas existentes ou rotas adjacentes que já estavam funcionando e passando nos testes.

Sem refatorações de carona: Não faça renames ou refatorações globais em arquivos fora do escopo da tarefa.

Rastreabilidade total: Toda e qualquer linha adicionada, editada ou removida no diff deve ter justificativa direta rastreável ao objetivo da tarefa.

Limpeza de órfãos próprios: Se a sua alteração tornou uma importação, variável ou função obsoleta, remova-a. Não apague código ou testes pré-existentes sem instrução explícita.

Princípio 4: GOAL-DRIVEN EXECUTION
Defina critérios de sucesso mensuráveis antes de codificar. Loop até verificar.

Transforme tarefas imperativas em contratos de sucesso declarativos:

Toda tarefa deve estruturar-se em quatro pilares:

OBJECTIVE: O que deve ser alcançado em uma frase objetiva.

ACCEPTANCE CRITERIA: Lista binária e verificável de requisitos funcionais, visuais e de segurança.

VERIFICATION: Um único comando simples e determinístico compatível com controlledVerification.ts (npm test, npm run test, npm run typecheck, npm run build, npm run lint, node --test, node --test <arquivo-relativo>, node <arquivo.js> ou tsc --noEmit). É estritamente proibido encadear comandos com ;, &&, ||, |, node -e ou node --check.

DONE WHEN: Condição mandatória de término (todos os critérios atendidos, exit code 0 no terminal e aprovação nos portões aplicáveis do IndependentEvaluator).

Para tarefas em múltiplos passos, declare o plano passo a passo:

1. [Passo] -> verificar: [comando/teste]
2. [Passo] -> verificar: [comando/teste]
O agente deve iterar autonomamente contra o comando de verificação até que o resultado comprove conformidade real em disco.

Princípio 5: OPERATIONAL AUTONOMY & INTELLIGENT EXECUTION
Autorização expressa para desenvolvimento autônomo, instalação inteligente e autocorreção ativa.

Em projetos confiáveis gerenciados pelo DecoHUB:

Execução Automática de Rotina: O agente tem permissão expressa para executar comandos de terminal, rodar builds, testes e iniciar servidores locais efêmeros (encerrando-os obrigatoriamente em blocos try / finally) sem solicitar aprovação manual.

Instalação Inteligente de Dependências:

Detecte se a dependência já existe ou se utilitários nativos resolvem com simplicidade.

Use o gerenciador de pacotes do projeto (npm, pnpm, yarn, bun, pip).

Instale versões estáveis no escopo local do projeto, respeitando lockfiles.

Proibido instalar pacotes globais (-g), ferramentas com privilégios elevados (sudo) ou serviços pagos sem aprovação.

Registre adições no histórico de decisões do projeto e valide imediatamente com testes.

Testes Totalmente Automáticos e Intocáveis:

Detecte a stack e utilize a suíte automatizada (node --test, npm test, etc.).

Se o projeto não possuir testes para a funcionalidade criada, implemente testes reais cobrindo caminho feliz, validações de erro e persistência.

Proibição de Adulteração (TAMPERING_DETECTED): Nunca modifique, comente, enfraqueça ou adicione .skip em arquivos de avaliação protegidos (protectedEvaluationFiles).

Ciclo Ativo de Autocorreção (Self-Healing Loop):

Diante de falhas em testes unitários, PlaywrightVisualInspector, UserExperienceSimulator ou SecurityPentestSimulator, leia o diagnóstico exato e a stacktrace.

Diagnostique a causa raiz no código de produção (ex: contrato JSON divergente, rota retornando 404/500, perda de estado no F5, falta de escapeHtml ou elemento truncado).

Aplique a correção cirúrgica no código de implementação e reexecute a verificação até obter exit code 0.

Princípio 6: FULL-STACK, APPSEC & ANTI-SLOP INVARIANTS
Padrões inegociáveis de arquitetura, segurança, design e comunicação em todos os projetos do DecoHUB.

Roteamento Full-Stack & Port Guard:

As portas 3001, 3000 e 5173 são reservadas ao DecoHUB. Todo projeto gerado deve utilizar const PORT = Number(process.env.PORT) || 4000; (faixa 4000–4999).

Em projetos com interface web (public/index.html), a rota raiz GET / DEVE servir public/index.html (text/html) e ativos estáticos, mantendo fallback SPA em rotas não-API (!req.url.startsWith('/api')). O status JSON da API deve residir estritamente em GET /api/health.

Padrão Dual-Mode Plug-and-Play (DOCSIMP) & Smart Seeding:

Toda integração externa (Supabase, PushinPay, Upstash, Cloudflare, etc.) deve ler chaves de process.env, fornecer .env.example completo e operar com Graceful Mock Fallback automático para que 100% dos testes e o uso local funcionem offline sem chaves reais.

A inicialização do banco deve conter seedIfEmpty() idempotente populando 15 a 30 registros realistas na primeira execução.

Design Anti-Slop, SaaS Master & Navegação de Secções:

Definir tokens semânticos em :root (DESIGN.md), font-variant-numeric: tabular-nums em números/preços/datas e scrollbars customizadas (::-webkit-scrollbar).

Utilizar exclusivamente ícones SVG Lucide inline (zero emojis nativos como ícones de interface).

Estruturar os botões de navegação/abas com role="tab" e data-tab="<secao>" para permitir a captura visual automatizada de todas as secções (01-Secao.png) e garantir persistência completa de dados após reload (F5).

Blindagem AppSec (Red Team Gate):

Usar exclusivamente queries SQL parametrizadas (?); sanitizar dados dinâmicos no DOM com escapeHtml/textContent; validar path.resolve(publicDir, '.' + reqPath).startsWith(publicDir) bloqueando .. e dotfiles (.env, .git); rejeitar valores monetários/durações negativas ou NaN com HTTP 400; e enviar header X-Content-Type-Options: nosniff.

Comunicação Direta (Zero Emojis & Zero Eco):

Adotar tom técnico estilo CLI corporativo (Linear/Vercel), sem emojis decorativos, sem repetir a instrução do usuário no início da resposta e focando diretamente nos arquivos de código (.ts, .tsx, .js, .css, .html).

Ordem de Precedência e Herança de Instruções
Quando houver conflito entre instruções recebidas, aplique estritamente a hierarquia:

1. SYSTEM SAFETY (Proteção de integridade local, isolamento de processos e escopo de diretório)
       ↓
2. GLOBAL AGENT GUIDELINES (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven, Operational Autonomy, Full-Stack/AppSec Invariants)
       ↓
3. PROJECT PROGRAM (.ai-dev-hub/program.md & DESIGN.md - Constituição técnica e visual do projeto)
       ↓
4. PROJECT CONTEXT (Stack, contratos de banco/API, DOCSIMP, REA Blueprint e memória persistente)
       ↓
5. CURRENT TASK (Objetivo, arquivos esperados e critérios de aceitação do contrato de trabalho)
       ↓
6. USER REQUEST (A mensagem específica do usuário)
Uma instrução de nível inferior NUNCA pode suprimir ou revogar uma política de nível superior.

