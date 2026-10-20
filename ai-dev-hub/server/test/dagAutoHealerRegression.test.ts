import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { db, initDatabase } from '../src/db.js';
import { DagAutoHealer } from '../src/dagAutoHealer.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { AutonomousManager } from '../src/autonomousManager.js';

initDatabase();

test('DAG Auto-Healer & Graph Normalizer Regression Suite (Production Resilience)', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-dag-healer-test-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const projId = `proj-dag-${Date.now()}`;
  const now = new Date().toISOString();

  // Setup disposable test project
  db.prepare(`
    INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Node/TypeScript', 'active', ?, ?)
  `).run(projId, 'Projeto DAG Healer Test', tmpRoot, 'Testar resiliência do grafo de dependências', now, now);

  t.after(() => {
    try {
      db.prepare('DELETE FROM autonomous_events WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(projId);
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(projId);
      db.prepare('DELETE FROM autonomous_major_tasks WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "dagAutoHealerRegression.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:dagAutoHealerRegression.test]", err);
      }
    }
  });

  await t.test('1. Resolução Multi-Chave: Referência a códigos de Grandes Tarefas (GT-1, GT-2)', () => {
    const rawTasks = [
      {
        id: 'task-1',
        code: 'GT-1-ET-1-TK-1',
        majorTaskCode: 'GT-1',
        title: 'Setup Inicial do Repositório',
        dependencies: []
      },
      {
        id: 'task-2',
        code: 'GT-1-ET-1-TK-2',
        majorTaskCode: 'GT-1',
        title: 'Configuração do TypeScript e ESLint',
        dependencies: ['Setup Inicial do Repositório']
      },
      {
        id: 'task-3',
        code: 'GT-2-ET-1-TK-1',
        majorTaskCode: 'GT-2',
        title: 'Estruturação do Backend Express',
        // Referenciando a Grande Tarefa anterior GT-1 em vez da microtarefa específica
        dependencies: ['GT-1']
      }
    ];

    const healed = DagAutoHealer.autoHealAndNormalizeTaskGraph(rawTasks);

    assert.equal(healed.length, 3);
    // Task 3 deve ter resolvido "GT-1" para a última microtarefa da GT-1 anterior
    assert.deepEqual(healed[2].dependencies, ['Configuração do TypeScript e ESLint']);
  });

  await t.test('2. Resolução Multi-Chave: Referências numéricas ("1", "#1", "Task 1", "0")', () => {
    const rawTasks = [
      {
        id: 'task-1',
        title: 'Criar Esquema do Banco SQLite',
        dependencies: []
      },
      {
        id: 'task-2',
        title: 'Criar Modelos e Migrações',
        dependencies: ['1'] // 1-based index
      },
      {
        id: 'task-3',
        title: 'Implementar Controladores REST',
        dependencies: ['#2'] // #2 -> index 1
      },
      {
        id: 'task-4',
        title: 'Escrever Testes de Integração',
        dependencies: ['Task 3'] // Task 3 -> index 2
      }
    ];

    const healed = DagAutoHealer.autoHealAndNormalizeTaskGraph(rawTasks);

    assert.equal(healed.length, 4);
    assert.deepEqual(healed[1].dependencies, ['Criar Esquema do Banco SQLite']);
    assert.deepEqual(healed[2].dependencies, ['Criar Modelos e Migrações']);
    assert.deepEqual(healed[3].dependencies, ['Implementar Controladores REST']);
  });

  await t.test('3. Remoção Silenciosa de Dependências Órfãs e Alucinadas ("Tarefa Fantasma")', () => {
    const rawTasks = [
      {
        id: 'task-1',
        title: 'Inicialização de Pacote',
        dependencies: ['Biblioteca Inexistente', 'Tarefa Fantasma']
      },
      {
        id: 'task-2',
        title: 'Implementação de Rota de Saúde',
        dependencies: ['Inicialização de Pacote', 'Dependencia Alucinada XYZ']
      }
    ];

    const healed = DagAutoHealer.autoHealAndNormalizeTaskGraph(rawTasks);

    assert.equal(healed.length, 2);
    // As dependências inexistentes devem ser removidas sem lançar erro
    assert.deepEqual(healed[0].dependencies, []);
    assert.deepEqual(healed[1].dependencies, ['Inicialização de Pacote']);
  });

  await t.test('4. Auto-Dependências (Self-Dependencies) ignoradas silenciosamente', () => {
    const rawTasks = [
      {
        id: 'task-1',
        title: 'Tarefa Auto-Dependente',
        dependencies: ['Tarefa Auto-Dependente', 'task-1']
      }
    ];

    const healed = DagAutoHealer.autoHealAndNormalizeTaskGraph(rawTasks);

    assert.equal(healed.length, 1);
    assert.deepEqual(healed[0].dependencies, []);
  });

  await t.test('5. Quebra Automática de Ciclos Diretos (Cycle Breaker: A <-> B)', () => {
    const rawTasks = [
      {
        id: 'task-a',
        orderIndex: 1,
        title: 'Módulo A',
        dependencies: ['Módulo B'] // Aresta não-natural apontando para a frente
      },
      {
        id: 'task-b',
        orderIndex: 2,
        title: 'Módulo B',
        dependencies: ['Módulo A'] // Aresta natural apontando para trás
      }
    ];

    const healed = DagAutoHealer.autoHealAndNormalizeTaskGraph(rawTasks);

    assert.equal(healed.length, 2);
    // O ciclo direto deve ser quebrado removendo a dependência reversa/não-natural de A para B
    assert.deepEqual(healed[0].dependencies, []);
    assert.deepEqual(healed[1].dependencies, ['Módulo A']);
  });

  await t.test('6. Quebra Automática de Ciclos Indiretos (A -> B -> C -> A)', () => {
    const rawTasks = [
      {
        id: 'task-1',
        orderIndex: 1,
        title: 'Camada de Persistência',
        dependencies: ['Camada de Apresentação'] // 1 depende de 3 (ciclo)
      },
      {
        id: 'task-2',
        orderIndex: 2,
        title: 'Camada de Serviço',
        dependencies: ['Camada de Persistência']
      },
      {
        id: 'task-3',
        orderIndex: 3,
        title: 'Camada de Apresentação',
        dependencies: ['Camada de Serviço']
      }
    ];

    const healed = DagAutoHealer.autoHealAndNormalizeTaskGraph(rawTasks);

    assert.equal(healed.length, 3);
    // O ciclo indireto deve ser quebrado removendo a dependência de 1 para 3
    assert.deepEqual(healed[0].dependencies, []);
    assert.deepEqual(healed[1].dependencies, ['Camada de Persistência']);
    assert.deepEqual(healed[2].dependencies, ['Camada de Serviço']);

    // O grafo resultante é garantido como acíclico
    const cycleCheck = HierarchicalOrchestrationService.detectCircularDependencies(
      healed.map(t => ({ id: t.id!, title: t.title, dependencies: t.dependencies || [] }))
    );
    assert.equal(cycleCheck.hasCycle, false);
  });

  await t.test('7. Desambiguação de Títulos Idênticos', () => {
    const rawTasks = [
      { id: 't1', title: 'Implementar Testes Unitários' },
      { id: 't2', title: 'Implementar Testes Unitários' },
      { id: 't3', title: 'Implementar Testes Unitários' }
    ];

    const healed = DagAutoHealer.autoHealAndNormalizeTaskGraph(rawTasks);

    assert.equal(healed[0].title, 'Implementar Testes Unitários');
    assert.equal(healed[1].title, 'Implementar Testes Unitários (Parte 2)');
    assert.equal(healed[2].title, 'Implementar Testes Unitários (Parte 3)');
  });

  await t.test('8. HierarchicalOrchestrationService.persistHierarchicalPlan aceita plano corrigido com autoHealGraph: true', () => {
    const runId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run Test DAG Healer', 'Teste de Integração de Persistência', 'Briefing de Teste', 'running', ?, ?, ?)
    `).run(runId, projId, now, now, now);

    // Plano que anteriormente causava SUPERVISOR_INVALID_PLAN e NONEXISTENT_DEPENDENCY_DETECTED
    const result = HierarchicalOrchestrationService.persistHierarchicalPlan({
      projectId: projId,
      runId,
      projectPath: tmpRoot,
      originalDescription: 'Planejamento com referências complexas a GT e ciclos',
      requirements: ['REQ-1: Setup', 'REQ-2: API'],
      majorTasks: [
        {
          code: 'GT-1',
          title: 'Grande Tarefa 1: Fundação',
          objective: 'Criar estrutura base',
          dependencies: ['GT-2'], // Ciclo proposital entre GTs
          stages: [
            {
              code: 'ET-1',
              title: 'Etapa 1: Configuração',
              microtasks: [
                {
                  code: '1.1',
                  title: 'Setup do Ambiente',
                  dependencies: ['Tarefa Que Não Existe'] // Órfã
                }
              ]
            }
          ]
        },
        {
          code: 'GT-2',
          title: 'Grande Tarefa 2: API',
          objective: 'Criar rotas da API',
          dependencies: ['GT-1'], // Dependência reversa
          stages: [
            {
              code: 'ET-2',
              title: 'Etapa 2: Rotas',
              microtasks: [
                {
                  code: '2.1',
                  title: 'Rotas de Usuário',
                  dependencies: ['GT-1'] // Referência a GT em vez de microtarefa
                }
              ]
            }
          ]
        }
      ],
      autoHealGraph: true
    });

    assert.ok(result);
    assert.equal(result.majorTasks.length, 2);
    assert.ok(result.microtasks.length >= 2);

    // Verifica que as tarefas foram persistidas no SQLite sem erro
    const dbTasks = db.prepare('SELECT id, title, dependencies_json FROM autonomous_tasks WHERE run_id = ?').all(runId) as any[];
    assert.ok(dbTasks.length >= 2);
    for (const task of dbTasks) {
      const deps = JSON.parse(task.dependencies_json);
      assert.ok(Array.isArray(deps));
    }
  });
});
