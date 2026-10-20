import fs from 'node:fs';

const serverDistPath = 'C:\\Users\\Deco\\AppData\\Local\\npm-cache\\_npx\\3dfbf5a9eea4a1b3\\node_modules\\@modelcontextprotocol\\server-github\\dist\\index.js';
if (fs.existsSync(serverDistPath)) {
  const content = fs.readFileSync(serverDistPath, 'utf8');
  console.log('Size of server-github index.js:', content.length);
  const toolRegex = /name:\s*['"]([a-z0-9_]+)['"],\s*description:\s*['"]([^'"]+)['"]/g;
  let m;
  const tools = [];
  while ((m = toolRegex.exec(content)) !== null) {
    tools.push({ name: m[1], description: m[2] });
  }
  console.log('Total tools found:', tools.length);
  console.log(tools);
} else {
  console.log('Not found');
}
