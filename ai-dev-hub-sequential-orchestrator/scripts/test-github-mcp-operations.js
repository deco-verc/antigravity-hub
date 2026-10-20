import { GitHubMcpClient } from '../server/src/githubMcpClient.ts';

async function testOperations() {
  const owner = 'deco-verc';
  const repo = 'ai-dev-hub-test-runner';
  console.log(`Testing GitHub MCP operations on ${owner}/${repo}...`);

  // 1. Create Issue
  console.log('1. Creating test issue...');
  const issue = await GitHubMcpClient.createIssue(
    owner,
    repo,
    '[TEST] Test Issue created via GitHub MCP Server',
    'This is a validation test issue created by the AI DEV HUB autonomous system via GitHub MCP.\n\n- [x] Initial check',
    ['test', 'automated']
  );
  console.log(`Created Issue #${issue.number}: ${issue.title} (${issue.html_url})`);

  // 2. Read Issue
  console.log('\n2. Reading issue details...');
  const fetched = await GitHubMcpClient.getIssue(owner, repo, issue.number);
  console.log(`Fetched Issue #${fetched.number}: state=${fetched.state}, labels=${fetched.labels?.map((l) => l.name).join(', ')}`);

  // 3. Add Comment
  console.log('\n3. Adding comment to issue...');
  const comment = await GitHubMcpClient.addIssueComment(
    owner,
    repo,
    issue.number,
    'Verified: Antigravity and AI DEV HUB have full read/write access via official GitHub MCP Server.'
  );
  console.log('Comment added successfully!');

  // 4. Update Issue
  console.log('\n4. Updating issue (closing it)...');
  const updated = await GitHubMcpClient.updateIssue(owner, repo, issue.number, {
    state: 'closed'
  });
  console.log(`Updated Issue #${updated.number}: state=${updated.state}`);

  // 5. List issues
  console.log('\n5. Listing issues...');
  const issues = await GitHubMcpClient.listIssues(owner, repo, 'all');
  console.log(`Total issues found in repo: ${issues.length}`);

  console.log('\n🎉 ALL GITHUB MCP READ/WRITE CAPABILITIES VERIFIED 100%!');
}

testOperations().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
