import { RelayError } from './core.mjs';
import { controlPrincipal, controlProjection, ControlStore } from './control.mjs';
import { SqlTaskThreadStore, TaskThreads } from './task-threads.mjs';
import { taskThreadPayloadRef } from './task-thread-runtime.mjs';
import { taskAuthority, teamCanRead } from './team-planning.mjs';
import { saveThreadPayload } from './thread-payloads.mjs';

const fail=(code,message,status=409)=>{throw new RelayError(code,message,status);};
const validText=(value,name,max=512)=>{
  if(typeof value!=='string'||!value||value.trim()!==value||value.length>max)fail('INVALID_THREAD_REQUEST',`${name} must be a bounded nonempty string.`,400);
  return value;
};
const threadTs=value=>typeof value==='string'&&/^\d+\.\d+$(?![\s\S])/.test(value);
const author=value=>value===null||typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$(?![\s\S])/.test(value);
function conversationProjection(value,rootTs){
  const empty=(reason)=>({status:'unreadable',reason,messages:[],pagination:{pagesRead:0,hasMore:null}});
  if(!value||typeof value!=='object'||Array.isArray(value)||!['complete','partial','unreadable'].includes(value.status)||
      !value.pagination||typeof value.pagination!=='object'||!Number.isInteger(value.pagination.pagesRead)||value.pagination.pagesRead<0||value.pagination.pagesRead>100||
      ![true,false,null].includes(value.pagination.hasMore))return empty('invalid_projection');
  const reason=value.reason===null||typeof value.reason==='string'&&value.reason.length>0&&value.reason.length<=128?value.reason:null;
  if(value.status==='complete'&&(reason!==null||value.pagination.hasMore!==false))return empty('invalid_projection');
  if(value.status==='partial'&&reason===null)return empty('invalid_projection');
  if(value.status==='unreadable')return {status:'unreadable',reason:reason||'unreadable',messages:[],pagination:{pagesRead:value.pagination.pagesRead,hasMore:value.pagination.hasMore}};
  if(!Array.isArray(value.messages)||value.messages.length>1000)return empty('invalid_projection');
  const messages=[],seen=new Set();let textSize=0;
  for(const item of value.messages){
    if(!item||typeof item!=='object'||typeof item.text!=='string'||item.text.length>4000||typeof item.textTruncated!=='boolean'||
        item.textTruncated&&item.text.length!==4000||
        !threadTs(item.messageTs)||item.rootMessageTs!==rootTs||typeof item.isRoot!=='boolean'||item.isRoot!==(item.messageTs===rootTs)||
        !item.author||typeof item.author!=='object'||!author(item.author.userId)||!author(item.author.botId)||(!item.author.userId&&!item.author.botId)||
        Object.keys(item.author).some(key=>!['userId','botId'].includes(key))||seen.has(item.messageTs))return empty('invalid_projection');
    textSize+=item.text.length;if(textSize>256000)return empty('invalid_projection');seen.add(item.messageTs);
    messages.push({text:item.text,textTruncated:item.textTruncated,messageTs:item.messageTs,rootMessageTs:rootTs,isRoot:item.isRoot,
      author:{userId:item.author.userId,botId:item.author.botId}});
  }
  if(messages.filter(item=>item.isRoot).length!==1)return empty('root_unverified');
  return {status:value.status,reason,messages,pagination:{pagesRead:value.pagination.pagesRead,hasMore:value.pagination.hasMore}};
}
function args(value,fields){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))fail('INVALID_THREAD_REQUEST','Use only the declared task-thread fields.',400);
  return value;
}
function threadConfig(env,transport,{requireTransport=true}={}){
  if(env?.RELAY_TASK_THREADS_ENABLED!=='true')fail('TASK_THREADS_DISABLED','Task thread service is disabled.',503);
  if(!['RELAY_TASK_THREADS_INSTANCE_ID','RELAY_TASK_THREADS_WORKSPACE_ID','RELAY_TASK_THREADS_CHANNEL_ID'].every(key=>typeof env[key]==='string'&&env[key]&&env[key].trim()===env[key]&&env[key].length<=512))
    fail('THREAD_CONFIGURATION','Trusted task-thread instance, workspace and channel configuration is required.',503);
  if(requireTransport&&(typeof transport?.send!=='function'||typeof transport?.lookup!=='function'))fail('THREAD_TRANSPORT_UNAVAILABLE','A trusted production task-thread transport is unavailable.',503);
  return {namespace:{instanceId:env.RELAY_TASK_THREADS_INSTANCE_ID,workspaceId:env.RELAY_TASK_THREADS_WORKSPACE_ID},channelId:env.RELAY_TASK_THREADS_CHANNEL_ID};
}
async function stableRootOperationId(namespace,taskId){
  const bytes=new TextEncoder().encode(JSON.stringify(['relay.task-thread.root.v1',namespace.instanceId,namespace.epoch,namespace.workspaceId,taskId]));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return `task-root:${[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}
const viewRecord=record=>record?{kind:record.kind,operationId:record.operationId,status:record.status,attempt:record.attempt,messageTs:record.messageTs,rootMessageTs:record.rootMessageTs}:null;

/**
 * Internal authorization and configuration join. `resolveIdentity` must resolve a
 * server-authenticated principal from the trusted call context; this module never
 * accepts a caller-selected actor, namespace or channel.
 */
export class TaskThreadService {
  constructor({env,db,transport,resolveIdentity,now=()=>Date.now()}={}){
    if(!env||!db||typeof resolveIdentity!=='function')fail('THREAD_CONFIGURATION','Provide environment, database and server-authenticated identity resolver.',500);
    this.env=env;this.db=db;this.transport=transport;this.resolveIdentity=resolveIdentity;this.now=now;
    this.control=new ControlStore(db,{now});this.threadStore=new SqlTaskThreadStore(db);this.observedEpoch=null;
  }
  async #authorized(context,value,allowedFields,{requireTransport=true}={}){
    const input=args(value,allowedFields),taskId=validText(input.taskId,'taskId');
    const configured=threadConfig(this.env,this.transport,{requireTransport});
    const state=await this.control.read();
    if(this.observedEpoch!==null&&this.observedEpoch!==state.meta.epoch)fail('STALE_EPOCH','Task-thread service must be recreated after the Relay epoch changes.');
    this.observedEpoch??=state.meta.epoch;
    const identity=await this.resolveIdentity(context);
    if(!identity||typeof identity.subject!=='string'||!identity.subject)fail('UNAUTHENTICATED','A server-authenticated identity is required.',401);
    if(!['human','agent'].includes(identity.kind))fail('UNAUTHENTICATED','A server-authenticated human or agent identity is required.',401);
    if(identity.kind==='agent'&&(!validText(identity.actor,'authenticated agent ID',80)))fail('UNAUTHENTICATED','A server-authenticated agent identity is required.',401);
    const principal=controlPrincipal(state,identity);
    const projection=controlProjection(state,principal,this.now(),[]);
    const task=projection.tasks.find(row=>row.id===taskId);
    const project=state.projects.find(row=>row.id===task?.projectId);
    if(!task||!project)fail('TASK_NOT_FOUND','Task not found or not authorized.',404);
    const authorityProject=taskAuthority(state,task);
    const planningReader=task.team?.phase==='planning'&&teamCanRead(task,principal);
    if(principal.agent&&!planningReader&&(authorityProject.owner!==principal.actor||authorityProject.recoveryRequired))fail('TASK_NOT_FOUND','Task not found or not authorized.',404);
    const namespace={...configured.namespace,epoch:state.meta.epoch};
    const authority={controlEpoch:state.meta.epoch,controlRevision:state.meta.revision};
    const assertCanSend=async(operation,reservation)=>{
      if(operation.taskId!==task.id||reservation.controlEpoch!==authority.controlEpoch||reservation.controlRevision!==authority.controlRevision)return false;
      const current=await this.control.read();
      if(current.meta.epoch!==authority.controlEpoch||current.meta.revision!==authority.controlRevision)return false;
      let currentPrincipal;try{currentPrincipal=controlPrincipal(current,identity);}catch{return false;}
      const currentTask=current.tasks.find(row=>row.id===task.id),currentProject=current.projects.find(row=>row.id===currentTask?.projectId);
      if(!currentTask||!currentProject||currentTask.projectId!==task.projectId)return false;
      if(currentPrincipal.agent){
        const currentAgent=current.agents.find(row=>row.id===currentPrincipal.actor);
        const assigned=taskAuthority(current,currentTask);
        const planner=currentTask.team?.phase==='planning'&&teamCanRead(currentTask,currentPrincipal);
        return (planner||assigned.owner===currentPrincipal.actor&&!assigned.recoveryRequired)&&!currentAgent?.paused;
      }
      return identity.kind==='human'&&identity.subject===current.meta.ownerId;
    };
    const service=requireTransport?new TaskThreads(this.threadStore,this.transport,{assertCanSend}):null;
    return {input,task,state,principal,namespace,authority,channelId:configured.channelId,service};
  }
  async ensureRoot(context,value){
    const {task,namespace,authority,channelId,service}=await this.#authorized(context,value,['taskId']);
    const operationId=await stableRootOperationId(namespace,task.id);
    const existing=await this.threadStore.read([namespace.instanceId,namespace.epoch,namespace.workspaceId,task.id]);
    const payloadRef=existing?.body.root?.payloadRef || (this.env.RELAY_TASK_THREAD_CONTENT_ENABLED==='true'
      ?await saveThreadPayload(this.db,{epoch:namespace.epoch,taskId:task.id,operationId,text:`Relay task: ${task.title}\n${(task.description||'').slice(0,2500)}\nTask ID: ${task.id}\n${this.env.RELAY_PUBLIC_URL||''}\nDot and Scout: read your Relay queue and this thread, build the plan together, then let the assigned owner execute.`})
      :taskThreadPayloadRef(task.id));
    return service.ensureRoot({namespace,taskId:task.id,channelId,operationId,payloadRef},authority);
  }
  async enqueueReply(context,value){
    const {input,task,namespace,authority,channelId,service}=await this.#authorized(context,value,['taskId','operationId','text']);
    const operationId=validText(input.operationId,'operationId');
    if(input.text!==undefined&&this.env.RELAY_TASK_THREAD_CONTENT_ENABLED!=='true')fail('THREAD_CONTENT_DISABLED','Task-thread content delivery is disabled.',503);
    const payloadRef=input.text===undefined?taskThreadPayloadRef(task.id):await saveThreadPayload(this.db,{epoch:namespace.epoch,taskId:task.id,operationId,text:input.text});
    return service.enqueueReply({namespace,taskId:task.id,channelId,operationId,payloadRef},authority);
  }
  async reconcile(context,value){
    const {input,task,namespace,channelId,service}=await this.#authorized(context,value,['taskId','kind','operationId']);
    if(!['root','reply'].includes(input.kind))fail('INVALID_THREAD_REQUEST','Choose root or reply.',400);
    const stored=await this.threadStore.read([namespace.instanceId,namespace.epoch,namespace.workspaceId,task.id]);
    const operationId=input.kind==='root'?await stableRootOperationId(namespace,task.id):validText(input.operationId,'operationId');
    if(input.kind==='root'&&input.operationId!==undefined&&input.operationId!==operationId)fail('STALE_EPOCH','Root operation does not match the current task epoch.');
    const record=input.kind==='root'?stored?.body.root:stored?.body.replies.find(row=>row.operationId===operationId);
    if(!record)fail('THREAD_OPERATION_NOT_FOUND','Thread operation not found.',404);
    if(record.operationId!==operationId)fail('STALE_EPOCH','Stored root operation does not match the current task epoch.');
    return service.reconcile({namespace,taskId:task.id,channelId,operationId,payloadRef:record.payloadRef},input.kind);
  }
  async readProjection(context,value){
    const {task,namespace,channelId}=await this.#authorized(context,value,['taskId'],{requireTransport:false});
    const stored=await this.threadStore.read([namespace.instanceId,namespace.epoch,namespace.workspaceId,task.id]);
    const link=record=>{const view=viewRecord(record);if(view?.status==='confirmed'&&view.messageTs)view.url=`https://app.slack.com/archives/${encodeURIComponent(channelId)}/p${view.messageTs.replace('.','')}`;return view;};
    return {taskId:task.id,revision:stored?.revision||0,root:link(stored?.body.root),replies:(stored?.body.replies||[]).map(link)};
  }
  async readConfirmedConversation(context,value){
    const {task,namespace,authority,channelId}=await this.#authorized(context,value,['taskId'],{requireTransport:false});
    const key=[namespace.instanceId,namespace.epoch,namespace.workspaceId,task.id];
    const stored=await this.threadStore.read(key),root=stored?.body?.root;
    if(stored&&stored.body?.channelId!==channelId)fail('THREAD_CHANNEL_CONFLICT','The persisted task channel does not match trusted configuration.');
    if(!root||root.kind!=='root'||root.status!=='confirmed'||!threadTs(root.messageTs)||root.rootMessageTs!==root.messageTs||
        typeof root.operationId!=='string'||!root.operationId||typeof root.payloadRef!=='string'||!root.payloadRef)
      return {taskId:task.id,conversation:{status:'unreadable',reason:'root_unconfirmed',messages:[],pagination:{pagesRead:0,hasMore:null}}};
    if(typeof this.transport?.readConfirmedThread!=='function')fail('THREAD_TRANSPORT_UNAVAILABLE','A trusted read-only task-thread transport is unavailable.',503);
    const binding={namespace,taskId:task.id,channelId,root:{kind:'root',status:'confirmed',operationId:root.operationId,
      payloadRef:root.payloadRef,attempt:root.attempt,messageTs:root.messageTs,rootMessageTs:root.rootMessageTs}};
    const read=await this.transport.readConfirmedThread(binding);
    const current=await this.#authorized(context,{taskId:task.id},['taskId']);
    const currentStored=await this.threadStore.read(key),currentRoot=currentStored?.body?.root;
    if(current.state.meta.epoch!==authority.controlEpoch||current.state.meta.revision!==authority.controlRevision||current.task.version!==task.version||
        currentStored?.body?.channelId!==channelId||currentRoot?.status!=='confirmed'||currentRoot?.operationId!==root.operationId||
        currentRoot?.payloadRef!==root.payloadRef||currentRoot?.messageTs!==root.messageTs||currentRoot?.rootMessageTs!==root.rootMessageTs)
      fail('THREAD_READ_AUTHORITY_CHANGED','Task or thread authority changed while the conversation was being read.',409);
    return {taskId:task.id,conversation:conversationProjection(read,root.messageTs)};
  }
  async readExecutionContext(context,value){
    const before=await this.#authorized(context,value,['taskId']);
    const {conversation}=await this.readConfirmedConversation(context,value);
    if(conversation.status!=='complete'||conversation.messages.some(message=>message.textTruncated))
      fail('TASK_CONTEXT_INCOMPLETE','Read the complete Slack task thread before starting or steering a worker.',409);
    const after=await this.#authorized(context,value,['taskId']);
    if(before.state.meta.epoch!==after.state.meta.epoch||before.state.meta.revision!==after.state.meta.revision)
      fail('THREAD_READ_AUTHORITY_CHANGED','Task changed during context ingestion. Refresh before continuing.',409);
    return {task:after.task,conversation,epoch:after.state.meta.epoch,revision:after.state.meta.revision,
      projectFence:taskAuthority(after.state,after.task).ownershipFence,ingestedAt:this.now()};
  }
}

export function createTaskThreadService(options){return new TaskThreadService(options);}
