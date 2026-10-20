#!/usr/bin/env node
/**
 * AI DEV HUB — Model Context Protocol (MCP) Stdio Server
 * Compatible with Antigravity, Claude Desktop, Cursor, and any MCP client.
 */

process.env.MCP_STDIO = 'true';

import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import compiled or source McpCore
let McpCore;
try {
  const mod = await import('./server/dist/mcpCore.js');
  McpCore = mod.McpCore;
} catch {
  const mod = await import('./server/src/mcpCore.js');
  McpCore = mod.McpCore;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const request = JSON.parse(trimmed);
    const response = await McpCore.handleJsonRpc(request);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (err) {
    const errResponse = {
      jsonrpc: '2.0',
      error: { code: -32700, message: `Parse error: ${err.message}` },
      id: null
    };
    process.stdout.write(JSON.stringify(errResponse) + '\n');
  }
});

rl.on('close', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
