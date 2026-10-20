async function check() {
  const baseUrl = 'http://127.0.0.1:3001/api';
  const runId = '6a023675-3611-4550-a20f-4412a22686de';
  const res = await fetch(`${baseUrl}/autonomous/runs/${runId}`);
  const run = await res.json();
  console.log('=== RUN STATUS ===');
  console.log(`Name: ${run.name}`);
  console.log(`Status: ${run.status}`);
  console.log(`Current Worker: ${run.current_worker || 'N/A'}`);
  console.log(`Current Task: ${run.current_task || 'N/A'}`);
  console.log(`Iteration: ${run.iteration}`);
  console.log(`Epic Issue: #${run.github_epic_issue_number}`);

  console.log('\n=== TASKS ===');
  for (const t of (run.tasks || [])) {
    console.log(`- [#${t.github_issue_number}] ${t.title}`);
    console.log(`  Status: ${t.status} | Branch: ${t.github_branch || 'N/A'} | PR: ${t.github_pr_number ? '#' + t.github_pr_number : 'None'}`);
  }

  console.log('\n=== RECENT EVENTS (LAST 6) ===');
  for (const ev of (run.events || []).slice(0, 6)) {
    console.log(`[${ev.agent_role?.toUpperCase()}] ${ev.event_type}: ${ev.message}`);
  }
}

check().catch(console.error);
