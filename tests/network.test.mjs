import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {openSqlite} from '../backend/sqlite-local.mjs';
import {applyMigrations} from '../backend/migrations-local.mjs';
import {ControlStore,controlProjection,controlPrincipal} from '../backend/control.mjs';
import {networkRelationships,resolveReferences} from '../backend/network.mjs';
import {createHandler} from '../backend/http.mjs';
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'relay-network-')),db=openSqlite(join(dir,'state.sqlite'));await applyMigrations(db);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});const store=new ControlStore(db),human={kind:'human',subject:'owner'};await store.bootstrap(human,null);
 const identity=actor=>actor==='human'?human:{kind:'agent',actor,subject:actor};
 const envelope=async command=>{const s=await store.read(),task=s.tasks.find(t=>t.id===command.taskId),project=s.projects.find(p=>p.id===(task?.projectId||command.projectId));return {epoch:s.meta.epoch,operationId:crypto.randomUUID(),...(task?{expectedVersion:task.version}:{}),...['claim_project','reassign_project'].includes(command.type)?{expectedProjectVersion:project.version}:{},command:{...project?{projectFence:project.ownershipFence}:{},...command}};};
 const run=async(command,actor='human')=>store.command(identity(actor),await envelope(command));
 const second=(await run({type:'create_project',name:'Messaging private',description:'Project summary'})).result.projectId;
 const a=(await run({type:'create_task',input:{title:'Shared event service',description:'Canonical service details',component:'event.js'}})).result.taskId;
 const b=(await run({type:'create_task',input:{title:'PRIVATE CUSTOMER ROUTING',description:'PRIVATE CONTENT',projectId:second,component:'routing.js',dependencies:[a]}})).result.taskId;
 await run({type:'reassign_project',projectId:'relay',target:'forge',reason:'Fixture'});await run({type:'reassign_project',projectId:second,target:'flux',reason:'Fixture'});
 const handle=createHandler({authenticate:request=>request.headers.get('test-subject')||null});const keys=Object.fromEntries(['forge','flux'].map(id=>[createHash('sha256').update(id+'-key').digest('hex'),id]));
 const http=(path,actor='human',body)=>handle(new Request('https://relay.test/api/control/'+path,{method:body?'POST':'GET',headers:{...(actor==='human'?{'test-subject':'owner'}:{authorization:'Bearer '+actor+'-key'}),...body?{origin:'https://relay.test','content-type':'application/json','x-relay-client':'1'}:{}},...body?{body:JSON.stringify(body)}:{}}),{DB:db,RELAY_AGENT_KEYS_JSON:JSON.stringify(keys)});
 return {db,store,run,envelope,http,a,b,second,identity};
}
test('references persist IDs only, deduplicate, resolve current data and replay without new messages',async t=>{
 const f=await fixture(t);const request=await f.envelope({type:'message',room:'admin',text:'Review this',references:[{type:'task',id:f.a,label:'FORGED LABEL',description:'FORGED CONTEXT'},{type:'task',id:f.a}]});
 const r=await f.store.command(f.identity('human'),request);const read=await new ControlStore(f.db).read(),m=read.messages.find(m=>m.id===r.result.messageId);assert.deepEqual(m.references,[{type:'task',id:f.a}]);assert.ok(!JSON.stringify(m).includes('FORGED'));
 const task=read.tasks.find(t=>t.id===f.a);await f.run({type:'edit_task',taskId:f.a,input:{...task,title:'Current event service',description:'Current description'}});
 const ctx=await(await f.http('context?messageId='+m.id)).json();assert.equal(ctx.references[0].label,'Current event service');assert.equal(ctx.references[0].entity.description,'Current description');
 await f.store.command(f.identity('human'),request);assert.equal((await f.store.read()).messages.length,1);
 assert.equal((await f.http('context?messageId='+m.id+'&jobId=anything')).status,400);
});
test('cross-project references never disclose unauthorized endpoints, relationship metadata or plans',async t=>{
 const f=await fixture(t);const relation=(await f.run({type:'create_relationship',from:{type:'task',id:f.a},to:{type:'task',id:f.b},name:'PRIVATE SHARED NAME',rationale:'PRIVATE SHARED RATIONALE',impact:'PRIVATE IMPACT'})).result.relationshipId;
 const sent=await f.run({type:'message',room:'admin',text:'Inspect explicit references',references:[{type:'task',id:f.a},{type:'task',id:f.b},{type:'relationship',id:relation}]});
 const ctx=await(await f.http('context?jobId='+sent.result.jobId,'forge')).json();assert.deepEqual(ctx.references.map(r=>r.status),['available','unavailable','unavailable']);assert.doesNotMatch(JSON.stringify(ctx),/PRIVATE/);
 for(const path of ['state','export','queue','network']){const body=await(await f.http(path,'forge')).json();assert.doesNotMatch(JSON.stringify(body),/PRIVATE CUSTOMER|PRIVATE CONTENT|PRIVATE SHARED|PRIVATE IMPACT/);}
 await assert.rejects(f.run({type:'message',room:'direct:forge',text:'Denied',references:[{type:'task',id:f.b}]},'forge'),e=>['NOT_ADDRESSED','REFERENCE_UNAVAILABLE'].includes(e.code));
 assert.equal((await f.http('context?messageId='+sent.result.messageId,'forge')).status,403);
 const heartbeat=await f.http('command','forge',await f.envelope({type:'heartbeat',summary:'Available'}));assert.equal(heartbeat.status,200);assert.doesNotMatch(JSON.stringify(await heartbeat.json()),/PRIVATE CUSTOMER|PRIVATE CONTENT|PRIVATE SHARED|PRIVATE IMPACT/);
 await f.run({type:'claim_ai',jobId:sent.result.jobId},'forge');assert.equal((await f.http('context?messageId='+sent.result.messageId,'forge')).status,200);
 const reassigned=await f.run({type:'reassign_project',projectId:'relay',target:'flux',reason:'Ownership changed'});
 const after=await(await f.http('context?jobId='+sent.result.jobId,'forge')).json();assert.ok(after.references.every(r=>r.status==='unavailable'));assert.doesNotMatch(JSON.stringify(after),/Canonical service details/);
});
test('relationships enforce human authority, optimistic versions, duplicate protection and tombstones',async t=>{
 const f=await fixture(t);const create={type:'create_relationship',from:{type:'task',id:f.a},to:{type:'task',id:f.b},name:'Event contract',rationale:'Both consume event envelopes',impact:'Coordinate envelope changes'};
 await assert.rejects(f.run(create,'forge'),e=>e.code==='FORBIDDEN');const id=(await f.run(create)).result.relationshipId;
 await assert.rejects(f.run({...create,from:create.to,to:create.from}),e=>e.code==='RELATIONSHIP_EXISTS');
 const edits=await Promise.allSettled([f.run({type:'save_relationship',relationshipId:id,relationshipVersion:1,rationale:'First'}),f.run({type:'save_relationship',relationshipId:id,relationshipVersion:1,rationale:'Second'})]);assert.equal(edits.filter(x=>x.status==='fulfilled').length,1);assert.equal(edits.find(x=>x.status==='rejected').reason.code,'STALE_RELATIONSHIP');
 const sent=await f.run({type:'message',room:'admin',text:'Check relationship',references:[{type:'relationship',id}]});await f.run({type:'remove_relationship',relationshipId:id,relationshipVersion:2});
 const ctx=await(await f.http('context?messageId='+sent.result.messageId)).json();assert.equal(ctx.references[0].status,'unavailable');assert.ok(!JSON.stringify(ctx).includes('First'));
 const before=(await f.store.read()).messages.length;await assert.rejects(f.run({type:'message',room:'admin',text:'Stale reference',references:[{type:'relationship',id}]}),e=>e.code==='REFERENCE_UNAVAILABLE');assert.equal((await f.store.read()).messages.length,before);
});
test('derived dependency explanations follow the real edge and cannot bypass task approval gates',async t=>{
 const f=await fixture(t),s=await f.store.read(),edge=networkRelationships(s).find(e=>e.type==='dependency');
 await f.run({type:'save_relationship',relationshipId:edge.id,relationshipVersion:0,name:'Event prerequisite',rationale:'Routing consumes its API',impact:'Routing must wait for API approval'});
 const before=(await f.store.read()).tasks;assert.deepEqual(before,s.tasks);
 const sent=await f.run({type:'message',room:'admin',text:'Dependency',references:[{type:'relationship',id:edge.id}]});const b=before.find(t=>t.id===f.b);await f.run({type:'edit_task',taskId:f.b,input:{...b,dependencies:[]}});
 assert.equal((await(await f.http('context?messageId='+sent.result.messageId)).json()).references[0].status,'unavailable');
 await assert.rejects(f.run({type:'save_relationship',relationshipId:edge.id,relationshipVersion:1,rationale:'Stale edit'}),e=>e.code==='RELATIONSHIP_UNAVAILABLE');
 const unknown=await f.http('context?messageId=deleted');assert.equal(unknown.status,403);
});
test('missing references, malformed types and excess attachments fail atomically; empty older messages still resolve',async t=>{
 const f=await fixture(t);for(const references of [[{type:'task',id:'gone'}],[{type:'secret',id:f.a}],Array.from({length:9},()=>({type:'task',id:f.a}))])await assert.rejects(f.run({type:'message',room:'admin',text:'Bad references',references}),e=>['REFERENCE_UNAVAILABLE','INVALID_REFERENCES'].includes(e.code));
 const r=await f.run({type:'message',room:'admin',text:'Plain old message'});assert.deepEqual((await(await f.http('context?messageId='+r.result.messageId)).json()).references,[]);
 const s=await f.store.read(),p=controlPrincipal(s,f.identity('human'));assert.equal(controlProjection(s,p,Date.now()).messages.length,1);assert.deepEqual(resolveReferences(s,p,[{type:'task',id:'deleted'}])[0].status,'unavailable');
});
