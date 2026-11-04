import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { CouncilManager } from '../src/councilManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { GeminiSupervisorProvider } from '../src/geminiSupervisorProvider.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';

test('Council Rigorous Verification Suite: Defective Plan Rejection, Anti-Slop Gate & Independent Deliberation', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-council-rigorous-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const projId = `proj-council-rigorous-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, path, objective, stack, is_trusted, full_dev_autonomy, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Node/TypeScript', 1, 1, 'active', ?, ?)
  `).run(projId, 'Council Rigorous Test Project', tmpRoot, 'Validar comportamento crítico do conselho', now, now);

  t.after(() => {
    try {
      db.prepare('DELETE FROM council_deliberations WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(projId);
      db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "councilExecutionRigorous.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:councilExecutionRigorous.test]", err);
      }
    }
  });

  await t.test('1. Council Plan Critique: Reprova plano com critérios ausentes (CHANGES_REQUESTED)', async () => {
    // Plano com tarefas incompletas/sem critérios de aceitação
    const defectivePlannedTasks = [
      {
        title: 'Criar módulo central de autenticação',
        description: 'Implementar auth sem especificar critérios',
        milestone: 'M1',
        criteria: [] // VAZIO: Violação proposital de critério
      },
      {
        title: 'Criar dashboard de controle',
        description: 'Interface de usuário genérica',
        milestone: 'M1',
        criteria: []
      }
    ];

    const planDeliberation = await CouncilManager.deliberate({
      taskId: 'plan-test-critique',
      projectId: projId,
      task: {
        title: 'Plano Defeituoso Inicial',
        description: 'Briefing do sistema',
        plannedTasks: defectivePlannedTasks
      },
      riskLevel: 'high',
      policyTrigger: 'PLAN_ARCHITECTURE_CRITIQUE'
    });

    assert.equal(planDeliberation.chairmanVerdict, 'CHANGES_REQUESTED', 'Conselho DEVE reprovar plano sem critérios de aceitação');
    assert.ok(planDeliberation.actionItems.length > 0, 'Conselho DEVE gerar itens de ação corretivos');
    assert.ok(planDeliberation.actionItems.some(i => i.includes('critérios') || i.includes('aceitação')));
    assert.ok(planDeliberation.scores.correctness <= 5, 'Nota de corretude deve ser rebaixada');
  });

  await t.test('2. Bloqueio de Despacho: Reprovação do Conselho impede Worker de receber tarefas defeituosas', async () => {
    // Simular que o Supervisor propõe plano defeituoso e não consegue resolver
    const originalPlanTasks = GeminiSupervisorProvider.prototype.planTasks;
    try {
      GeminiSupervisorProvider.prototype.planTasks = async () => [
        {
          title: 'Tarefa Sem Critérios',
          description: 'Defeituosa proposital',
          milestone: 'M1',
          criteria: [] // Causa rejeição no conselho
        }
      ];

      const run = await AutonomousManager.createRun({
        projectId: projId,
        name: 'Run com Plano Defeituoso',
        objective: 'Testar contenção do Conselho',
        briefing: 'Criar aplicação',
        autonomyMode: 'safe',
        forceNew: true
      });

      // O run deve estar aguardando aprovação humana (waiting_approval) e NÃO ter tarefas liberadas para execução
      assert.equal(run.status, 'waiting_approval', 'Run com plano reprovado pelo Conselho deve ser travado como waiting_approval');
      const tasks = AutonomousManager.getAvailableTasks(run.id);
      assert.equal(tasks.length, 0, 'Worker NÃO pode receber nenhuma tarefa de plano reprovado');
    } finally {
      GeminiSupervisorProvider.prototype.planTasks = originalPlanTasks;
    }
  });

  await t.test('3. Refinamento do Plano: Supervisor recebe crítica, refina critérios e Conselho aprova', async () => {
    let callCount = 0;
    const originalPlanTasks = GeminiSupervisorProvider.prototype.planTasks;
    try {
      GeminiSupervisorProvider.prototype.planTasks = async (briefing, proj, opts) => {
        callCount++;
        if (opts.mode === 'REPLAN') {
          // Versão corrigida em resposta à crítica do Conselho
          return [
            {
              title: 'Autenticação JWT com Validação Estrita',
              description: 'Implementar token JWT com expiração e verificação',
              milestone: 'M1',
              criteria: ['Token assinado com chave secreta', 'Expiração em 3600 segundos', 'Rejeição de token inválido com 401'],
              verificationCommand: 'node test/auth.test.js'
            }
          ];
        }
        // Primeira tentativa sem critérios
        return [
          {
            title: 'Autenticação Genérica',
            description: 'Auth',
            milestone: 'M1',
            criteria: []
          }
        ];
      };

      const run = await AutonomousManager.createRun({
        projectId: projId,
        name: 'Run com Refinamento de Plano',
        objective: 'Testar ciclo crítica -> replan -> aprovação',
        briefing: 'Criar auth segura',
        autonomyMode: 'safe',
        forceNew: true
      });

      assert.ok(callCount >= 2, 'Supervisor deve ter sido chamado para planejar e depois para replanejar');
      assert.equal(run.status, 'running', 'Run com plano refinado e aprovado deve transicionar para running');
      const available = AutonomousManager.getAvailableTasks(run.id);
      assert.equal(available.length, 1, 'Worker deve receber a versão refinada com critérios');
      assert.ok(available[0].criteria.length >= 3, 'Critérios de aceitação refinados devem estar presentes na tarefa');
    } finally {
      GeminiSupervisorProvider.prototype.planTasks = originalPlanTasks;
    }
  });

  await t.test('4. Anti-Slop Review Gate: Entrega com testes PASS ainda é reprovada por overengineering / complexidade excessiva', async () => {
    // Cenário: Worker entrega código onde os testes passam no terminal (PASS), mas o diff contém
    // classes, fábricas redundantes e código prolixo desnecessário (Overengineering).
    const bloatedDiff = `
+ class AbstractServiceFactory {
+   static createInstance() { return new ConcreteAdapterProxy(); }
+ }
+ class ConcreteAdapterProxy {
+   execute(a, b) { return a + b; }
+ }
+ exports.add = (a, b) => AbstractServiceFactory.createInstance().execute(a, b);
`;
    const mockPassingEval = {
      taskIsDone: true,
      verdict: 'PASS',
      executedCommands: ['node test/add.test.js'],
      actual: 'Exit Code: 0 (PASS)'
    };

    const deliberation = await CouncilManager.deliberate({
      taskId: 'task-bloated-test',
      projectId: projId,
      task: { title: 'Implementar soma aritmética simples' },
      diff: bloatedDiff,
      filesChanged: ['src/math.js'],
      evaluation: mockPassingEval,
      riskLevel: 'medium',
      policyTrigger: 'POST_EVALUATION_REVIEW'
    });

    // O Conselho DEVE solicitar correções (CHANGES_REQUESTED) mesmo com teste PASS
    assert.equal(deliberation.chairmanVerdict, 'CHANGES_REQUESTED');
    assert.ok(deliberation.scores.simplicity <= 5, 'Nota de simplicidade deve ser rebaixada por overengineering');
    assert.ok(deliberation.chairmanSynthesis.includes('Simplicity Alert') || deliberation.chairmanSynthesis.includes('Overengineering'));
    assert.ok(deliberation.actionItems.some(i => i.includes('classes') || i.includes('redundantes') || i.includes('simples')));
  });

  await t.test('5. Reavaliação Pós-Reparo: Código cirúrgico reparado é aprovado sem carregar reprovação obsoleta', async () => {
    // Cenário: Worker repara o código substituindo a hierarquia de classes por 1 linha simples
    const cleanSurgicalDiff = `+ exports.add = (a, b) => a + b;`;
    const mockPassingEval = {
      taskIsDone: true,
      verdict: 'PASS',
      executedCommands: ['node test/add.test.js'],
      actual: 'Exit Code: 0 (PASS)'
    };

    const deliberation = await CouncilManager.deliberate({
      taskId: 'task-clean-repaired',
      projectId: projId,
      task: { title: 'Implementar soma aritmética simples' },
      diff: cleanSurgicalDiff,
      filesChanged: ['src/math.js'],
      evaluation: mockPassingEval,
      riskLevel: 'low',
      policyTrigger: 'POST_EVALUATION_REVIEW'
    });

    assert.equal(deliberation.chairmanVerdict, 'APPROVED');
    assert.ok(deliberation.scores.simplicity >= 8, 'Código cirúrgico deve ter alta nota de simplicidade');
    assert.ok(deliberation.scores.correctness >= 8);
    assert.ok(deliberation.scores.final >= 8);
  });

  await t.test('6. Pareceres Independentes: Deliberação usa 3 revisores especializados e ranking anônimo', async () => {
    const deliberation = await CouncilManager.deliberate({
      taskId: 'task-multi-reviewer',
      projectId: projId,
      task: { title: 'Verificar integridade multi-revisores' },
      diff: '+ exports.test = true;',
      filesChanged: ['src/test.js'],
      evaluation: { taskIsDone: true, verdict: 'PASS', actual: 'Exit Code: 0 (PASS)' },
      riskLevel: 'high'
    });

    // 3 revisores independentes
    assert.equal(deliberation.reviews.length, 3);
    const roles = deliberation.reviews.map(r => r.roleName);
    assert.ok(roles.includes('Correctness'), 'Revisor A: Corretude Funcional');
    assert.ok(roles.includes('Simplicity'), 'Revisor B: Simplicidade Karpathy');
    assert.ok(roles.includes('Regression'), 'Revisor C: Regressão e Segurança');

    // Revisão por pares anônima (Peer Ranking)
    assert.ok(deliberation.peerRankings.length === 3, 'Cada revisor deve ter classificado anonimamente os pares');
    assert.ok(deliberation.consensusLevel);
  });

  await t.test('7. Phase-Aware Cognition: Aprova plano arquitetural pré-implementação sólido (ad-hunter-local) com 0 diff e 0 arquivos alterados', async () => {
    // Simula o plano de 5 Grandes Tarefas coesas do ad-hunter-local (Fase 1: Blueprint Conceitual)
    const adHunterPlannedTasks = [
      {
        orderIndex: 1,
        milestone: 'GT-1',
        title: 'Backend - Ingestão e Persistência (/api/mine)',
        description: 'Endpoint POST /api/mine com paginação por cursor, deduplicação por hash de anúncio e persistência em SQLite WAL.',
        expectedFiles: ['server/src/routes/mine.ts', 'server/src/db/schema.sql', 'test/mine.test.ts'],
        criteria: [
          'Endpoint POST /api/mine aceita maxPages e cursor retornando status HTTP 200',
          'Tabela ads criada no SQLite com PRAGMA journal_mode = WAL',
          'Deduplicação de anúncios existentes comprovada em teste unitário'
        ],
        verificationCommand: 'npx tsx --test test/mine.test.ts'
      },
      {
        orderIndex: 2,
        milestone: 'GT-2',
        title: 'Backend - Proxy de Mídia e Listagem (/api/download, /api/ads)',
        description: 'Proxy de streaming de vídeo com headers corretos e mitigação anti-SSRF, e listagem paginada.',
        expectedFiles: ['server/src/routes/media.ts', 'server/src/routes/ads.ts', 'test/media.test.ts'],
        criteria: [
          'Endpoint GET /api/download valida URLs com mitigação anti-SSRF',
          'Endpoint GET /api/ads suporta busca com paginação limit e offset'
        ],
        verificationCommand: 'npx tsx --test test/media.test.ts'
      },
      {
        orderIndex: 3,
        milestone: 'GT-3',
        title: 'Frontend - SPA e Player (<video controls>)',
        description: 'Interface web servida na raiz GET / com fallback SPA e cards de anúncios com player de vídeo nativo.',
        expectedFiles: ['public/index.html', 'public/app.js', 'server/src/server.ts'],
        criteria: [
          'Rota raiz GET / serve public/index.html com Content-Type text/html',
          'Cards de anúncio renderizam player <video controls> nativo sem travar UI'
        ],
        verificationCommand: 'tsc --noEmit'
      },
      {
        orderIndex: 4,
        milestone: 'GT-4',
        title: 'Frontend - Toolbar e Filtros de Busca',
        description: 'Barra de ferramentas com input de busca em tempo real com debounce 300ms e filtros por nicho/data.',
        expectedFiles: ['public/components/toolbar.js', 'public/styles.css'],
        criteria: [
          'Input de busca dispara requisição após 300ms de inatividade do usuário',
          'Filtros por nicho atualizam grid sem reload de página'
        ],
        verificationCommand: 'tsc --noEmit'
      },
      {
        orderIndex: 5,
        milestone: 'GT-5',
        title: 'Qualidade e Homologação de Segurança',
        description: 'Suíte de testes de integração ponta a ponta e auditoria de segurança (PORT_GUARD 4000-4999 e Path Traversal).',
        expectedFiles: ['test/integration.test.ts', 'test/security.test.ts'],
        criteria: [
          'Suíte completa de testes executa com exit code 0',
          'Servidor roda na faixa PORT_GUARD 4000-4999 mantendo 3000/3001 livres'
        ],
        verificationCommand: 'npm test'
      }
    ];

    const planDeliberation = await CouncilManager.deliberate({
      taskId: 'plan-ad-hunter-deliberation',
      projectId: projId,
      phase: 'PLANNING',
      task: {
        title: 'Plano Arquitetural: ad-hunter-local',
        briefing: 'Ferramenta local de mineração de criativos publicitários com proxy de download, busca e SPA nativa.',
        description: 'Construção completa da ferramenta local sem autenticação e persistência em SQLite WAL.',
        plannedTasks: adHunterPlannedTasks
      },
      diff: '', // Propositalmente vazio (Fase 1: Blueprint)
      filesChanged: [], // Propositalmente vazio (Fase 1: Blueprint)
      riskLevel: 'high',
      policyTrigger: 'PLAN_ARCHITECTURE_CRITIQUE'
    });

    // 1. Veredicto e Notas
    assert.equal(planDeliberation.phase, 'PLANNING', 'Deliberação deve registrar fase PLANNING');
    assert.equal(planDeliberation.chairmanVerdict, 'APPROVED', 'Conselho DEVE aprovar o plano arquitetural sólido mesmo com diff vazio');
    assert.ok(planDeliberation.scores.final >= 9, 'Nota final deve ser >= 9');
    assert.ok(planDeliberation.scores.correctness >= 9, 'Corretude deve ser >= 9');
    assert.ok(planDeliberation.scores.simplicity >= 9, 'Simplicidade deve ser >= 9');
    assert.ok(planDeliberation.scores.regression >= 9, 'Regressão deve ser >= 9');

    // 2. Não-bloqueio por ausência de código
    for (const review of planDeliberation.reviews) {
      assert.equal(review.verdict, 'APPROVED', `${review.roleName} deve aprovar o plano`);
      assert.equal(review.blockingIssues.length, 0, `${review.roleName} não pode ter bloqueios de código na fase conceitual`);
    }

    // 3. Proibição de Rubber-Stamping: Revisor B DEVE citar no mínimo 1 decisão concreta do plano avaliado
    const simplicityReview = planDeliberation.reviews.find(r => r.roleName === 'Simplicity');
    assert.ok(simplicityReview, 'Revisor B (Simplicity) deve existir');
    const hasConcreteDecision = simplicityReview.findings.some(f => f.includes('Decisão concreta avaliada:'));
    assert.ok(hasConcreteDecision, 'Revisor B DEVE citar explicitamente ao menos 1 decisão concreta do plano para evitar rubber-stamping');

    // 4. Diretriz de Ação Construtiva: actionItems contêm orientações construtivas sem paralisia
    assert.ok(planDeliberation.actionItems.length > 0, 'Conselho deve prover orientações de execução construtivas');
    assert.ok(!planDeliberation.actionItems.some(i => i.toLowerCase().includes('diff nao disponivel')), 'Action items não podem demandar diff em fase de planejamento');
  });

  await t.test('8. Excelência do Supervisor: Plano sanitizado atinge Nota 10/10 no Conselho (Zero "A definir", Zero Mocks, Fronteiras e Coalescência)', async () => {
    // Simula plano bruto com "A definir" e sem verificationCommand para testar reparo automático
    const rawUncalibratedTasks = [
      {
        orderIndex: 1,
        milestone: 'GT-1',
        title: 'Backend - Ingestão e Persistência (/api/mine)',
        description: 'Endpoint POST /api/mine com SQLite WAL',
        expectedFiles: ['A definir'], // Deve ser reparado
        criteria: ['Endpoint POST /api/mine aceita maxPages e cursor retornando HTTP 200'],
        verificationCommand: 'true' // Mock deve ser reparado
      },
      {
        orderIndex: 2,
        milestone: 'GT-2',
        title: 'Backend - Proxy de Mídia e Listagem (/api/download, /api/ads)',
        description: 'Proxy de streaming de vídeo e listagem',
        expectedFiles: [], // Deve ser inferido
        criteria: ['Endpoint GET /api/download valida URLs com mitigação anti-SSRF'],
        verificationCommand: '' // Vazio deve ser reparado
      },
      {
        orderIndex: 3,
        milestone: 'GT-3',
        title: 'Frontend - SPA e Player (<video controls>)',
        description: 'Interface web servida na raiz GET /',
        expectedFiles: ['public/index.html'],
        criteria: ['Rota raiz GET / serve public/index.html'],
        verificationCommand: 'npx tsc --noEmit'
      },
      {
        orderIndex: 4,
        milestone: 'GT-4',
        title: 'Frontend - Toolbar e Filtros de Busca',
        description: 'Barra de ferramentas com input de busca',
        expectedFiles: ['public/components/toolbar.js'],
        criteria: ['Input de busca dispara requisição com debounce 300ms'],
        verificationCommand: 'npx tsc --noEmit'
      },
      {
        orderIndex: 5,
        milestone: 'GT-5',
        title: 'Qualidade e Homologação de Segurança',
        description: 'Testes de integração e segurança',
        expectedFiles: ['test/integration.test.ts'],
        criteria: ['Suíte completa de testes executa com exit code 0'],
        verificationCommand: 'npm test'
      }
    ];

    // Validação e refinamento de qualidade pelo GeminiSupervisorProvider
    const refinedTasks = GeminiSupervisorProvider.validateAndRefinePlanQuality(rawUncalibratedTasks as any);

    // 1. Verifica Diretriz 1: ZERO "A definir"
    for (const task of refinedTasks) {
      assert.ok(task.expectedFiles && task.expectedFiles.length > 0, `Tarefa ${task.title} deve ter arquivos previstos`);
      assert.ok(!task.expectedFiles.some(f => /a\s*definir|tbd/i.test(f)), `Tarefa ${task.title} não pode ter 'A definir'`);
    }

    // 2. Verifica Diretriz 2: ZERO MOCKS nos comandos de verificação
    for (const task of refinedTasks) {
      assert.ok(task.verificationCommand && task.verificationCommand.length > 0, `Tarefa ${task.title} deve ter comando de teste`);
      assert.ok(!/^(?:true|exit\s*0|:|echo|return\s*0)$/i.test(task.verificationCommand.trim()), `Tarefa ${task.title} não pode ter mock command`);
    }

    // 3. Verifica Diretriz 3: Contrato de Fronteiras Arquiteturais (GT-1 e GT-5)
    const gt1 = refinedTasks.find(t => t.milestone === 'GT-1' || t.orderIndex === 1);
    assert.ok(gt1, 'GT-1 deve existir');
    assert.ok(gt1.criteria.some(c => /journal_mode\s*=\s*WAL/i.test(c)), 'GT-1 deve declarar SQLite WAL');
    assert.ok(gt1.criteria.some(c => /PORT_GUARD/i.test(c)), 'GT-1 deve declarar PORT_GUARD');
    assert.ok(gt1.criteria.some(c => /SQL\s*Injection|\?/i.test(c)), 'GT-1 deve declarar proteção contra SQLi');

    const gt5 = refinedTasks.find(t => t.milestone === 'GT-5' || t.orderIndex === 5);
    assert.ok(gt5, 'GT-5 deve existir');
    assert.ok(gt5.criteria.some(c => /Path\s*Traversal/i.test(c)), 'GT-5 deve declarar proteção Path Traversal');

    // 4. Verifica Diretriz 4: Coalescência em 4 a 6 GTs e Grafo Conectado (sem órfãos)
    assert.ok(refinedTasks.length >= 4 && refinedTasks.length <= 6, 'Grafo deve ter entre 4 e 6 GTs');
    for (let i = 1; i < refinedTasks.length; i++) {
      assert.ok(refinedTasks[i].dependencies && refinedTasks[i].dependencies.length > 0, `Tarefa ${refinedTasks[i].title} não pode ser órfã`);
    }

    // 5. Deliberação do Conselho: DEVE atingir Nota 10/10
    const deliberation = await CouncilManager.deliberate({
      taskId: 'plan-excellence-10-10',
      projectId: projId,
      phase: 'PLANNING',
      task: {
        title: 'Plano Arquitetural Calibrado: Nota 10/10',
        description: 'Plano com 5 GTs, mapa exato de arquivos, testes direcionados e fronteiras arquiteturais.',
        plannedTasks: refinedTasks
      },
      diff: '',
      filesChanged: [],
      riskLevel: 'high',
      policyTrigger: 'PLAN_ARCHITECTURE_CRITIQUE'
    });

    assert.equal(deliberation.chairmanVerdict, 'APPROVED', 'Conselho DEVE aprovar o plano excelente');
    assert.equal(deliberation.scores.correctness, 10, 'Corretude DEVE receber nota 10/10');
    assert.equal(deliberation.scores.simplicity, 10, 'Simplicidade DEVE receber nota 10/10');
    assert.equal(deliberation.scores.regression, 10, 'Regressão DEVE receber nota 10/10');
    assert.equal(deliberation.scores.final, 10, 'Nota final do Conselho DEVE ser 10/10');
  });

  await t.test('9. Planner Determinístico: Extração de GTs explícitas, zero mock process.exit(0) e respeito absoluto a local_personal', () => {
    const explicitBriefing = `Aqui está o plano arquitetural:
* GT-1 [Backend - Ingestão e Persistência]: Condensa passos A, B e C. Critérios: endpoints POST testados com HTTP 200/400 e schema SQLite WAL criado. verificationCommand: \`npx tsx --test test/mine.test.ts\`.
* GT-2 [Backend - Mídia e Listagem]: Condensa passos D e E. Critérios: stream proxy com headers e listagem paginada. verificationCommand: \`npx tsx --test test/media.test.ts\`.
* GT-3 [Frontend - SPA e Player]: Condensa passos F e G. Critérios: SPA servida na raiz GET /, tags <video controls> e botões ativos. verificationCommand: \`npx tsc --noEmit\`.
* GT-4 [Frontend - Toolbar e Filtros]: Condensa passos H e I. Critérios: busca com debounce 300ms e filtros dinâmicos. verificationCommand: \`npx tsc --noEmit\`.
* GT-5 [Qualidade e Homologação E2E]: Suíte completa de testes de integração e validação de segurança. verificationCommand: \`npm test\`.`;

    const extracted = HierarchicalOrchestrationService.extractExplicitGrandesTarefasFromBriefing(explicitBriefing, 'ad-hunter-local');
    assert.ok(extracted, 'Deve extrair tarefas das GTs explícitas');
    assert.equal(extracted!.length, 5, 'Deve conter exatamente 5 GTs');

    // Valida encadeamento sequencial de DAG
    assert.equal(extracted![0].code, 'GT-1');
    assert.deepEqual(extracted![0].dependencies, []);
    assert.equal(extracted![1].code, 'GT-2');
    assert.deepEqual(extracted![1].dependencies, ['GT-1']);
    assert.equal(extracted![2].code, 'GT-3');
    assert.deepEqual(extracted![2].dependencies, ['GT-2']);
    assert.equal(extracted![3].code, 'GT-4');
    assert.deepEqual(extracted![3].dependencies, ['GT-3']);
    assert.equal(extracted![4].code, 'GT-5');
    assert.deepEqual(extracted![4].dependencies, ['GT-4']);

    // Valida que nenhum comando de verificação usa mock
    for (const t of extracted!) {
      assert.ok(!t.verificationCommand.includes('process.exit(0)'), `Comando de ${t.code} não pode conter process.exit(0)`);
      assert.ok(t.verificationCommand.length > 0, `Comando de ${t.code} deve estar definido`);
    }

    // Valida que generateMultiPassPlannedTasks prioriza GTs explícitas
    const planned = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
      briefing: explicitBriefing,
      projectName: 'ad-hunter-local',
      projectPath: '/tmp/ad-hunter-local',
      projectProfile: 'local_personal'
    });
    assert.equal(planned.length, 5, 'Deve retornar as 5 GTs explícitas sem cair no plano SaaS de 46 tarefas');

    // Valida respeito absoluto ao modo local_personal mesmo com keywords de SaaS
    const saasKeywordsBriefing = 'Sistema com painel e planos, mas o usuário escolheu modo local_personal';
    const localPlanned = HierarchicalOrchestrationService.generateMultiPassPlannedTasks({
      briefing: saasKeywordsBriefing,
      projectName: 'lead-radar-local',
      projectPath: '/tmp/lead-radar-local',
      projectProfile: 'local_personal'
    });
    const billingTasks = localPlanned.filter(t => /checkout-pix|pushinpay|\/api\/billing|saasSchema/i.test(t.title + t.description));
    assert.equal(billingTasks.length, 0, 'Projeto local_personal NUNCA deve gerar tarefas de billing/pix SaaS');
  });

  await t.test('10. Adoção e Persistência Automática do Plano Refinado pelo Conselho', async () => {
    const runProjId = crypto.randomUUID();
    const testSubDir = path.join(tmpRoot, 'autonomous-run-test');
    fs.mkdirSync(testSubDir, { recursive: true });

    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, is_trusted, full_dev_autonomy, project_profile, created_at, updated_at)
      VALUES (?, 'ad-hunter-autonomous', ?, 'Testar adoção do plano refinado', 'Node.js', 'active', 1, 1, 'local_personal', ?, ?)
    `).run(runProjId, testSubDir, new Date().toISOString(), new Date().toISOString());

    const explicitBriefing = `* GT-1 [Backend - Ingestão]: Endpoints POST. verificationCommand: \`npx tsx --test test/mine.test.ts\`.
* GT-2 [Backend - Mídia]: Proxy stream. verificationCommand: \`npx tsx --test test/media.test.ts\`.
* GT-3 [Frontend - SPA]: Interface web. verificationCommand: \`npx tsc --noEmit\`.
* GT-4 [Frontend - Toolbar]: Busca. verificationCommand: \`npx tsc --noEmit\`.
* GT-5 [Qualidade]: Testes. verificationCommand: \`npm test\`.`;

    const run = await AutonomousManager.createRun({
      projectId: runProjId,
      name: 'Run Adoção Plano',
      objective: explicitBriefing,
      autonomousMode: 'autonomous'
    });

    assert.ok(run, 'Run deve ser criado');
    assert.equal(run.status, 'running', 'Run deve transicionar automaticamente para running ao ser aprovado');

    // Valida que apenas as 5 tarefas da GT foram persistidas no banco
    const tasksInDb: any[] = db.prepare('SELECT * FROM autonomous_tasks WHERE run_id = ? ORDER BY order_index ASC').all(run.id);
    assert.equal(tasksInDb.length, 5, `Exatamente 5 tarefas devem ser persistidas no SQLite (obteve: ${tasksInDb.length})`);
    assert.equal(tasksInDb[0].milestone, 'GT-1');
    assert.equal(tasksInDb[4].milestone, 'GT-5');
  });
});
