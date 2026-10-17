import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {initialControl,controlProjection,controlPrincipal} from '../backend/control.mjs';
import {NETWORK_DEMO,hasDemoCommandTarget,renderDemoReference} from '../network-demo.mjs';
import {renderNetwork,networkPicker} from '../network-view.mjs';

async function demoPage({search='?network=demo',empty=false}={}){
 const raw=initialControl('owner',null,1900000000000),data=controlProjection(raw,controlPrincipal(raw,{kind:'human',subject:'owner'}),1900000000000,[]);
 if(empty){data.network={nodes:[],edges:[]};data.tasks=[];data.projects=[];}
 const original=JSON.stringify(data),posts=[],gets=[];
 const {document,window}=parseHTML(readFileSync('control.html','utf8'));
 const query=document.querySelector.bind(document);document.querySelector=q=>q.includes(':focus')?null:query(q);
 window.HTMLElement.prototype.focus=function(){};window.SVGElement.prototype.focus=function(){};
 const dialog=document.querySelector('dialog');dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return [...this.querySelectorAll('option')].find(o=>o.hasAttribute('selected'))?.value||this.querySelector('option')?.value||'';},set(v){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===v);}});
 window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 window.SVGElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:1200,height:780});
 class Data{constructor(form){this.values=[...form.querySelectorAll('input,textarea,select')].filter(el=>el.name).map(el=>[el.name,el.value]);}[Symbol.iterator](){return this.values[Symbol.iterator]();}}
 const context=vm.createContext({document,window,location:{hash:'#portfolio',search,href:`https://relay.local/${search}#portfolio`},crypto,structuredClone,URL,Blob,Date,FormData:Data,MouseEvent:window.Event,setTimeout:()=>0,setInterval:()=>0,console,fetch:async(path,options={})=>{if(options.method==='POST')posts.push(JSON.parse(options.body));else gets.push(path);return new Response(JSON.stringify(structuredClone(data)));}});
 const modules=['network-demo.mjs','network-view.mjs','network-motion.mjs','network-interactions.mjs','control-app.mjs'].map(p=>readFileSync(p,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
 await vm.runInContext(`(async()=>{${modules}\n})()`,context);
 const tick=()=>new Promise(r=>setImmediate(r)),event=(el,type)=>{assert.ok(el,`Target for ${type}`);el.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}));},click=async el=>{event(el,'click');await tick();};
 return{document,dialog,data,original,posts,gets,event,click,tick,q:s=>document.querySelector(s)};
}

test('fictional fixture has 6 projects, 30 tasks and 42 meaningful valid connections',()=>{
 const {projects,tasks,network}=NETWORK_DEMO;
 assert.equal(projects.length,6);assert.equal(tasks.length,30);assert.equal(network.edges.length,42);
 assert.ok(Object.isFrozen(NETWORK_DEMO));assert.ok(Object.isFrozen(network.nodes[0]));
 const keys=new Set(network.nodes.map(n=>`${n.type}:${n.id}`));assert.equal(keys.size,36);
 assert.equal(new Set(network.edges.map(e=>e.id)).size,42);
 assert.equal(new Set(network.edges.map(e=>e.impact)).size,42);
 assert.ok(new Set(tasks.map(t=>t.stage)).size>=6);
 for(const e of network.edges){assert.ok(e.synthetic);assert.ok(keys.has(`${e.from.type}:${e.from.id}`));assert.ok(keys.has(`${e.to.type}:${e.to.id}`));assert.ok(e.rationale.length>50);assert.ok(e.impact.length>50);assert.ok(e.summary.includes(e.from.label));assert.ok(e.summary.includes(e.to.label));}
 assert.ok(network.edges.some(e=>e.type==='shared'&&network.nodes.find(n=>n.id===e.from.id).projectId!==network.nodes.find(n=>n.id===e.to.id).projectId));
 for(const t of tasks){assert.ok(t.synthetic);assert.equal(t.owner,null);assert.ok(t.plan.files.length>=2);assert.ok(t.acceptance.length>40);if(t.evidence)assert.match(t.evidence.summary,/No build or test was executed/);}
});

