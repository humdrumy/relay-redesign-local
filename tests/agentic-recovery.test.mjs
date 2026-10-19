import test from 'node:test';
import assert from 'node:assert/strict';
import {initialControl,reduceControl,controlPrincipal,controlProjection} from '../backend/control.mjs';
import {taskAuthority} from '../backend/team-planning.mjs';

test('Agentic policy follows authorized scope edits and human task recovery without peer gates',()=>{
 const human={kind:'human',subject:'owner'},dot={kind:'agent',actor:'dot',subject:'dot'},scout={kind:'agent',actor:'scout',subject:'scout'};
 const now=1900000000000;let state=initialControl('owner',null,now),id;
 const run=(identity,command)=>{const t=state.tasks.find(x=>x.id===command.taskId),authority=t&&taskAuthority(state,t);const next=reduceControl(state,controlPrincipal(state,identity),{epoch:state.meta.epoch,operationId:crypto.randomUUID(),...(t?{expectedVersion:t.version}:{}),command:{...authority?{projectFence:authority.ownershipFence}:{},...t?{fence:t.fence}:{},...command}},now,null,identity,true);state=next.state;return next.result;};
 id=run(human,{type:'create_task',input:{title:'Personal recovery',executionMode:'agentic'}}).taskId;
 run(dot,{type:'claim',taskId:id});run(dot,{type:'edit_task',taskId:id,input:{title:'Revised personal scope',description:'Owner refined research'}});
 const plan={research:'Inspected source',files:[{path:'app.js',reason:'Fix'}],steps:'Patch and test',acceptance:'Tests pass'};
 run(dot,{type:'claim',taskId:id});run(dot,{type:'save_plan',taskId:id,...plan});run(dot,{type:'submit_plan',taskId:id});
 run(human,{type:'team_reassign',taskId:id,target:'scout',reason:'Dot unavailable'});
 const task=state.tasks.find(x=>x.id===id),policy=state.executionPolicies.find(x=>x.id===id);
 assert.equal(policy.mode,'agentic');assert.equal(policy.projectOwner,'scout');assert.equal(policy.projectFence,task.team.fence);assert.equal(policy.scopeRevision,task.scopeRevision);
 run(scout,{type:'agentic_advance',taskId:id,expectedPolicyRevision:policy.executionPolicyRevision,expectedOwnerGrantRevision:policy.ownerGrantRevision,scopeRevision:task.scopeRevision,planRevision:task.planRevision});
 assert.equal(state.tasks.find(x=>x.id===id).stage,'build');assert.equal(controlProjection(state,controlPrincipal(state,scout),now,[]).tasks[0].executionPolicy.mode,'agentic');
});
