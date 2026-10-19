import { RelayError } from './core.mjs';

const fail=(code,message,status=403)=>{throw new RelayError(code,message,status);};
const clip=(value,length)=>typeof value==='string'?value.slice(0,length):'';
const taskView=(task,project)=>({
  id:task.id,version:task.version,title:clip(task.title,160),description:clip(task.description,1500),stage:task.stage,
  owner:project?.owner??null,blocker:clip(task.blocker,800)||null,
  updatedAt:task.updatedAt||null,project:project?{id:project.id,name:clip(project.name,160)}:null,
  plan:task.plan?{research:clip(task.plan.research,1200),steps:clip(task.plan.steps,1800),acceptance:clip(task.plan.acceptance,1000),at:task.plan.at||null}:null,
  planApproval:task.planApproval?{actor:task.planApproval.actor,at:task.planApproval.at,note:clip(task.planApproval.note,400)}:null,
  evidence:task.evidence?{revision:clip(task.evidence.revision,200),summary:clip(task.evidence.summary,1200),tests:task.evidence.tests?{passed:task.evidence.tests.passed,failed:task.evidence.tests.failed}:null,at:task.evidence.at||null}:null,
  finalApproval:task.finalApproval?{actor:task.finalApproval.actor,at:task.finalApproval.at,note:clip(task.finalApproval.note,400)}:null
});

export function lunaContext(state,jobId,fence,now){
  if(!jobId||!Number.isSafeInteger(fence)||fence<1)fail('INVALID_CONTEXT','Supply one jobId and a positive lease fence.',400);
  const job=state.jobs.find(item=>item.id===jobId);
  const parent=state.messages.find(item=>item.id===job?.context?.messageId);
  const projectId=job?.context?.projectId||null;
  const project=projectId?state.projects.find(item=>item.id===projectId):null;
  if(!job||job.type!=='conversation'||job.context?.taskId||!parent||parent.actor!=='human'||!['admin','general'].includes(parent.room)||parent.projectId!==projectId)
    fail('FORBIDDEN','Conversation context is not accessible.');
  if(job.owner!=='luna'||job.status!=='running'||job.fence!==fence||!Number.isFinite(job.until)||job.until<=now)
    fail('STALE_FENCE','A current Luna conversation lease is required.',409);
  if(projectId&&(!project||project.status!=='active'||job.projectFence!==project.ownershipFence))
    fail('STALE_PROJECT_FENCE','Project assignment changed. Stop and refresh.',409);
  const position=state.messages.findIndex(item=>item.id===parent.id);
  const conversation=state.messages.slice(0,position+1)
    .filter(item=>['admin','general'].includes(item.room)&&item.projectId===projectId&&['human','luna'].includes(item.actor))
    .slice(-12).map(item=>({id:item.id,actor:item.actor,text:clip(item.text,2000),at:item.at}));
  const ids=new Set();
  for(const turn of [...conversation].reverse()){
    const original=state.messages.find(item=>item.id===turn.id);
    for(const match of (original?.text||'').matchAll(/\bRLY-(?:BD-)?[A-Z0-9]{8,18}\b/gi))ids.add(match[0].toUpperCase());
    for(const reference of original?.references||[])if(reference.type==='task')ids.add(reference.id);
    if(ids.size>=4)break;
  }
  const inScope=task=>!projectId||task.projectId===projectId;
  const exactTasks=[...ids].slice(0,4).map(id=>state.tasks.find(task=>task.id===id&&inScope(task))).filter(Boolean)
    .map(task=>taskView(task,state.projects.find(item=>item.id===task.projectId)));
  const tasks=state.tasks.filter(inScope);
  const counts={};for(const task of tasks)counts[task.stage]=(counts[task.stage]||0)+1;
  const recentTasks=tasks.filter(task=>task.source?.system!=='brain_dump')
    .sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).slice(0,6)
    .map(task=>({id:task.id,title:clip(task.title,160),stage:task.stage,updatedAt:task.updatedAt||null,projectId:task.projectId}));
  return {schema:'relay-luna-context-v1',jobId,fence,createdTaskId:job.createdTaskId||null,startedTaskId:job.startedTaskId||null,startRequestId:job.startRequestId||null,asOf:new Date(now).toISOString(),revision:state.meta.revision,
    conversation,exactTasks,workSummary:{total:tasks.length,byStage:counts,recentTasks},
    project:project?{id:project.id,name:clip(project.name,160),description:clip(project.description,1000),status:project.status,owner:project.owner||null}:null,
    access:'Context for this claimed Chief conversation. Luna may create one task or request the current project owner to start one exact referenced task when the latest human message explicitly asks. A start request is queued, not claimed work. Approvals require separate owner authority.'};
}
