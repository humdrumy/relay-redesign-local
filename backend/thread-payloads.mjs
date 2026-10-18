import {RelayError} from './core.mjs';
export async function saveThreadPayload(db,{epoch,taskId,operationId,text}){
 if(typeof text!=='string'||!text.trim()||text.length>4000)throw new RelayError('INVALID_THREAD_TEXT','Thread messages must contain 1–4000 characters.',400);
 const bytes=new TextEncoder().encode(JSON.stringify([epoch,taskId,operationId]));
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const ref='relay-content:v1:'+Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 await db.prepare('INSERT INTO relay_thread_payloads (ref,task_id,epoch,text) VALUES (?,?,?,?) ON CONFLICT(ref) DO NOTHING').bind(ref,taskId,epoch,text).run();
 const stored=await db.prepare('SELECT text FROM relay_thread_payloads WHERE ref=?').bind(ref).first();
 if(stored.text!==text)throw new RelayError('THREAD_OPERATION_CONFLICT','Reuse an operation ID only with the same message.',409);
 return ref;
}
