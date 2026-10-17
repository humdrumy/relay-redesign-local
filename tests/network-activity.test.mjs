import test from 'node:test';
import assert from 'node:assert/strict';
import {networkActivityNodes,liveNetworkActivity,renderNetwork} from '../network-view.mjs';
import {NETWORK_DEMO as demo} from '../network-demo.mjs';
test('activity rolls from two project badges into four feature or file badges',()=>{
 const graph=demo.network;
 for(const depth of ['project','feature','file']){
  const types=depth==='project'?['project']:depth==='feature'?['project','feature']:['project','feature','file'];
  const nodes=networkActivityNodes(graph,graph.nodes.filter(n=>types.includes(n.type)),demo.activity);
  const marked=nodes.filter(n=>n.activity.length);
  assert.equal(marked.length,depth==='project'?2:4);
  assert.ok(marked.every(n=>n.type===depth));
  assert.equal(marked.reduce((sum,n)=>sum+n.activity.length,0),4);
  if(depth==='project')assert.equal(marked.find(n=>n.id.endsWith(':portal')).activity.length,3);
  assert.equal((renderNetwork({...graph,nodes}).match(/class="network-activity"/g)||[]).length,marked.length);
 }
});
test('unknown file stays on feature, hidden work stays hidden, and duplicate agent reports collapse',()=>{
 const graph=demo.network,work={...demo.activity[0],fileIds:[]};
 const nodes=networkActivityNodes(graph,graph.nodes,[work,work]);
 assert.equal(nodes.filter(n=>n.activity.length).length,1);
 assert.equal(nodes.find(n=>n.activity.length).type,'feature');
 assert.equal(nodes.find(n=>n.activity.length).activity.length,1);
 assert.ok(networkActivityNodes(graph,graph.nodes.filter(n=>n.projectId.endsWith(':analytics')),[work]).every(n=>!n.activity.length));
});
test('live activity requires working agent and unexpired execution lease',()=>{
 const now=Date.now(),state={agents:[{id:'a',name:'Dot 1',status:'working',activeFiles:['src/a.ts']}],tasks:[{id:'t',projectId:'p',lease:{actor:'a',until:new Date(now+1000).toISOString()}}]};
 assert.deepEqual(liveNetworkActivity(state,now)[0].filePaths,['src/a.ts']);
 assert.equal(liveNetworkActivity(state,now+2000).length,0);
 state.agents[0].status='offline';assert.equal(liveNetworkActivity(state,now).length,0);
});
