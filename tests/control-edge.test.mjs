import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
test('built Worker uses real D1 batches: migration, create, concurrent claim, replay and persistence',async()=>{
  const mf=new Miniflare({scriptPath:resolve('dist/server/index.js'),modules:true,compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{RELAY_AGENT_KEYS_JSON:JSON.stringify(Object.fromEntries(['forge','flux'].map(id=>[createHash('sha256').update(id+'-fixture-key').digest('hex'),id])))}});
  try{
    const db=await mf.getD1Database('DB');for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort()){for(const statement of readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();}
    const call=async(path,body,actor=null)=>mf.dispatchFetch(`https://relay.test/api/control/${path}`,{method:body?'POST':'GET',headers:{...actor?{authorization:`Bearer ${actor}-fixture-key`}:{'oai-authenticated-user-id':'edge-owner'},...body?{origin:'https://relay.test','x-relay-client':'1','content-type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});
    const bootstrap=await call('bootstrap',{});assert.equal(bootstrap.status,200);const s=await bootstrap.json();assert.equal(s.tasks.length,0);
    const request={epoch:s.meta.epoch,operationId:'edge-operation-0001',command:{type:'create_task',input:{title:'Actual D1 workflow'}}};
    const response=await call('command',request);assert.equal(response.status,200);const created=await response.json();assert.equal(created.tasks.length,1);assert.equal(created.wakes.length,5);
    const replay=await(await call('command',request)).json();assert.equal(replay.result.replayed,true);assert.equal(replay.tasks.length,1);
    // Independent requests with the same workspace revision must safely retry CAS.
    const copies=await Promise.all([1,2,3].map(i=>call('command',{epoch:s.meta.epoch,operationId:`edge-project-${i}`,command:{type:'create_project',name:`Project ${i}`}})));assert.ok(copies.every(r=>r.status===200));
    const current=await(await call('state')).json();assert.equal(current.projects.length,4);assert.equal(current.tasks.length,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM relay_control_records WHERE kind = ?').bind('operations').first()).count,4);
    const claim={epoch:current.meta.epoch,operationId:'edge-project-claim',expectedProjectVersion:current.projects.find(p=>p.id==='relay').version,command:{type:'claim_project',projectId:'relay'}};
    const competing=await Promise.all(['forge','flux'].map(actor=>call('command',claim,actor)));assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
    const winnerIndex=competing.findIndex(r=>r.status===200),winner=['forge','flux'][winnerIndex],loser=['forge','flux'][1-winnerIndex];assert.equal((await(await call('command',claim,winner)).json()).result.replayed,true);
    assert.equal((await(await call('state',undefined,loser)).json()).tasks.length,0);assert.equal((await(await call('state',undefined,winner)).json()).tasks.length,1);
    const taskId=current.tasks[0].id;
    const referenced=await(await call('command',{epoch:s.meta.epoch,operationId:'edge-reference-message',command:{type:'message',room:'admin',projectId:'relay',text:'Inspect this task',references:[{type:'task',id:taskId,label:'UNTRUSTED LABEL'}]}})).json();
    assert.equal(referenced.result.type,'message');assert.deepEqual(referenced.messages[0].references,[{type:'task',id:taskId}]);
    const context=await(await call('context?messageId='+referenced.result.messageId,undefined,winner)).json();assert.equal(context.references[0].entity.title,'Actual D1 workflow');assert.equal((await call('context?messageId='+referenced.result.messageId,undefined,loser)).status,403);
    assert.ok(!(JSON.stringify(await(await call('export',undefined,loser)).json())).includes('Actual D1 workflow'));
    const views=await mf.dispatchFetch('https://relay.test/network-view.mjs');assert.equal(views.status,200);assert.match(await views.text(),/renderNetwork/);
    for(const file of ['network-motion.mjs','network-interactions.mjs']){
      const asset=await mf.dispatchFetch(`https://relay.test/${file}`);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
      assert.equal(await asset.text(),readFileSync(file,'utf8'),'built Worker serves the exact camera/spring module');
    }
    const html=await mf.dispatchFetch('https://relay.test/');assert.equal(html.status,200);assert.match(await html.text(),/control-app.mjs/);
    const script=await mf.dispatchFetch('https://relay.test/control-app.mjs');assert.equal(script.status,200);
  }finally{await mf.dispose();}
});
