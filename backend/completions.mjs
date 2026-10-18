import { RelayError } from './core.mjs';

const check = (ok, code, message, status = 409) => { if (!ok) throw new RelayError(code, message, status); };
const text = (value, name, max = 2048) => {
  check(typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value,
    'INVALID_COMPLETION', `${name} must be a nonempty bounded string.`, 400);
  return value;
};
const integer = value => Number.isSafeInteger(value) && value >= 1;
const fields = {
  record: ['runId', 'attemptId', 'baseRevision', 'resultRef', 'threadRef'],
  discuss: ['completionId', 'expectedRevision'],
  block: ['completionId', 'expectedRevision'],
  done: ['completionId', 'expectedRevision'],
  reserve: ['completionId', 'expectedRevision'],
  uncertain: ['completionId', 'expectedRevision', 'dispatchId'],
  confirm: ['completionId', 'expectedRevision', 'dispatchId', 'spawnedRunId'],
};

// Pure, synchronous state change. The caller must authorize the task/project and
// commit via ControlStore's atomic CAS. No external side effects belong here.
export function applyCompletion(state, input, task, now, principal) {
  const allowed = Object.hasOwn(fields, input.action) ? fields[input.action] : null;
  check(allowed && Object.keys(input).every(key => ['action', 'epoch', 'taskId', 'projectFence', ...allowed].includes(key)),
    'INVALID_COMPLETION', 'Use the typed completion envelope; identity is server-owned.', 400);
  const records = state.completions;
  const result = (record, shouldSpawn = false) => ({ completion: structuredClone(record), shouldSpawn });
  if (input.action === 'record') {
    const payload = {
      runId: text(input.runId, 'runId', 200), attemptId: text(input.attemptId, 'attemptId', 200),
      taskId: task.id, baseRevision: input.baseRevision,
      resultRef: text(input.resultRef, 'resultRef'), threadRef: text(input.threadRef, 'threadRef'),
    };
    check(integer(payload.baseRevision) && payload.baseRevision <= task.version,
      'INVALID_COMPLETION', 'baseRevision must reference an existing task revision.', 400);
    const prior = records.find(record => record.runId === payload.runId && record.attemptId === payload.attemptId);
    if (prior) {
      check(Object.entries(payload).every(([key, value]) => prior[key] === value),
        'COMPLETION_CONFLICT', 'This run attempt already has a different completion.');
      return result(prior);
    }
    check(records.length < 25000, 'CAPACITY', 'Completion capacity reached.', 507);
    const completionId = crypto.randomUUID();
    const record = { id: completionId, completionId, ...payload, projectId: task.projectId,
      discussionStatus: 'queued', revision: 1, createdAt: now, updatedAt: now,
      provenance: { source: 'authenticated-principal-assertion', reportedBy: principal.actor } };
    records.push(record);
    return result(record);
  }
  const record = records.find(record => record.completionId === input.completionId && record.taskId === task.id);
  check(record, 'COMPLETION_NOT_FOUND', 'Completion not found for this task.', 404);
  // Replays never hand out a second spawn permit, even if the original response
  // was lost. There is deliberately no expiry, release or automatic re-reserve.
  if (input.action === 'reserve' && record.dispatch) return result(record);
  if (input.action === 'confirm' && record.dispatch?.status === 'spawned') {
    check(record.dispatch.dispatchId === input.dispatchId && record.dispatch.spawnedRunId === input.spawnedRunId,
      'DISPATCH_MISMATCH', 'Confirmed dispatch identity cannot change.');
    return result(record);
  }
  check(integer(input.expectedRevision) && input.expectedRevision === record.revision,
    'STALE_COMPLETION', 'Completion changed. Refresh before deciding.');
  if (input.action === 'discuss') {
    check(['queued', 'blocked'].includes(record.discussionStatus) && !record.dispatch,
      'INVALID_COMPLETION_TRANSITION', 'Only an unreserved queued or blocked completion can enter discussion.');
    record.discussionStatus = 'discussing';
  } else if (input.action === 'block' || input.action === 'done') {
    check(['queued', 'discussing', 'blocked', 'dispatched'].includes(record.discussionStatus) &&
      (!record.dispatch || record.dispatch.status === 'spawned'),
      'INVALID_COMPLETION_TRANSITION', 'Reconcile any unresolved dispatch before closing discussion.');
    record.discussionStatus = input.action === 'block' ? 'blocked' : 'done';
  } else if (input.action === 'reserve') {
    check(record.baseRevision === task.version, 'STALE_COMPLETION_BASE', 'Task changed since this result. Review a current completion before dispatch.');
    check(record.discussionStatus === 'discussing', 'INVALID_COMPLETION_TRANSITION', 'Discuss before reserving a dispatch.');
    record.dispatch = { dispatchId: crypto.randomUUID(), status: 'reserved', spawnedRunId: null, reservedBy: principal.actor, reservedAt: now };
  } else {
    check(record.dispatch && record.dispatch.dispatchId === input.dispatchId,
      'DISPATCH_MISMATCH', 'Use this completion’s reserved dispatch ID.');
    check(['reserved', 'uncertain'].includes(record.dispatch.status),
      'INVALID_COMPLETION_TRANSITION', 'Spawn is already confirmed.');
    if (input.action === 'uncertain') record.dispatch.status = 'uncertain';
    else {
      record.dispatch.spawnedRunId = text(input.spawnedRunId, 'spawnedRunId', 200);
      record.dispatch.status = 'spawned';
      record.dispatch.confirmation = { source: 'authenticated-principal-assertion', confirmedBy: principal.actor, confirmedAt: now };
      record.discussionStatus = 'dispatched';
    }
  }
  record.revision++;
  record.updatedAt = now;
  return result(record, input.action === 'reserve');
}
