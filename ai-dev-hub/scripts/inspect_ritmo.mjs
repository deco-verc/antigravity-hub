import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';

const dbPath = path.join(os.homedir(), '.ai-dev-hub', 'hub.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

console.log('--- PROJETOS RECENTES ---');
const projects = db.prepare('SELECT id, name, path, active_account_profile_id, status, created_at FROM projects ORDER BY created_at DESC LIMIT 5').all();
console.log(projects);

console.log('\n--- RUNS RECENTES ---');
const runs = db.prepare('SELECT id, project_id, name, status, last_error, next_action, briefing, created_at FROM autonomous_runs ORDER BY created_at DESC LIMIT 5').all();
console.log(runs);

console.log('\n--- NATIVE WORKSPACE BINDINGS ---');
const bindings = db.prepare('SELECT * FROM native_workspace_bindings').all();
console.log(bindings);

console.log('\n--- NATIVE EXECUTION POLICIES ---');
const policies = db.prepare('SELECT * FROM native_execution_policies').all();
console.log(policies);
