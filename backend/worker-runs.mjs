import { RelayError } from './core.mjs';
import { controlPrincipal } from './control.mjs';
import { taskAuthority } from './team-planning.mjs';
const fail = (code, message, status = 409) => { throw new RelayError(code, message, status); };
const check = (ok, code, message, status) => { if (!ok) fail(code, message, status); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => check(object(x) && Object.keys(x).every(k => keys.includes(k)), 'INVALID_RUN', 'Unexpected request fields.', 400);
// Opaque IDs are never trimmed, normalized, parsed, or split.
const text = (x, max = 200) => check(typeof x === 'string' && x.length > 0 && x.length <= max, 'INVALID_RUN', 'Expected bounded string.', 400);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const canonical = x => JSON.stringify(x, (_, v) => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const byteLength = x => new TextEncoder().encode(x).byteLength;
const digest = async x => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(x))))].map(b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => canonical(a) === canonical(b);
const nsKeys = ['instanceId', 'workspaceId', 'epoch'];
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const ranks = { registered: 0, queued: 1, running: 2, succeeded: 3, failed: 3, cancelled: 3 };
function namespace(ns) { exact(ns, nsKeys); nsKeys.forEach(k => text(ns[k])); }
function settings(x) { exact(x, ['provider', 'model', 'reasoningEffort', 'serviceTier']); Object.values(x).forEach(v => text(v, 120)); }
function validate(x) {
  exact(x, ['action', 'namespace', 'taskId', 'projectFence', 'runId', 'attemptId', 'expectedRevision', 'operationId', ...(x?.action === 'register' ? ['baseRevision', 'parent', 'requestedSettings', 'sourceDispatchId'] : x?.action === 'observe' ? ['observation'] : [])]);
  check(['register', 'observe'].includes(x.action), 'INVALID_RUN', 'Choose register or observe.', 400);
  namespace(x.namespace); ['taskId', 'runId', 'attemptId', 'operationId'].forEach(k => text(x[k]));
  check(integer(x.expectedRevision) && integer(x.projectFence), 'INVALID_RUN', 'Expected nonnegative revision and fence.', 400);
  if (x.action === 'register') {
    check(integer(x.baseRevision) && x.baseRevision > 0 && x.parent !== undefined, 'INVALID_RUN', 'Provide base revision and explicit parent.', 400);
    settings(x.requestedSettings);
    if (x.parent !== null) { exact(x.parent, ['runId', 'attemptId']); text(x.parent.runId); text(x.parent.attemptId); }
    if (x.sourceDispatchId !== undefined) text(x.sourceDispatchId);
  } else {
    const o = x.observation;
    exact(o, ['eventId', 'sequence', 'status', 'reportedAt', 'settings', 'evidenceRef']);
    text(o.eventId); check(integer(o.sequence), 'INVALID_RUN', 'Provide a source sequence.', 400);
    check(typeof o.status === 'string' && Object.hasOwn(ranks, o.status), 'INVALID_RUN', 'Unknown worker status.', 400);
    if (o.reportedAt !== undefined) check(integer(o.reportedAt), 'INVALID_RUN', 'Invalid reported time.', 400);
    if (o.settings !== undefined) settings(o.settings);
    if (o.evidenceRef !== undefined) text(o.evidenceRef, 2048);
  }
  check(byteLength(canonical(x)) <= 8192, 'INVALID_RUN', 'Request exceeds 8 KiB.', 400);
}
export const WORKER_RUNS_SCHEMA = `CREATE TABLE IF NOT EXISTS relay_worker_run_registry (
 instance_id TEXT NOT NULL, workspace_id TEXT NOT NULL, epoch TEXT NOT NULL,
 revision INTEGER NOT NULL, body TEXT NOT NULL,
 PRIMARY KEY(instance_id,workspace_id,epoch)
);`;
export class SqlWorkerRunStore {
  constructor(db) { this.db = db; }
  async initialize() { await this.db.exec(WORKER_RUNS_SCHEMA); }
  #authoritySql(guard) {
    check(guard && guard.controlEpoch && integer(guard.controlRevision) && guard.taskId && guard.projectId && guard.actor && guard.projectOwner !== undefined && integer(guard.ownershipFence) && integer(guard.taskVersion) && typeof guard.projectRecoveryRequired === 'boolean' && typeof guard.agentPaused === 'boolean' && integer(guard.executionFence), 'RUN_CONFIGURATION', 'Trusted authority snapshot is incomplete.', 500);
    const sql = `EXISTS (SELECT 1 FROM relay_control_meta m WHERE m.id='main' AND m.epoch=? AND m.revision=?
      AND EXISTS (SELECT 1 FROM relay_control_records p WHERE p.kind='projects' AND p.id=?
        AND json_extract(p.body,'$.owner') IS ? AND json_extract(p.body,'$.ownershipFence')=?
        AND json_extract(p.body,'$.recoveryRequired')=? AND json_extract(p.body,'$.status')='active')
      AND EXISTS (SELECT 1 FROM relay_control_records t WHERE t.kind='tasks' AND t.id=?
        AND json_extract(t.body,'$.projectId')=? AND json_extract(t.body,'$.version')=?)
      AND EXISTS (SELECT 1 FROM relay_control_records a WHERE a.kind='agents' AND a.id=?
        AND json_extract(a.body,'$.paused')=? AND COALESCE(json_extract(a.body,'$.executionFence'),0)=?))`;
    return { sql, values: [guard.controlEpoch, guard.controlRevision, guard.projectId, Object.hasOwn(guard,'projectRecordOwner')?guard.projectRecordOwner:guard.projectOwner, guard.projectRecordFence??guard.ownershipFence, guard.projectRecoveryRequired ? 1 : 0, guard.taskId, guard.projectId, guard.taskVersion, guard.actor, guard.agentPaused ? 1 : 0, guard.executionFence] };
  }
  async read(ns, guard) {
    const auth = this.#authoritySql(guard);
    const row = await this.db.prepare(`SELECT r.revision,r.body,${auth.sql} AS authorized FROM (SELECT 1) x LEFT JOIN relay_worker_run_registry r ON r.instance_id=? AND r.workspace_id=? AND r.epoch=?`).bind(...auth.values, ...nsKeys.map(k => ns[k])).first();
    check(Number(row?.authorized) === 1, 'STALE_AUTHORITY', 'Control authority changed; refresh authorization.');
    return row?.revision != null ? { revision: row.revision, body: JSON.parse(row.body) } : null;
  }
  async readOwner(ns, guard) {
    check(guard && typeof guard.siteOwnerId === 'string' && guard.siteOwnerId.length > 0 && guard.taskId && guard.projectId && integer(guard.controlRevision) && integer(guard.taskVersion) && integer(guard.projectFence), 'RUN_CONFIGURATION', 'Trusted owner read snapshot is incomplete.', 500);
    const sql = `EXISTS (SELECT 1 FROM relay_control_meta m WHERE m.id='main' AND m.owner_id=? AND m.epoch=? AND m.revision=?
      AND EXISTS (SELECT 1 FROM relay_control_records t WHERE t.kind='tasks' AND t.id=?
        AND json_extract(t.body,'$.projectId')=? AND json_extract(t.body,'$.version')=?)
      AND EXISTS (SELECT 1 FROM relay_control_records p WHERE p.kind='projects' AND p.id=?
        AND json_extract(p.body,'$.ownershipFence')=?))`;
    const values = [guard.siteOwnerId, ns.epoch, guard.controlRevision, guard.taskId, guard.projectId, guard.taskVersion, guard.projectId, guard.projectFence];
    const row = await this.db.prepare(`SELECT r.revision,r.body,${sql} AS authorized FROM (SELECT 1) x LEFT JOIN relay_worker_run_registry r ON r.instance_id=? AND r.workspace_id=? AND r.epoch=?`).bind(...values, ...nsKeys.map(k => ns[k])).first();
    check(Number(row?.authorized) === 1, 'STALE_AUTHORITY', 'Owner or task authority changed; refresh authorization.');
    return row?.revision != null ? { revision: row.revision, body: JSON.parse(row.body) } : null;
  }
  async commit(ns, previous, body, guard) {
    const json = JSON.stringify(body), key = nsKeys.map(k => ns[k]);
    const auth = this.#authoritySql(guard);
    check(byteLength(json) <= 4 * 1024 * 1024, 'RUN_CAPACITY', 'Registry capacity reached.', 507);
    // One SQL statement atomically commits records, event deduplication and receipts.
    const result = previous
      ? await this.db.prepare(`UPDATE relay_worker_run_registry SET revision=?,body=? WHERE instance_id=? AND workspace_id=? AND epoch=? AND revision=? AND ${auth.sql}`).bind(previous.revision + 1, json, ...key, previous.revision, ...auth.values).run()
      : await this.db.prepare(`INSERT INTO relay_worker_run_registry(instance_id,workspace_id,epoch,revision,body) SELECT ?,?,?,1,? WHERE ${auth.sql} ON CONFLICT(instance_id,workspace_id,epoch) DO NOTHING`).bind(...key, json, ...auth.values).run();
    return Number(result.meta?.changes) === 1;
  }
}
/** Build the internal authority callback from the real control store and raw, server-authenticated identity. */
export function createServerWithAuthority({ currentControlStore, identity, instanceId, workspaceId, sourceId, validateAuthority }) {
  check(currentControlStore && identity && instanceId && workspaceId && sourceId, 'RUN_CONFIGURATION', 'Server authority inputs are required.', 500);
  return async (request, callback) => {
    const state = await currentControlStore.read();
    validateAuthority?.(state);
    const principal = controlPrincipal(state, identity);
    check(principal.agent === true, 'FORBIDDEN', 'Worker runs require an authenticated agent principal.', 403);
    const task = state.tasks.find(record => record.id === request.taskId);
    check(task, 'TASK_NOT_FOUND', 'Task not found.', 404);
    const projectRecord = state.projects.find(record => record.id === task.projectId);
    const project = taskAuthority(state,task);
    check(project && project.status === 'active' && !project.recoveryRequired, 'PROJECT_UNAVAILABLE', 'Project is inactive or requires recovery.');
    check(project.owner === principal.actor && project.ownershipFence === request.projectFence, 'STALE_PROJECT_FENCE', 'Project authority changed.');
    const agent = state.agents.find(record => record.id === principal.actor);
    check(agent && !agent.paused, 'AGENT_PAUSED', 'Agent is paused.', 403);
    return callback({ namespace: { instanceId, workspaceId, epoch: state.meta.epoch }, actor: principal.actor, sourceId, taskId: task.id, projectId: project.id, projectFence: project.ownershipFence, taskVersion: task.version, controlRevision: state.meta.revision, projectOwner: project.owner, projectRecordOwner:projectRecord.owner,projectRecordFence:projectRecord.ownershipFence,projectRecoveryRequired: !!projectRecord.recoveryRequired, agentPaused: !!agent.paused, executionFence: agent.executionFence || 0 });
  };
}
const find = (body, key) => body.runs.find(r => r.runId === key.runId && r.attemptId === key.attemptId);
const projection = r => structuredClone(Object.fromEntries(['namespace', 'taskId', 'projectId', 'runId', 'attemptId', 'parent', 'baseRevision', 'originProjectFence', 'sourceDispatchId', 'requestedSettings', 'observedSettings', 'status', 'revision', 'createdAt', 'updatedAt', 'firstObservedAt', 'lastObservedAt', 'terminalRecordedAt', 'reportedTimes', 'provenance', 'disputed'].filter(k => Object.hasOwn(r, k)).map(k => [k, r[k]])));
export const workerRunProjection = projection;
/** Internal service only. withAuthority must authenticate and serialize ownership/fence
 * changes through the callback's completion. Never construct it from HTTP payload data.
 * It supplies {namespace, actor, sourceId, taskId, projectId, projectFence, taskVersion}.
 * No default permissive authority, provider verifier, route or executor is supplied.
 */
