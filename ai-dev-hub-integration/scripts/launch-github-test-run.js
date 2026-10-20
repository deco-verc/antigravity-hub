async function launch() {
  const baseUrl = 'http://127.0.0.1:3001/api';
  console.log('Fetching project id for AI Dev Hub Test Runner...');
  const projectsRes = await fetch(`${baseUrl}/projects`);
  const projects = await projectsRes.json();
  const project = projects.find((p) => p.path.toLowerCase().includes('ai-dev-hub-test-runner'));

  if (!project) {
    throw new Error('Project not found in AI DEV HUB');
  }

  console.log(`Target Project: ${project.name} (${project.id})`);
  console.log(`Target GitHub Repo: ${project.github_repo}`);

  console.log('\nCreating Autonomous Run with GitHub Task Graph...');
  const createRunRes = await fetch(`${baseUrl}/autonomous/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: project.id,
      name: 'TaskFlow - Micro-Serviço & Biblioteca Utilitária',
      objective: 'Construir um micro-serviço modular de utilitários em Node.js e TypeScript com Task Graph no GitHub, branches dedicadas, Pull Requests, Code Review e merge automatizado.',
      briefing: `Construir uma biblioteca de utilitários e micro-serviço chamada TaskFlow em Node.js e TypeScript dentro deste repositório.
Requisitos do MVP:
1. Setup do projeto: package.json, tsconfig.json e estrutura base de pastas src/.
2. Módulo de validação de schemas e tipos TypeScript para tarefas e eventos.
3. Módulo de persistência leve e gerenciamento de estado em JSON.
4. Endpoints e handlers de API REST para criação e consulta de tarefas.
5. Testes automatizados unitários e script de execução comprovando 100% de integridade.`,
      autonomyMode: 'autonomous',
      maxHours: 4.0,
      maxCycles: 30
    })
  });

  const run = await createRunRes.json();
  console.log('\n✅ Autonomous Run Created successfully!');
  console.log('Run ID:', run.id);
  console.log('Run Name:', run.name);
  console.log('GitHub Epic Issue:', run.github_epic_issue_number, run.github_epic_issue_url);
  console.log('Tasks mapped:', run.tasks?.length);

  for (const t of (run.tasks || [])) {
    console.log(` - [#${t.github_issue_number || 'local'}] ${t.milestone}: ${t.title} (${t.status}) -> ${t.github_issue_url || ''}`);
  }

  return run;
}

launch().catch(err => {
  console.error('Launch failed:', err);
  process.exit(1);
});
