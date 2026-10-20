
async function setup() {
  const baseUrl = 'http://127.0.0.1:3001/api';
  console.log('1. Checking if AI Dev Hub Test Runner is registered...');

  const projectsRes = await fetch(`${baseUrl}/projects`);
  const projects = await projectsRes.json();
  let project = projects.find((p) => p.path.toLowerCase().includes('ai-dev-hub-test-runner'));

  if (!project) {
    console.log('Registering project in AI DEV HUB...');
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'AI Dev Hub Test Runner',
        folderPath: 'c:\\IA\\test-projects\\ai-dev-hub-test-runner',
        objective: 'Validação autônoma de desenvolvimento ponta a ponta com GitHub Task Graph, PRs e Code Review',
        description: 'Repositório de teste para demonstrar a orquestração multi-agente Gemini Supervisor + Antigravity Builder + GitHub',
        stack: 'Node.js, TypeScript, GitHub MCP'
      })
    });
    project = await createRes.json();
    console.log('Project created:', project.id, project.name);
  } else {
    console.log('Project already registered:', project.id, project.name);
  }

  console.log('2. Linking to GitHub repo deco-verc/ai-dev-hub-test-runner...');
  const linkRes = await fetch(`${baseUrl}/projects/${project.id}/github`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: 'deco-verc/ai-dev-hub-test-runner',
      branch: 'main'
    })
  });
  const linkData = await linkRes.json();
  console.log('Linked to GitHub successfully:', linkData.github_repo, linkData.github_branch);

  console.log('3. Verifying GitHub status endpoint...');
  const statusRes = await fetch(`${baseUrl}/projects/${project.id}/github`);
  const statusData = await statusRes.json();
  console.log('GitHub Status:', {
    linked: statusData.linked,
    repo: statusData.repo,
    branch: statusData.branch,
    issuesCount: statusData.issuesCount,
    pullRequestsCount: statusData.pullRequestsCount
  });

  return project;
}

setup().catch(err => {
  console.error('Setup error:', err);
  process.exit(1);
});
