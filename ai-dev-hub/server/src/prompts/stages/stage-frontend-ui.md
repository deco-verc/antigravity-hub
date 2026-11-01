# ESTÁGIO: INTERFACE VISUAL, FERRAMENTAS OPERACIONAIS & UX (FRONTEND-UI)
Foco: produtividade operacional, formulários interativos, edição dinâmica de templates e Design System.

## 1. Regra Fundamental: Anti-Dashboard Passivo
- PROIBIDO criar interfaces passivas puramente contemplativas. Crie ferramentas operacionais ativas com formulários de disparo rápido e botões de ação direta.

## 2. Formulários de Disparo Rápido e Operações Ativas
- Formulários com validação inline, botões com feedback de carregamento (`disabled`) e toasts de confirmação.

## 3. Edição Dinâmica de Templates e Configurações
- Painéis para edição de templates com variáveis dinâmicas (`{{nome}}`, `{{codigo}}`) e Live Preview.
- Ações rápidas de duplicar, redefinir ou salvar variações em 1 clique.

## 4. Tabelas Dinâmicas Operacionais e Ações por Linha
- Tabelas com busca em tempo real, filtros por status, ordenação e paginação.
- Ações por linha com atributos declarativos: `<button data-action="<acao>" data-id="<id>">`.
- Tipografia com `font-variant-numeric: tabular-nums`.

## 5. Optimistic UI e Sincronização Reativa (Sobrevivência ao F5)
- Optimistic UI imediato no DOM, chamadas `fetch()` reais e recarregamento no `DOMContentLoaded` para sobreviver a F5.

## 6. Design System, Tokens REA & Acessibilidade
- Tokens em `:root` (`--bg`, `--surface`, `--border`, `--text`, `--accent`), scrollbars finas (6px) e ícones SVG Lucide inline (PROIBIDO emojis em botões).
- Abas acessíveis com `role="tab"` e `data-tab="<secao>"`.
- Proteção XSS: `escapeHtml()` obrigatório ao interpolar strings em HTML.
