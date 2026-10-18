import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSqlite} from '../backend/sqlite-local.mjs';
import {applyMigrations} from '../backend/migrations-local.mjs';
import {ControlStore,controlProjection,controlPrincipal,currentWake} from '../backend/control.mjs';
import {controlQueue} from '../backend/control-http.mjs';
import {taskAuthority,teamCapacity} from '../backend/team-planning.mjs';
const human={kind:'human',subject:'owner'},agent=actor=>({kind:'agent',actor,subject:actor});
const plan={research:'Inspected Apex implementation and callers',files:[{path:'classes/Example.cls',reason:'Fix validation'}],steps:'Implement in sandbox then test',acceptance:'Apex tests pass',risks:'Production deployment requires separate approval'};
const evidence={revision:'sandbox-123',artifacts:[{path:'classes/Example.cls',summary:'Fixed in sandbox'}],passed:3,failed:0,commands:'Run Apex tests in sandbox',output:'3 tests passed',summary:'Sandbox result verified'};
async function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'relay-team-')),db=openSqlite(join(dir,'db.sqlite'));await applyMigrations(db);
 let now=1900000000000;const store=new ControlStore(db,{now:()=>now,teamPlanning:true});await store.bootstrap(human);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const request=async command=>{const s=await store.read(),task=s.tasks.find(x=>x.id===command.taskId),project=task?taskAuthority(s,task):s.projects.find(x=>x.id===(command.projectId||'relay'));return{operationId:crypto.randomUUID(),epoch:s.meta.epoch,...task?{expectedVersion:task.version}:{},command:{projectFence:project?.ownershipFence,...task?.lease?{fence:task.fence}:{},...command}};};
 const run=async(actor,c)=>store.command(actor==='human'?human:agent(actor),await request(c));
 const create=async(n,executionMode)=>(await run('human',{type:'create_task',input:{title:'Task '+n,component:'component-'+n,executionMode}})).result.taskId;
 const get=async id=>(await store.read()).tasks.find(x=>x.id===id);
 const advance=async id=>{const s=await store.read(),task=s.tasks.find(x=>x.id===id),policy=s.executionPolicies.find(x=>x.id===id);return run(task.team.owner,{type:'agentic_advance',taskId:id,fence:task.fence,scopeRevision:task.scopeRevision,planRevision:task.planRevision,buildRevision:task.buildRevision,evidenceRevision:task.evidence?.revision,expectedPolicyRevision:policy?.executionPolicyRevision??0,expectedOwnerGrantRevision:policy?.ownerGrantRevision??0});};
 const submit=async(id,actor='dot')=>{await run(actor,{type:'claim',taskId:id});await run(actor,{type:'save_plan',taskId:id,...plan});await run(actor,{type:'submit_plan',taskId:id});};
 return {store,run,create,get,advance,submit,request,elapse:ms=>now+=ms,now:()=>now};
}

test('solo owner completes Work with manual reviews and no peer response',async t=>{
 const f=await setup(t),id=await f.create('solo');await f.submit(id);let task=await f.get(id);
 assert.equal(task.owner,'dot');assert.equal(task.stage,'plan_review');assert.deepEqual(task.team.accepted,[]);
 await assert.rejects(f.advance(id),e=>e.code==='POLICY_REQUIRED');await assert.rejects(f.run('dot',{type:'claim',taskId:id}),e=>e.code==='INVALID_STAGE');await assert.rejects(f.run('scout',{type:'claim',taskId:id}),e=>e.code==='TASK_NOT_OWNED');
 await f.run('human',{type:'approve_plan',taskId:id,scopeRevision:task.scopeRevision,planRevision:task.planRevision});
 await f.run('dot',{type:'claim',taskId:id});await f.run('dot',{type:'save_evidence',taskId:id,...evidence});await f.run('dot',{type:'submit_build',taskId:id});
 assert.equal((await f.get(id)).stage,'human_review');await assert.rejects(f.advance(id),e=>e.code==='POLICY_REQUIRED');
 task=await f.get(id);await f.run('human',{type:'approve_final',taskId:id,scopeRevision:task.scopeRevision,planRevision:task.planRevision,buildRevision:task.buildRevision});assert.equal((await f.get(id)).stage,'ready');
});

test('idle peer can research; busy peer is not invited and cannot replace the owner plan',async t=>{
 const f=await setup(t),id=await f.create('optional');await f.run('dot',{type:'claim',taskId:id});await f.run('scout',{type:'report_capacity',availableSlots:5});let s=await f.store.read();
 assert.equal(controlQueue(s,controlPrincipal(s,agent('scout')),f.now(),[]).planningInvitations.length,1);
 await f.run('scout',{type:'team_note',taskId:id,text:'Independent research found a null check.'});await assert.rejects(f.run('scout',{type:'save_plan',taskId:id,...plan}),e=>e.code==='TASK_NOT_OWNED');
 const other=await f.create('busy');assert.equal((await f.get(other)).owner,'scout');s=await f.store.read();assert.equal(controlQueue(s,controlPrincipal(s,agent('scout')),f.now(),[]).planningInvitations.length,0);
 await assert.rejects(f.run('scout',{type:'team_note',taskId:id,text:'Interrupt other work'}),e=>e.code==='PLANNING_BUSY');
 await f.run('dot',{type:'save_plan',taskId:id,...plan});await f.run('dot',{type:'submit_plan',taskId:id});assert.equal((await f.get(id)).stage,'plan_review');
});