test('all 78 selectable dots and connectors render full labeled details and valid navigation',()=>{
 const graph=NETWORK_DEMO.network,svg=renderNetwork(graph),{document}=parseHTML(`<main>${svg}<select>${networkPicker(graph)}</select></main>`);
 assert.equal(document.querySelectorAll('.network-node').length,36);assert.equal(document.querySelectorAll('.network-link').length,42);assert.equal(document.querySelectorAll('option').length,79);
 assert.doesNotMatch(svg,/NaN|Infinity|undefined/);
 for(const ref of [...graph.nodes.map(n=>({type:n.type,id:n.id})),...graph.edges.map(e=>({type:'relationship',id:e.id}))]){
  const detail=renderDemoReference(ref);assert.ok(detail?.title);assert.match(detail.html,/Fictional data/);assert.match(detail.html,/Reference in demo chat/);
  const doc=parseHTML(detail.html).document;assert.equal(doc.querySelectorAll('form,[data-mutate]').length,0);
  for(const b of doc.querySelectorAll('[data-action="network-node"]'))assert.ok(renderDemoReference({type:b.dataset.type,id:b.dataset.id}));
  if(ref.type==='relationship'){assert.match(detail.html,/Why this connection exists/);assert.match(detail.html,/Impact/);}else if(ref.type==='task'){assert.match(detail.html,/Affected files/);assert.match(detail.html,/Acceptance condition/);}
 }
 mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/v12-demo-network.svg',svg);
});

test('demo UI opens every dot and connector, isolates drafts, and cannot send or mutate real work',async()=>{
 const p=await demoPage(),{q}=p;
 assert.match(q('h1').textContent,/Demo/);assert.equal(q('[data-action="new-project"]'),null);assert.equal(q('[data-action="network-connect"]'),null);
 assert.equal(q('.network-composer button[type="submit"]').disabled,true);
 for(const el of [...p.document.querySelectorAll('.network-node,.network-link')]){await p.click(el);assert.equal(p.dialog.open,true);assert.match(p.dialog.textContent,/Fictional data/);assert.ok(p.dialog.querySelector('[data-action="network-reference-add"]'));await p.click(p.dialog.querySelector('[data-action="close"]'));}
 await p.click(q('.network-link[data-id="demo:edge:link:1"]'));
 await p.click(p.dialog.querySelector('[data-action="network-node"]'));assert.match(p.dialog.textContent,/Account identity model/);
 await p.click(p.dialog.querySelector('[data-action="network-reference-add"]'));
 assert.match(q('.draft-references').textContent,/Account identity model/);
 q('#network-message').value='Keep this fictional reference local';p.event(q('#network-message'),'input');p.event(q('[data-form="network-message"]'),'submit');await p.tick();
 assert.equal(p.posts.length,0);assert.match(q('#notice').textContent,/Nothing was sent or queued/);
 await p.click(q('[data-action="network-data-mode"][data-mode="real"]'));
 assert.doesNotMatch(q('h1').textContent,/Demo/);assert.equal(q('.draft-references').textContent,'');assert.equal(q('#network-message').value,'');assert.ok(q('[data-action="new-project"]'));
 q('#network-message').value='Real message without sample references';p.event(q('#network-message'),'input');p.event(q('[data-form="network-message"]'),'submit');await p.tick();
 assert.equal(p.posts.length,1);assert.deepEqual(p.posts[0].command.references,[]);assert.equal(p.posts[0].command.projectId,null);
 await p.click(q('[data-action="network-data-mode"][data-mode="demo"]'));assert.equal(q('#network-message').value,'Keep this fictional reference local');assert.match(q('.draft-references').textContent,/Account identity model/);
 assert.equal(JSON.stringify(p.data),p.original);assert.ok(p.gets.every(path=>path==='/api/control/state'));
});

test('mode defaults honor real work, show demo on empty graph, and allow explicit empty real view',async()=>{
 const existing=await demoPage({search:''});assert.doesNotMatch(existing.q('h1').textContent,/Demo/);assert.ok(existing.q('[data-action="network-data-mode"][data-mode="demo"]'));
 const empty=await demoPage({search:'',empty:true});assert.match(empty.q('h1').textContent,/Demo/);assert.equal(empty.document.querySelectorAll('.network-node').length,36);
 const real=await demoPage({search:'?network=real',empty:true});assert.equal(real.document.querySelectorAll('.network-node').length,0);assert.doesNotMatch(real.q('h1').textContent,/Demo/);
 assert.equal(existing.posts.length+empty.posts.length+real.posts.length,0);
});

test('demo IDs are blocked in every supported mutation target and never mistaken for real IDs',()=>{
 for(const key of ['taskId','projectId','relationshipId'])assert.ok(hasDemoCommandTarget({[key]:'demo:task:accounts'}));
 assert.ok(hasDemoCommandTarget({references:[{type:'task',id:'demo:task:accounts'}]}));
 assert.ok(hasDemoCommandTarget({from:{id:'demo:project:crm'}}));assert.ok(hasDemoCommandTarget({to:{id:'demo:task:accounts'}}));
 assert.equal(hasDemoCommandTarget({text:'Demo: useful explanation',taskId:'real-task',references:[{id:'real-edge'}]}),false);
});
