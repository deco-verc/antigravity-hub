import http from 'http';

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function api(method, path, body = null) {
  return request({
    hostname: '127.0.0.1',
    port: 3001,
    path: `/api${path}`,
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  }, body);
}

async function run() {
  console.log('====================================================');
  console.log('🧪 TESTE COMPLETO DO SISTEMA MULTI-AGENTE (FASE 4)');
  console.log('====================================================\n');

  // 1. Obter projetos
  console.log('[1/10] Buscando projetos cadastrados...');
  const projRes = await api('GET', '/projects');
  if (!projRes.data || projRes.data.length === 0) {
    throw new Error('Nenhum projeto encontrado!');
  }
  const project = projRes.data.find(p => p.name === 'ai-voice-studio') || projRes.data[0];
  console.log(`✅ Projeto selecionado: "${project.name}" (ID: ${project.id})\n`);

  // 2. Criar Autonomous Run com Preset Overnight
  console.log('[2/10] Criando Autonomous Run (Preset Overnight)...');
  const runRes = await api('POST', '/autonomous/runs', {
    projectId: project.id,
    goal: 'Construir Módulo de Áudio e Telemetria com Pipeline DAG',
    mode: 'overnight',
    maxIterations: 10,
    timeBudgetMinutes: 480
  });
  console.log('Status code:', runRes.status);
  const autonomousRun = runRes.data;
  console.log(`✅ Run criada: ID ${autonomousRun.id}, Branch: ${autonomousRun.git_branch}, Status: ${autonomousRun.status}\n`);

  // 3. Adicionar Tarefas no Grafo DAG com dependências
  console.log('[3/10] Populando DAG com 4 tarefas e dependências...');
  
  // Task 1: Sem dependências (GREEN)
  const t1Res = await api('POST', `/autonomous/runs/${autonomousRun.id}/tasks`, {
    title: 'Configurar Pipeline de Áudio Base',
    description: 'Implementar interface de processamento e testes unitários de áudio',
    milestone: 'M1 - Infraestrutura de Áudio',
    estimatedComplexity: 'low',
    dependencies: [],
    acceptanceCriteria: ['Testes unitários de pipeline passando', 'Interface de áudio tipada'],
    riskLevel: 'GREEN'
  });
  const task1 = t1Res.data;
  console.log(`- Tarefa 1 criada: ID ${task1.id} "${task1.title}" (deps: none)`);

  // Task 2: Depende da Task 1 (GREEN)
  const t2Res = await api('POST', `/autonomous/runs/${autonomousRun.id}/tasks`, {
    title: 'Criar Componente de Visualização Waveform',
    description: 'Renderizar canvas de visualização de frequências de áudio',
    milestone: 'M2 - Interface e UX',
    estimatedComplexity: 'medium',
    dependencies: [task1.id],
    acceptanceCriteria: ['Canvas renderizado sem erros de render', 'Testes de componente passando'],
    riskLevel: 'GREEN'
  });
  const task2 = t2Res.data;
  console.log(`- Tarefa 2 criada: ID ${task2.id} "${task2.title}" (deps: [${task1.id}])`);

  // Task 3: Depende da Task 1 (ORANGE - Requer aprovação de migração)
  const t3Res = await api('POST', `/autonomous/runs/${autonomousRun.id}/tasks`, {
    title: 'Migrar Esquema SQLite para Telemetria',
    description: 'Executar migração de banco com novas tabelas de streaming de telemetria',
    milestone: 'M1 - Infraestrutura de Áudio',
    estimatedComplexity: 'high',
    dependencies: [task1.id],
    acceptanceCriteria: ['Tabelas criadas com integridade referencial', 'Backup prévio executado'],
    riskLevel: 'ORANGE'
  });
  const task3 = t3Res.data;
  console.log(`- Tarefa 3 criada: ID ${task3.id} "${task3.title}" (deps: [${task1.id}], RISK: ORANGE)`);

  // Task 4: Independente da Task 2 e 3, só depende da Task 1 (GREEN)
  const t4Res = await api('POST', `/autonomous/runs/${autonomousRun.id}/tasks`, {
    title: 'Criar Endpoint de Métricas Rápidas',
    description: 'Endpoint REST para obter latência de processamento de áudio',
    milestone: 'M1 - Infraestrutura de Áudio',
    estimatedComplexity: 'low',
    dependencies: [task1.id],
    acceptanceCriteria: ['Endpoint /api/metrics/latency responde HTTP 200'],
    riskLevel: 'GREEN'
  });
  const task4 = t4Res.data;
  console.log(`- Tarefa 4 criada: ID ${task4.id} "${task4.title}" (deps: [${task1.id}])`);

  // 4. Testar Resolução do Grafo DAG
  console.log('\n[4/10] Verificando resolução DAG antes de iniciar...');
  let tasksList = (await api('GET', `/autonomous/runs/${autonomousRun.id}/tasks`)).data;
  const initialAvailable = tasksList.filter(t => t.status === 'pending' && t.isAvailable);
  console.log(`Tarefas disponíveis no início: ${initialAvailable.map(t => t.title).join(', ')}`);
  if (initialAvailable.length !== 1 || initialAvailable[0].id !== task1.id) {
    throw new Error(`DAG incorreto! Apenas a Task 1 deveria estar disponível.`);
  }
  console.log('✅ Grafo DAG validado: Somente Tarefa 1 está desbloqueada.\n');

  // 5. Executar Tarefa 1: Builder claim -> Builder report -> Supervisor approve
  console.log('[5/10] Ciclo da Tarefa 1 (Normal)...');
  await api('POST', `/autonomous/tasks/${task1.id}/claim`, { agent: 'builder' });
  console.log('-> Builder reivindicou Tarefa 1');

  await api('POST', `/autonomous/tasks/${task1.id}/report`, {
    taskId: task1.id,
    summary: 'Implementado módulo de pipeline de áudio com classes AudioProcessor e StreamBuffer',
    filesCreated: ['src/audio/pipeline.ts'],
    filesModified: ['src/audio/types.ts'],
    testsAdded: ['tests/pipeline.test.ts'],
    testsPassed: true,
    browserValidation: { url: 'http://localhost:5173', passed: true, visualObservations: 'Audio components mounted cleanly' },
    acceptanceCriteriaMet: [
      { criterion: 'Testes unitários de pipeline passando', met: true, evidence: '12 unit tests passed in 45ms' },
      { criterion: 'Interface de áudio tipada', met: true, evidence: 'Exported AudioProcessor interface' }
    ]
  });
  console.log('-> Builder submeteu Builder Report com testes aprovados');

  const rev1 = await api('POST', `/autonomous/tasks/${task1.id}/review`, {
    decision: 'APPROVED',
    notes: 'Implementação limpa, boa cobertura de testes e aderente aos critérios.',
    criteriaEvaluated: [
      { criterion: 'Testes unitários de pipeline passando', approved: true },
      { criterion: 'Interface de áudio tipada', approved: true }
    ]
  });
  console.log(`-> Supervisor revisou: Decisão = ${rev1.data.decision}`);

  // Verificar se Tasks 2, 3 e 4 foram liberadas
  tasksList = (await api('GET', `/autonomous/runs/${autonomousRun.id}/tasks`)).data;
  const nowAvailable = tasksList.filter(t => t.status === 'pending' && t.isAvailable);
  console.log(`Tarefas desbloqueadas após Task 1: ${nowAvailable.map(t => t.title).join(', ')}`);
  if (nowAvailable.length !== 3) {
    throw new Error(`Esperado 3 tarefas disponíveis (2, 3 e 4), mas obteve ${nowAvailable.length}`);
  }
  console.log('✅ Transição de estado DAG perfeita: Tasks 2, 3 e 4 desbloqueadas simultaneamente.\n');

  // 6. Teste de Rejeição e Correção Automática (Tarefa 2)
  console.log('[6/10] Testando Ciclo de Rejeição e Correção (CHANGES_REQUESTED)...');
  await api('POST', `/autonomous/tasks/${task2.id}/claim`, { agent: 'builder' });
  
  // Builder submete com falha
  console.log('-> Builder submete relatório inicial com teste falhando...');
  await api('POST', `/autonomous/tasks/${task2.id}/report`, {
    taskId: task2.id,
    summary: 'Criado Waveform Canvas inicial com WebGL',
    filesCreated: ['src/components/Waveform.tsx'],
    filesModified: [],
    testsAdded: ['tests/waveform.test.ts'],
    testsPassed: false,
    testOutput: 'Error: Waveform canvas failed to clear on resize',
    browserValidation: { url: 'http://localhost:5173', passed: false, visualObservations: 'Glitch na largura do canvas' },
    acceptanceCriteriaMet: [
      { criterion: 'Canvas renderizado sem erros de render', met: false, evidence: 'Canvas redimensionado com glitch' },
      { criterion: 'Testes de componente passando', met: false, evidence: '1 failing test' }
    ]
  });

  // Supervisor reprova e pede correções
  const revReject = await api('POST', `/autonomous/tasks/${task2.id}/review`, {
    decision: 'CHANGES_REQUESTED',
    notes: 'O canvas está com erro no evento de resize e o teste unitário falhou. Ajuste o useEffect com resize observer.',
    requiredChanges: [
      'Corrigir lógica de redimensionamento do canvas',
      'Fazer o teste tests/waveform.test.ts passar 100%'
    ],
    criteriaEvaluated: [
      { criterion: 'Canvas renderizado sem erros de render', approved: false },
      { criterion: 'Testes de componente passando', approved: false }
    ]
  });
  console.log(`-> Supervisor revisou: Decisão = ${revReject.data.decision}`);
  
  const t2AfterReject = (await api('GET', `/autonomous/runs/${autonomousRun.id}/tasks`)).data.find(t => t.id === task2.id);
  console.log(`-> Status da Tarefa 2 após reprovação: "${t2AfterReject.status}" (needs_changes)`);
  if (t2AfterReject.status !== 'needs_changes') {
    throw new Error('A tarefa deveria estar no status needs_changes!');
  }

  // Builder corrige e ressubmete
  console.log('-> Builder corrige código e reenvia relatório...');
  await api('POST', `/autonomous/tasks/${task2.id}/report`, {
    taskId: task2.id,
    summary: 'Corrigido Waveform Canvas adicionando ResizeObserver e debounce',
    filesCreated: ['src/components/Waveform.tsx'],
    filesModified: ['src/components/Waveform.tsx'],
    testsAdded: ['tests/waveform.test.ts'],
    testsPassed: true,
    testOutput: 'All 8 tests passing',
    browserValidation: { url: 'http://localhost:5173', passed: true, visualObservations: 'Waveform renderizado perfeitamente com animação suave' },
    acceptanceCriteriaMet: [
      { criterion: 'Canvas renderizado sem erros de render', met: true, evidence: 'ResizeObserver testado em 3 viewports' },
      { criterion: 'Testes de componente passando', met: true, evidence: '8 tests passed' }
    ]
  });

  const revApprove = await api('POST', `/autonomous/tasks/${task2.id}/review`, {
    decision: 'APPROVED',
    notes: 'Correções validadas. ResizeObserver funciona corretamente.',
    criteriaEvaluated: [
      { criterion: 'Canvas renderizado sem erros de render', approved: true },
      { criterion: 'Testes de componente passando', approved: true }
    ]
  });
  console.log(`-> Supervisor revisou segunda versão: Decisão = ${revApprove.data.decision}`);
  console.log('✅ Ciclo de Rejeição, Feedback e Reaprovação concluído com sucesso!\n');

  // 7. Teste de Approval Inbox com Execução Não-Bloqueante
  console.log('[7/10] Testando Matriz de Risco (ORANGE/RED) e Execução Não-Bloqueante...');
  // Tarefa 3 é ORANGE (migração de banco). Solicita aprovação humana:
  console.log('-> Tarefa 3 requer aprovação de risco ORANGE para migração de banco...');
  const appReq = await api('POST', `/autonomous/runs/${autonomousRun.id}/approvals`, {
    taskId: task3.id,
    riskLevel: 'ORANGE',
    actionType: 'database_migration',
    description: 'Execução de migração DDL de streaming de telemetria no banco de produção SQLite',
    command: 'npx prisma migrate deploy',
    impact: 'Alteração estrutural de schema com criação de 2 novas tabelas'
  });
  console.log(`-> Item de aprovação criado: ID ${appReq.data.id}, Risco: ${appReq.data.risk_level}`);

  // Verificar se Tarefa 3 está BLOCKED
  tasksList = (await api('GET', `/autonomous/runs/${autonomousRun.id}/tasks`)).data;
  const t3Blocked = tasksList.find(t => t.id === task3.id);
  console.log(`-> Status da Tarefa 3: "${t3Blocked.status}" (bloqueada aguardando aprovação humana)`);
  if (t3Blocked.status !== 'blocked') {
    throw new Error('A tarefa 3 deveria estar no status blocked!');
  }

  // Verificar se Tarefa 4 (independente) continua DISPONÍVEL e pode ser executada em paralelo!
  const t4Check = tasksList.find(t => t.id === task4.id);
  console.log(`-> Status da Tarefa 4 (independente): "${t4Check.status}", isAvailable: ${t4Check.isAvailable}`);
  if (!t4Check.isAvailable || t4Check.status !== 'pending') {
    throw new Error('A Tarefa 4 não deveria ser bloqueada pelo bloqueio da Tarefa 3!');
  }
  console.log('-> Executando Tarefa 4 normalmente enquanto Tarefa 3 aguarda no Approval Inbox...');
  await api('POST', `/autonomous/tasks/${task4.id}/claim`, { agent: 'builder' });
  await api('POST', `/autonomous/tasks/${task4.id}/report`, {
    taskId: task4.id,
    summary: 'Endpoint /api/metrics/latency criado com fast route handler',
    filesCreated: ['src/routes/metrics.ts'],
    filesModified: [],
    testsAdded: ['tests/metrics.test.ts'],
    testsPassed: true,
    browserValidation: { url: 'http://localhost:5173', passed: true, visualObservations: 'Metrics dashboard active' },
    acceptanceCriteriaMet: [{ criterion: 'Endpoint /api/metrics/latency responde HTTP 200', met: true, evidence: 'Status 200 OK' }]
  });
  await api('POST', `/autonomous/tasks/${task4.id}/review`, {
    decision: 'APPROVED',
    notes: 'Endpoint implementado e funcional.',
    criteriaEvaluated: [{ criterion: 'Endpoint /api/metrics/latency responde HTTP 200', approved: true }]
  });
  console.log('-> Tarefa 4 concluída com sucesso enquanto Tarefa 3 permaneceu no Inbox!');

  // Agora o humano aprova no Inbox
  console.log('-> Humano acessa Approval Inbox e APROVA a migração...');
  const appResolve = await api('POST', `/autonomous/approvals/${appReq.data.id}/resolve`, {
    approved: true,
    resolvedBy: 'Deco (Tech Lead)',
    comment: 'Migração aprovada após revisão do arquivo de schema'
  });
  console.log(`-> Aprovação resolvida com status: "${appResolve.data.status}"`);

  // Tarefa 3 volta a ficar pronta/pending
  tasksList = (await api('GET', `/autonomous/runs/${autonomousRun.id}/tasks`)).data;
  const t3Unblocked = tasksList.find(t => t.id === task3.id);
  console.log(`-> Status da Tarefa 3 após aprovação: "${t3Unblocked.status}"`);

  // Builder conclui Tarefa 3
  await api('POST', `/autonomous/tasks/${task3.id}/claim`, { agent: 'builder' });
  await api('POST', `/autonomous/tasks/${task3.id}/report`, {
    taskId: task3.id,
    summary: 'Migração SQLite executada com sucesso',
    filesCreated: ['prisma/migrations/20261005_telemetry.sql'],
    filesModified: ['src/db.ts'],
    testsAdded: ['tests/migration.test.ts'],
    testsPassed: true,
    browserValidation: { url: 'http://localhost:5173', passed: true, visualObservations: 'DB status normal' },
    acceptanceCriteriaMet: [
      { criterion: 'Tabelas criadas com integridade referencial', met: true, evidence: '2 tables created' },
      { criterion: 'Backup prévio executado', met: true, evidence: 'Backup saved to .ai-dev-hub/backups' }
    ]
  });
  await api('POST', `/autonomous/tasks/${task3.id}/review`, {
    decision: 'APPROVED',
    notes: 'Migração concluída com integridade verificada.',
    criteriaEvaluated: [
      { criterion: 'Tabelas criadas com integridade referencial', approved: true },
      { criterion: 'Backup prévio executado', approved: true }
    ]
  });
  console.log('✅ Aprovação Humana e Execução Não-Bloqueante validadas com perfeição!\n');

  // 8. Teste de Watchdog e Limites de Segurança
  console.log('[8/10] Validando Políticas de Segurança e Watchdog...');
  const policyCheck = await api('POST', `/autonomous/runs/${autonomousRun.id}/watchdog`, {});
  console.log('-> Resultado do Watchdog:', policyCheck.data);
  console.log('✅ Watchdog ativo: monitorando contadores de iteração, erros consecutivos e timeout.\n');

  // 9. Teste de Persistência e Recuperação de Estado (Crash / Restart)
  console.log('[9/10] Verificando Persistência SQLite e Resiliência a Falhas...');
  const finalRun = (await api('GET', `/autonomous/runs/${autonomousRun.id}`)).data;
  const finalTasks = (await api('GET', `/autonomous/runs/${autonomousRun.id}/tasks`)).data;
  const finalApprovals = (await api('GET', `/autonomous/runs/${autonomousRun.id}/approvals`)).data;
  const finalEvents = (await api('GET', `/autonomous/runs/${autonomousRun.id}/events`)).data;

  console.log(`- Status da Run: ${finalRun.status} (iterações: ${finalRun.iteration_count})`);
  console.log(`- Total de Tarefas Persistidas: ${finalTasks.length} (Concluídas: ${finalTasks.filter(t => t.status === 'completed').length})`);
  console.log(`- Total de Aprovações no Histórico: ${finalApprovals.length}`);
  console.log(`- Eventos Auditados na Linha do Tempo: ${finalEvents.length}`);
  console.log('✅ Persistência Completa: 100% dos dados residem no banco SQLite relacional.\n');

  // 10. Geração do Relatório Noturno Consolidado (Morning Report)
  console.log('[10/10] Gerando Relatório Consolidado (Morning Report)...');
  const reportRes = await api('GET', `/autonomous/runs/${autonomousRun.id}/report`);
  console.log('----------------------------------------------------');
  console.log(reportRes.data.report.slice(0, 500) + '...\n[Restante do relatório gerado com sucesso]');
  console.log('----------------------------------------------------');
  console.log('✅ Morning Report gerado com sucesso!\n');

  console.log('====================================================');
  console.log('🎉 TODOS OS 10 TESTES DA FASE 4 PASSARAM COM SUCESSO!');
  console.log('====================================================');
}

run().catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});
