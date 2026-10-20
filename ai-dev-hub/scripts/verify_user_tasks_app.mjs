import { createAppServer } from 'file:///C:/IA/test-projects/decohub-user-tasks-app/src/server.ts';
import fs from 'node:fs';
import path from 'node:path';

async function runVerification() {
  console.log('🚀 Iniciando verificação funcional E2E do Aplicativo de Tarefas...');

  const tempDb = path.join(process.cwd(), 'temp-verify-tasks.db');
  if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);

  const appInstance = createAppServer({
    port: 4055,
    dbPath: tempDb
  });

  const { port, url } = await appInstance.start();
  console.log(`✅ Servidor HTTP rodando na porta ${port} (${url})`);

  try {
    // 1. GET / (Interface Web HTML)
    console.log('Testing GET / (Interface Web)...');
    const htmlRes = await fetch(`${url}/`);
    if (htmlRes.status !== 200) throw new Error(`HTML status ${htmlRes.status}`);
    const htmlText = await htmlRes.text();
    if (!htmlText.includes('<!DOCTYPE html>') || !htmlText.includes('Tarefas')) {
      throw new Error('HTML não contém cabeçalho esperado');
    }
    console.log('  ✔ Interface Web HTML retornou status 200 com markup completo');

    // 2. GET /api/health
    console.log('Testing GET /api/health...');
    const healthRes = await fetch(`${url}/api/health`);
    const healthData = await healthRes.json();
    if (healthRes.status !== 200 || healthData.status !== 'ok') {
      throw new Error(`Health check falhou: ${JSON.stringify(healthData)}`);
    }
    console.log('  ✔ Health check OK');

    // 3. GET /api/tasks (Empty list)
    console.log('Testing GET /api/tasks...');
    const listRes = await fetch(`${url}/api/tasks`);
    const list = await listRes.json();
    if (!Array.isArray(list)) throw new Error('Tasks deve ser um array');
    console.log(`  ✔ Lista inicial obtida: ${list.length} tarefas`);

    // 4. POST /api/tasks (Criar tarefa)
    console.log('Testing POST /api/tasks (Cadastro de tarefa)...');
    const createRes = await fetch(`${url}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Construir Dashboard DecoHUB',
        description: 'Implementar interface moderna com cards e status',
        completed: false
      })
    });
    if (createRes.status !== 201) throw new Error(`Create status ${createRes.status}`);
    const created = await createRes.json();
    if (!created?.id || created.title !== 'Construir Dashboard DecoHUB') {
      throw new Error(`Falha nos dados da tarefa criada: ${JSON.stringify(created)}`);
    }
    const taskId = created.id;
    console.log(`  ✔ Tarefa criada com sucesso: ID ${taskId} ("${created.title}")`);

    // 5. GET /api/tasks/:id
    console.log(`Testing GET /api/tasks/${taskId}...`);
    const getRes = await fetch(`${url}/api/tasks/${taskId}`);
    if (getRes.status !== 200) throw new Error(`Get task status ${getRes.status}`);
    const getData = await getRes.json();
    if (getData.id !== taskId) throw new Error('Task ID mismatch');
    console.log('  ✔ Tarefa consultada por ID com sucesso');

    // 6. PATCH /api/tasks/:id (Editar tarefa)
    console.log(`Testing PATCH /api/tasks/${taskId} (Edição de tarefa)...`);
    const patchRes = await fetch(`${url}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Construir Dashboard DecoHUB [FINALIZADO]',
        completed: true
      })
    });
    if (patchRes.status !== 200) throw new Error(`Patch status ${patchRes.status}`);
    const patchData = await patchRes.json();
    if (patchData.completed !== true || !patchData.title.includes('[FINALIZADO]')) {
      throw new Error(`Falha na atualização da tarefa: ${JSON.stringify(patchData)}`);
    }
    console.log(`  ✔ Tarefa editada: novo completed="${patchData.completed}", title="${patchData.title}"`);

    // 7. GET /api/tasks?status=completed (Filtro)
    console.log('Testing GET /api/tasks?status=completed (Filtro por status)...');
    const filterRes = await fetch(`${url}/api/tasks?status=completed`);
    const filterData = await filterRes.json();
    const matched = filterData.find(t => t.id === taskId);
    if (!matched) throw new Error('Tarefa filtrada não encontrada no resultado');
    console.log(`  ✔ Filtro por status=completed retornou ${filterData.length} tarefa(s) correspondente(s)`);

    // 8. DELETE /api/tasks/:id (Exclusão)
    console.log(`Testing DELETE /api/tasks/${taskId} (Exclusão de tarefa)...`);
    const delRes = await fetch(`${url}/api/tasks/${taskId}`, { method: 'DELETE' });
    if (delRes.status !== 200 && delRes.status !== 204) throw new Error(`Delete status ${delRes.status}`);
    console.log('  ✔ Tarefa excluída com sucesso');

    // 9. Confirm 404 after delete
    const notFoundRes = await fetch(`${url}/api/tasks/${taskId}`);
    if (notFoundRes.status !== 404) throw new Error(`Expected 404 after delete, got ${notFoundRes.status}`);
    console.log('  ✔ Confirmação pós-exclusão: status 404 verificado com sucesso');

    console.log('\n======================================================');
    console.log('🎉 TODOS OS 9 CRITÉRIOS FUNCIONAIS DO APLICATIVO PASSARAM!');
    console.log('======================================================');
  } finally {
    await appInstance.stop();
    console.log('Servidor finalizado.');
    if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
  }
}

runVerification().catch(err => {
  console.error('❌ Erro na verificação funcional:', err);
  process.exit(1);
});
