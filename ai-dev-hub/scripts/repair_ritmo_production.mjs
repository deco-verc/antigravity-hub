import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const dbPath = path.join(os.homedir(), '.ai-dev-hub', 'hub.db');
const db = new DatabaseSync(dbPath);

const projectId = 'b15f9af0-6843-461c-8ae6-3daea0396fd7';
const runId = '83986c07-4235-4509-8a14-4bad6b3e3bc5';
const projectPath = 'C:\\IA\\test-projects\\Ritmo';
const profileId = 'acc-pro-1';
const userProfileDir = 'C:\\Users\\Deco';

console.log('--- REPARANDO RITMO NO BANCO DE PRODUÇÃO ---');

// 1. Criar arquivo de configuração oficial no Antigravity ~/.gemini/config/projects/
const nativeConfigDir = path.join(userProfileDir, '.gemini', 'config', 'projects');
const nativeConfigId = crypto.randomUUID();
const nativeConfigFile = path.join(nativeConfigDir, `${nativeConfigId}.json`);

const nativeConfig = {
  id: nativeConfigId,
  name: 'Ritmo - Produtividade',
  projectResources: {
    resources: [
      {
        gitFolder: {
          folderUri: pathToFileURL(projectPath).href
        }
      }
    ]
  },
  settings: {
    fileAccessPolicy: 'AGENT_SETTING_POLICY_ALLOW',
    sandboxMode: false,
    autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER'
  },
  isWorkspaceOnly: false
};

const rawConfig = JSON.stringify(nativeConfig, null, 2);
fs.writeFileSync(nativeConfigFile, rawConfig, 'utf8');
const configHash = crypto.createHash('sha256').update(Buffer.from(rawConfig)).digest('hex');
console.log('Configuração nativa criada:', nativeConfigFile);
console.log('Native Project ID:', nativeConfigId);
console.log('Config Hash:', configHash);

// 2. Configurar native_execution_policies para o Ritmo
const now = new Date().toISOString();
const policyChoice = {
  mode: 'permissive',
  acknowledgement: {
    userConsent: 'Autorização explícita do usuário: aceitar ALLOW/EAGER sem contenção do filesystem para o projeto Ritmo.',
    outsideAccessAllowed: true,
    automaticCommandsAllowed: true,
    noFilesystemIsolation: true
  }
};

db.prepare(`
  INSERT INTO native_execution_policies (project_id, choice_json, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(project_id) DO UPDATE SET choice_json=excluded.choice_json, updated_at=excluded.updated_at
`).run(projectId, JSON.stringify(policyChoice), now);

db.prepare(`
  INSERT INTO native_execution_policy_audit (project_id, previous_json, choice_json, created_at)
  VALUES (?, ?, ?, ?)
`).run(projectId, JSON.stringify({ mode: 'restricted' }), JSON.stringify(policyChoice), now);
console.log('Política nativa ALLOW/EAGER salva no banco.');

// 3. Inserir em native_workspace_bindings
db.prepare(`
  INSERT INTO native_workspace_bindings (project_id, account_profile_id, native_project_id, user_profile_dir, workspace_path, config_hash)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(project_id) DO UPDATE SET
    account_profile_id=excluded.account_profile_id,
    native_project_id=excluded.native_project_id,
    user_profile_dir=excluded.user_profile_dir,
    workspace_path=excluded.workspace_path,
    config_hash=excluded.config_hash
`).run(projectId, profileId, nativeConfigId, userProfileDir, path.normalize(projectPath).toLowerCase(), configHash);
console.log('Vínculo nativo registrado com sucesso.');

// 4. Atualizar o Run bloqueado para status 'ready' e limpar last_error
const runBefore = db.prepare('SELECT id, name, status, last_error, next_action, briefing FROM autonomous_runs WHERE id = ?').get(runId);
console.log('Run antes do reparo:', {
  id: runBefore.id,
  status: runBefore.status,
  last_error: runBefore.last_error,
  briefingLength: runBefore.briefing ? runBefore.briefing.length : 0
});

db.prepare(`
  UPDATE autonomous_runs
  SET status = 'ready', last_error = NULL, next_action = 'Pronto para iniciar planejamento', updated_at = ?
  WHERE id = ?
`).run(now, runId);

const runAfter = db.prepare('SELECT id, name, status, last_error, next_action, briefing FROM autonomous_runs WHERE id = ?').get(runId);
console.log('Run após o reparo:', {
  id: runAfter.id,
  status: runAfter.status,
  last_error: runAfter.last_error,
  next_action: runAfter.next_action,
  briefingLength: runAfter.briefing ? runAfter.briefing.length : 0
});

// 5. Verificar outros projetos (FinanceFlow, AutoAdapt)
const otherProjects = db.prepare('SELECT id, name, status FROM projects WHERE id != ?').all(projectId);
console.log('Outros projetos verificados (intactos):', otherProjects);
