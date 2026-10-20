import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetDir = 'C:\\Users\\Deco\\.gemini\\antigravity\\mcp\\github';

async function main() {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, '..', 'github-mcp-stdio.js')],
  });

  const client = new Client(
    { name: 'schema-exporter', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  const toolsResponse = await client.listTools();
  console.log(`Exporting ${toolsResponse.tools.length} tool schemas to ${targetDir}...`);

  for (const tool of toolsResponse.tools) {
    const schemaFile = path.join(targetDir, `${tool.name}.json`);
    const content = {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    };
    fs.writeFileSync(schemaFile, JSON.stringify(content, null, 2), 'utf8');
    console.log(`Saved: ${tool.name}.json`);
  }

  await transport.close();
  console.log('Schemas exported successfully!');
}

main().catch(err => {
  console.error('Error exporting schemas:', err);
  process.exit(1);
});
