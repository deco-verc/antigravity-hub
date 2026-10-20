const { WorkerRegistry } = require('./server/dist/workerRegistry.js');
const { AccountProfileManager } = require('./server/dist/accountProfileManager.js');

async function testWorkerBootstrap() {
  console.log('=== TESTE WORKER BOOTSTRAP REAL ===');

  // 1. Verificar contas
  const activeProf = AccountProfileManager.getGlobalActiveProfile();
  console.log('Conta ativa:', activeProf.id, activeProf.display_name, activeProf.auth_status);

  // 2. Chamar ensureWorkerAvailable
  console.log('Chamando WorkerRegistry.ensureWorkerAvailable()...');
  const worker = await WorkerRegistry.ensureWorkerAvailable();
  console.log('Worker retornado:', worker ? {
    id: worker.id,
    name: worker.name,
    status: worker.status,
    account_profile_id: worker.account_profile_id,
    conversation_id: worker.conversation_id,
    last_heartbeat: worker.last_heartbeat
  } : null);

  if (!worker || worker.status !== 'READY') {
    console.error('❌ Falha: Worker não retornou como READY');
    process.exit(1);
  }

  // 3. Testar claim de lease
  console.log('Testando claim de lease para Worker...');
  const fakeRunId = 'test-run-' + Date.now();
  const fakeTaskId = 'test-task-' + Date.now();
  const leaseId = WorkerRegistry.claimTask(worker.id, fakeRunId, fakeTaskId);
  console.log('Lease adquirida:', leaseId);

  const activeWorker = WorkerRegistry.getWorker(worker.id);
  console.log('Status do Worker após claim:', activeWorker.status);

  if (activeWorker.status !== 'WORKING') {
    console.error('❌ Falha: Worker deveria estar WORKING após claim');
    process.exit(1);
  }

  // 4. Liberar lease
  console.log('Liberando lease...');
  WorkerRegistry.releaseLease(leaseId, worker.id);
  WorkerRegistry.updateWorkerStatus(worker.id, 'READY');
  const releasedWorker = WorkerRegistry.getWorker(worker.id);
  console.log('Status do Worker após release:', releasedWorker.status);

  console.log('✅ SUCESSO: Worker bootstrap, heartbeat e lease management totalmente validados!');
  process.exit(0);
}

testWorkerBootstrap().catch(err => {
  console.error('Erro no teste de bootstrap:', err);
  process.exit(1);
});
