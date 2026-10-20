import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

const isHttpTest = process.argv.includes('--http-only');
const isStdioTest = process.argv.includes('--stdio-only');

async function testStdio() {
  console.log('\n========================================');
  console.log('🧪 TESTANDO MCP VIA STDIO (mcp-stdio.js)');
  console.log('========================================');

  const mcpScript = path.resolve('mcp-stdio.js');
  const child = spawn(process.execPath, [mcpScript], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const rl = readline.createInterface({ input: child.stdout });
  let reqId = 1;
  const pendingRequests = new Map();

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pendingRequests.has(msg.id)) {
        const resolve = pendingRequests.get(msg.id);
        pendingRequests.delete(msg.id);
        resolve(msg);
      }
    } catch (e) {
      console.error('Erro ao parsear linha JSON do stdio:', line);
    }
  });

  child.stderr.on('data', (d) => {
    // stdio debug output from server
    // console.log('[STDERR]', d.toString().trim());
  });

  function sendRpc(method, params = {}) {
    const id = reqId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve) => {
      pendingRequests.set(id, resolve);
      child.stdin.write(payload + '\n');
    });
  }

  try {
    // 1. initialize
    console.log('1. Enviando initialize...');
    const initRes = await sendRpc('initialize', {});
    console.log('   ✅ Inicializado:', initRes.result.serverInfo);

    // 2. tools/list
    console.log('2. Listando tools...');
    const listRes = await sendRpc('tools/list', {});
    const tools = listRes.result.tools;
    console.log(`   ✅ Total de tools encontradas: ${tools.length}`);
    const toolNames = tools.map((t) => t.name);
    console.log(`   🛠️  Tools: ${toolNames.slice(0, 10).join(', ')}... (+${toolNames.length - 10} mais)`);

    // Ensure all 23 expected tools exist
    const expectedTools = [
      'get_projects', 'get_project_context', 'get_project_overview', 'get_project_memory',
      'get_tasks', 'get_git_status', 'get_recent_changes', 'get_session_history',
      'get_last_checkpoint', 'create_checkpoint', 'update_project_memory', 'add_task',
      'update_task', 'add_decision', 'log_change', 'add_problem', 'resolve_problem',
      'set_next_task', 'start_session', 'end_session', 'search_project_context',
      'smart_checkpoint', 'generate_handover'
    ];
    const missing = expectedTools.filter(t => !toolNames.includes(t));
    if (missing.length > 0) {
      throw new Error(`Faltando ferramentas MCP: ${missing.join(', ')}`);
    }
    console.log('   ✅ Todas as 23 ferramentas obrigatórias estão presentes!');

    // 3. get_projects
    console.log('3. Chamando get_projects...');
    const projRes = await sendRpc('tools/call', { name: 'get_projects', arguments: {} });
    const projects = JSON.parse(projRes.result.content[0].text);
    console.log(`   ✅ Projetos cadastrados: ${projects.length}`);
    if (projects.length === 0) {
      throw new Error('Nenhum projeto encontrado para testar.');
    }
    const testProject = projects[0];
    console.log(`   🎯 Usando projeto de teste: "${testProject.name}" (${testProject.id})`);

    // 4. get_project_context (compact e normal)
    console.log('4. Testando get_project_context (compact & normal)...');
    const ctxCompact = await sendRpc('tools/call', {
      name: 'get_project_context',
      arguments: { project: testProject.id, mode: 'compact' }
    });
    console.log('   ✅ Contexto Compact obtido. Tamanho:', ctxCompact.result.content[0].text.length, 'bytes');

    const ctxNormal = await sendRpc('tools/call', {
      name: 'get_project_context',
      arguments: { project: testProject.id, mode: 'normal' }
    });
    console.log('   ✅ Contexto Normal obtido. Tamanho:', ctxNormal.result.content[0].text.length, 'bytes');

    // 5. search_project_context
    console.log('5. Testando search_project_context...');
    const searchRes = await sendRpc('tools/call', {
      name: 'search_project_context',
      arguments: { project: testProject.id, query: 'projeto' }
    });
    console.log('   ✅ Busca executada com sucesso.');

    // 6. start_session
    console.log('6. Testando start_session...');
    const sessionStart = await sendRpc('tools/call', {
      name: 'start_session',
      arguments: { project: testProject.id, agent_name: 'Antigravity Test Agent' }
    });
    const sessionData = JSON.parse(sessionStart.result.content[0].text);
    console.log(`   ✅ Sessão iniciada! session_id: ${sessionData.session_id}`);

    // 7. add_decision
    console.log('7. Testando add_decision...');
    const decRes = await sendRpc('tools/call', {
      name: 'add_decision',
      arguments: {
        project: testProject.id,
        decision: 'MCP Server Unificado via JSON-RPC 2.0',
        rationale: 'Permitir que agentes acessem memória estruturada com segurança local.'
      }
    });
    console.log('   ✅ Decisão registrada.');

    // 8. add_task
    console.log('8. Testando add_task...');
    const taskRes = await sendRpc('tools/call', {
      name: 'add_task',
      arguments: {
        project: testProject.id,
        task: 'Auditar integração MCP no Antigravity',
        column: 'done'
      }
    });
    console.log('   ✅ Tarefa adicionada e sincronizada.');

    // 9. end_session
    console.log('9. Testando end_session...');
    const endRes = await sendRpc('tools/call', {
      name: 'end_session',
      arguments: {
        session_id: sessionData.session_id,
        implemented: ['Teste automatizado do MCP executado com sucesso'],
        files_changed: ['mcp-stdio.js', 'server/src/mcpCore.ts'],
        decisions: ['Padronização do protocolo MCP em stdio e http'],
        next_task: 'Habilitar interface do Agent Context no Frontend'
      }
    });
    const endData = JSON.parse(endRes.result.content[0].text);
    console.log(`   ✅ Sessão encerrada! Sessão #${endData.session_number} arquivada.`);

    // 10. generate_handover
    console.log('10. Testando generate_handover...');
    const handoverRes = await sendRpc('tools/call', {
      name: 'generate_handover',
      arguments: { project: testProject.id }
    });
    console.log('   ✅ Handover prompt gerado!');

    // 11. smart_checkpoint
    console.log('11. Testando smart_checkpoint...');
    const cpRes = await sendRpc('tools/call', {
      name: 'smart_checkpoint',
      arguments: { project: testProject.id }
    });
    console.log('   ✅ Smart Checkpoint gerado!');

    console.log('\n🎉 TODOS OS TESTES STDIO DO MCP PASSARAM COM SUCESSO!\n');
  } finally {
    rl.close();
    child.stdin.end();
    await new Promise((resolve) => {
      child.on('exit', resolve);
      setTimeout(resolve, 500);
    });
  }
}

