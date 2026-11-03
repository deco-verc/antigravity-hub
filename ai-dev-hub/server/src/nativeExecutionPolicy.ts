import { db } from './db.js';
import { assertNativeExecutionPolicy, NativeExecutionChoice } from './nativePolicyValidation.js';
export { assertNativeExecutionPolicy, NativeExecutionChoice } from './nativePolicyValidation.js';

// This is a DecoHUB choice per project, never a write to Antigravity settings.
export class NativeExecutionPolicy {
  static get(projectId: string): NativeExecutionChoice {
    const row = db.prepare('SELECT choice_json FROM native_execution_policies WHERE project_id=?').get(projectId) as any;
    const choice: NativeExecutionChoice = row ? JSON.parse(row.choice_json) : { mode: 'restricted' };
    // Validate the acknowledgement even before official metadata is available.
    assertNativeExecutionPolicy(choice.mode === 'permissive'
      ? { fileAccessPolicy: 'AGENT_SETTING_POLICY_ALLOW', autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER' }
      : { fileAccessPolicy: 'AGENT_SETTING_POLICY_DENY', autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF' }, choice);
    return choice;
  }
  static releaseStaleAmbiguousLocks(projectId?: string, projectPath?: string): void {
    try {
      // Clear execution reservations older than 5 minutes or malformed (blindado sem json_valid)
      db.prepare(`
        DELETE FROM execution_reservations
        WHERE datetime(COALESCE(updated_at, created_at), '+5 minutes') < datetime('now')
           OR context_json IS NULL
           OR TRIM(context_json) NOT LIKE '{%'
      `).run();

      // Limpeza de segurança em JS para validar JSON sem depender de extensão C SQLite
      try {
        const rows = db.prepare('SELECT scope, context_json FROM execution_reservations').all() as any[];
        for (const row of rows) {
          try {
            JSON.parse(row.context_json);
          } catch {
            db.prepare('DELETE FROM execution_reservations WHERE scope = ?').run(row.scope);
          }
        }
      } catch {}

      // Clear dead agent creation reservations older than 2 minutes
      if (projectId) {
        db.prepare(`
          DELETE FROM agent_creation_reservations
          WHERE project_id = ? AND status <> 'CONFIRMED'
            AND datetime(created_at, '+2 minutes') < datetime('now')
        `).run(projectId);
      }
    } catch {}
  }

  static configure(projectId: string, choice: NativeExecutionChoice): NativeExecutionChoice {
    // Validate before starting a transaction; malformed input cannot change the policy.
    assertNativeExecutionPolicy(choice?.mode === 'permissive'
      ? { fileAccessPolicy: 'AGENT_SETTING_POLICY_ALLOW', autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER' }
      : { fileAccessPolicy: 'AGENT_SETTING_POLICY_DENY', autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF' }, choice);
    db.exec('BEGIN IMMEDIATE');
    try {
      const project = db.prepare('SELECT path FROM projects WHERE id=?').get(projectId) as any;
      if (!project) throw new Error('NATIVE_EXECUTION_PROJECT_NOT_FOUND');
      this.releaseStaleAmbiguousLocks(projectId, project.path);
      if (db.prepare("SELECT 1 FROM autonomous_runs WHERE project_id=? AND status NOT IN ('completed','failed') LIMIT 1").get(projectId) ||
          db.prepare("SELECT 1 FROM agent_turn_observations WHERE project_path=? AND phase IN ('IN_FLIGHT','UNCERTAIN') LIMIT 1").get(project.path) ||
          db.prepare("SELECT 1 FROM execution_reservations WHERE scope = ? OR json_extract(context_json, '$.projectId') = ? LIMIT 1").get(projectId, projectId) ||
          db.prepare("SELECT 1 FROM agent_creation_reservations WHERE project_id=? AND status<>'CONFIRMED' LIMIT 1").get(projectId)) {
        throw new Error('NATIVE_EXECUTION_POLICY_ACTIVE_OR_AMBIGUOUS');
      }
      const previous = this.get(projectId), now = new Date().toISOString();
      // Canonicalize input: no injected fields, no implicit consent from full_dev_autonomy.
      const saved: NativeExecutionChoice = choice.mode === 'permissive'
        ? { mode: 'permissive', acknowledgement: { userConsent:choice.acknowledgement!.userConsent,
          outsideAccessAllowed:true,automaticCommandsAllowed:true,noFilesystemIsolation:true } }
        : { mode: 'restricted' };
      db.prepare(`INSERT INTO native_execution_policies(project_id,choice_json,updated_at) VALUES(?,?,?)
        ON CONFLICT(project_id) DO UPDATE SET choice_json=excluded.choice_json,updated_at=excluded.updated_at`)
        .run(projectId, JSON.stringify(saved), now);
      db.prepare('INSERT INTO native_execution_policy_audit(project_id,previous_json,choice_json,created_at) VALUES(?,?,?,?)')
        .run(projectId, JSON.stringify(previous), JSON.stringify(saved), now);
      db.exec('COMMIT');
      return saved;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}
