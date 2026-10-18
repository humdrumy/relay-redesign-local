import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openPostgres} from '../backend/postgres.mjs';
import {ControlStore} from '../backend/control.mjs';

test('Postgres preserves CAS, idempotency and concurrent task writes',{skip:!process.env.DATABASE_URL},async()=>{
 const admin=openPostgres(process.env.DATABASE_URL),schema='relay_test_'+crypto.randomUUID().replaceAll('-','');
 await admin.exec(`CREATE SCHEMA ${schema}`);
 try{
  const db=openPostgres(process.env.DATABASE_URL,{schema});
  assert.equal((await db.prepare('SELECT current_schema() AS name').bind().first()).name,schema);
  const statements=readFileSync(new URL('../migrations-postgres/001_relay.sql',import.meta.url),'utf8').split(';').map(x=>x.trim()).filter(Boolean);
  await db.batch(statements.map(sql=>db.prepare(sql).bind()));
  const store=new ControlStore(db,{teamPlanning:true}),identity={kind:'human',subject:'test-owner'};
  const initial=await store.bootstrap(identity);
  const requests=Array.from({length:4},(_,i)=>({epoch:initial.meta.epoch,operationId:crypto.randomUUID(),command:{type:'create_task',input:{title:'Concurrent '+i,component:'test-'+i}}}));
  await Promise.all(requests.map(request=>store.command(identity,request)));
  assert.equal((await store.read()).tasks.length,4);
  const replay=await store.command(identity,requests[0]);assert.equal(replay.result.replayed,true);
  assert.equal((await store.read()).tasks.length,4);
  const a=await store.read(),b=structuredClone(a);b.meta.revision++;
  assert.equal(await store.save(a,b),true);assert.equal(await store.save(a,b),false);
 }finally{await admin.exec(`DROP SCHEMA ${schema} CASCADE`);}
});
