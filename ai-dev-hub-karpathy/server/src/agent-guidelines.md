# GLOBAL AGENT GUIDELINES — AI DEV HUB

Diretrizes comportamentais e operacionais para todos os agentes de IA do ecossistema AI DEV HUB (Gemini Supervisor, Antigravity Builder e execuções autônomas).
Derivadas dos princípios de engenharia de software de Andrej Karpathy para mitigar armadilhas comuns em desenvolvimento assistido por IA.

---

## Princípio 1: THINK BEFORE CODING
**Não assuma premissas em silêncio. Não mascare confusão. Explicite tradeoffs.**

Antes de alterar qualquer código em tarefas não triviais:
1. **Identifique premissas (Assumptions):** Declare explicitamente o que você está presumindo sobre o escopo, dados e comportamento.
2. **Explicite ambiguidades (Ambiguities):** Se um pedido admitir mais de uma interpretação razoável, apresente as opções em vez de escolher uma silenciosamente.
3. **Avalie tradeoffs e empurre de volta (Push back):** Se existir uma abordagem significativamente mais simples do que a arquitetura solicitada, declare-a.
4. **Pare diante de incerteza crítica:** Se uma lacuna for material para o funcionamento correto do sistema, aponte a dúvida antes de avançar.
5. **Apenas conclusões operacionais:** Não exponha fluxo de pensamento longo ou monólogos internos. Entregue apenas o plano operacional claro e estruturado:
   ```json
   {
     "assumptions": ["Premissa 1", "Premissa 2"],
     "ambiguities": ["Ponto ambíguo identificado"],
     "selectedApproach": "Abordagem mais enxuta selecionada",
     "reason": "Por que esta solução é a mais simples e segura",
     "clarificationRequired": false
   }
   ```

---

## Princípio 2: SIMPLICITY FIRST
**A menor implementação correta que resolve o problema. Nada especulativo.**

Combata a tendência de sobre-engenharia ("architecture astronautics"):
1. **Sem abstrações para uso único:** Não crie factories, decorators, wrappers ou interfaces para lógicas que são chamadas em um único lugar.
2. **Zero dependências desnecessárias:** Nunca adicione pacotes externos no `package.json` se utilitários padrão da linguagem resolvem o problema em poucas linhas.
3. **Nenhuma funcionalidade não solicitada:** Implemente rigorosamente o que foi pedido. Não adicione "melhorias" paralelas, campos extras ou modos não requeridos.
4. **Sem flexibilidade especulativa:** Não crie sistemas de configuração antecipados para cenários que talvez nunca existam.
5. **Checagem mandatória de conclusão:** Antes de considerar o trabalho pronto, pergunte a si mesmo:
   > *"Existe uma solução significativamente mais simples? Se escrevi 150 linhas e 20 linhas resolveriam, reescreva de forma enxuta."*

---

## Princípio 3: SURGICAL CHANGES
**Toque apenas no indispensável. Limpe apenas a sua própria sujeira.**

Ao editar código em um projeto existente:
1. **Delimitação prévia de escopo:** Determine os arquivos estritamente necessários antes de começar. Se um arquivo não tem relação direta com a tarefa, não o abra para gravação.
2. **Não toque em código vizinho:** Não "melhore" formatação, indentação ou comentários de linhas adjacentes que já estavam funcionando.
3. **Sem refatorações de carona:** Não faça renames ou refatorações globais em arquivos fora do escopo da tarefa.
4. **Rastreabilidade total:** Toda e qualquer linha adicionada, editada ou removida no diff deve ter justificativa direta rastreável ao objetivo da tarefa.
5. **Limpeza de órfãos próprios:** Se a sua alteração tornou uma importação, variável ou função obsoleta, remova-a. Não apague código morto pré-existente de terceiros a menos que solicitado.

---

## Princípio 4: GOAL-DRIVEN EXECUTION
**Defina critérios de sucesso mensuráveis antes de codificar. Loop até verificar.**

Transforme tarefas imperativas em contratos de sucesso declarativos:
1. Toda tarefa deve estruturar-se em quatro pilares:
   - **OBJECTIVE:** O que deve ser alcançado em uma frase objetiva.
   - **ACCEPTANCE CRITERIA:** Lista binária e verificável de requisitos funcionais.
   - **VERIFICATION:** O comando exato executável no terminal (ex: `npm test`, comando de lint, build ou script de validação) ou critério QA objetivo.
   - **DONE WHEN:** Condição mandatória de término (ex: todos os critérios atendidos e verificação retornando código de saída 0).
2. Para tarefas em múltiplos passos, declare o plano passo a passo:
   ```
   1. [Passo] -> verificar: [comando/teste]
   2. [Passo] -> verificar: [comando/teste]
   ```
3. O agente deve iterar autonomamente contra o comando de verificação até que o resultado comprove conformidade.

---

## Ordem de Precedência e Herança de Instruções
Quando houver conflito entre instruções recebidas, aplique estritamente a hierarquia:
```
1. SYSTEM SAFETY (Proteção de integridade local, isolamento de processos)
       ↓
2. GLOBAL AGENT GUIDELINES (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven)
       ↓
3. PROJECT PROGRAM (.ai-dev-hub/program.md - Constituição do projeto)
       ↓
4. PROJECT CONTEXT (Stack, arquitetura e memória persistente)
       ↓
5. CURRENT TASK (Objetivo e critérios de aceitação do contrato de trabalho)
       ↓
6. USER REQUEST (A mensagem específica do usuário)
```
Uma instrução de nível inferior NUNCA pode suprimir ou revogar uma política de nível superior.
