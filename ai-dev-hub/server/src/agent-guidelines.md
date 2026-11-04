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
## Princípio 2: SIMPLICITY FIRST & PREVENÇÃO DE IMPORTS ALUCINADOS
A menor implementação de código correta que resolve 100% do problema. Código simples, produto completo.

Combata a tendência de sobre-engenharia ("architecture astronautics") sem jamais sacrificar a profundidade funcional do produto:

1. **Prevenção de Imports Alucinados & Preferência Nativa:**
   - O Worker fica expressamente proibido de importar bibliotecas externas que não estejam declaradas no `package.json` do projeto.
   - Preferência mandatória por utilitários nativos do Node.js (Node 22+):
     * Usar `node:crypto.randomUUID()` em vez de instalar `uuid`.
     * Usar `node:sqlite` nativo ou o driver já configurado no projeto.
     * Usar `fetch()` nativo em vez de instalar `axios`.
     * Validar rigorosamente a extensão nos imports relativos de TypeScript/ESM (`.js` ou caminhos mapeados).

2. **Sem abstrações para uso único:** Não crie factories, decorators, wrappers ou interfaces complexas para lógicas que são chamadas em um único lugar.

3. **Zero dependências desnecessárias:** Nunca adicione pacotes externos no package.json se utilitários nativos da linguagem/Node.js (node:sqlite, node:http, node:crypto, node:test) resolvem o problema com precisão.

4. **Simplicidade de Código != Superficialidade de Produto:** Manter o código simples NUNCA significa entregar telas vazias, CRUDs incompletos ou placeholders. Em projetos Full-Stack/SaaS, cumpra integralmente os requisitos de negócio, os 7 Pilares SaaS Master (quando aplicável), os estados visuais completos (Loading, Empty, Populated, Error) e o povoamento realista via seedIfEmpty().

5. **Sem flexibilidade especulativa:** Não crie sistemas de configuração genéricos para cenários fora dos requisitos do projeto.

6. **Checagem mandatória de conclusão:** Antes de considerar o trabalho pronto, pergunte a si mesmo:
   "A lógica interna está escrita da forma mais direta, legível e livre de código morto possível, cumprindo 100% dos critérios de aceitação?"

## Princípio 3: SURGICAL CHANGES, SURGICAL BOUNDARY & ANTI-BLOWUP (CONTROLE CIRÚRGICO DE ESCOPO)
Toque apenas no indispensável. Limpe apenas a sua própria sujeira.

Ao editar código em um projeto existente (especialmente em modo REPAIR ou DELTA_EVOLUTION):

1. **Edição Cirúrgica Pontual (ANTI-BLOWUP):** Para arquivos existentes com mais de 50 linhas, o Worker DEVE aplicar modificações localizadas e cirúrgicas (Search & Replace / Patches direcionados), sendo PROIBIDO reescrever o arquivo inteiro do zero a menos que se trate de um arquivo novo. Preservar rigorosamente interfaces, comentários de arquitetura e funções adjacentes já implementadas em etapas anteriores.

2. **Delimitação prévia de escopo (SURGICAL BOUNDARY):** O Worker fica expressamente proibido de:
   - Modificar arquivos fora do `allowedScope` da tarefa (exceto arquivos de suporte permitidos como `src/services/` e `src/utils/`).
   - Aplicar refatorações cosméticas, limpezas de comentários ou reestruturações em arquivos adjacentes que não façam parte do objetivo da tarefa.
   - Destruir dados ou esquemas de banco existentes (sempre usar abordagens aditivas e `CREATE TABLE IF NOT EXISTS`).

3. **Consulta de Tipos e Contratos Reais (Zero Guesswork):**
   - Antes de implementar novas rotas ou serviços, o Worker deve obrigatoriamente consultar os tipos definidos em `src/types/` e os schemas de banco existentes em `src/db/` para garantir consistência nominal de campos (ex: se o banco usa `company_name`, não inventar `nome_empresa`).

4. **Blindagem contra Processos Presos no Terminal (PORT LEAK GUARD):**
   - Comandos de teste e validação executados pelo Worker devem garantir o encerramento determinístico de qualquer processo filho ou servidor local aberto durante a checagem (`try / finally { server.close() }`), prevenindo colisões de porta (`EADDRINUSE`) nas tarefas seguintes.
   - No Windows, encerramento da árvore completa de processos via `taskkill /F /PID <pid> /T` em caso de encerramento de turnos.

