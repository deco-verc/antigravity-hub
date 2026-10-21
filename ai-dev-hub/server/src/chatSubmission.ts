import crypto from 'node:crypto';
import { db } from './db.js';

/** Durable user-intent identity; a lost HTTP reply must not dispatch another model turn. */
export class ChatSubmission {
  static begin(projectId: string, requestId: string, content: string) {
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) throw new Error('CHAT_REQUEST_ID_INVALID');
    const contentHash=crypto.createHash('sha256').update(content).digest('hex');
    const now=new Date().toISOString(),messageId=crypto.randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior:any=db.prepare('SELECT * FROM chat_submissions WHERE project_id=? AND request_id=?').get(projectId,requestId);
      if(prior){
        if (prior.status === 'cancelled' || prior.status === 'uncertain') {
          db.prepare('DELETE FROM chat_submissions WHERE project_id=? AND request_id=?').run(projectId, requestId);
        } else {
          if(prior.content_hash!==contentHash)throw new Error('CHAT_REQUEST_CONTENT_CONFLICT');
          const persistedMessage: any = db.prepare('SELECT * FROM messages WHERE id=? AND project_id=?').get(prior.user_message_id, projectId);
          db.exec('COMMIT');
          return {
            isNew:false,
            messageId:prior.user_message_id,
            persisted: Boolean(persistedMessage),
            persistedMessage: persistedMessage || null,
            response:prior.response_json?JSON.parse(prior.response_json):null,
            status:prior.status
          };
        }
      }
      db.prepare('INSERT INTO chat_submissions VALUES(?,?,?,?,?,NULL,?,?)').run(projectId,requestId,contentHash,messageId,'dispatching',now,now);
      db.prepare("INSERT INTO messages(id,project_id,role,content,created_at) VALUES(?,?,'user',?,?)").run(messageId,projectId,content,now);
      db.exec('COMMIT');return {isNew:true,messageId,persisted:true,persistedMessage:null,response:null,status:'dispatching'};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  static complete(projectId:string,requestId:string,response:unknown){
    db.prepare("UPDATE chat_submissions SET status='completed',response_json=?,updated_at=? WHERE project_id=? AND request_id=? AND status='dispatching'").run(JSON.stringify(response),new Date().toISOString(),projectId,requestId);
  }
  static uncertain(projectId:string,requestId:string){
    db.prepare("UPDATE chat_submissions SET status='uncertain',updated_at=? WHERE project_id=? AND request_id=? AND status='dispatching'").run(new Date().toISOString(),projectId,requestId);
  }
  static cancel(projectId:string){
    db.prepare("UPDATE chat_submissions SET status='cancelled',updated_at=? WHERE project_id=? AND status='dispatching'").run(new Date().toISOString(),projectId);
  }
}
