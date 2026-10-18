import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {agentMcp} from '../backend/agent-mcp.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const env={RELAY_AGENT_KEYS_JSON:JSON.stringify({[hash('dot-test-key')]:'dot',[hash('scout-test-key')]:'scout'})};
const request=(key,method,params)=>new Request('https://relay.invalid/mcp',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
test('machine credentials expose only their own tools and never human creation',async()=>{
 for(const actor of ['dot','scout']){
  const result=await (await agentMcp(request(actor+'-test-key','tools/list'),{env})).json();
  assert.ok(result.result.tools.length>0);assert.ok(result.result.tools.every(t=>t.name.startsWith('relay_'+actor+'_')));
  for(const name of ['relay_owner_create_relay_task',actor==='dot'?'relay_scout_command':'relay_dot_command']){
   const denied=await (await agentMcp(request(actor+'-test-key','tools/call',{name,arguments:{}}),{env})).json();
   assert.equal(denied.error.code,-32601);
  }
 }
 await assert.rejects(agentMcp(request('wrong-key','tools/list'),{env}),e=>e.status===401);
});
