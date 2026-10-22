# SISTEMA DE DESIGN VISUAL ANTI-SLOP & DIRETRIZES DE UI (DESIGN.MD)

> **Fonte Canônica de Design do Test Project Force Unlock:** Este documento dita as cores, tipografia, tokens CSS, coreografia e estados de interface que impedem qualquer degradação de qualidade visual (Anti-Slop).

---

## 1. Arquétipo Visual, Dials & Habilidades de Design Injetadas Autonomamente
- **Arquétipo Selecionado:** `LINEAR` (Linear Software Craft: Design dark premium, superfícies carvão (#0f1011), destaque lavanda (#5e6ad2) e precisão de engenharia.)
- **Skill Estética Injetada Automaticamente:** `linear-skill` (autonomamente provisionada para o nicho "SaaS Corporativo Moderno & Gestão de Operações" sem necessidade de slash commands manuais)
- **Dials de Taste:**
  - **Variância:** 5/10 (Equilíbrio e Simetria)
  - **Movimento:** 3/10 (Transições CSS Suaves <150ms)
  - **Densidade:** 3/10 (Cockpit de Alta Densidade / SaaS Master)

---

## 2. Paleta de Tokens CSS Semânticos Obrigatórios (`:root`)
Todo estilo de componentes deve consumir estritamente as variáveis abaixo, proibindo cores hexadecimais soltas nas regras CSS:

```css
:root {
  /* Superfícies & Fundos */
  --bg-primary: #090d16;
  --bg-surface: #111726;
  --bg-elevated: #1a2236;

  /* Tipografia & Contraste */
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;

  /* Cor de Ação & Destaque */
  --accent-primary: #3b82f6;
  --accent-hover: #4f46e5;
  --accent-subtle: rgba(99, 102, 241, 0.12);

  /* Bordas & Divisores */
  --border-subtle: #1e293b;
  --border-strong: #334155;

  /* Estados Semânticos */
  --status-success: #10b981;
  --status-warning: #f59e0b;
  --status-danger: #ef4444;
  --status-info: #0ea5e9;

  /* Raios e Tipografia */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', Menlo, Consolas, monospace;
}
```

---

## 3. Regras Tipográficas & Numéricas
- **Interface Principal:** Fonte `Inter` para labels, títulos e textos com espaçamento reduzido e peso 500/600.
- **Regra Numérica Obrigatória (`tabular-nums`):** Todos os valores monetários, percentuais, contadores, datas e células numéricas de Data Grid devem aplicar:
  ```css
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  font-family: var(--font-mono);
  ```

---

## 4. Especificação de Componentes
- **Botões:** Estados `:hover`, `:active` (`transform: scale(0.98)`) e `:disabled` com opacidade 0.5.
- **Inputs & Selects:** Borda `--border-subtle`, foco com outline de 2px em `--accent-primary` e transição suave.
- **Command Palette (`Ctrl+K`):** Overlay elevado em `--bg-elevated`, pesquisa debounce e atalhos rápidos de navegação.
- **Slide-Over Detail Drawer:** Animação lateral suave a partir da direita (`transform: translateX(0)`) com backdrop blur.
- **Ícones:** Uso exclusivo de **ícones SVG Lucide inline** (24x24 ou 16x16, stroke-width 2). **Zero emojis nativos como ícones.**

---

## 5. Os 4 Estados Visuais Obrigatórios em Cada Tela
1. **Loading Skeleton:** Shimmer translúcido ocupando a área exata dos cards e tabelas durante requisições.
2. **Empty State:** Ícone SVG temático suave, mensagem explicativa clara e botão primário para criar o primeiro registro.
3. **Populated State:** Grade rica com alta densidade, paginação, busca instantânea e ordenação.
4. **Error Toast:** Alerta flutuante com auto-dismiss (4s) e opção de repetição da ação.
