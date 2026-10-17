import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseHTML } from 'linkedom';
import { openSqlite } from '../backend/sqlite-local.mjs';
import { applyMigrations } from '../backend/migrations-local.mjs';
import { createHandler } from '../backend/http.mjs';
import { ControlStore } from '../backend/control.mjs';

// DOM interaction tests exercise the shipped UI against the real API and SQLite.
// They do not claim visual/layout or browser-engine verification.
test('UI: task creation, plan revision/rejection/approval, graph navigation, agent journal and disconnected chat persistence',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'relay-dom-')),db=openSqlite(join(dir,'relay.sqlite'));await applyMigrations(db);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const {document,window}=parseHTML(readFileSync('control.html','utf8'));const handle=createHandler({authenticate:()=> 'dom-owner'});let fetchCount=0;
  const dialog=document.querySelector('#detail');dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
  window.HTMLInputElement.prototype.setSelectionRange=function(){};
  // Linkedom lacks FormData and form reset; provide the standard control serialization.
  class DomFormData{constructor(form){this.entries=[];for(const el of form.querySelectorAll('input,textarea,select')){if(!el.name||el.disabled)continue;if(el.type==='checkbox'){if(el.checked)this.entries.push([el.name,el.value||'on']);}else if(el.localName==='select'){const options=[...el.querySelectorAll('option')];let chosen=options.filter(o=>o.hasAttribute('selected'));if(!chosen.length&&!el.hasAttribute('multiple'))chosen=options.slice(0,1);for(const o of chosen)this.entries.push([el.name,o.value]);}else this.entries.push([el.name,el.value||'']);}}[Symbol.iterator](){return this.entries[Symbol.iterator]();}getAll(name){return this.entries.filter(([k])=>k===name).map(([,v])=>v);}}
  document.addEventListener('submit',e=>{const form=e.target;form.reset=()=>{for(const x of form.querySelectorAll('input,textarea'))x.value='';};},true);
  const sent=[];const storage=new Map();const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))};
  const context=vm.createContext({document,window,localStorage,location:{hash:'#tasks'},crypto,URL,Blob,structuredClone,FormData:DomFormData,MouseEvent:window.Event,Date,console,setTimeout:()=>0,setInterval:()=>0,
    fetch:async(path,options={})=>{fetchCount++;if(path.endsWith('/command'))sent.push(JSON.parse(options.body));return handle(new Request(`https://relay.test${path}`,{...options,headers:{...options.headers,origin:'https://relay.test'}}),{DB:db});}});
  await vm.runInContext(`(async()=>{${['adapters/voice-dictation-contract.mjs','site-editor.mjs','inline-composer.mjs','network-demo.mjs','network-view.mjs','network-motion.mjs','network-interactions.mjs','network-transition.mjs'].map(p=>readFileSync(p,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n')}
const TASK_DAG_DEMO={tasks:[],mainTaskId:null};
const taskDagModel=()=>({});
const taskDagMarkup=()=>'<section class="task-dag-host"></section>';
const captureTaskDagOrigins=()=>new Map();
const primeTaskDag=()=>Promise.resolve();
const mountTaskDag=()=>({hasNode:()=>false,capture:()=>new Map(),dispose:()=>{},select:()=>{}});
${readFileSync('control-app.mjs','utf8').replace(/^import .*;\r?\n/gm,'')}\n})()`,context);
  const settle=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}throw new Error(`UI did not settle: ${document.querySelector('#notice').textContent}`);};
  const action=(name,extra='')=>document.querySelector(`[data-action="${name}"]${extra}`);
  const click=async el=>{assert.ok(el,'Element exists');el.dispatchEvent(new window.Event('click',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));};
  const fill=(name,value)=>{const el=dialog.querySelector(`[name="${name}"]`);assert.ok(el,`Field ${name}`);el.value=value;};
  const submit=async form=>{form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setImmediate(resolve));};
  assert.equal(document.querySelector('h1').textContent,'Tasks');assert.match(document.body.textContent,/0 working/);
  await click(action('new-task'));fill('title','DOM verified task');fill('description','End-to-end persisted task');fill('component','src/dom.js');await submit(dialog.querySelector('form'));await settle(()=>dialog.textContent.includes('DOM verified task')&&dialog.textContent.includes('Agent read'));
  const state=async()=>await(await handle(new Request('https://relay.test/api/control/state'),{DB:db})).json();const id=(await state()).tasks[0].id;
  await click(action('task-tab','[data-tab="plan"]'));await click(action('plan-form'));fill('research','Inspected src/dom.js');fill('files','src/dom.js | Task implementation');fill('steps','Implement feature and test it');fill('acceptance','Behavior verified');fill('risks','No external integrations');await submit(dialog.querySelector('form'));await settle(()=>!!action('submit-plan'));
  const control=new ControlStore(db);
  const other=async(actor,command)=>{const s=await control.read(),t=s.tasks.find(t=>t.id===command.taskId),p=s.projects.find(p=>p.id===(t?.projectId||command.projectId));return control.command(actor==='human'?{kind:'human',subject:'dom-owner'}:{kind:'agent',actor,subject:actor},{epoch:s.meta.epoch,operationId:crypto.randomUUID(),...(t?{expectedVersion:t.version}:{}),...(['claim_project','reassign_project'].includes(command.type)?{expectedProjectVersion:p.version}:{}),command:{...(p?{projectFence:p.ownershipFence}:{}),...(t?.lease?{fence:t.fence}:{}),...command}});};
  await click(action('submit-plan'));await settle(()=>!!action('approve-plan'));
  const oldPlanVersion=(await state()).tasks[0].version;
  await other('human',{type:'save_plan',taskId:id,research:'NEW research from another session',files:[{path:'new.js',reason:'New scope evidence'}],steps:'New plan unseen by first session',acceptance:'New acceptance'});
  await other('human',{type:'submit_plan',taskId:id});
  await click(action('approve-plan'));await settle(()=>!!action('reload-review'));
  assert.match(dialog.textContent,/Inspected src\/dom.js/);assert.doesNotMatch(dialog.textContent,/NEW research from another session/);
  assert.equal(sent.at(-1).command.planRevision,1);assert.equal(sent.at(-1).expectedVersion,oldPlanVersion);
  const planRequestCount=sent.length;await click(action('approve-plan'));assert.equal(sent.length,planRequestCount);assert.equal((await state()).tasks[0].stage,'plan_review');
  await click(action('reload-review'));assert.match(dialog.textContent,/NEW research from another session/);
  await click(action('decision-form','[data-type="request_plan_changes"]'));fill('reason','Add error handling');await submit(dialog.querySelector('form'));await settle(()=>!!action('plan-form'));
  assert.equal((await state()).tasks[0].stage,'research');await click(action('submit-plan'));await settle(()=>!!action('approve-plan'));await click(action('approve-plan'));await settle(()=>dialog.textContent.includes('Approved scope'));
  assert.equal((await state()).tasks[0].stage,'build');assert.ok((await state()).tasks[0].planApproval);
  // Reach final review with real reducer operations, then replace build evidence
  // in another session while the first session displays the old build.
  await other('forge',{type:'claim_project',projectId:'relay'});
  const build=async revision=>{await other('forge',{type:'claim',taskId:id});await other('forge',{type:'save_evidence',taskId:id,revision,artifacts:[{path:'dom.js',summary:revision}],passed:3,failed:0,commands:'node --test',output:revision,summary:revision});await other('forge',{type:'submit_build',taskId:id});};
  await build('old-build');await click(action('refresh'));await click(action('task-tab','[data-tab="build"]'));assert.match(dialog.textContent,/old-build/);
  const oldBuildVersion=(await state()).tasks[0].version;
  await other('human',{type:'request_build_changes',taskId:id,reason:'Replace build'});await build('new-build');
  await click(action('approve-final'));await settle(()=>!!action('reload-review'));assert.match(dialog.textContent,/old-build/);assert.doesNotMatch(dialog.textContent,/new-build/);assert.equal(sent.at(-1).command.buildRevision,1);assert.equal(sent.at(-1).expectedVersion,oldBuildVersion);
  const buildRequestCount=sent.length;await click(action('approve-final'));assert.equal(sent.length,buildRequestCount);assert.equal((await state()).tasks[0].stage,'human_review');
  await click(action('reload-review'));assert.match(dialog.textContent,/new-build/);await click(action('approve-final'));await settle(()=>dialog.textContent.includes('Approved build 2'));assert.equal((await state()).tasks[0].stage,'ready');
  // Edit forms retain their displayed task version and cannot overwrite a
  // concurrent scope edit by submitting again after the first 409.
  await click(action('task-tab','[data-tab="overview"]'));await click(action('edit-task'));fill('description','Old form draft');
  const existing=(await state()).tasks[0];await other('human',{type:'edit_task',taskId:id,input:{...existing,description:'NEW description from another session'}});
  await submit(dialog.querySelector('form'));await settle(()=>!!action('reload-review'));const editRequestCount=sent.length;await submit(dialog.querySelector('form'));assert.equal(sent.length,editRequestCount);assert.equal((await state()).tasks[0].description,'NEW description from another session');await click(action('reload-review'));assert.match(dialog.textContent,/NEW description from another session/);
  await click(action('close'));await click(action('nav','[data-view="agents"]'));assert.match(document.querySelector('main').textContent,/Not connected/);assert.match(document.querySelector('main').textContent,/No recorded activity/);
  // The project network intentionally maps projects, features, and recorded
  // files; task records remain in Tasks. Exercise a real project focus and
  // detail path instead of expecting a task dot in this graph.
  await click(action('nav','[data-view="portfolio"]'));await click(document.querySelector('.network-node[data-type="project"][data-id="relay"]'));await settle(()=>!!action('network-details','[data-type="project"][data-id="relay"]'));await click(action('network-details','[data-type="project"][data-id="relay"]'));assert.match(dialog.textContent,/Workspace/);await click(action('close'));assert.equal(document.querySelector('[data-action="graph-mode"]'),null);
  const chat=document.querySelector('[data-form="network-message"]'),composer=chat.querySelector('#network-message');composer.textContent='<script>unsafe()</script> Review overall system';composer.dispatchEvent(new window.Event('input',{bubbles:true}));await submit(chat);await settle(()=>document.querySelector('.chat-log').textContent.includes('<script>unsafe()</script>'));
  assert.equal(document.querySelectorAll('.chat-log script').length,0);assert.match(document.querySelector('.awaiting').textContent,/awaiting an agent/);const stored=await state();assert.equal(stored.messages.length,1);assert.equal(stored.jobs[0].status,'queued');assert.equal(stored.jobs[0].output,undefined);
  await click(document.querySelector('.network-node[data-type="project"][data-id="relay"]'));await click(action('project-detail','[data-id="relay"]'));await click(action('project-assignment'));fill('reason','Old assignment draft');
  const oldProjectVersion=(await state()).projects[0].version;await other('human',{type:'reassign_project',projectId:'relay',target:'flux',reason:'Changed in another session'});
  await submit(dialog.querySelector('form'));await settle(()=>!!action('reload-project'));assert.equal(sent.at(-1).expectedProjectVersion,oldProjectVersion);const assignmentRequests=sent.length;await submit(dialog.querySelector('form'));assert.equal(sent.length,assignmentRequests);await click(action('reload-project'));assert.match(dialog.textContent,/Dot 4/);await click(action('close'));
  await click(action('nav','[data-view="integrations"]'));assert.match(document.querySelector('main').textContent,/Notification outbox/);assert.match(document.querySelector('main').textContent,/pending/);
});
