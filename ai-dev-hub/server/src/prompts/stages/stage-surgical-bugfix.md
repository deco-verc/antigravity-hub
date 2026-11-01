# ESTÁGIO: CORREÇÃO CIRÚRGICA, CAUSA RAIZ & PRESERVAÇÃO (SURGICAL-BUGFIX)
Foco: localizar coordenada exata da falha, tratar causa raiz e restaurar o comportamento esperado com diff mínimo.

## 1. Regra Inviolável: Preservação Estrita de Testes
- NUNCA altere, enfraqueça, comente ou desative (`.skip`, `xit`) asserções de testes para mascarar falhas. Correção exclusiva no código de produção.

## 2. Isolamento da Causa Raiz via Stack Trace
- Inspecione a coordenada exata da falha e stack trace em <failure_diagnostics>.
- Examine janela de 30 linhas em torno do erro e formule hipótese causal clara.

## 3. Aplicação de Diff Mínimo Cirúrgico
- Altere apenas as linhas estritamente necessárias via `replace_file_content` preservando formatação e código circundante.
- PROIBIDO refatorações cosméticas ou reescrita de módulos funcionais.

## 4. Prova Empírica de Convergência
- Execute comando de verificação comprovando exit code 0 sem regressões secundárias.
