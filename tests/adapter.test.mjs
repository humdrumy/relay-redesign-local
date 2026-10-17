import test from 'node:test';
import assert from 'node:assert/strict';
import {RelayClient} from '../adapters/relay-client.mjs';
test('adapter never follows redirects or substitutes approval/fence values on retry',async()=>{
  const bodies=[],client=new RelayClient({url:'https://relay.example',siteToken:'site-fixture',agentToken:'agent-fixture',fetcher:async(url,options)=>{assert.equal(url.origin,'https://relay.example');assert.equal(options.redirect,'manual');assert.equal(options.headers.authorization,'Bearer agent-fixture');assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer site-fixture');bodies.push(options.body);return Response.json({result:{ok:true}});}});
  const envelope=client.envelope({meta:{epoch:'epoch'},tasks:[{id:'task',version:3,lease:{until:9999},fence:8}]},{type:'journal',taskId:'task',summary:'Verified'},'operation-123');
  await client.send(envelope);await client.send(envelope);assert.equal(bodies[0],bodies[1]);assert.equal(JSON.parse(bodies[0]).expectedVersion,3);assert.equal(JSON.parse(bodies[0]).command.fence,8);
  client.fetcher=async()=>new Response(null,{status:302,headers:{location:'https://other.example'}});await assert.rejects(client.queue(),/redirected/);
});
test('adapter captures project versions and both fences without replacing an explicit stale fence',()=>{
  const client=new RelayClient({url:'https://relay.example',agentToken:'fixture'}),snapshot={meta:{epoch:'epoch'},projects:[{id:'relay',version:4,ownershipFence:9}],tasks:[{id:'task',projectId:'relay',version:3,lease:{until:9999},fence:8}],jobs:[{id:'job',context:{projectId:'relay'}}]};
  const claim=client.envelope(snapshot,{type:'claim_project',projectId:'relay'});assert.equal(claim.expectedProjectVersion,4);
  const write=client.envelope(snapshot,{type:'journal',taskId:'task',summary:'Action'});assert.equal(write.command.projectFence,9);assert.equal(write.command.fence,8);
  const old=client.envelope(snapshot,{type:'journal',taskId:'task',projectFence:2,fence:1,summary:'Old'});assert.equal(old.command.projectFence,2);assert.equal(old.command.fence,1);
  assert.equal(client.envelope(snapshot,{type:'complete_ai',jobId:'job',fence:3}).command.projectFence,9);assert.equal(client.envelope(snapshot,{type:'create_task',input:{title:'New'}}).command.projectFence,9);
});
