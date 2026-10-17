import test from 'node:test';
import assert from 'node:assert/strict';
import {networkLayout,networkEdgePath} from '../network-view.mjs';
import {NETWORK_ZOOM,clientToNetworkSvg,networkWorldPoint,zoomNetworkCamera,networkWheelFactor,fitNetworkCamera,createNetworkMotion,grabNetworkNode,dragNetworkNode,releaseNetworkNode,stepNetworkMotion,settleNetworkMotion,resetNetworkMotion} from '../network-motion.mjs';
const graph=()=>({nodes:[{type:'project',id:'p',projectId:'p',label:'Project'},{type:'project',id:'q',projectId:'q',label:'Other project'},...['a','b'].map(id=>({type:'task',id,projectId:'p',label:id})),{type:'task',id:'c',projectId:'q',label:'Other task'}],edges:[{id:'cross',type:'dependency',from:{type:'task',id:'a'},to:{type:'task',id:'c'}}]});
const model=()=>createNetworkMotion(networkLayout(graph()));
const close=(a,b,epsilon=1e-7)=>assert.ok(Math.abs(a-b)<epsilon,`${a} ≈ ${b}`);
function settle(m){let active=true,frames=0;while(active&&frames<1500){active=stepNetworkMotion(m,1/60);frames++;}assert.equal(active,false,'springs reach idle');return frames;}

