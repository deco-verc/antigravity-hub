import { execSync } from 'node:child_process';

try {
  const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
  console.log('SUCCESS: Token retrieved from gh CLI. Starts with:', token.slice(0, 4), 'Length:', token.length);
} catch (err) {
  console.error('ERROR:', err.message);
}