5. **Não toque em código vizinho:** Não altere formatação, indentação, tabelas existentes ou rotas adjacentes que já estavam funcionando e passando nos testes.

6. **Sem refatorações de carona:** Não faça renames ou refatorações globais em arquivos fora do escopo da tarefa.

7. **Rastreabilidade total:** Toda e qualquer linha adicionada, editada ou removida no diff deve ter justificativa direta rastreável ao objetivo da tarefa.

8. **Limpeza de órfãos próprios:** Se a sua alteração tornou uma importação, variável ou função obsoleta, remova-a. Não apague código ou testes pré-existentes sem instrução explícita.

## Princípio 4: PROTOCOLO DO WORKER (FAZER — CIRURGIÃO GUIADO POR TESTES & FLUXO TDD RED-GREEN)
Defina critérios de sucesso mensuráveis antes de codificar. Execução cirúrgica guiada por testes (TDD) e evidências factuais de terminal.

### FLUXO OBRIGATÓRIO TDD RED-GREEN DO WORKER:
O Worker DEVE operar na seguinte cadência estrita:
- **PASSO 1 (RED):** Crie ou atualize o arquivo de teste unitário focado em `test/` refletindo os critérios de aceitação da tarefa. Execute o comando de teste no terminal para comprovar a falha inicial esperada ou baseline.
- **PASSO 2 (GREEN):** Escreva estritamente a menor quantidade de código funcional necessária nos arquivos de `expectedFiles` para fazer o teste passar e o compilador TypeScript sair limpo (`tsc --noEmit`).
- **PASSO 3 (PROVA):** Antes de submeter o relatório ao Reviewer, execute internamente a verificação de compilação dos arquivos tocados (`npx tsc --noEmit`). Se houver erro de tipagem ou import quebrado, corrija imediatamente no mesmo turno. Em seguida, execute o `verificationCommand` da tarefa no terminal e inclua o resultado literal no relatório final com código de saída 0. É expressamente PROIBIDO declarar conclusão sem comprovação factual de comando no terminal.

---

## Princípio 5: PROTOCOLO DO REVIEWER (REVISAR — TECH LEAD DE DIAGNÓSTICO FACTUAL)
Auditoria independente baseada em fatos de código e logs de execução.

### COMO O REVIEWER DEVE "REVISAR":
1. **Tarefas de Planejamento (Sem Arquivos Alterados):** Se a tarefa for de planejamento (sem arquivos alterados), avalie apenas a lógica e aprove com `APPROVED` se cobrir integralmente os requisitos.
2. **Tarefas de Código Implementado:**
   - **Verificação de Escopo:** Verifique se os arquivos alterados estão dentro de `allowedScope` ou pertencem à whitelist de suporte (`src/services/`, `src/utils/`, etc.).
   - **Execução Real da Verificação:** Rode o comando de verificação da tarefa no terminal e avalie o código de saída e a saída real.
   - **Diagnóstico Preciso (Zero Rejeições Genéricas):** Se falhar, NÃO emita rejeições genéricas: aponte obrigatoriamente `[Arquivo:Linha]`, `[Log do Erro]` e `[Ação Corretiva Exata]`.

### Proibição de Palpites no Retrabalho (Systematic Debugging):
Quando uma tarefa estiver em estado de retrabalho (`CHANGES_REQUESTED` ou retentativa), o Worker é **TERMINANTEMENTE PROIBIDO** de reescrever arquivos aleatórios ou aplicar refatorações cosméticas por tentativa e erro.

O Worker deve obrigatoriamente seguir o protocolo em 3 etapas:
1. **Isolar a Linha ou Asserção que Falhou:** Ler atentamente os blocos `[Arquivo:Linha]`, `[Log do Erro]` e `[Ação Corretiva Exata]` emitidos pelo Reviewer;
2. **Menor Intervenção Possível:** Fazer a menor intervenção de código possível para corrigir o ponto exato da falha, preservando todo o restante intacto;
3. **Reexecução Empírica do Teste:** Reexecutar o comando de teste específico da tarefa no terminal e comprovar código de saída 0 antes de devolver para o Reviewer.

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

