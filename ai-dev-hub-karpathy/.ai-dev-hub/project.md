# Projeto: AI DEV HUB

## Objetivo Principal
Centralizar o desenvolvimento autônomo local e orquestração de agentes de IA com preservação de memória permanente, continuidade multi-contas (Google Pro 1, Google Pro 2, etc.) e interface Simple IDE unificada (Desktop Electron + Web React).

## Contexto do Produto
O AI DEV HUB é uma plataforma local completa para desenvolvedores gerenciarem projetos de software assistidos e conduzidos por agentes de IA inteligentes. O ecossistema suporta execução sob demanda, modos autônomos persistentes (24/7) com Supervisor Gemini e Builder Antigravity, integração via Model Context Protocol (MCP) e controle de versões via Git local.

## Funcionamento Esperado
- Operação local rápida, confiável e resiliente suportada por Node.js e SQLite (`node:sqlite`).
- Preservação perpétua de contexto e estado entre sessões via pasta `.ai-dev-hub/` (Markdown) e banco de dados unificado (`hub.db`).
- Sistema Multi-Worker com leases atômicas, renovação periódica de leases e recuperação automática pós-falha.
- Troca de perfis/contas com preservação ininterrupta de sessões e checkpoints automáticos.
- Interface Simple IDE em 3 colunas: Sidebar de Projetos, Chat/Execução e File Explorer recolhível, complementados por DiffModal e TerminalDrawer.
- Auditoria de segurança e governança de comandos com PolicyEngine (riscos Green, Orange e Red com Approval Inbox).
