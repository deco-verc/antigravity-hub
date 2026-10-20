import { execSync } from 'node:child_process';

const out = execSync(`wmic process where "commandline like '%test_isolated_probe%'" get ProcessId,CommandLine /format:list`, { encoding: 'utf-8' });
console.log(out);
