import { RelayError } from './core.mjs';
import { ControlStore } from './control.mjs';
import { createSlackTaskThreadTransport } from './task-thread-slack-transport.mjs';
import { withActorMentions } from './slack-mention.mjs';

const fail=(code,message,status=503)=>{throw new RelayError(code,message,status);};
const configText=value=>typeof value==='string'&&!!value&&value.trim()===value&&value.length<=512;
const PREFIX='relay-task-notice:v1:';

export function taskThreadPayloadRef(taskId){
  if(!configText(taskId))throw new TypeError('Task ID must be a bounded nonempty string.');
  return PREFIX+encodeURIComponent(taskId);
}

/** Resolves references to one deterministic, non-sensitive server-owned notice. */
export function createTaskThreadPayloadResolver(db){
  if(!db)throw new TypeError('A durable Relay database is required.');
  const control=new ControlStore(db);
  return async(payloadRef,operation)=>{
    let text;
    if(typeof payloadRef==='string'&&payloadRef.startsWith('relay-content:v1:')){
      const row=await db.prepare('SELECT text FROM relay_thread_payloads WHERE ref=? AND task_id=? AND epoch=?').bind(payloadRef,operation?.taskId,operation?.namespace?.epoch).first();
      if(!row)return null;
      text=row.text;
    }else{
      if(typeof payloadRef!=='string'||!payloadRef.startsWith(PREFIX))return null;
      const encoded=payloadRef.slice(PREFIX.length);let taskId;
      try{taskId=decodeURIComponent(encoded);}catch{return null;}
      if(!configText(taskId)||encodeURIComponent(taskId)!==encoded||operation?.taskId!==taskId)return null;
      text=`Relay task thread update for ${taskId}. Open Relay to view authorized details.`;
    }
    const state=await control.read(),task=state.tasks.find(row=>row.id===operation?.taskId);
    if(!task||!state.projects.some(project=>project.id===task.projectId))return null;
    const owner=task.team?.owner??task.owner;
    const wake=operation?.operationId?.startsWith('wake:')
      ?state.wakes.find(item=>`wake:${item.id}`===operation.operationId&&item.target?.taskId===task.id):null;
    const actors=operation?.kind==='root'?['dot','scout']:owner?[owner]:wake?[wake.recipient]:['dot','scout'];
    return {text:withActorMentions(text,actors)};
  };
}

/**
 * Create the production transport only after both default-off gates and all
 * separately verified destination/identity bindings have been supplied.
 * The credential is an explicit injected argument; this module never discovers it.
 */
export function createTaskThreadRuntime({env,db,authorizationHeader,fetcher,onDiagnostic}={}){
  if(env?.RELAY_TASK_THREADS_ENABLED!=='true'||env?.RELAY_TASK_THREADS_TRANSPORT_ENABLED!=='true')return null;
  if(!db||typeof fetcher!=='function')fail('THREAD_TRANSPORT_UNAVAILABLE','Durable storage and an explicit task-thread fetch adapter are required.');
  const required=['RELAY_TASK_THREADS_INSTANCE_ID','RELAY_TASK_THREADS_WORKSPACE_ID','RELAY_TASK_THREADS_CHANNEL_ID',
    'RELAY_TASK_THREADS_SLACK_TEAM_ID','RELAY_TASK_THREADS_SLACK_USER_ID','RELAY_TASK_THREADS_SLACK_BOT_ID'];
  if(!required.every(key=>configText(env[key])))fail('THREAD_CONFIGURATION','Explicit task-thread namespace, Slack destination and verified sender binding are required.');
  if(env.RELAY_TASK_THREADS_WORKSPACE_ID!==env.RELAY_TASK_THREADS_SLACK_TEAM_ID)
    fail('THREAD_CONFIGURATION','Task-thread workspace must match the separately verified Slack team binding.');
  if(typeof authorizationHeader!=='string'||!authorizationHeader)
    fail('THREAD_TRANSPORT_UNAVAILABLE','An explicitly injected task-thread authorization header is required.');
  try{
    return createSlackTaskThreadTransport({enabled:true,authorizationHeader,fetch:fetcher,
      binding:{workspaceId:env.RELAY_TASK_THREADS_SLACK_TEAM_ID,userId:env.RELAY_TASK_THREADS_SLACK_USER_ID,botId:env.RELAY_TASK_THREADS_SLACK_BOT_ID},
      resolvePayload:createTaskThreadPayloadResolver(db),...(typeof onDiagnostic==='function'?{onDiagnostic}:{})});
  }catch{
    fail('THREAD_CONFIGURATION','Explicit task-thread transport configuration is invalid.');
  }
}