test('SVG coordinates handle both letterbox directions, page offsets and camera inverse',()=>{
 const box={minX:-50,minY:-20,width:1200,height:780};
 for(const rect of [{left:80,top:125,width:600,height:600},{left:20,top:55,width:1400,height:390}]){
  const c=clientToNetworkSvg({x:rect.left+rect.width/2,y:rect.top+rect.height/2},rect,box);close(c.x,550);close(c.y,370);
  const scale=Math.min(rect.width/1200,rect.height/780),p=clientToNetworkSvg({x:rect.left+rect.width/2+70*scale,y:rect.top+rect.height/2-22*scale},rect,box);close(p.x,620);close(p.y,348);
  const world=networkWorldPoint(p,{x:20,y:-12,scale:2});close(world.x,300);close(world.y,180);
 }
});
test('cursor-anchored zoom retains the world point including useful zoom limits and wheel units',()=>{
 const cursor={x:147,y:221},camera={x:-20,y:19,scale:.9},before=networkWorldPoint(cursor,camera);
 for(const factor of [1.05,.91,1000,.00001]){const next=zoomNetworkCamera(camera,factor,cursor),after=networkWorldPoint(cursor,next);close(after.x,before.x);close(after.y,before.y);assert.ok(next.scale>=NETWORK_ZOOM.min&&next.scale<=NETWORK_ZOOM.max);}
 close(networkWheelFactor(1,1),networkWheelFactor(16,0));close(networkWheelFactor(.1,2,600),networkWheelFactor(60,0));assert.ok(networkWheelFactor(-1)>1);assert.equal(networkWheelFactor(NaN),1);assert.deepEqual(zoomNetworkCamera(camera,Infinity,cursor),camera);
});
test('project drag elastically pulls its own tasks, overshoots and settles; cross-project dependencies stay truthful',()=>{
 const g=graph(),snapshot=structuredClone(g),m=createNetworkMotion(networkLayout(g)),hub=m.byKey.get('project:p'),a=m.byKey.get('task:a'),other=m.byKey.get('task:c'),otherStart={x:other.x,y:other.y},start={x:hub.x,y:hub.y},ax=a.x;
 assert.equal(grabNetworkNode(m,'project:p'),true);dragNetworkNode(m,{x:start.x+260,y:start.y+90});assert.equal(a.x,ax,'followers lag behind direct drag');stepNetworkMotion(m,1/60);assert.ok(a.x>ax&&a.x<ax+260);
 releaseNetworkNode(m,{x:900,y:300});let overshoot=false;
 for(let i=0;i<180;i++){stepNetworkMotion(m,1/60);overshoot ||= hub.x>start.x+260.2;}
 assert.equal(overshoot,true);settle(m);close(hub.x,start.x+260);close(a.x,ax+260);close(other.x,otherStart.x);close(other.y,otherStart.y);assert.deepEqual(g,snapshot,'domain data stays unchanged');assert.deepEqual(m.edges,snapshot.edges);
});
test('task drag remains tethered, bounds extreme input, and settles without moving its project',()=>{
 const m=model(),task=m.byKey.get('task:a'),hub=m.byKey.get('project:p'),original={x:task.x,y:task.y},hubX=hub.x;
 grabNetworkNode(m,'task:a');dragNetworkNode(m,{x:1e12,y:-1e12});assert.ok(Math.hypot(task.x-original.x,task.y-original.y)<=1000.0001);releaseNetworkNode(m,{x:1e10,y:1e10});assert.ok(Math.hypot(task.vx,task.vy)<=260.0001);settle(m);close(task.x,original.x);close(task.y,original.y);close(hub.x,hubX);
});
test('deterministic bounded timesteps survive a suspended tab, invalid input and repeated extreme drags',()=>{
 const a=model(),b=model();for(const m of [a,b]){grabNetworkNode(m,'project:p');dragNetworkNode(m,{x:1000,y:900});releaseNetworkNode(m,{x:600,y:200});}
 stepNetworkMotion(a,60*60);stepNetworkMotion(b,.05);assert.deepEqual(a.nodes,b.nodes,'long pause clamps to 50ms');
 for(let i=0;i<300;i++){stepNetworkMotion(a,1/60);stepNetworkMotion(b,1/60);}assert.deepEqual(a.nodes,b.nodes);
 const snapshot=structuredClone(a.nodes);stepNetworkMotion(a,NaN);stepNetworkMotion(a,-1);assert.deepEqual(a.nodes,snapshot);
 for(let i=0;i<10;i++){grabNetworkNode(a,'project:p');dragNetworkNode(a,{x:i%2?1e12:-1e12,y:1e12});releaseNetworkNode(a,{x:Infinity,y:NaN});settle(a);}
 for(const n of a.nodes)for(const k of ['x','y','vx','vy'])assert.ok(Number.isFinite(n[k]));
});
test('cancellation, reduced motion and reset restore stable positions without autonomous motion',()=>{
 const m=model(),before=structuredClone(m.nodes),hub=m.byKey.get('project:p');grabNetworkNode(m,hub.key);dragNetworkNode(m,{x:hub.x+300,y:hub.y-80},true);const a=m.byKey.get('task:a');close(a.x,before.find(n=>n.key===a.key).x+300);releaseNetworkNode(m,{x:900,y:20},{reduced:true,cancel:true});assert.equal(stepNetworkMotion(m,1/60),false);
 for(let i=0;i<m.nodes.length;i++){close(m.nodes[i].x,before[i].x);close(m.nodes[i].y,before[i].y);}
 grabNetworkNode(m,'task:a');dragNetworkNode(m,{x:a.x+90,y:a.y},true);releaseNetworkNode(m,{x:800,y:0},{reduced:true});assert.equal(stepNetworkMotion(m,1/60),false);
 grabNetworkNode(m,hub.key);dragNetworkNode(m,{x:hub.x+200,y:hub.y});releaseNetworkNode(m);settleNetworkMotion(m);resetNetworkMotion(m);for(const n of m.nodes){close(n.x,n.originX);close(n.y,n.originY);}
});
test('fit frames moved positions; resize/reconciliation retains presentation and removes obsolete nodes',()=>{
 const m=model(),hub=m.byKey.get('project:p');grabNetworkNode(m,hub.key);dragNetworkNode(m,{x:hub.x+1800,y:hub.y-600});releaseNetworkNode(m);settleNetworkMotion(m);
 const camera=fitNetworkCamera(m.nodes,m.box);for(const n of m.nodes){const x=n.x*camera.scale+camera.x,y=n.y*camera.scale+camera.y;assert.ok(x>m.box.minX&&x<m.box.minX+m.box.width);assert.ok(y>m.box.minY&&y<m.box.minY+m.box.height);}
 const reconciled=createNetworkMotion(networkLayout(graph()),m);assert.deepEqual(reconciled.nodes,m.nodes);const next=graph();next.nodes=next.nodes.filter(n=>n.id!=='b');const filtered=createNetworkMotion(networkLayout(next),m);assert.equal(filtered.byKey.has('task:b'),false);assert.equal(filtered.byKey.get(hub.key).x,hub.x);
 assert.deepEqual(fitNetworkCamera([],m.box),{x:0,y:0,scale:1});
});
test('large graph spring cost is linear in nodes and all live edge paths remain finite',()=>{
 const g=graph();for(let i=0;i<551;i++)g.nodes.push({type:'task',id:'big'+i,projectId:'p',label:'Task'});const m=createNetworkMotion(networkLayout(g));grabNetworkNode(m,'project:p');dragNetworkNode(m,{x:2000,y:500});releaseNetworkNode(m);settle(m);
 for(const n of m.nodes)assert.ok(Number.isFinite(n.x)&&Number.isFinite(n.y));const e=m.edges[0],a=m.byKey.get('task:a'),b=m.byKey.get('task:c');assert.doesNotMatch(networkEdgePath(a,b,e),/NaN|Infinity/);assert.doesNotMatch(networkEdgePath(a,a,e),/NaN|Infinity/);
});