test('plan edits and human changes retain owner and never reopen peer acceptance',async t=>{
 const f=await setup(t),id=await f.create('revision');await f.submit(id);let task=await f.get(id),fence=task.team.fence;
 await f.run('human',{type:'request_plan_changes',taskId:id,reason:'Cover errors'});await f.run('dot',{type:'claim',taskId:id});await f.run('dot',{type:'save_plan',taskId:id,...plan,steps:'Test errors'});task=await f.get(id);
 assert.equal(task.team.owner,'dot');assert.equal(task.team.fence,fence);assert.equal(task.team.phase,'assigned');await assert.rejects(f.run('scout',{type:'team_note',taskId:id,text:'Reopen discussion'}),e=>['TASK_NOT_OWNED','PLANNING_CLOSED'].includes(e.code));
 await f.run('dot',{type:'submit_plan',taskId:id});assert.equal((await f.get(id)).stage,'plan_review');await f.run('human',{type:'edit_task',taskId:id,input:{...task,description:'Updated scope'}});assert.equal((await f.get(id)).owner,'dot');
});

test('Agentic task advances both reviews alone; Work switch revokes autonomous readiness',async t=>{
 const f=await setup(t),id=await f.create('personal','agentic');await f.submit(id);await f.advance(id);assert.equal((await f.get(id)).stage,'build');assert.equal((await f.get(id)).planApproval,null);
 await f.run('dot',{type:'claim',taskId:id});await f.run('dot',{type:'save_evidence',taskId:id,...evidence});await f.run('dot',{type:'submit_build',taskId:id});await f.advance(id);assert.equal((await f.get(id)).stage,'ready');assert.equal((await f.get(id)).finalApproval,null);
 await f.run('human',{type:'set_task_mode',taskId:id,mode:'work'});let task=await f.get(id);assert.equal(task.stage,'plan_review');assert.equal(task.agenticPlanDecision,null);assert.equal(task.agenticFinalDecision,null);await assert.rejects(f.advance(id),e=>e.code==='POLICY_REQUIRED');
 const s=await f.store.read();assert.equal(controlProjection(s,controlPrincipal(s,human),f.now(),[]).tasks.find(x=>x.id===id).executionPolicy.mode,'manual');
});

test('only human enables Agentic; stale mode changes fail and other tasks stay Work',async t=>{
 const f=await setup(t),id=await f.create('protected');await f.run('dot',{type:'claim',taskId:id});
 await assert.rejects(f.run('dot',{type:'set_task_mode',taskId:id,mode:'agentic'}),e=>e.code==='FORBIDDEN');await assert.rejects(f.run('dot',{type:'create_task',input:{title:'Escalate',executionMode:'agentic'}}),e=>e.code==='FORBIDDEN');
 const stale=await f.request({type:'set_task_mode',taskId:id,mode:'agentic'});await f.run('human',{type:'set_task_mode',taskId:id,mode:'work'});await assert.rejects(f.store.command(human,stale),e=>e.code==='STALE_TASK');
 const other=await f.create('still-work');await f.run('human',{type:'set_task_mode',taskId:id,mode:'agentic'});const s=await f.store.read();assert.equal(controlProjection(s,controlPrincipal(s,human),f.now(),[]).tasks.find(x=>x.id===other).executionPolicy.mode,'manual');
});

test('five-task capacity cap applies before planning; stale reports cannot auto assign',async t=>{
 const f=await setup(t);for(const a of ['dot','scout'])await f.run(a,{type:'report_capacity',availableSlots:5});for(let i=0;i<11;i++)await f.create(i);let s=await f.store.read();assert.deepEqual(teamCapacity(s,f.now()).map(a=>a.active),[5,5]);assert.equal(s.tasks.filter(t=>!t.team.owner).length,1);
 await assert.rejects(f.run('dot',{type:'claim',taskId:s.tasks.find(t=>!t.team.owner).id}),e=>e.code==='CAPACITY');f.elapse(900001);assert.ok(teamCapacity(s,f.now()).every(a=>!a.reportFresh&&a.available===0));
});

test('racing claims have one owner; human recovery fences old owner and its wakes',async t=>{
 const f=await setup(t),id=await f.create('race');const [dot,scout]=await Promise.all([f.request({type:'claim',taskId:id}),f.request({type:'claim',taskId:id})]);const outcomes=await Promise.allSettled([f.store.command(agent('dot'),dot),f.store.command(agent('scout'),scout)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 const task=await f.get(id),owner=task.owner,other=owner==='dot'?'scout':'dot',old=await f.request({type:'save_plan',taskId:id,...plan});await f.run('human',{type:'team_reassign',taskId:id,target:other,reason:'Owner unavailable'});await assert.rejects(f.store.command(agent(owner),old),e=>e.code==='TASK_NOT_OWNED');
 const s=await f.store.read();assert.deepEqual([...new Set(s.wakes.filter(w=>currentWake(s,w)).map(w=>w.recipient))],[other]);
});

test('legacy accept finalizes without peer; retried notes remain unique',async t=>{
 const f=await setup(t),id=await f.create('compat');await f.run('dot',{type:'claim',taskId:id});await f.run('dot',{type:'save_plan',taskId:id,...plan});const req=await f.request({type:'team_note',taskId:id,text:'Research complete'});await f.store.command(agent('dot'),req);await f.store.command(agent('dot'),req);await f.run('dot',{type:'team_accept_plan',taskId:id,planRevision:1});const task=await f.get(id);assert.equal(task.stage,'plan_review');assert.equal(task.team.notes.length,1);
});
