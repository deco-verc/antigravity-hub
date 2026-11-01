# ESTÁGIO: PERSISTÊNCIA, MODELAGEM RELACIONAL & DDL (DATABASE)
Foco: esquemas DDL limpos, integridade referencial, queries parametrizadas e transações ACID com SQLite.

## 1. Conexão & Pragmas WAL (better-sqlite3)
- Pragmas obrigatórios: `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;`.

## 2. DDL Tipado & Chaves Estrangeiras
- Tabelas: `CREATE TABLE IF NOT EXISTS` com tipos estritos (`INTEGER PRIMARY KEY AUTOINCREMENT`, `TEXT NOT NULL`, `INTEGER DEFAULT 0`, `CHECK`).
- Foreign Keys: integridade referencial explícita com `FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE`.
- Índices: `CREATE INDEX IF NOT EXISTS idx_<tabela>_<coluna>` em chaves estrangeiras e buscas frequentes.

## 3. Transações ACID & Queries 100% Parametrizadas
- Blindagem anti-SQLi: PROIBIDO concatenar variáveis. Use exclusivamente placeholders `?` ou `:param` (`db.prepare('... WHERE id = ?').get(id)`).
- Operações multi-tabela em transação atômica via `db.transaction((fn) => ...)()`.

## 4. Smart Demo Seeding Idempotente (seedIfEmpty)
- Rotina `seedIfEmpty()`: se tabelas vazias, popule 15-30 registros realistas e relacionais para homologação.
- Valide números finitos e não-negativos (`Number.isFinite(val) && val >= 0`).
