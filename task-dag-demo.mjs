// Isolated, browser-only demonstration. Never merged into workspace state.
const specs=[
 ['requirements','Define invitation requirements','ready',[],0,'Describe the fictional invitation journey, account boundaries, expiry behavior and acceptance conditions.'],
 ['contract','Define the invitation data contract','ready',['requirements'],1,'Translate the sample requirements into invitation fields, API payloads and error states.'],
 ['service','Build the invitation API','build',['contract'],2,'Use the recorded sample data contract to implement invitation issuance and redemption endpoints.'],
 ['screen','Build the acceptance screen','plan_review',['requirements','contract'],3,'Use the journey requirements and API contract to build the sample acceptance form and accessible error states.'],
 ['flow','Integrate invitation onboarding','intake',['service','screen'],4,'Merge the API and screen branches into one fictional end-to-end onboarding journey. Open this main task to see all seven connected cards.'],
 ['validation','Validate the connected journey','intake',['flow','contract'],5,'Check the integrated sample journey against the explicit data contract and its expiry/error conditions. No validation was actually run.'],
 ['release','Prepare the release review','intake',['validation'],6,'Collect the fictional validation evidence for human release review. This sample does not approve or deploy anything.']
];
// These are presentation fixtures, never execution evidence or connected agents.
const details={
 requirements:{
  component:'Product requirements',research:'The fictional journey starts with an administrator invitation and ends with one workspace membership. New and existing accounts need distinct sign-in paths.',
  files:[['docs/invitations/requirements.md','Record actors, permissions and acceptance rules.'],['docs/invitations/journeys.md','Describe new-account and existing-account journeys.']],
  steps:'1. Define administrator and recipient permissions.\n2. Specify 72-hour expiry and single-use acceptance.\n3. Agree on duplicate, revoked and expired invitation behavior.',
  acceptance:'Acceptance creates at most one membership. Expired and revoked links explain the next step without exposing workspace information.',risks:'Ambiguous duplicate behavior could cause repeated memberships or emails.',
  update:'The fictional requirements and journeys are approved; the contract and screen can use these boundaries.',
  evidence:'Fictional requirements and journey documents are complete.',checks:'6 illustrative cases: permissions, new account, existing account, expiry, revocation and duplicate acceptance.',passed:6
 },
 contract:{
  component:'Data contract',research:'The sample requirements need a hashed token, expiry, recipient email and workspace ID. Token consumption and membership creation must be atomic.',
  files:[['src/invitations/contract.ts','Define issue, preview and accept payloads.'],['db/migrations/014_invitations.sql','Specify token and membership uniqueness constraints.']],
  steps:'1. Define payload schemas.\n2. Name expiry, revocation, used-token and email-mismatch errors.\n3. Record atomic token-consumption constraints.',
  acceptance:'The API and screen share fields and error codes. Tokens are stored hashed; replay cannot create a second membership.',risks:'Error responses must not disclose recipient or workspace data before authorization.',
  update:'The fictional contract is approved for the API and screen branches.',
  evidence:'Fictional contract schema and migration are attached.',checks:'8 illustrative contract cases: issue, preview, accept, expiry, revocation, used token, email mismatch and membership uniqueness.',passed:8
 },
 service:{
  stage:'human_review',component:'Invitation API',research:'The approved fictional contract defines three endpoints and one redemption transaction. Check authenticated identity before creating membership.',
  files:[['src/api/invitations.ts','Implement issue, preview and accept routes.'],['src/invitations/repository.ts','Consume tokens and create membership atomically.'],['tests/invitations-api.test.ts','Cover authorization, expiry and concurrent redemption.']],
  steps:'1. Validate requests with the shared contract.\n2. Implement hashing and expiry checks.\n3. Add atomic redemption and replay handling.\n4. Attach evidence for human review.',
  acceptance:'Unauthorized issuance is rejected. Concurrent acceptance creates one membership. Expired and revoked links return contracted errors.',risks:'Token consumption must not succeed without the associated membership write.',
  update:'Sample API evidence awaits final human approval. Integration cannot execute yet.',
  evidence:'Fictional API changes and passing example results are ready for human review. Final approval is still pending.',checks:'12 illustrative API cases, including unauthorized issue, expiry, revocation, email mismatch and concurrent redemption.',passed:12
 },
 screen:{
  component:'Acceptance interface',research:'The fictional requirements describe two account paths. Use the contract error codes for actionable messages and announce status changes accessibly.',
  files:[['src/pages/AcceptInvitation.tsx','Render preview, sign-in and acceptance states.'],['src/components/InvitationStatus.tsx','Announce pending, success and error states.'],['tests/accept-invitation.spec.ts','Describe keyboard and expired-link scenarios.']],
  steps:'1. Preview permitted invitation details.\n2. Add sign-in and acceptance states.\n3. Map contract errors to messages.\n4. After plan approval, verify keyboard and status announcements.',
  acceptance:'Recipients can accept with a keyboard, retry recoverable errors and request a replacement link. Pending requests prevent duplicate submissions.',risks:'Sign-in redirects must retain invitation context without leaking the token.',
  update:'The sample screen plan is awaiting human approval; implementation has not started.'
 },
 flow:{
  stage:'build',component:'Onboarding integration',research:'The fictional API is at final review and the screen is at plan review. This integration plan is approved, but execution must wait for both prerequisites.',
  files:[['src/onboarding/invitation-flow.ts','Connect preview, authentication, acceptance and navigation.'],['src/routes.ts','Preserve invitation context across sign-in.'],['tests/invitation-journey.spec.ts','Cover both connected account journeys.']],
  steps:'1. Wait for final approval of the API and screen.\n2. Connect screen actions to the API.\n3. Preserve context across authentication.\n4. Record end-to-end results for review.',
  acceptance:'A recipient reaches the invited workspace after one acceptance. Refresh and repeated clicks preserve a single membership.',risks:'Both dependency gates must clear before building. Redirects must not expose invitation tokens.',
  update:'The sample plan is approved, but build execution is waiting on the API and screen. No build evidence exists.'
 },
 validation:{
  stage:'research',component:'Journey validation',research:'The approved fictional contract supplies expected outcomes. The integrated flow is still pending; draft a scenario matrix without claiming results.',
  files:[['tests/invitation-journey.spec.ts','Cover account paths, redirects and replay.'],['tests/invitation-accessibility.spec.ts','Cover keyboard navigation and announcements.'],['docs/invitations/validation.md','Record scenarios and eventual raw results.']],
  steps:'1. Review the contract.\n2. Draft scenarios and fixtures.\n3. Submit the plan for human approval.\n4. Once approved and dependencies are ready, execute and record results.',
  acceptance:'Each contract error has an expected journey outcome. Evidence identifies a source revision and includes raw results for both account paths.',risks:'Happy-path-only checks could miss replay and authentication state changes.',
  update:'The fictional validation plan is a research draft. No validation has run.'
 },
 release:{
  stage:'research',component:'Release preparation',research:'The fictional review packet must reference a validated revision and retain a separate human readiness decision. Validation is pending, so this is a draft.',
  files:[['docs/invitations/release-review.md','Collect scope, source revision and evidence links.'],['docs/invitations/rollout.md','Describe rollout ownership, observations and rollback criteria.']],
  steps:'1. Draft the review packet.\n2. Submit this plan for approval.\n3. Wait for approved validation evidence.\n4. Complete the packet and request final human approval; do not deploy.',
  acceptance:'Every claim traces to the approved validation revision. The rollout owner and rollback criteria are named. Readiness remains separate from deployment.',risks:'Stale evidence could describe a different source revision than the one under review.',
  update:'The fictional release packet is a research draft, without build evidence, final approval or deployment.'
 }
};
const owner='demo:dag:dot-1',human='demo:dag:human',projectId='demo:dag-project',events=[],messages=[];
const tasks=specs.map(([key,title,initialStage,dependencies,day,description])=>{
 const d=details[key],stage=d.stage||initialStage,id=`demo:dag:${key}`,at=hour=>`2026-10-${String(1+day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00.000Z`;
 const approved=['build','human_review','ready'].includes(stage),stamp={scope:1,plan:1,build:d.evidence?1:0};
 const plan={research:d.research,files:d.files.map(([path,reason])=>({path,reason})),steps:d.steps,acceptance:d.acceptance,risks:d.risks,author:owner,at:at(13)};
 const evidence=d.evidence?{...stamp,revision:`fictional-${key}-revision-1`,summary:d.evidence+' All outputs below are fictional; no commands were executed.',author:owner,at:at(15),artifacts:plan.files.map(f=>({path:f.path,summary:`Fictional artifact: ${f.reason}`})),tests:{passed:d.passed,failed:0,commands:`# FICTIONAL EXAMPLE — NOT EXECUTED\nnpm run test:invitation-${key}`,output:`FICTIONAL DEMO OUTPUT — NO TESTS RAN\n${d.checks}`}}:null;
 const addEvent=(hour,actor,summary)=>events.push({id:`${id}:event:${hour}`,taskId:id,actor,at:at(hour),summary,synthetic:true});
 addEvent(12,human,`Fictional task created: ${title}.`);
 addEvent(13,owner,'Sample task acknowledged; affected files researched and plan revision 1 recorded.');
 if(approved||stage==='plan_review')addEvent(14,approved?human:owner,approved?'Fictional human approved scope 1 / plan 1. Dependency gates still apply.':'Sample plan submitted for human approval.');
 if(evidence)addEvent(15,owner,'Fictional build evidence attached with illustrative output; no commands actually ran.');
 if(stage==='ready')addEvent(16,human,'Fictional human approved build 1 for readiness. Nothing was deployed.');
 if(stage==='human_review')addEvent(16,owner,'Sample build submitted for final human review. Approval is pending.');
 addEvent(17,owner,d.update);
 messages.push({id:`${id}:message:1`,room:`task:${id}`,projectId,actor:human,kind:'human',at:at(12),text:`Fictional briefing: ${description}`,receipts:[{actor:owner,at:at(13)}]},
 {id:`${id}:message:2`,room:`task:${id}`,projectId,actor:owner,kind:'ai',at:at(17),text:`Fictional status update: ${d.update}`,receipts:[]});
 return{id,title,stage,dependencies:dependencies.map(id=>`demo:dag:${id}`),description,projectId,type:'Task',priority:key==='flow'?'High':'Normal',component:d.component,environment:'Fictional development',synthetic:true,owner,builder:evidence?owner:null,version:7,scopeRevision:1,planRevision:1,buildRevision:stamp.build,plan,evidence,review:null,planApproval:approved?{scope:1,plan:1,build:0,actor:human,at:at(14),note:'Sample plan approval. Scope is limited to the recorded plan; prerequisite approvals are still required.'}:null,finalApproval:stage==='ready'?{...stamp,actor:human,at:at(16),note:'Fictional readiness approval; not deployed.'}:null,readReceipts:[{actor:owner,at:at(13)}],lease:null,fence:0,blocker:null,createdAt:at(12),updatedAt:at(17)};
});
export const TASK_DAG_DEMO={readOnly:true,mainTaskId:'demo:dag:flow',tasks,events,messages,jobs:[],
 projects:[{id:projectId,name:'Invitation onboarding (fictional)',owner,status:'active'}],
 agents:[{id:owner,name:'Dot 1 (fictional)',status:'disconnected'}],actors:[{id:human,name:'Demo reviewer (fictional)'}],
 features:[{id:'demo:dag-feature',name:'Invitation onboarding',taskIds:tasks.map(t=>t.id)}]};
