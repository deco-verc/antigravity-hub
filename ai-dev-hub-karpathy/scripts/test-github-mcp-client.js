import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('Starting GitHub MCP test client...');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, '..', 'github-mcp-stdio.js')],
  });

  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('Connected to GitHub MCP server!');

  const toolsResponse = await client.listTools();
  console.log(`Successfully listed ${toolsResponse.tools.length} tools:`);
  for (const t of toolsResponse.tools) {
    console.log(`- ${t.name}: ${t.description.slice(0, 60)}...`);
  }

  // Let's test a tool call: search_repositories or list_issues
  console.log('\nTesting tool call search_repositories with query "repo:deco-verc/ai-pro-landing"...');
  try {
    const searchRes = await client.callTool({
      name: 'search_repositories',
      arguments: {
        query: 'user:deco-verc',
      },
    });
    console.log('Tool call search_repositories response:');
    console.log(JSON.stringify(searchRes, null, 2).slice(0, 500));
  } catch (callErr) {
    console.error('CallTool error:', callErr);
  }

  await transport.close();
  console.log('\nTest completed successfully!');
}

main().catch(err => {
  console.error('FATAL error in MCP test client:', err);
  process.exit(1);
});
