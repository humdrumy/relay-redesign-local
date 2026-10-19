import {ControlStore,currentWake} from './control.mjs';
import {createTaskThreadService} from './task-thread-service.mjs';
import {createTaskThreadRuntime} from './task-thread-runtime.mjs';
import {createHash} from 'node:crypto';

export function threadTransport(env,db){return createTaskThreadRuntime({env,db,authorizationHeader:`Bearer ${env.SLACK_BOT_TOKEN||''}`,fetcher:fetch});}

// Source records remain durable until their matching thread receipt is confirmed.
// Stable operation IDs make repeated invocations safe across function restarts.
export async function drainTaskThreads(db,env,{transport=threadTransport(env,db),limit=20,budgetMs=25000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(env.RELAY_TASK_THREADS_ENABLED!=='true'||!transport)return {status:'disconnected'};
 const store=new ControlStore(db);if(!await store.exists())return {status:'not-initialized'};
 const snapshot=await store.read(),started=Date.now();let sent=0,pending=0;
 const registry=env.RELAY_WORKER_RUNS_ENABLED==='true'?await db.prepare('SELECT body FROM relay_worker_run_registry WHERE instance_id=? AND workspace_id=? AND epoch=?').bind(env.RELAY_WORKER_RUNS_INSTANCE_ID,env.RELAY_WORKER_RUNS_WORKSPACE_ID,snapshot.meta.epoch).first():null;
 const runs=registry?JSON.parse(registry.body).runs:[];
 for(const task of snapshot.tasks){
  if(task.archivedAt)continue;
  if(sent>=limit||Date.now()-started>=budgetMs){pending++;break;}
  const threads=createTaskThreadService({env,db,transport,resolveIdentity:async()=>({kind:'human',subject:snapshot.meta.ownerId})});
  let projection=await threads.readProjection(null,{taskId:task.id});
  if(projection.root?.status!=='confirmed'){
   const root=projection.root?await threads.reconcile(null,{taskId:task.id,kind:'root'}):await threads.ensureRoot(null,{taskId:task.id});
   if(root.status!=='confirmed'){pending++;continue;}sent++;await sleep(1100);
   projection=await threads.readProjection(null,{taskId:task.id});
  }
  const delivered=new Map(projection.replies.map(x=>[x.operationId,x]));
  const messages=snapshot.messages.filter(m=>m.room===`task:${task.id}`).map(m=>({id:'message:'+m.id,text:`${m.actor}: ${m.text}`,at:m.at}));
  const notes=(task.team?.notes||[]).map(n=>({id:'note:'+n.id,text:`${n.actor}: ${n.text}`,at:n.at}));
  const events=snapshot.events.filter(e=>e.taskId===task.id&&!['message','team_note','read_task','ack_wake','heartbeat'].includes(e.kind)).map(e=>({id:'event:'+e.id,text:`${e.actor}: ${e.summary}`,at:e.at}));
  const wakes=snapshot.wakes.filter(w=>w.target?.taskId===task.id&&currentWake(snapshot,w)&&!w.acknowledgedAt&&w.status!=='sent').map(w=>({id:'wake:'+w.id,text:`Relay wake for ${w.recipient}: ${w.reason}. Read your queue and the complete task thread before acting. Wake ID: ${w.id}`,at:w.at,wakeId:w.id}));
  const workerUpdates=runs.filter(r=>r.taskId===task.id&&r.originProjectFence===(task.team?.fence??snapshot.projects.find(p=>p.id===task.projectId)?.ownershipFence)).map(r=>({
   id:'worker:'+createHash('sha256').update(JSON.stringify([r.runId,r.attemptId,r.revision])).digest('hex'),
   text:`Worker ${r.runId}, attempt ${r.attemptId}: ${r.status}${r.disputed?' (conflicting evidence; inspect before acting)':''}. Execution owner: ${task.team?.owner??task.owner??'unassigned'}. This is a reported status, not independent verification. Read the complete task and thread before resuming or steering Luna.`,
   at:new Date(r.updatedAt).toISOString()
  }));
  const entries=[...messages,...notes,...events,...wakes,...workerUpdates].sort((a,b)=>String(a.at).localeCompare(String(b.at))).flatMap(item=>{
   if(item.text.length<=4000)return [item];
   return Array.from({length:Math.ceil(item.text.length/3500)},(_,i)=>({...item,id:item.id+':part:'+i,text:`[Part ${i+1}/${Math.ceil(item.text.length/3500)}]\n`+item.text.slice(i*3500,(i+1)*3500)}));
  });
  for(const item of entries){
   if(sent>=limit||Date.now()-started>=budgetMs){pending++;break;}
   let receipt=delivered.get(item.id);
   if(receipt?.status!=='confirmed'){
    if(item.wakeId){const current=await store.read(),wake=current.wakes.find(x=>x.id===item.wakeId);if(!wake||!currentWake(current,wake)||wake.acknowledgedAt)continue;}
    receipt=receipt?await threads.reconcile(null,{taskId:task.id,kind:'reply',operationId:item.id}):await threads.enqueueReply(null,{taskId:task.id,operationId:item.id,text:item.text});
    if(receipt.status!=='confirmed'){pending++;continue;}sent++;await sleep(1100);
   }
   if(item.wakeId)await store.mutate(s=>{const w=s.wakes.find(x=>x.id===item.wakeId);if(!w||w.status==='sent')return null;w.status='sent';w.sentAt=new Date().toISOString();w.messageTs=receipt.messageTs;w.error=null;return true;});
  }
 }
 return {status:pending?'pending':'idle',sent,pending};
}
