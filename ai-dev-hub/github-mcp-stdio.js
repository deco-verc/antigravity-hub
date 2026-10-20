#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

if (!process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
    if (token) {
      process.env.GITHUB_PERSONAL_ACCESS_TOKEN = token;
    }
  } catch (err) {
    // gh auth token failed or gh not logged in
  }
}

const serverPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'node_modules',
  '@modelcontextprotocol',
  'server-github',
  'dist',
  'index.js'
);

await import(pathToFileURL(serverPath).href);
