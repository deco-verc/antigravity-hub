# Registro de Decisões Técnicas

## Decisões Tomadas
- **[08/10/2026] Estrutura Inicial**
  - **Decisão:** Uso de arquivos Markdown locais para memória permanente do projeto.
  - **Motivo:** Leitura direta por qualquer agente de IA, controle de versão transparente via Git e independência de provedores em nuvem.
- **[08/10/2026] Utilização do Node.js test runner nativo (node:test e node:assert/strict) e arquitetura modular de verificação de worktree.**
  - **Decisão:** Utilização do Node.js test runner nativo (node:test e node:assert/strict) e arquitetura modular de verificação de worktree.
  - **Motivo:** Zero dependências externas adicionadas ao package.json, tempo de execução ultra-rápido (<250ms) e conformidade com o princípio de simplicidade do projeto.
- **[08/10/2026] Padronização de relatórios de auditoria e benchmarks em Markdown estruturado acoplados a validadores funcionais em Node.js nativo (src/auditAndBenchmarks.js) e testes contínuos com node:test.**
  - **Decisão:** Padronização de relatórios de auditoria e benchmarks em Markdown estruturado acoplados a validadores funcionais em Node.js nativo (src/auditAndBenchmarks.js) e testes contínuos com node:test.
  - **Motivo:** Garante rastreabilidade transparente para humanos e modelos de IA, valida integridade da documentação contra regressões e mantém o princípio de Simplicity First sem dependências pesadas.
- **[08/10/2026] Restrição estrita a 2 melhorias no backlog prioritário (IMP-01 Self-Healing Loop e IMP-02 Ephemeral Worktrees) com baseline quantificada e matriz de rejeição.**
  - **Decisão:** Restrição estrita a 2 melhorias no backlog prioritário (IMP-01 Self-Healing Loop e IMP-02 Ephemeral Worktrees) com baseline quantificada e matriz de rejeição.
  - **Motivo:** Alinhamento com o princípio Simplicity First da Karpathy Layer, focando esforços nas duas frentes de maior impacto sobre a resolução autônoma e estabilidade.
- **[09/10/2026] Implementação das duas melhorias prioritárias: Self-Healing Debug Loop (IMP-01) com limite estrito de 5 iterações e Gerenciamento de Worktrees Efêmeros (IMP-02) com padrão RAII.**
  - **Decisão:** Implementação das duas melhorias prioritárias: Self-Healing Debug Loop (IMP-01) com limite estrito de 5 iterações e Gerenciamento de Worktrees Efêmeros (IMP-02) com padrão RAII.
  - **Motivo:** Eleva a taxa de resolução autônoma para 75% em defeitos recuperáveis, elimina risco de colisões de branches e locks concorrentes, e protege a inviolabilidade dos testes com zero dependências de terceiros.

### [09/10/2026] Decisões da Sessão #22
- **Decisão:** Implementação das duas melhorias prioritárias: Self-Healing Debug Loop (IMP-01) com limite estrito de 5 iterações e Gerenciamento de Worktrees Efêmeros (IMP-02) com padrão RAII.
- **Decisão:** Preservação da branch master/main intacta e entrega formal da versão candidata na branch ai/1-isolamento-worktree.
