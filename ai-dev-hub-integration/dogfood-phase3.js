import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function dogfood() {
  console.log('🐕 INICIANDO DOGFOODING DA FASE 3 DO AI DEV HUB VIA MCP...');

  const { McpCore } = await import('./server/dist/mcpCore.js');

  // 1. Check projects
  const projects = await McpCore.handleToolCall('get_projects', {});
  console.log(`📂 Projetos encontrados: ${projects.length}`);

  let targetProject = projects.find(p => p.name.includes('Voice') || p.name.includes('ai-voice-studio')) || projects[0];
  console.log(`🎯 Projeto selecionado para dogfooding: "${targetProject.name}" (${targetProject.id})`);

  // 2. start_session
  console.log('\n1. Iniciando sessão de agente via MCP start_session...');
  const session = await McpCore.handleToolCall('start_session', {
    project: targetProject.id,
    agent_name: 'Antigravity Senior Agent (Fase 3)'
  });
  console.log(`   ✅ Sessão iniciada: #${session.sessionNumber} (ID: ${session.sessionId})`);

  // 3. add_decision
  console.log('\n2. Registrando decisões arquiteturais da Fase 3 via add_decision...');
  await McpCore.handleToolCall('add_decision', {
    project: targetProject.id,
    decision: 'Implementação de servidor MCP local (stdio + HTTP) com 23 ferramentas padronizadas',
    rationale: 'Permitir que agentes de programação externos (Cursor, Antigravity, Claude Code) interajam diretamente com a memória permanente.'
  });
  await McpCore.handleToolCall('add_decision', {
    project: targetProject.id,
    decision: 'Modelo de memória em 3 níveis (Level 1: Project Memory, Level 2: Working Memory, Level 3: History)',
    rationale: 'Permite modos compact, normal e full para otimizar tokens e velocidade de bootstrap de LLMs.'
  });
  await McpCore.handleToolCall('add_decision', {
    project: targetProject.id,
    decision: 'Single Source of Truth desacoplada: .ai-dev-hub/ em Markdown e auditoria no SQLite local',
    rationale: 'Arquivos no repositório versionados pelo Git com auditoria global de sessões no banco ~/.ai-dev-hub/hub.db.'
  });
  console.log('   ✅ 3 Decisões arquiteturais registradas em decisions.md!');

  // 4. log_change
  console.log('\n3. Registrando alterações de código via log_change...');
  await McpCore.handleToolCall('log_change', {
    project: targetProject.id,
    files: [
      'mcp-stdio.js',
      'server/src/mcpCore.ts',
      'server/src/sessionManager.ts',
      'server/src/routes.ts',
      'client/src/components/AgentContextView.tsx',
      'client/src/components/SystemHealthView.tsx'
    ],
    description: 'Implementação completa do MCP Server, 23 tools, camada de memória permanente e interface Agent Context'
  });
  console.log('   ✅ Alterações registradas em changes.md!');

  // 5. add_task
  console.log('\n4. Registrando tarefas concluídas via add_task...');
  await McpCore.handleToolCall('add_task', {
    project: targetProject.id,
    task: 'Construir servidor MCP local com 23 ferramentas',
    column: 'done'
  });
  await McpCore.handleToolCall('add_task', {
    project: targetProject.id,
    task: 'Implementar modelo de memória em 3 níveis (compact, normal, full)',
    column: 'done'
  });
  await McpCore.handleToolCall('add_task', {
    project: targetProject.id,
    task: 'Adicionar interface Agent Context e card MCP no System Health',
    column: 'done'
  });
  await McpCore.handleToolCall('add_task', {
    project: targetProject.id,
    task: 'Auditar segurança local (127.0.0.1 e CORS restrito)',
    column: 'done'
  });
  console.log('   ✅ 4 Tarefas registradas como concluídas em tasks.md!');

  // 6. smart_checkpoint
  console.log('\n5. Executando smart_checkpoint via MCP...');
  const smartCp = await McpCore.handleToolCall('smart_checkpoint', { project: targetProject.id });
  console.log(`   ✅ Smart Checkpoint #${smartCp.sessionNumber} gerado e salvo em session-summary.md!`);

  // 7. generate_handover
  console.log('\n6. Gerando Handover Prompt via generate_handover...');
  const handover = await McpCore.handleToolCall('generate_handover', { project: targetProject.id });
  console.log(`   ✅ Handover Prompt gerado com sucesso (${handover.length} caracteres)!`);

  // 8. end_session
  console.log('\n7. Finalizando sessão via end_session...');
  const endResult = await McpCore.handleToolCall('end_session', {
    session_id: session.sessionId,
    implemented: [
      'Servidor MCP com 23 ferramentas operando via stdio e HTTP',
      'Modelo de contexto em 3 níveis (compact/normal/full)',
      'Aba Agent Context no frontend e card MCP em System Health',
      'Integração configurada em ~/.gemini/config/mcp_config.json'
    ],
    files_changed: [
      'mcp-stdio.js',
      'server/src/mcpCore.ts',
      'server/src/sessionManager.ts',
      'client/src/components/AgentContextView.tsx'
    ],
    next_task: 'Realizar auditoria no navegador e verificação de inicialização',
    notes: 'Fase 3 concluída com 100% de sucesso.'
  });
  console.log(`   ✅ Sessão #${endResult.sessionNumber} concluída com sucesso e persistida no SQLite!`);

  console.log('\n🎉 DOGFOODING DO MCP DA FASE 3 CONCLUÍDO COM ÊXITO TOTAL!');
}

dogfood().catch(err => {
  console.error('❌ Erro no dogfooding:', err);
  process.exit(1);
});
