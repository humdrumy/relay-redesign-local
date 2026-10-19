import { RelayError } from './core.mjs';

export const TEAM_AGENTS = ['dot', 'scout'];
export const TEAM_CAPACITY = 5;
const requireValue = (ok, code, message) => { if (!ok) throw new RelayError(code, message, 409); };
export function taskAuthority(state, task) {
  const project = state.projects.find(p => p.id === task.projectId);
  if(!project)return undefined;
  return task.team ? {...project, owner:task.team.owner, ownershipFence:task.team.fence, recoveryRequired:false} : project;
}
export function teamCanRead(task, principal) {
  return !!task.team && (principal.role === 'human' || principal.agent && TEAM_AGENTS.includes(principal.actor));
}
export function teamCapacity(state, now) {
  return TEAM_AGENTS.map(id => {
    const agent = state.agents.find(a => a.id === id), report = agent?.capacityReport;
    const active = state.tasks.filter(t => !t.archivedAt && t.team?.owner === id && t.stage !== 'ready').length;
    const legacyActive = state.tasks.filter(t => !t.archivedAt && !t.team && ['research','build'].includes(t.stage) && taskAuthority(state,t)?.owner === id).length;
    const fresh = !!report && report.at <= now && now - report.at <= 15 * 60 * 1000;
    // Unknown/stale usage never means unlimited capacity. Reports are self-reported, not account telemetry.
    const available = !agent?.paused && fresh ? Math.max(0, Math.min(TEAM_CAPACITY-active-legacyActive, report.availableSlots-active)) : 0;
    return {id, active, legacyActive, limit:TEAM_CAPACITY, available, reportFresh:fresh, usageRemainingPercent:fresh?report.usageRemainingPercent:null, reportedAt:report?.at||null};
  });
}
export function startTeamPlanning(task) {
  task.team = {phase:'planning', owner:null, fence:0, accepted:[], notes:[], round:1, planningClosed:false};
  task.owner = null;
}
export function resetTeamPlanning(task) {
  if (!task.team) return;
  task.team.phase=task.team.planningClosed?'assigned':'planning';
  task.team.accepted=[]; task.team.round++; task.owner=task.team.owner;
}

// A responding agent can take unassigned work without waiting for a peer's
// heartbeat, capacity report, research, or acceptance. The store commits this
// assignment atomically, so competing claims cannot create two owners.
export function claimTeamTask(state, task, actor, now) {
  requireValue(TEAM_AGENTS.includes(actor),'FORBIDDEN','Only Dot or Scout may take this task.');
  requireValue(!task.team.owner,'TASK_OWNED','This task already has an owner.');
  const capacity=teamCapacity(state,now).find(a=>a.id===actor);
  const report=state.agents.find(a=>a.id===actor)?.capacityReport;
  requireValue(capacity.active+capacity.legacyActive<TEAM_CAPACITY&&
    (!capacity.reportFresh||capacity.available>0&&report.usageRemainingPercent!==0),
    'CAPACITY','Finish current work or report available capacity before taking another task.');
  task.team.owner=actor;task.team.phase=task.team.planningClosed?'assigned':'planning';task.team.fence++;
  task.owner=actor;
}

export function planningAvailable(state, actor, now) {
  const capacity=teamCapacity(state,now).find(a=>a.id===actor);
  return !!capacity&&capacity.reportFresh&&capacity.available>0&&
    capacity.active===0&&capacity.legacyActive===0&&capacity.usageRemainingPercent!==0;
}

export function teamRecipients(state, task, now, {invite=false}={}) {
  const owner=task.team.owner;
  if(!owner)return TEAM_AGENTS.filter(id=>!state.agents.find(a=>a.id===id)?.paused);
  return [owner,...(invite&&task.team.phase==='planning'
    ? TEAM_AGENTS.filter(id=>id!==owner&&planningAvailable(state,id,now)):[])];
}
export function reportTeamCapacity(state, actor, command, now) {
  requireValue(TEAM_AGENTS.includes(actor),'FORBIDDEN','Only Dot and Scout report team capacity.');
  requireValue(Number.isInteger(command.availableSlots)&&command.availableSlots>=0&&command.availableSlots<=5,'INVALID_CAPACITY','availableSlots must be an integer from 0 to 5, excluding Relay-managed assignments.');
  const percent=command.usageRemainingPercent??null;
  requireValue(percent===null||Number.isFinite(percent)&&percent>=0&&percent<=100,'INVALID_CAPACITY','Usage remaining must be null or a percentage.');
  state.agents.find(a=>a.id===actor).capacityReport={availableSlots:command.availableSlots,usageRemainingPercent:percent,at:now};
}
export function acceptTeamPlan(task, actor, revision) {
  requireValue(TEAM_AGENTS.includes(actor),'FORBIDDEN','Only Dot or Scout may accept the plan.');
  requireValue(task.team?.phase==='planning'&&task.plan&&revision===task.planRevision,'STALE_PLAN','Read and accept the current shared plan.');
  requireValue(task.team.owner===actor,'TASK_NOT_OWNED','Only the task owner may finalize its plan.');
  if(!task.team.accepted.includes(actor))task.team.accepted.push(actor);
  task.team.phase='assigned';
}
export function assignTeamTasks(state, now, notify) {
  const priority={Urgent:0,High:1,Normal:2,Low:3};
  const waiting=state.tasks.filter(t=>!t.archivedAt&&t.team&&!t.team.owner&&['planning','waiting_capacity'].includes(t.team.phase)&&!t.blocker&&t.stage!=='ready'&&state.projects.find(p=>p.id===t.projectId)?.status==='active')
    .sort((a,b)=>(priority[a.priority]-priority[b.priority])||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  for(const task of waiting){
    const candidates=teamCapacity(state,now).filter(a=>a.available>0&&a.usageRemainingPercent!==0)
      .sort((a,b)=>(a.active+a.legacyActive)-(b.active+b.legacyActive)||(b.usageRemainingPercent??-1)-(a.usageRemainingPercent??-1)||a.id.localeCompare(b.id));
    if(!candidates.length)break;
    const submitted=task.team.phase==='waiting_capacity'&&!!task.plan;
    claimTeamTask(state,task,candidates[0].id,now);
    task.team.phase=submitted||task.team.planningClosed?'assigned':'planning';
    if(submitted){task.stage='plan_review';task.team.planningClosed=true;}
    task.lease=null;task.fence++;
    task.version++;task.updatedAt=new Date(now).toISOString();
    notify(task,'task-assigned');
  }
}
