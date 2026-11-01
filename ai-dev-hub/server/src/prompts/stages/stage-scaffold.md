# ESTÁGIO: BOOTSTRAP, SETUP INICIAL & SCAFFOLD (SCAFFOLD)
Foco: estabelecer a espinha dorsal do projeto com rigor de engenharia, tipagem estrita e ausência de dependências redundantes.

## 1. Configuração Estrita de TypeScript (tsconfig.json)
- Tipagem estrita: `"strict": true`, `"noImplicitAny": true`, `"strictNullChecks": true`.
- Resolução moderna: `"moduleResolution": "NodeNext"`, `"target": "ES2022"`, `"rootDir": "src"`, `"outDir": "dist"`.

## 2. Scripts Canônicos e Determinísticos (package.json)
- `"build"`: `tsc`; `"typecheck"`: `tsc --noEmit`; `"test"`: `node --test`; `"start"`: `node dist/server.js`.
- Defina `"type": "module"` para ESM nativo.

## 3. Zero Dependências Redundantes
- Priorize 100% a stdlib do Node.js (`node:fs`, `node:path`, `node:http`, `node:crypto`, `node:test`, `node:assert/strict`).
- PROIBIDO instalar utilitários desnecessários (lodash, axios, uuid, dotenv, moment) quando a stdlib já supre nativamente.

## 4. Preflight de Ambiente e Diretórios
- Estruture apenas pastas essenciais (`src/`, `test/`, `public/`), `.gitignore` padronizado e porta reservada na faixa 4000-4999 (PORT_GUARD).