async function testHttp() {
  console.log('\n========================================');
  console.log('🧪 TESTANDO MCP VIA HTTP (/api/mcp)');
  console.log('========================================');

  const baseUrl = 'http://127.0.0.1:3001/api/mcp';

  // 1. GET /api/mcp/status
  console.log('1. Consultando GET /api/mcp/status...');
  const statusRes = await fetch(`${baseUrl}/status`);
  if (!statusRes.ok) throw new Error(`Falha em /status: HTTP ${statusRes.status}`);
  const statusData = await statusRes.json();
  console.log('   ✅ Status:', statusData.status, '| Tools:', statusData.toolsCount, '| Transports:', statusData.transports);

  // 2. POST /api/mcp/test
  console.log('2. Executando POST /api/mcp/test...');
  const testRes = await fetch(`${baseUrl}/test`, { method: 'POST' });
  if (!testRes.ok) throw new Error(`Falha em /test: HTTP ${testRes.status}`);
  const testData = await testRes.json();
  console.log('   ✅ Self-test MCP:', testData.status, `(Latência: ${testData.latencyMs}ms)`);

  // 3. POST /api/mcp (JSON-RPC)
  console.log('3. Chamando POST /api/mcp com get_projects...');
  const rpcRes = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'get_projects', arguments: {} }
    })
  });
  if (!rpcRes.ok) throw new Error(`Falha em POST /api/mcp: HTTP ${rpcRes.status}`);
  const rpcData = await rpcRes.json();
  console.log('   ✅ JSON-RPC HTTP OK:', rpcData.result ? 'Resposta válida recebida' : rpcData);

  console.log('\n🎉 TODOS OS TESTES HTTP DO MCP PASSARAM COM SUCESSO!\n');
}

async function main() {
  try {
    if (!isHttpTest) {
      await testStdio();
    }
    if (!isStdioTest) {
      await testHttp();
    }
    console.log('🏁 SUITE COMPLETA DE TESTES MCP CONCLUÍDA COM ÊXITO!');
  } catch (err) {
    console.error('\n❌ ERRO DURANTE TESTES MCP:', err.message);
    process.exit(1);
  }
}

main();
