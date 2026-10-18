import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSqlite} from '../backend/sqlite-local.mjs';
import {applyMigrations} from '../backend/migrations-local.mjs';
import {ControlStore,controlProjection,controlPrincipal,currentWake} from '../backend/control.mjs';
import {taskAuthority,teamCapacity} from '../backend/team-planning.mjs';
const human={kind:'human',subject:'owner'},agent=actor=>({kind:'agent',actor,subject:actor});
const plan={research:'Read the implementation',files:[{path:'src/app.js',reason:'Change required'}],steps:'Implement then test',acceptance:'Tests pass',risks:'None identified'};
async function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'relay-team-')),db=openSqlite(join(dir,'db.sqlite'));await applyMigrations(db);
 let now=1900000000000;const store=new ControlStore(db,{now:()=>now,teamPlanning:true});await store.bootstrap(human);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const request=async command=>{const s=await store.read(),task=s.tasks.find(x=>x.id===command.taskId),project=task?taskAuthority(s,task):s.projects.find(x=>x.id===(command.projectId||'relay'));return{operationId:crypto.randomUUID(),epoch:s.meta.epoch,...task?{expectedVersion:task.version}:{},command:{projectFence:project?.ownershipFence,...task?.lease?{fence:task.fence}:{},...command}};};
 const run=async(actor,c)=>store.command(actor==='human'?human:agent(actor),await request(c));
 const create=async n=>(await run('human',{type:'create_task',input:{title:'Task '+n,component:'component-'+n}})).result.taskId;
 const agree=async id=>{await run('dot',{type:'save_plan',taskId:id,...plan});let s=await store.read(),revision=s.tasks.find(t=>t.id===id).planRevision;await run('dot',{type:'team_accept_plan',taskId:id,planRevision:revision});await run('scout',{type:'team_accept_plan',taskId:id,planRevision:revision});};
 return {store,run,create,agree,request,advance:ms=>now+=ms,now:()=>now};
}
test('two planners agree a revision; only assigned owner can execute after approval',async t=>{
 const f=await setup(t),id=await f.create('one');let s=await f.store.read();
 assert.deepEqual(s.wakes.filter(w=>currentWake(s,w)).map(w=>w.recipient).sort(),['dot','scout']);
 for(const actor of ['dot','scout']){assert.equal(controlProjection(s,controlPrincipal(s,agent(actor)),f.now(),[]).tasks.length,1);await f.run(actor,{type:'report_capacity',availableSlots:5,usageRemainingPercent:actor==='dot'?80:60});}
 await f.agree(id);s=await f.store.read();let task=s.tasks.find(t=>t.id===id);assert.equal(task.owner,'dot');assert.equal(task.stage,'plan_review');
 assert.deepEqual([...new Set(s.wakes.filter(w=>currentWake(s,w)).map(w=>w.recipient))],['dot']);
 await assert.rejects(f.run('scout',{type:'claim',taskId:id}),e=>e.code==='TASK_NOT_OWNED');
 await assert.rejects(f.run('dot',{type:'team_note',taskId:id,text:'Keep discussing'}),e=>e.code==='PLANNING_CLOSED');
 await f.run('human',{type:'approve_plan',taskId:id,scopeRevision:task.scopeRevision,planRevision:task.planRevision});
 await f.run('dot',{type:'claim',taskId:id});await f.run('dot',{type:'save_evidence',taskId:id,revision:'commit',artifacts:[{path:'src/app.js',summary:'Done'}],passed:1,failed:0,commands:'node --test',output:'pass',summary:'Done'});await f.run('dot',{type:'submit_build',taskId:id});
 s=await f.store.read();task=s.tasks.find(t=>t.id===id);await f.run('human',{type:'approve_final',taskId:id,scopeRevision:task.scopeRevision,planRevision:task.planRevision,buildRevision:task.buildRevision});
 assert.equal((await f.store.read()).tasks.find(t=>t.id===id).stage,'ready');
});
test('capacity caps five per bot, balances assignments, queues overflow and rejects stale reports',async t=>{
 const f=await setup(t);for(const a of ['dot','scout'])await f.run(a,{type:'report_capacity',availableSlots:5});
 for(let i=0;i<11;i++)await f.agree(await f.create(i));let s=await f.store.read();assert.deepEqual(teamCapacity(s,f.now()).map(a=>a.active),[5,5]);assert.equal(s.tasks.filter(t=>t.team.phase==='waiting_capacity').length,1);
 await assert.rejects(f.run('dot',{type:'report_capacity',availableSlots:6}),e=>e.code==='INVALID_CAPACITY');
 f.advance(900001);assert.ok(teamCapacity(s,f.now()).every(a=>!a.reportFresh&&a.available===0));
});
test('plan revisions invalidate agreement and duplicate commands do not duplicate notes or wakes',async t=>{
 const f=await setup(t),id=await f.create('revision');await f.run('dot',{type:'save_plan',taskId:id,...plan});await f.run('dot',{type:'team_accept_plan',taskId:id,planRevision:1});
 await f.run('scout',{type:'save_plan',taskId:id,...plan,steps:'Better plan'});
 await assert.rejects(f.run('dot',{type:'team_accept_plan',taskId:id,planRevision:1}),e=>e.code==='STALE_PLAN');
 const req=await f.request({type:'team_note',taskId:id,text:'Discuss this revision'});await f.store.command(agent('dot'),req);await f.store.command(agent('dot'),req);
 const task=(await f.store.read()).tasks.find(t=>t.id===id);assert.deepEqual(task.team.accepted,[]);assert.equal(task.team.notes.length,1);
});
