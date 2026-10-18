import { controlPrincipal } from './control.mjs';

export const APP_REVIEW_CHECKPOINTS = Object.freeze(['plan_review', 'human_review']);
export const RESTRICTED_ACTIONS = Object.freeze([
  'identity', 'access', 'ownership', 'version', 'fence', 'lease',
  'destructive', 'security', 'credentials', 'deployment', 'runtime_tool_approval',
]);

const checkpointSet = new Set(APP_REVIEW_CHECKPOINTS);
const restrictedSet = new Set(RESTRICTED_ACTIONS);
const isRevision = value => Number.isSafeInteger(value) && value >= 0;
const currentTask = (state, taskId) => typeof taskId === 'string'
  ? state?.tasks?.find(task => task.id === taskId) || null : null;
const currentScopeId = task => typeof task?.environment === 'string' && typeof task?.component === 'string'
  ? `${task.environment.toLowerCase().trim()}\n${task.component.toLowerCase().trim()}` : null;
function currentBinding(state, taskId) {
  const task = currentTask(state, taskId), ownerId = state?.meta?.ownerId, epoch = state?.meta?.epoch;
  if (!task || typeof ownerId !== 'string' || !ownerId || typeof epoch !== 'string' || !epoch) return null;
  return { task, taskId: task.id, epoch, scopeId: currentScopeId(task), scopeRevision: task.scopeRevision, siteOwnerId: ownerId };
}
function authorizedPrincipal(state, identity) {
  try { return controlPrincipal(state, identity); } catch { return null; }
}
function validPolicy(policy, taskId) {
  return !!policy && policy.taskId === taskId && isRevision(policy.executionPolicyRevision) &&
    isRevision(policy.ownerGrantRevision) && isRevision(policy.scopeRevision) &&
    Array.isArray(policy.checkpoints) && policy.checkpoints.every(checkpoint => checkpointSet.has(checkpoint));
}

/** Manual by default. Binding identity comes only from current ControlStore state. */
export function defaultExecutionPolicy({ state, taskId } = {}) {
  const binding = currentBinding(state, taskId);
  return {
    mode: 'manual', taskId: binding?.taskId ?? taskId ?? null,
    epoch: binding?.epoch ?? null, scopeId: binding?.scopeId ?? null,
    scopeRevision: binding?.scopeRevision ?? null, executionPolicyRevision: 0,
    siteOwnerId: binding?.siteOwnerId ?? null, ownerGrantRevision: 0, checkpoints: [],
  };
}

/** The authenticated, current Site owner can change a policy, never an assigned agent. */
export function changeTaskExecutionPolicy({ state, taskId, policy, identity, mode, checkpointPermissions = [] }) {
  const binding = currentBinding(state, taskId);
  if (!binding) return { ok: false, reason: 'current_task_required' };
  if (identity?.kind !== 'human') return { ok: false, reason: 'authenticated_human_required' };
  const principal = authorizedPrincipal(state, identity);
  if (principal?.role !== 'human' || identity.subject !== state.meta.ownerId)
    return { ok: false, reason: 'site_owner_required' };
  if (!['manual', 'agentic'].includes(mode)) return { ok: false, reason: 'invalid_mode' };
  if (!Array.isArray(checkpointPermissions) || checkpointPermissions.some(x => !checkpointSet.has(x)))
    return { ok: false, reason: 'checkpoint_not_permitted' };
  if (mode === 'agentic' && (!binding.scopeId || !isRevision(binding.scopeRevision)))
    return { ok: false, reason: 'current_scope_required' };

  const previous = policy ?? defaultExecutionPolicy({ state, taskId });
  if (!validPolicy(previous, taskId)) return { ok: false, reason: 'policy_binding_mismatch' };
  const checkpoints = mode === 'agentic' ? [...new Set(checkpointPermissions)] : [];
  const grantChanged = previous.siteOwnerId !== binding.siteOwnerId || previous.epoch !== binding.epoch ||
    previous.scopeId !== binding.scopeId || previous.scopeRevision !== binding.scopeRevision ||
    previous.checkpoints.length !== checkpoints.length || previous.checkpoints.some(value => !checkpoints.includes(value));
  return { ok: true, policy: {
    mode, taskId: binding.taskId, epoch: binding.epoch, scopeId: binding.scopeId,
    scopeRevision: binding.scopeRevision, executionPolicyRevision: previous.executionPolicyRevision + 1,
    siteOwnerId: binding.siteOwnerId, ownerGrantRevision: previous.ownerGrantRevision + (grantChanged ? 1 : 0), checkpoints,
  } };
}

/**
 * Decision only. The caller must pass current ControlStore state, an identity
 * produced by controlIdentity(), the separately persisted policy, and
 * server-derived current review/evidence context. Labels are ignored.
 */
export function decideTaskExecution({ state, taskId, policy, identity, checkpoint, action = 'app_review', evidenceValid = false, context = {} }) {
  const blocked = reason => ({ decision: 'blocked', reason });
  const manual = reason => ({ decision: 'manualreviewrequired', reason });
  const binding = currentBinding(state, taskId);
  if (!binding || !validPolicy(policy, taskId)) return blocked('task_binding_mismatch');
  if (context.taskId !== binding.taskId) return blocked('task_binding_mismatch');
  if (context.epoch !== binding.epoch || policy.epoch !== binding.epoch) return manual('epoch_mismatch');
  if (identity?.kind !== 'agent' || authorizedPrincipal(state, identity)?.role !== 'agent')
    return blocked('authenticated_agent_required');
  if (restrictedSet.has(action)) return blocked('restricted_action');
  if (action !== 'app_review') return blocked('action_not_permitted');
  if (binding.task.blocker) return blocked('task_blocked');
  if (!evidenceValid) return blocked('evidence_invalid');
  if (!checkpointSet.has(checkpoint)) return blocked('checkpoint_not_permitted');

  if (policy.mode !== 'agentic') return manual('manual_mode');
  if (context.executionPolicyRevision !== policy.executionPolicyRevision) return manual('stale_policy');
  if (context.ownerGrantRevision !== policy.ownerGrantRevision) return manual('stale_grant');
  if (policy.siteOwnerId !== binding.siteOwnerId) return manual('owner_changed');
  if (context.scopeRevision !== binding.scopeRevision || policy.scopeRevision !== binding.scopeRevision ||
      context.scopeId !== binding.scopeId || policy.scopeId !== binding.scopeId)
    return manual('scope_changed');
  if (!policy.checkpoints.includes(checkpoint)) return manual('checkpoint_not_granted');
  if (!context.planCurrent || (checkpoint === 'human_review' && !context.buildEvidenceCurrent))
    return manual('review_evidence_stale');
  if (checkpoint === 'human_review' && (!context.testsPassed || context.testsFailed))
    return manual('evidence_failure');
  return { decision: 'agenticadvanceallowed', reason: 'bounded_app_checkpoint', checkpoint,
    taskId: binding.taskId, epoch: binding.epoch, executionPolicyRevision: policy.executionPolicyRevision,
    ownerGrantRevision: policy.ownerGrantRevision, scopeId: binding.scopeId, scopeRevision: binding.scopeRevision };
}
