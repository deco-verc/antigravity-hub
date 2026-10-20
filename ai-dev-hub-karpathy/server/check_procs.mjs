import { execSync } from 'node:child_process';

const out = execSync(`wmic process where "name='Antigravity.exe' or name='language_server.exe'" get ProcessId,CommandLine /format:list`, { encoding: 'utf-8' });
console.log(out);
