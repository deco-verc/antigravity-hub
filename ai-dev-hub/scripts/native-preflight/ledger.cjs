'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => fs.realpathSync.native(path.resolve(value)).toLowerCase();
class SafetyError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// This database is separate from hub.db. It has no expiry, reset or automatic recovery API.
class Ledger {
  static initialize(root, binding) {
    fs.mkdirSync(root, { recursive: true });
    const marker = path.join(root, 'ledger.anchor.json');
    const file = path.join(root, 'control.sqlite');
    const hash = digest(JSON.stringify(binding));
    if (fs.existsSync(marker) || fs.existsSync(file)) {
      const existing = new Ledger(root, binding);
      existing.close();
      return;
    }
    const identity = crypto.randomUUID();
    // A partially completed preparation cannot be silently reinitialized.
    fs.writeFileSync(marker, JSON.stringify({ identity, bindingHash: hash }), { flag: 'wx' });
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE control(id INTEGER PRIMARY KEY CHECK(id=1),identity TEXT NOT NULL,binding_hash TEXT NOT NULL,halt_reason TEXT);
      CREATE TABLE creations(role TEXT PRIMARY KEY CHECK(role IN ('SUPERVISOR','WORKER')),
        operation_id TEXT NOT NULL UNIQUE, model TEXT NOT NULL, project_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('RESERVED','CONFIRMED','UNCERTAIN')), conversation_id TEXT UNIQUE,
        reserved_at TEXT NOT NULL, owner_pid INTEGER NOT NULL);
      CREATE TABLE sends(operation_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,prompt_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('RESERVED','CONFIRMED','UNCERTAIN')), UNIQUE(conversation_id,prompt_hash));
      CREATE TABLE active_call(id INTEGER PRIMARY KEY CHECK(id=1),operation_id TEXT NOT NULL,owner_pid INTEGER NOT NULL);
      CREATE TABLE backend_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner_pid INTEGER NOT NULL,started_at TEXT NOT NULL);
      CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,event TEXT NOT NULL,data_json TEXT NOT NULL);
      CREATE TRIGGER preserve_creations BEFORE DELETE ON creations BEGIN SELECT RAISE(ABORT,'PERMANENT_RESERVATION'); END;
      CREATE TRIGGER preserve_creation_binding BEFORE UPDATE OF role,operation_id,model,project_id,reserved_at ON creations
        BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CREATION_BINDING'); END;
      CREATE TRIGGER preserve_control BEFORE DELETE ON control BEGIN SELECT RAISE(ABORT,'PERMANENT_CONTROL'); END;
      CREATE TRIGGER preserve_identity BEFORE UPDATE OF identity,binding_hash ON control
        BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SANDBOX_IDENTITY'); END;
      CREATE TRIGGER preserve_sends BEFORE DELETE ON sends BEGIN SELECT RAISE(ABORT,'PERMANENT_SEND_RESERVATION'); END;`);
    db.prepare('INSERT INTO control VALUES(1,?,?,NULL)').run(identity, hash);
    db.close();
  }
  constructor(root, binding) {
    this.root = path.resolve(root);
    const marker = path.join(this.root, 'ledger.anchor.json');
    const file = path.join(this.root, 'control.sqlite');
    if (!fs.existsSync(marker) || !fs.existsSync(file)) throw new SafetyError('LEDGER_MISSING_NO_AUTOMATIC_RESET');
    const anchor = JSON.parse(fs.readFileSync(marker, 'utf8'));
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout=6000; PRAGMA synchronous=FULL;');
    this.binding = binding;
    const control = this.db.prepare('SELECT * FROM control WHERE id=1').get();
    if (control?.identity !== anchor.identity || control?.binding_hash !== anchor.bindingHash || anchor.bindingHash !== digest(JSON.stringify(binding))) {
      this.db.close(); throw new SafetyError('SANDBOX_BINDING_CHANGED');
    }
  }
  close() { if (this.closed) return; if (this.ownsBackend) this.db.prepare('DELETE FROM backend_lease WHERE id=1 AND owner_pid=?').run(process.pid); this.db.close();this.closed=true; }
  claimBackend() {
    if (!this.db.prepare('INSERT OR IGNORE INTO backend_lease VALUES(1,?,?)').run(process.pid,new Date().toISOString()).changes) throw new SafetyError('SANDBOX_BACKEND_BUSY_OR_UNRECONCILED');
    this.ownsBackend=true;
  }
  event(event, data = {}) {
    // Only explicitly selected operational metadata; never raw environment, command line, prompt or exception text.
    const entry = { at: new Date().toISOString(), event, ...data };
    const seq = Number(this.db.prepare('INSERT INTO events(at,event,data_json) VALUES(?,?,?)').run(entry.at,event,JSON.stringify(data)).lastInsertRowid);
    fs.appendFileSync(path.join(this.root, 'operations.jsonl'), JSON.stringify({ seq, ...entry }) + '\n');
  }
  halt(reason) {
    this.db.prepare('UPDATE control SET halt_reason=COALESCE(halt_reason,?) WHERE id=1').run(reason);
    this.event('HALTED', { code: reason });
  }
  ready() {
    const control = this.db.prepare('SELECT halt_reason FROM control WHERE id=1').get();
    if (control.halt_reason) throw new SafetyError('HALTED_RECONCILIATION_REQUIRED');
    if (this.db.prepare('SELECT 1 FROM active_call').get()) throw new SafetyError('CONCURRENT_OR_UNRECONCILED_CALL');
  }
  reserve(request) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.ready();
      if (request.projectId !== this.binding.projectId || request.accountProfileId !== this.binding.accountProfileId ||
          !['SUPERVISOR','WORKER'].includes(request.role) || request.model !== this.binding.models[request.role]) throw new SafetyError('PROFILE_PROJECT_OR_MODEL_MISMATCH');
      const operationId = crypto.randomUUID();
      if (request.verb === 'new-conversation') {
        if (this.db.prepare('SELECT 1 FROM creations WHERE role=?').get(request.role) || this.db.prepare('SELECT COUNT(*) n FROM creations').get().n >= 2) {
          throw new SafetyError('ABSOLUTE_CREATION_CAP');
        }
        this.db.prepare("INSERT INTO creations VALUES(?,?,?,?, 'RESERVED',NULL,?,?)")
          .run(request.role,operationId,request.model,request.projectId,new Date().toISOString(),process.pid);
      } else if (request.verb === 'send-message') {
        const session = this.db.prepare("SELECT * FROM creations WHERE role=? AND status='CONFIRMED'").get(request.role);
        if (!session || session.conversation_id !== request.conversationId || session.model !== request.model) throw new SafetyError('CONVERSATION_BINDING_MISMATCH');
        if (this.db.prepare('SELECT 1 FROM sends WHERE conversation_id=? AND prompt_hash=?').get(request.conversationId,request.promptHash)) throw new SafetyError('DUPLICATE_MESSAGE');
        this.db.prepare("INSERT INTO sends VALUES(?,?,?,'RESERVED')").run(operationId,request.conversationId,request.promptHash);
      } else { throw new SafetyError('UNEXPECTED_AGENT_OPERATION'); }
      this.db.prepare('INSERT INTO active_call VALUES(1,?,?)').run(operationId,process.pid);
      this.event('RESERVED_BEFORE_EXTERNAL_CALL', { operationId, verb: request.verb,role:request.role,model:request.model,
        projectId:request.projectId,accountProfileId:request.accountProfileId,conversationId:request.conversationId || null,promptHash:request.promptHash });
      this.db.exec('COMMIT');
      return operationId;
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.halt(error.code || 'RESERVATION_FAILURE');
      throw error;
    }
  }
  finish(operationId, request, conversationId) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('SELECT operation_id FROM active_call WHERE id=1').get()?.operation_id !== operationId) throw new SafetyError('CALL_OWNERSHIP_CHANGED');
      if (request.verb === 'new-conversation') {
        if (typeof conversationId !== 'string' || !conversationId.trim()) throw new SafetyError('AMBIGUOUS_CREATE_RESPONSE');
        this.db.prepare("UPDATE creations SET status='CONFIRMED',conversation_id=? WHERE operation_id=? AND status='RESERVED'").run(conversationId,operationId);
      } else this.db.prepare("UPDATE sends SET status='CONFIRMED' WHERE operation_id=?").run(operationId);
      this.event('CONFIRMED', { operationId,verb:request.verb,role:request.role,conversationId:conversationId || request.conversationId });
      this.db.prepare('DELETE FROM active_call WHERE operation_id=?').run(operationId);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  uncertain(operationId, request) {
    this.db.prepare(`UPDATE ${request.verb === 'new-conversation' ? 'creations' : 'sends'} SET status='UNCERTAIN' WHERE operation_id=?`).run(operationId);
    // Retain active_call even if its owner dies. No restart or clock-based recovery.
    this.halt('EXTERNAL_RESULT_UNCERTAIN');
  }
  snapshot() {
    return { binding:this.binding,control:this.db.prepare('SELECT * FROM control').get(),
      creations:this.db.prepare('SELECT * FROM creations ORDER BY role').all(),sends:this.db.prepare('SELECT * FROM sends').all(),
      activeCalls:this.db.prepare('SELECT * FROM active_call').all(),events:this.db.prepare('SELECT COUNT(*) n FROM events').get().n };
  }
}

class Boundary {
  constructor(ledger, readiness) { this.ledger = ledger; this.readiness = readiness; }
  invoke(request, executor) {
    try { this.readiness(request); } catch (error) { this.ledger.event('DENIED_BEFORE_EXTERNAL_CALL',{code:error.code || 'READINESS_UNKNOWN',verb:request.verb}); throw error; }
    const id = this.ledger.reserve(request);
    try {
      // SQLite transaction and audit record have committed before this callback can run.
      const output = executor();
      const conversationId = request.verb === 'new-conversation' ? JSON.parse(String(output))?.response?.newConversation?.conversationId : request.conversationId;
      this.ledger.finish(id,request,conversationId);
      return output;
    } catch(error) { this.ledger.uncertain(id,request); throw new SafetyError('EXTERNAL_RESULT_UNCERTAIN'); }
  }
}
module.exports = { Ledger, Boundary, SafetyError, digest, canonical };