export class WorkerRuns {
  constructor(store, { withAuthority, now = Date.now } = {}) {
    check(store && typeof withAuthority === 'function', 'RUN_CONFIGURATION', 'A trusted authority boundary is required.', 500);
    this.store = store; this.withAuthority = withAuthority; this.now = now;
  }
  #authorize(x, c) {
    check(c && same(x.namespace, c.namespace), 'STALE_NAMESPACE', 'Namespace or epoch changed.');
    check(c.taskId === x.taskId && c.projectFence === x.projectFence, 'STALE_PROJECT_FENCE', 'Task authority or assignment changed.');
    text(c.actor); text(c.sourceId); text(c.projectId);
  }
  async mutate(input) {
    const x = structuredClone(input); validate(x);
    return this.withAuthority(structuredClone(x), async c => {
      this.#authorize(x, c);
      const guard = { ...c, controlEpoch: c.namespace.epoch, ownershipFence: c.projectFence };
      const hash = await digest(x);
      for (let i = 0; i < 32; i++) {
        const previous = await this.store.read(c.namespace, guard);
        const body = previous ? structuredClone(previous.body) : { runs: [], operations: [] };
        const prior = body.operations.find(o => o.actor === c.actor && o.id === x.operationId);
        if (prior) { check(prior.digest === hash, 'RUN_OPERATION_CONFLICT', 'Operation payload changed.'); return { ...structuredClone(prior.result), replayed: true }; }
        check(body.operations.length < 5000, 'RUN_CAPACITY', 'Operation capacity reached.', 507);
        let r = find(body, x), applied = false;
        const now = this.now();
        if (x.action === 'register') {
          check(x.expectedRevision === 0, 'STALE_RUN', 'Registration requires expectedRevision zero.');
          check(x.baseRevision <= c.taskVersion, 'INVALID_RUN', 'Base revision does not exist.', 400);
          const identity = { namespace: c.namespace, taskId: x.taskId, projectId: c.projectId, runId: x.runId, attemptId: x.attemptId, parent: x.parent, baseRevision: x.baseRevision, requestedSettings: x.requestedSettings, sourceDispatchId: x.sourceDispatchId ?? null };
          if (r) check(Object.keys(identity).every(k => same(r[k], identity[k])), 'RUN_CONFLICT', 'Attempt identity changed.');
          else {
            check(body.runs.length < 1000, 'RUN_CAPACITY', 'Run capacity reached.', 507);
            check(!body.runs.some(v => v.runId === x.runId && (v.taskId !== x.taskId || v.projectId !== c.projectId)), 'RUN_CONFLICT', 'Run is bound to another task.');
            if (x.parent) {
              check(!(x.parent.runId === x.runId && x.parent.attemptId === x.attemptId), 'RUN_PARENT_CYCLE', 'Self parent rejected.');
              let p = find(body, x.parent); check(p && p.projectId === c.projectId, 'RUN_PARENT_NOT_FOUND', 'Parent must exist in this namespace and project.');
              const visited = new Set();
              while (p) { const key = canonical([p.runId, p.attemptId]); check(!visited.has(key) && !(p.runId === x.runId && p.attemptId === x.attemptId), 'RUN_PARENT_CYCLE', 'Parent cycle rejected.'); visited.add(key); p = p.parent ? find(body, p.parent) : null; }
            }
            r = { ...structuredClone(identity), originProjectFence: c.projectFence, revision: 1, status: 'registered', createdAt: now, updatedAt: now, firstObservedAt: null, lastObservedAt: null, terminalRecordedAt: null, requestedSettings: structuredClone(x.requestedSettings), observedSettings: {}, reportedTimes: [], provenance: { source: 'authenticated-principal-assertion', reportedBy: c.actor }, disputed: false, events: [], streams: [] };
            body.runs.push(r); applied = true;
          }
        } else {
          check(r && r.taskId === x.taskId && r.projectId === c.projectId, 'RUN_NOT_FOUND', 'Attempt not found for task.', 404);
          check(r.revision === x.expectedRevision, 'STALE_RUN', 'Refresh the run revision.');
          const o = x.observation, hash = await digest(o), event = r.events.find(e => e.sourceId === c.sourceId && e.eventId === o.eventId);
          if (event) check(event.digest === hash, 'RUN_EVENT_CONFLICT', 'Event payload changed.');
          else {
            check(r.events.length < 256, 'RUN_CAPACITY', 'Attempt evidence capacity reached.', 507);
            let stream = r.streams.find(s => s.sourceId === c.sourceId);
            const stale = !!stream && o.sequence <= stream.sequence;
            const conflict = terminal.has(r.status) && terminal.has(o.status) && r.status !== o.status;
            const provenance = { source: 'authenticated-principal-assertion', reportedBy: c.actor, sourceId: c.sourceId, receivedAt: now };
            r.events.push({ ...structuredClone(o), sourceId: c.sourceId, digest: hash, stale, conflict, provenance });
            if (conflict) r.disputed = true;
            if (!stale) {
              if (!stream) { stream = { sourceId: c.sourceId, sequence: o.sequence }; r.streams.push(stream); } else stream.sequence = o.sequence;
              if (!terminal.has(r.status) && ranks[o.status] >= ranks[r.status]) { r.status = o.status; if (terminal.has(o.status)) r.terminalRecordedAt = now; }
              for (const [key, value] of Object.entries(o.settings || {})) r.observedSettings[key] = { value, provenance };
            }
            // Historical timestamps are evidence, not authority for lifecycle ordering.
            if (o.reportedAt !== undefined) r.reportedTimes.push({ status: o.status, at: o.reportedAt, stale, provenance });
            r.firstObservedAt ??= now; r.lastObservedAt = now; r.updatedAt = now; r.revision++; applied = true;
          }
        }
        const result = { workerRun: projection(r), applied, replayed: false };
        body.operations.push({ actor: c.actor, id: x.operationId, digest: hash, result });
        if (await this.store.commit(c.namespace, previous, body, guard)) return structuredClone(result);
        // A zero-change guarded statement is authority revocation or registry CAS loss.
        await this.store.read(c.namespace, guard);
      }
      fail('RUN_BUSY', 'Retry the identical operation.');
    });
  }
  async list(input) {
    const x = structuredClone(input); exact(x, ['namespace', 'taskId', 'projectFence']); namespace(x.namespace); text(x.taskId); check(integer(x.projectFence), 'INVALID_RUN', 'Invalid fence.', 400);
    return this.withAuthority(x, async c => { this.#authorize(x, c); const guard = { ...c, controlEpoch: c.namespace.epoch, ownershipFence: c.projectFence }; const state = await this.store.read(c.namespace, guard); return (state?.body.runs || []).filter(r => r.taskId === x.taskId && r.projectId === c.projectId).map(projection); });
  }
}
