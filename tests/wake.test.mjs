import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite } from '../backend/sqlite-local.mjs';
import { applyMigrations } from '../backend/migrations-local.mjs';
import { WorkspaceStore } from '../backend/store.mjs';
import { enqueueWake } from '../backend/core.mjs';
import { drainSlack, postSlack, wakeText } from '../backend/slack.mjs';
import { ROOK_PREFIX } from '../backend/slack-mention.mjs';
import { createHandler } from '../backend/http.mjs';
const owner = 'test-owner';
const env = { SLACK_BOT_TOKEN: 'xoxb-test-fixture', SLACK_CHANNEL_ID: 'C0TEST', RELAY_PUBLIC_URL: 'https://relay.example' };
const good = async () => Response.json({ ok: true, ts:'123.456', channel:'C0TEST' });
const input = { title:'Wake proof task', component:'proof', environment:'test', revision:'r1', type:'Task', priority:'Normal' };
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-wake-')), file = join(directory,'test.sqlite');
  const db = openSqlite(file); await applyMigrations(db);
  let now = 1791510000000;
  const store = new WorkspaceStore(db, { now:()=>now, bindings:{'coordinator':'dot'} }); await store.bootstrap(owner);
  const connections=[db];
  t.after(()=>{for(const connection of connections){try{connection.close();}catch{}} rmSync(directory,{recursive:true,force:true}); });
  const request = async command => ({ command, operationId:crypto.randomUUID(), epoch:(await store.read()).state.epoch });
  const run = async command => store.command(owner,await request(command));
  const enable = () => store.mutate(doc=>{ doc.wakeSettings={enabled:true,channel:'C0TEST'}; return true; });
  const queue = (reason='test') => store.mutate(doc=>enqueueWake(doc,{reason},now));
  return {store,db,file,connections,request,run,enable,queue,advance:ms=>{now+=ms;}};
}
function req(path, body, subject=owner, headers={}) { return new Request(`https://relay.example${path}`,{method:body?'POST':'GET',headers:{...(subject?{'oai-authenticated-user-id':subject}:{}),...(body?{'content-type':'application/json',origin:'https://relay.example','x-relay-client':'1'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}); }
const rpc = (name,args={}) => ({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});

test('events stay quiet until enabled; task and addressed message create durable wakes',async t=>{
  const f=await fixture(t); await f.run({type:'message',channel:'general',recipients:['dot'],text:'before'});
  assert.equal((await f.store.read()).wakes,undefined); await f.enable();
  await f.run({type:'create',input}); await f.run({type:'message',channel:'general',recipients:['dot'],text:'wake'});
  await f.run({type:'message',channel:'direct:forge',text:'not for dot'});
  assert.deepEqual((await f.store.read()).wakes.map(w=>w.reason),['task-created','room-message']);
});
test('idempotent replay and rejected writes do not enqueue additional wakes',async t=>{
  const f=await fixture(t); await f.enable(); const r=await f.request({type:'create',input});
  await f.store.command(owner,r); await f.store.command(owner,r);
  await assert.rejects(f.run({type:'create',input}),/Duplicate/);
  assert.equal((await f.store.read()).wakes.length,1);
});
test('two dispatchers cannot concurrently send the same wake',async t=>{
  const f=await fixture(t); await f.queue(); const otherDB=openSqlite(f.file); f.connections.push(otherDB);
  const other=new WorkspaceStore(otherDB,{now:f.store.now}); let calls=0;
  const sender=async()=>{calls++;return good();};
  const result=await Promise.all([drainSlack(f.store,env,sender),drainSlack(other,env,sender)]);
  assert.equal(calls,1); assert.equal(result.filter(r=>r.status==='sent').length,1);
  const wake=(await f.store.read()).wakes[0]; assert.equal(wake.status,'sent'); assert.equal(wake.acknowledgedAt,null);
});
test('Slack 429 respects Retry-After and does not spin',async t=>{
  const f=await fixture(t); await f.queue(); let calls=0;
  const sender=async()=>{calls++;return Response.json({ok:false,error:'ratelimited'},{status:429,headers:{'retry-after':'60'}});};
  await drainSlack(f.store,env,sender); await drainSlack(f.store,env,sender); assert.equal(calls,1);
  f.advance(60000); await drainSlack(f.store,env,good); assert.equal((await f.store.read()).wakes[0].status,'sent');
});
test('HTTP 200 with Slack ok:false is a failure, never a success receipt',async t=>{
  const f=await fixture(t); await f.queue();
  await drainSlack(f.store,env,async()=>Response.json({ok:false,error:'not_in_channel'}));
  const wake=(await f.store.read()).wakes[0]; assert.equal(wake.status,'failed'); assert.equal(wake.error,'not_in_channel'); assert.equal(wake.sentAt,undefined);
});
test('transport errors retry six times then stop; no token/error-body leakage',async t=>{
  const f=await fixture(t); await f.queue();
  for(let i=0;i<6;i++){await drainSlack(f.store,env,async()=>{throw new Error(env.SLACK_BOT_TOKEN);});f.advance(400000);}
  const doc=await f.store.read(); assert.equal(doc.wakes[0].attempts,6);assert.equal(doc.wakes[0].status,'failed');assert.ok(!JSON.stringify(doc).includes(env.SLACK_BOT_TOKEN));
});
test('a persisted pending job survives restart and expired sender lease is recoverable',async t=>{
  const f=await fixture(t); await f.queue();
  await f.store.mutate(doc=>{doc.wakes[0].status='sending';doc.wakes[0].lockUntil=f.store.now()+30000;doc.slackLease={token:'abandoned',until:f.store.now()+30000};return true;});
  assert.equal((await drainSlack(f.store,env,good)).status,'idle');f.advance(30001);
  const db=openSqlite(f.file);f.connections.push(db);const store=new WorkspaceStore(db,{now:f.store.now});
  assert.equal((await drainSlack(store,env,good)).status,'sent');
});
test('MCP dot receipt is explicit, idempotent, and cannot launch another wake',async t=>{
  const f=await fixture(t);await f.enable();const wake=await f.queue();const handle=createHandler();
  const request=()=>req('/mcp',rpc('relay_ack_wake',{wakeId:wake.id}));
  assert.equal((await handle(request(),{DB:f.db})).status,200);
  assert.equal((await handle(request(),{DB:f.db})).status,200);
  const doc=await f.store.read();assert.ok(doc.wakes[0].acknowledgedAt);assert.equal(doc.wakes.length,1);assert.equal(doc.state.tasks.some(t=>t.owner),false);
  assert.equal((await handle(req('/mcp',rpc('relay_ack_wake',{wakeId:wake.id}),'other'),{DB:f.db})).status,403);
  const command=await f.request({type:'create',input}); await assert.rejects(f.store.command(owner,command,true),e=>e.code==='READ_ONLY_CONNECTION');
});
test('wake APIs require owner identity and same-origin POST; configuration does not reveal secrets',async t=>{
  const f=await fixture(t);const handle=createHandler({slackFetch:good});const runtime={...env,DB:f.db};
  assert.equal((await handle(req('/api/wake-status',null,null),runtime)).status,401);
  assert.equal((await handle(req('/api/wake-test',{operationId:'test-12345'},'other'),runtime)).status,403);
  assert.equal((await handle(req('/api/wake-test',{operationId:'test-12345'},owner,{origin:'https://evil.test'}),runtime)).status,403);
  const status=await (await handle(req('/api/wake-status'),runtime)).text();assert.ok(!status.includes(env.SLACK_BOT_TOKEN));
  assert.equal((await handle(req('/api/wake-test',{operationId:'test-12345'}),runtime)).status,200);
  assert.equal((await handle(req('/api/wake-test',{operationId:'test-12345'}),runtime)).status,200);
  assert.equal((await f.store.read()).wakes.length,1);
});
test('disabling cancels pending event wakes; a manual probe remains usable',async t=>{
  const f=await fixture(t);await f.enable();await f.queue('task-created');const handle=createHandler({slackFetch:good});
  const runtime={...env,DB:f.db};await handle(req('/api/wake-config',{enabled:false,channel:'C0TEST',mention:''}),runtime);
  assert.equal((await f.store.read()).wakes[0].error,'paused_by_owner');
  await handle(req('/api/wake-test',{operationId:'test-12345'}),runtime);
  assert.equal((await f.store.read()).wakes[1].status,'sent');
});
test('Slack payload contains a trusted pointer only and no untrusted task text',async()=>{
  const job={id:crypto.randomUUID(),recipient:'dot',text:'<!channel> Secret task content',reason:'test'};
  const config={token:env.SLACK_BOT_TOKEN,channel:'C0TEST',url:env.RELAY_PUBLIC_URL,mentions:{}};
  const text=wakeText(job,config);assert.ok(!text.includes('Secret'));assert.ok(!text.includes('<!channel>'));
  assert.ok(text.startsWith(`${ROOK_PREFIX}<@U0C6PAA9PT5> Relay wake-up`));
  let posted;await postSlack(job,config,async(url,options)=>{posted=JSON.parse(options.body);assert.equal(url,'https://slack.com/api/chat.postMessage');assert.equal(options.redirect,'manual');return good();});
  assert.equal(posted.text,text);assert.equal(posted.client_msg_id,job.id);assert.equal(posted.unfurl_links,false);assert.equal(posted.thread_ts,undefined);
  assert.ok(wakeText({...job,recipient:'scout'},config).startsWith(`${ROOK_PREFIX}Relay wake-up`));
  await assert.rejects(postSlack(job,{...config,url:'javascript:alert(1)'},good),e=>e.code==='SLACK_NOT_CONFIGURED');
});
test('Slack redirect is rejected without following it or parsing its body',async()=>{
  let calls=0;
  const result=await postSlack({id:crypto.randomUUID(),recipient:'dot'}, {token:env.SLACK_BOT_TOKEN,channel:'C0TEST',url:env.RELAY_PUBLIC_URL,mentions:{}}, async()=>{calls++;return new Response('redirect',{status:302,headers:{location:'https://untrusted.example'}});});
  assert.equal(calls,1);assert.deepEqual(result,{ok:false,retryable:false,error:'slack_unexpected_redirect'});
});
test('non-JSON rate limits, server errors, and null JSON retain distinct failure reasons',async()=>{
  const config={token:env.SLACK_BOT_TOKEN,channel:'C0TEST',url:env.RELAY_PUBLIC_URL,mentions:{}};
  const send=sender=>postSlack({id:crypto.randomUUID(),recipient:'dot'},config,sender);
  assert.deepEqual(await send(async()=>new Response('slow down',{status:429,headers:{'retry-after':'9'}})),{ok:false,retryable:true,error:'rate_limited',retryAfterMs:9000});
  assert.deepEqual(await send(async()=>new Response('unavailable',{status:503})),{ok:false,retryable:true,error:'slack_http_503'});
  assert.deepEqual(await send(async()=>Response.json(null)),{ok:false,retryable:true,error:'slack_invalid_response'});
  assert.deepEqual(await send(async()=>{throw new TypeError('Invalid redirect value');}),{ok:false,retryable:false,error:'runtime_request_error'});
});
