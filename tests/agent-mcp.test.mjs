import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {agentMcp} from '../backend/agent-mcp.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSqlite} from '../backend/sqlite-local.mjs';
import {applyMigrations} from '../backend/migrations-local.mjs';
import {ControlStore} from '../backend/control.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const env={RELAY_AGENT_KEYS_JSON:JSON.stringify({[hash('dot-test-key')]:'dot',[hash('scout-test-key')]:'scout'})};
const request=(key,method,params)=>new Request('https://relay.invalid/mcp',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
test('both sign-ins receive one stable tool catalog and never human creation',async()=>{
 let catalog;
 for(const actor of ['dot','scout']){
  const result=await (await agentMcp(request(actor+'-test-key','tools/list'),{env})).json();
  const names=result.result.tools.map(t=>t.name);
  assert.ok(names.includes('relay_queue'));
  assert.ok(names.includes('relay_dot_queue')&&names.includes('relay_scout_queue'));
  assert.equal(new Set(names).size,names.length);
  if(catalog)assert.deepEqual(result.result.tools,catalog);else catalog=result.result.tools;
  const denied=await (await agentMcp(request(actor+'-test-key','tools/call',{name:'relay_owner_create_relay_task',arguments:{}}),{env})).json();
  assert.equal(denied.error.code,-32601);
 }
 await assert.rejects(agentMcp(request('wrong-key','tools/list'),{env}),e=>e.status===401);
});

test('actor tool creates and claims an independent Work task without a project claim',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'relay-mcp-owner-')),db=openSqlite(join(dir,'relay.sqlite'));await applyMigrations(db);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const store=new ControlStore(db,{teamPlanning:true});await store.bootstrap({kind:'human',subject:'owner'});
 const call=async(name,args)=>{const response=await agentMcp(request('dot-test-key','tools/call',{name,arguments:args}),{db,env:{...env,RELAY_TEAM_PLANNING_ENABLED:'true'},onCommandCommitted:async()=>({status:'idle'})});const rpc=await response.json();assert.ok(!rpc.error,JSON.stringify(rpc));return JSON.parse(rpc.result.content[0].text);};
 let queue=await call('relay_queue',{});assert.equal(queue.actor,'dot');assert.equal(queue.taskOwnership,'task');
 assert.equal((await call('relay_scout_queue',{})).actor,'dot','a cached Scout name must still use the signed-in Dot identity');
 const created=await call('relay_task_create',{operationId:crypto.randomUUID(),epoch:queue.epoch,title:'Independent sandbox task'});assert.ok(created.taskId);assert.equal((await store.read()).projects[0].owner,null);
 queue=await call('relay_queue',{});const task=queue.tasks.find(x=>x.id===created.taskId);assert.equal(task.executionPolicy.mode,'manual');
 await call('relay_scout_command',{operationId:crypto.randomUUID(),epoch:queue.epoch,expectedVersion:task.version,command:{type:'claim',taskId:task.id,projectFence:task.projectFence}});
 assert.equal((await store.read()).tasks.find(x=>x.id===task.id).team.owner,'dot');assert.equal((await store.read()).projects[0].owner,null);
});
