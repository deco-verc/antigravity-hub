# Project Program: AI DEV HUB

## Objective
Central de Desenvolvimento Autonomo com Memoria Permanente

## Product Principles
- **Think Before Coding**: Explicitar premissas e opções antes de escrever código; não presumir decisões críticas em silêncio.
- **Simplicity First**: Menor código correto que resolve o problema; sem classes, factories ou interfaces especulativas para uso único.
- **Surgical Changes**: Toda linha modificada deve ser diretamente rastreável à tarefa solicitada; sem alterações cosméticas ortogonais.
- **Goal-Driven Execution**: Toda tarefa possui objetivo declarado, critérios de aceitação binários e comando de teste automatizado.

## Technical Constraints
- Respeitar padrões de arquitetura e convenções da stack do projeto.
- Não introduzir dependências externas no package.json sem justificativa aceita.
- Garantir que todos os testes automatizados existentes continuem passando com código de saída 0.

## Allowed Actions
- Ler e analisar qualquer arquivo dentro do diretório do projeto.
- Criar e editar arquivos estritamente pertencentes ao escopo da tarefa em andamento.
- Executar comandos locais de compilação, teste, formatação e verificação de integridade via terminal.

## Human Approval Required
- Exclusão ou drop de bancos de dados ou arquivos de dados persistentes.
- Alterações em segredos, credenciais, tokens ou variáveis sensíveis de produção.
- Mudanças drásticas de arquitetura ou substituição de bibliotecas centrais do projeto.

## Verification
- Testes automatizados executáveis no terminal (ex: `npm test`, `npm run build`, etc.).
- Verificação de ausência de erros em tempo de execução no console.
- **Critério de término (DONE WHEN)**: 100% dos critérios de aceitação atendidos e comando de verificação com saída 0.

## Quality Standards
- Código tipado, limpo, modular e sem dead code introduzido.
- Tratamento explícito e seguro de erros operacionais.
- Manter o histórico de memória e checkpoints do AI DEV HUB sincronizados.

## Autonomous Behavior
- O agente tem autonomia para iterar e corrigir erros apontados pelo comando de verificação até que todos passem.
- Se uma abordagem causar quebra irrecuperável, reverter as alterações (rollback cirúrgico) antes de tentar nova abordagem.

## Forbidden Changes
- Proibido refatorar arquivos funcionais adjacentes que não façam parte do objetivo da tarefa.
- Proibido alterar harness de testes para falsear aprovações sem resolver a causa raiz.
- Proibido formatar globalmente repositórios ou alterar convenções de estilo estabelecidas.
