import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openSqlite} from '../backend/sqlite-local.mjs';
import {applyMigrations} from '../backend/migrations-local.mjs';
import {ControlStore} from '../backend/control.mjs';
import {createTaskThreadService} from '../backend/task-thread-service.mjs';
import {taskThreadPayloadRef} from '../backend/task-thread-runtime.mjs';

const OWNER='task-thread-owner',ENV={RELAY_TASK_THREADS_ENABLED:'true',RELAY_TASK_THREADS_INSTANCE_ID:'instance-test',RELAY_TASK_THREADS_WORKSPACE_ID:'workspace-test',RELAY_TASK_THREADS_CHANNEL_ID:'channel-test'};
const ownerIdentity={kind:'human',subject:OWNER},dotIdentity={kind:'agent',actor:'dot',subject:'authenticated-dot'},scoutIdentity={kind:'agent',actor:'scout',subject:'authenticated-scout'};
test('execution context requires a complete untruncated thread and returns current task state',async t=>{
 let truncated=false,partial=false;
 const f=await fixture(t,{readConfirmedThread:async binding=>({status:partial?'partial':'complete',reason:partial?'page_limit':null,messages:[{text:truncated?'x'.repeat(4000):'Full thread context',textTruncated:truncated,messageTs:binding.root.messageTs,rootMessageTs:binding.root.messageTs,isRoot:true,author:{userId:'U-human',botId:null}}],pagination:{pagesRead:1,hasMore:partial}})});
 const taskId=await f.createTask();
 await rejected(f.service.readExecutionContext('owner-session',{taskId}),'TASK_CONTEXT_INCOMPLETE');
 await f.service.ensureRoot('owner-session',{taskId});
 const context=await f.service.readExecutionContext('owner-session',{taskId});
 assert.equal(context.task.id,taskId);assert.equal(context.conversation.messages[0].text,'Full thread context');assert.equal(context.epoch,(await f.control.read()).meta.epoch);
 truncated=true;await rejected(f.service.readExecutionContext('owner-session',{taskId}),'TASK_CONTEXT_INCOMPLETE');
 truncated=false;partial=true;await rejected(f.service.readExecutionContext('owner-session',{taskId}),'TASK_CONTEXT_INCOMPLETE');
});
const rejected=(promise,code)=>assert.rejects(promise,e=>e.code===code);
const receipt=(op,messageTs='1700000000.123456789')=>({namespace:{...op.namespace},taskId:op.taskId,operationId:op.operationId,channelId:op.channelId,payloadRef:op.payloadRef,messageTs,rootMessageTs:op.kind==='root'?null:op.rootMessageTs});
async function fixture(t,{env={...ENV},send,lookup,readConfirmedThread}={}){
 const directory=mkdtempSync(join(tmpdir(),'task-thread-service-')),file=join(directory,'service.sqlite'),db=openSqlite(file);await applyMigrations(db);const control=new ControlStore(db);await control.bootstrap(ownerIdentity);
 const identities=new Map([['owner-session',ownerIdentity],['dot-session',dotIdentity],['scout-session',scoutIdentity]]),calls=[];
 const transport={send:async(op,{beforePost}={})=>{if(typeof beforePost!=='function'||await beforePost()!==true)return null;calls.push(structuredClone(op));return send?send(op,calls.length):receipt(op,op.kind==='reply'?'1700000000.123456790':'1700000000.123456789');},lookup:async op=>lookup?lookup(op):null,
  readConfirmedThread:async binding=>readConfirmedThread?readConfirmedThread(binding):{status:'complete',reason:null,messages:[{text:'verified root text',textTruncated:false,messageTs:binding.root.messageTs,rootMessageTs:binding.root.messageTs,isRoot:true,author:{userId:'U-agent',botId:'B-agent'},providerMetadata:{shouldNotEscape:true}}],pagination:{pagesRead:1,hasMore:false}}};
 const makeService=()=>createTaskThreadService({env,db,transport,resolveIdentity:async context=>identities.get(context),now:()=>Date.now()});
 let taskSeq=0;const service=makeService();const createTask=async()=>{const state=await control.read();taskSeq++;return (await control.command(ownerIdentity,{epoch:state.meta.epoch,operationId:`create-thread-task-${taskSeq}`,command:{type:'create_task',input:{title:'Threaded task',description:'Test task',projectId:'relay'}}})).result.taskId;};
 t.after(()=>{try{db.close();}catch{}rmSync(directory,{recursive:true,force:true});});
 return{db,control,service,makeService,createTask,calls,identities};
}
test('disabled by default, constructor requires real identity resolver, and unavailable config/transport fails closed',async t=>{
 const f=await fixture(t,{env:{RELAY_TASK_THREADS_INSTANCE_ID:ENV.RELAY_TASK_THREADS_INSTANCE_ID,RELAY_TASK_THREADS_WORKSPACE_ID:ENV.RELAY_TASK_THREADS_WORKSPACE_ID,RELAY_TASK_THREADS_CHANNEL_ID:ENV.RELAY_TASK_THREADS_CHANNEL_ID}}),taskId=await f.createTask();
 await rejected(f.service.ensureRoot('owner-session',{taskId}),'TASK_THREADS_DISABLED');
 assert.throws(()=>createTaskThreadService({env:ENV,db:f.db,transport:{send:async()=>null,lookup:async()=>null}}),/identity resolver/);
 const noTransport=createTaskThreadService({env:ENV,db:f.db,resolveIdentity:async()=>ownerIdentity});
 await rejected(noTransport.ensureRoot(null,{taskId}),'THREAD_TRANSPORT_UNAVAILABLE');
 const noChannel=createTaskThreadService({env:{...ENV,RELAY_TASK_THREADS_CHANNEL_ID:''},db:f.db,resolveIdentity:async()=>ownerIdentity,transport:{send:async()=>null,lookup:async()=>null}});
 await rejected(noChannel.ensureRoot(null,{taskId}),'THREAD_CONFIGURATION');
});
test('owner and current project owner can access tasks; unauthorized principals and agent slots cannot',async t=>{
 const f=await fixture(t),taskId=await f.createTask();const root=await f.service.ensureRoot('owner-session',{taskId});assert.equal(root.status,'confirmed');
 await rejected(f.service.readProjection('scout-session',{taskId}),'TASK_NOT_FOUND');assert.equal(f.calls.length,1);
 let state=await f.control.read(),project=state.projects.find(x=>x.id==='relay');
 await f.control.command(dotIdentity,{epoch:state.meta.epoch,operationId:'dot-claim-project',expectedProjectVersion:project.version,command:{type:'claim_project',projectId:'relay'}});
 const agentService=f.service;assert.equal((await agentService.readProjection('dot-session',{taskId})).taskId,taskId);
 await rejected(agentService.readProjection('unbound-session',{taskId}),'UNAUTHENTICATED');
});
test('confirmed conversation reads use stored root bindings and only return the bounded plain-text projection',async t=>{
 let observed;const f=await fixture(t,{readConfirmedThread:async binding=>{observed=structuredClone(binding);return{status:'complete',reason:null,messages:[{text:'untrusted <script> text https://example.invalid',textTruncated:false,messageTs:binding.root.messageTs,rootMessageTs:binding.root.messageTs,isRoot:true,author:{userId:'U-human',botId:null},extra:'discard'}],pagination:{pagesRead:1,hasMore:false},extra:'discard'};}});
 const taskId=await f.createTask(),before=await f.service.readConfirmedConversation('owner-session',{taskId});
 assert.equal(before.conversation.status,'unreadable');assert.equal(before.conversation.reason,'root_unconfirmed');assert.equal(observed,undefined);
 await f.service.ensureRoot('owner-session',{taskId});
 const result=await f.service.readConfirmedConversation('owner-session',{taskId});
 assert.deepEqual(observed,{namespace:{instanceId:ENV.RELAY_TASK_THREADS_INSTANCE_ID,epoch:(await f.control.read()).meta.epoch,workspaceId:ENV.RELAY_TASK_THREADS_WORKSPACE_ID},taskId,channelId:ENV.RELAY_TASK_THREADS_CHANNEL_ID,root:{kind:'root',status:'confirmed',operationId:observed.root.operationId,payloadRef:taskThreadPayloadRef(taskId),attempt:1,messageTs:'1700000000.123456789',rootMessageTs:'1700000000.123456789'}});
 assert.deepEqual(result.conversation,{status:'complete',reason:null,messages:[{text:'untrusted <script> text https://example.invalid',textTruncated:false,messageTs:'1700000000.123456789',rootMessageTs:'1700000000.123456789',isRoot:true,author:{userId:'U-human',botId:null}}],pagination:{pagesRead:1,hasMore:false}});
 await rejected(f.service.readConfirmedConversation('scout-session',{taskId}),'TASK_NOT_FOUND');
});
test('conversation read discards results when workspace authority changes while transport is reading',async t=>{
 let f,changed=false;f=await fixture(t,{readConfirmedThread:async binding=>{
  if(!changed){changed=true;const state=await f.control.read();await f.control.command(ownerIdentity,{epoch:state.meta.epoch,operationId:'advance-workspace-during-thread-read',command:{type:'create_task',input:{title:'Concurrent task',description:'Test authority revalidation',projectId:'relay'}}});}
  return{status:'complete',reason:null,messages:[{text:'do not release',textTruncated:false,messageTs:binding.root.messageTs,rootMessageTs:binding.root.messageTs,isRoot:true,author:{userId:'U-human',botId:null}}],pagination:{pagesRead:1,hasMore:false}};
 }});
 const taskId=await f.createTask();await f.service.ensureRoot('owner-session',{taskId});
 await rejected(f.service.readConfirmedConversation('owner-session',{taskId}),'THREAD_READ_AUTHORITY_CHANGED');
});
test('request cannot forge namespace, channel or actor; server config determines all bindings',async t=>{
 const f=await fixture(t),taskId=await f.createTask();
 for(const forged of [{namespace:{instanceId:'evil',epoch:'evil',workspaceId:'evil'}},{channelId:'evil-channel'},{actor:'scout'},{subject:'attacker'},{payloadRef:'caller-controlled'}])
  await rejected(f.service.ensureRoot('owner-session',{taskId,...forged}),'INVALID_THREAD_REQUEST');
 const root=await f.service.ensureRoot('owner-session',{taskId});
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].namespace,{instanceId:ENV.RELAY_TASK_THREADS_INSTANCE_ID,epoch:(await f.control.read()).meta.epoch,workspaceId:ENV.RELAY_TASK_THREADS_WORKSPACE_ID});
 assert.equal(f.calls[0].channelId,ENV.RELAY_TASK_THREADS_CHANNEL_ID);assert.equal(f.calls[0].operationId,root.operationId);assert.equal(f.calls[0].payloadRef,taskThreadPayloadRef(taskId));
});
test('root operation ID is stable and persisted per task; immutable payload refs and reuse conflicts hold after restart',async t=>{
 const f=await fixture(t),taskId=await f.createTask(),first=await f.service.ensureRoot('owner-session',{taskId}),second=await f.service.ensureRoot('owner-session',{taskId});
 assert.equal(first.operationId,second.operationId);assert.equal(f.calls.length,1);
 const projection=await f.service.readProjection('owner-session',{taskId});assert.equal(projection.root.operationId,first.operationId);assert.equal(projection.root.status,'confirmed');
 const restarted=f.makeService(),again=await restarted.ensureRoot('owner-session',{taskId});assert.equal(again.operationId,first.operationId);assert.equal(f.calls.length,1);
 const otherTask=await f.createTask(),otherRoot=await restarted.ensureRoot('owner-session',{taskId:otherTask});assert.notEqual(otherRoot.operationId,first.operationId);
 await rejected(restarted.ensureRoot('owner-session',{taskId,payloadRef:'caller-controlled'}),'INVALID_THREAD_REQUEST');
 await restarted.enqueueReply('owner-session',{taskId,operationId:'reply-op-1'});
 await rejected(restarted.enqueueReply('owner-session',{taskId,operationId:'reply-op-1',payloadRef:'caller-controlled'}),'INVALID_THREAD_REQUEST');
 await rejected(restarted.enqueueReply('owner-session',{taskId,operationId:first.operationId,payloadRef:'caller-controlled'}),'INVALID_THREAD_REQUEST');
});
test('uncertain operations are not resent and reconciliation uses only persisted immutable data',async t=>{
 let visible=null;const f=await fixture(t,{send:async()=>null,lookup:async op=>visible?receipt(op):null}),taskId=await f.createTask();
 const first=await f.service.ensureRoot('owner-session',{taskId});assert.equal(first.status,'uncertain');
 assert.equal((await f.service.ensureRoot('owner-session',{taskId})).status,'uncertain');assert.equal(f.calls.length,1);
 assert.equal((await f.service.reconcile('owner-session',{taskId,kind:'root'})).status,'uncertain');assert.equal(f.calls.length,1);
 visible='found';const recovered=await f.service.reconcile('owner-session',{taskId,kind:'root',operationId:first.operationId});assert.equal(recovered.status,'confirmed');assert.equal(f.calls.length,1);
 await rejected(f.service.reconcile('owner-session',{taskId,kind:'root',operationId:'forged-root'}),'STALE_EPOCH');
});
test('reply uses the exact persisted root timestamp string without numeric conversion',async t=>{
 const f=await fixture(t),taskId=await f.createTask(),root=await f.service.ensureRoot('owner-session',{taskId});
 const reply=await f.service.enqueueReply('owner-session',{taskId,operationId:'reply-exact-ts'});
 assert.equal(root.messageTs,'1700000000.123456789');assert.equal(f.calls[1].rootMessageTs,'1700000000.123456789');assert.equal(reply.rootMessageTs,root.messageTs);
});
test('deleted task and stale service epoch fail closed',async t=>{
 const f=await fixture(t),taskId=await f.createTask();await f.service.ensureRoot('owner-session',{taskId});
 await f.db.prepare('DELETE FROM relay_control_records WHERE kind=? AND id=?').bind('tasks',taskId).run();
 await rejected(f.service.readProjection('owner-session',{taskId}),'TASK_NOT_FOUND');
 const task2=await f.createTask(),service=f.makeService();await service.ensureRoot('owner-session',{taskId:task2});
 await f.db.prepare('UPDATE relay_control_meta SET epoch=? WHERE id=?').bind('new-current-epoch','main').run();
 await rejected(service.readProjection('owner-session',{taskId:task2}),'STALE_EPOCH');
});
