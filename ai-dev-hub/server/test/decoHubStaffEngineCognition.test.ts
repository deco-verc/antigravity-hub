// server/test/decoHubStaffEngineCognition.test.ts
// Validação e Homologação dos 4 Pilares: Staff Engineer Cognition Upgrade (DecoHUB Master Engine)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { AstSymbolIndexService } from '../src/astSymbolIndexService.js';
import { DecoMindMlService } from '../src/decoMindMlService.js';
import { PromptArchitectureService } from '../src/promptArchitectureService.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';

describe('DecoHUB Master Engine: Upgrade de Cognição & Inteligência Arquitetural (Staff Engineer)', () => {
  let tmpDir: string;
  const testProjectId = 'test-staff-engine-proj';

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-staff-engine-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });

    // Cria arquivos com schemas, classes, rotas e funções
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'db.ts'),
      `
      import { Database } from 'sqlite3';
      export interface UserAccount {
        id: string;
        email: string;
        createdAt: string;
      }
      export class DbConnection {
        static init() {
          const sql = "CREATE TABLE IF NOT EXISTS user_accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL);";
          return sql;
        }
      }
      export function getUser(id: string): UserAccount | null {
        return null;
      }
      `
    );

    fs.writeFileSync(
      path.join(tmpDir, 'src', 'server.ts'),
      `
      import express from 'express';
      const app = express();
      app.get('/api/users', (req, res) => res.json([]));
      app.post('/api/users', (req, res) => res.json({ ok: true }));
      export const startServer = () => app.listen(4000);
      `
    );
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // PILAR 1: RACIOCÍNIO ADVERSARIAL PRÉ-PLANEJAMENTO (PRE-MORTEM ANALYSIS)
  it('Pilar 1: Pre-Mortem Analysis está presente nos prompts de Onda 1 e injeta critérios preventivos', () => {
    const blueprintPrompt = PromptArchitectureService.buildArchitecturalBlueprintPrompt({
      projectId: testProjectId,
      projectName: 'Finance SaaS',
      projectPath: tmpDir,
      briefing: 'Criar SaaS com SQLite, exportação de CSV e rotas de API'
    });

    assert.ok(
      blueprintPrompt.prompt.includes('ANÁLISE PRE-MORTEM (ANTECIPAÇÃO DE FALHAS)'),
      'Blueprint deve conter ANÁLISE PRE-MORTEM (ANTECIPAÇÃO DE FALHAS)'
    );
    assert.ok(
      blueprintPrompt.prompt.includes('SQLite WAL') && blueprintPrompt.prompt.includes('travessia de diretório'),
      'Blueprint deve conter exemplos de falhas como concorrência no SQLite WAL e travessia de diretório'
    );

    // Valida que injectArchitecturalBoundaryCriteria injeta mitigações do Pre-Mortem
    const criteriaBackend = GeminiSupervisorProvider.injectArchitecturalBoundaryCriteria([], 'GT-1', 'Backend SQLite', 1);
    assert.ok(
      criteriaBackend.some(c => c.includes('PRAGMA busy_timeout = 5000') && c.includes('Pre-Mortem')),
      'Deve injetar mitigação de busy_timeout/WAL contra concorrência'
    );

    const criteriaCsv = GeminiSupervisorProvider.injectArchitecturalBoundaryCriteria([], 'GT-5', 'Exportação de Relatórios CSV', 3);
    assert.ok(
      criteriaCsv.some(c => c.includes('fórmulas em exportação CSV RFC-4180')),
      'Deve injetar mitigação contra injeção de fórmulas CSV'
    );

    const criteriaStatic = GeminiSupervisorProvider.injectArchitecturalBoundaryCriteria([], 'GT-5', 'Servidor e SPA', 5);
    assert.ok(
      criteriaStatic.some(c => c.includes('Path Traversal na rota raiz GET /')),
      'Deve injetar mitigação contra Path Traversal'
    );
  });

  // PILAR 2: INDEXAÇÃO SINTÁTICA POR AST
  it('Pilar 2: AstSymbolIndexService extrai schemas de tabela e gera bloco <codebase_ast_context>', () => {
    // 1. Extração de símbolos
    const symbols = AstSymbolIndexService.extractSymbols(
      `
      export interface Customer { id: string; name: string; }
      export class CustomerRepo { static find() {} }
      export function listCustomers(): Customer[] { return []; }
      CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      `,
      'test.ts'
    );

    assert.ok(symbols.some(s => s.symbolType === 'schema' && s.symbolName.includes('customers')), 'Deve extrair schema de tabela');
    assert.ok(symbols.some(s => s.symbolType === 'interface' && s.symbolName === 'Customer'), 'Deve extrair interface');
    assert.ok(symbols.some(s => s.symbolType === 'class' && s.symbolName === 'CustomerRepo'), 'Deve extrair class');
    assert.ok(symbols.some(s => s.symbolType === 'function' && s.symbolName === 'listCustomers'), 'Deve extrair function');

    // 2. buildCodebaseAstContext
    const context = AstSymbolIndexService.buildCodebaseAstContext(testProjectId, tmpDir);
    assert.ok(context.length > 0, 'Deve gerar contexto AST do repositório');
    assert.ok(context.includes('user_accounts') || context.includes('UserAccount'), 'Deve conter símbolos do projeto');

    // 3. Injeção no prompt do Supervisor e do Worker
    const supervisorPrompt = PromptArchitectureService.buildSupervisorPrompt({
      mode: 'INITIAL_PLAN',
      projectId: testProjectId,
      projectName: 'Test Proj',
      projectPath: tmpDir,
      projectObjective: 'Test Objective',
      codebaseAstContext: context
    });
    assert.ok(supervisorPrompt.prompt.includes('<codebase_ast_context>'), 'Prompt do Supervisor deve conter tag <codebase_ast_context>');

    const workerPrompt = PromptArchitectureService.buildWorkerPrompt({
      mode: 'BUILD',
      projectId: testProjectId,
      projectName: 'Test Proj',
      projectPath: tmpDir,
      projectObjective: 'Test Objective',
      taskId: 't1',
      taskTitle: 'Implementar clientes',
      acceptanceCriteria: ['Passar testes'],
      codebaseAstContext: context
    });
    assert.ok(workerPrompt.prompt.includes('<codebase_ast_context>'), 'Prompt do Worker deve conter tag <codebase_ast_context>');
  });

  // PILAR 3: GOVERNANÇA DE DECISÕES ARQUITETURAIS (TWO-WAY VS. ONE-WAY DOORS)
  it('Pilar 3: Governança Two-Way vs One-Way Doors formalizada nas regras e prompts', () => {
    assert.ok(
      PromptArchitectureService.SUPERVISOR_CORE_RULES.includes('TWO-WAY VS. ONE-WAY DOORS'),
      'SUPERVISOR_CORE_RULES deve formalizar TWO-WAY VS. ONE-WAY DOORS'
    );
    assert.ok(
      PromptArchitectureService.SUPERVISOR_CORE_RULES.includes('DECISÕES REVERSÍVEIS (Portas de 2 Vias'),
      'Deve explicitar decisões reversíveis com autonomia total'
    );
    assert.ok(
      PromptArchitectureService.SUPERVISOR_CORE_RULES.includes('DECISÕES IRREVERSÍVEIS (Portas de 1 Via'),
      'Deve explicitar decisões irreversíveis com isolamento e justificativa em decisions.md'
    );

    const bpPrompt = PromptArchitectureService.buildArchitecturalBlueprintPrompt({
      projectId: testProjectId,
      projectName: 'Test',
      projectPath: tmpDir,
      briefing: 'Criar app'
    });
    assert.ok(bpPrompt.prompt.includes('TWO-WAY VS. ONE-WAY DOORS'), 'Blueprint de Onda 1 deve conter Two-Way vs One-Way Doors');
  });

  // PILAR 4: ATIVAÇÃO PLENA DAS VACINAS DO DECOMIND ML ENGINE
  it('Pilar 4: DecoMindMlService recupera vacinas cirúrgicas, formata bloco e registra memórias com recompensa positiva', () => {
    // 1. retrieveVaccinesForTask
    const vaccines = DecoMindMlService.retrieveVaccinesForTask('Planejamento de rotas e banco', 'Decomposição de endpoints e persistência');
    assert.ok(Array.isArray(vaccines), 'Deve retornar array de vacinas');
    assert.ok(vaccines.length > 0, 'Deve retornar ao menos 1 vacina episódica');
    assert.ok(vaccines[0].q_value >= 0.5, 'Vacina principal deve ter alto Q-value');

    // 2. formatEmpiricalVaccinesBlock
    const block = DecoMindMlService.formatEmpiricalVaccinesBlock(vaccines);
    assert.ok(block.includes('[VACINAS CIRÚRGICAS DO HISTÓRICO EMPÍRICO]'), 'Deve conter cabeçalho padronizado');
    assert.ok(block.includes('Padrão de Falha:'), 'Deve listar padrão de falha');
    assert.ok(block.includes('Vacina Cirúrgica:'), 'Deve listar vacina cirúrgica');

    // 3. predictReworkRisk
    const risk = DecoMindMlService.predictReworkRisk({
      taskComplexityScore: 0.95,
      expectedFilesCount: 0.9,
      historicalAttempts: 1.0,
      dependenciesCount: 0.8,
      categoryRiskPrior: 0.8,
      previousReworkHistory: 1.0,
      instructionAmbiguityScore: 0.9,
      contextRotIndex: 0.9
    });
    assert.ok(['HIGH', 'CRITICAL'].includes(risk.riskTier), 'Alto risco de retrabalho deve gerar HIGH ou CRITICAL');

    // 4. recordEpisodicMemory com recompensa positiva
    const memory = DecoMindMlService.recordEpisodicMemory({
      taskTitle: 'Correção de SQL Injection em login',
      taskDescription: 'Queries não parametrizadas causavam falha de segurança',
      errorPattern: 'SQL_INJECTION_VULNERABILITY',
      rootCause: 'Uso de template string direto em db.prepare',
      surgicalVaccine: 'Utilizar sempre placeholders parametrizados (?) no SQLite',
      reward: 1.0
    });

    assert.ok(memory && memory.id, 'Deve criar registro de memória episódica');
    assert.equal(memory.q_value, 1.0, 'Memória com reward 1.0 deve ter Q-Value máximo (1.0)');

    // Recupera a vacina recém-gravada
    const retrieved = DecoMindMlService.retrieveVaccinesForTask('Login de usuário com banco SQL', 'Autenticação e segurança');
    assert.ok(retrieved.some(v => v.error_pattern === 'SQL_INJECTION_VULNERABILITY'), 'Vacina gravada deve ser recuperada por busca vetorial');
  });
});
