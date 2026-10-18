import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite } from '../backend/sqlite-local.mjs';
import { SqlWorkerRunStore, WorkerRuns, createServerWithAuthority } from '../backend/worker-runs.mjs';
const rejects = (p, code) => assert.rejects(p, e => e.code === code);
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'worker-runs-')), path = join(dir, 'runs.sqlite'), connections = [];
  t.after(() => { connections.forEach(c => c.close()); rmSync(dir, { recursive: true, force: true }); });
  const context = { namespace: { instanceId: 'instance', workspaceId: 'workspace', epoch: 'epoch' }, actor: 'forge', sourceId: 'adapter-one', taskId: 'task', projectId: 'project', projectFence: 1, taskVersion: 3, controlRevision: 1, projectOwner: 'forge', projectRecoveryRequired: false, agentPaused: false, executionFence: 1 };
  let denied = false, clock = 100, beforeAuthorizeCommit = null;
  const create = async () => { const db = openSqlite(path); connections.push(db); await db.exec(`CREATE TABLE IF NOT EXISTS relay_control_meta(id TEXT PRIMARY KEY,epoch TEXT,revision INTEGER); CREATE TABLE IF NOT EXISTS relay_control_records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id)); INSERT OR IGNORE INTO relay_control_meta VALUES('main','epoch',1); INSERT OR IGNORE INTO relay_control_records VALUES('projects','project','{"id":"project","owner":"forge","ownershipFence":1,"recoveryRequired":false,"status":"active"}'); INSERT OR IGNORE INTO relay_control_records VALUES('tasks','task','{"id":"task","projectId":"project","version":3}'); INSERT OR IGNORE INTO relay_control_records VALUES('agents','forge','{"id":"forge","paused":false,"executionFence":1}');`); const store = new SqlWorkerRunStore(db); await store.initialize(); return { store, service: new WorkerRuns(store, { withAuthority: async (request, fn) => { if (denied) throw Object.assign(new Error('Paused'), { code: 'PAUSED' }); const snapshot = structuredClone(context); if (beforeAuthorizeCommit) { const race = beforeAuthorizeCommit; beforeAuthorizeCommit = null; await race(db); } return fn(snapshot); }, now: () => clock++ }) }; };
  const { store, service } = await create();
  const base = { namespace: structuredClone(context.namespace), taskId: 'task', projectFence: 1, runId: 'opaque / run : id ', attemptId: 'attempt 1' };
  const register = (extra = {}, target = service) => target.mutate({ ...base, action: 'register', expectedRevision: 0, operationId: 'register', baseRevision: 1, parent: null, requestedSettings: { model: 'requested-model', reasoningEffort: 'xhigh' }, ...extra });
  const observe = (observation, extra = {}, target = service) => target.mutate({ ...base, action: 'observe', operationId: observation.eventId, expectedRevision: 1, observation, ...extra });
  const guard = () => ({ ...structuredClone(context), controlEpoch: context.namespace.epoch, ownershipFence: context.projectFence });
  return { context, base, store, service, create, register, observe, guard, deny: () => { denied = true; }, race: fn => { beforeAuthorizeCommit = fn; } };
}
test('durable restart, opaque exact IDs, canonical operation replay and conflicts', async t => {
  const f = await fixture(t), a = await f.register(), other = await f.create();
  assert.equal(a.workerRun.runId, 'opaque / run : id ');
  const replay = await f.register({ requestedSettings: { reasoningEffort: 'xhigh', model: 'requested-model' } }, other.service);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.workerRun, a.workerRun);
  await rejects(f.register({ parent: { runId: 'other', attemptId: 'a' } }), 'RUN_OPERATION_CONFLICT');
  await rejects(f.register({ expectedRevision: 1, operationId: 'bad-first-cas' }), 'STALE_RUN');
  const duplicate = await f.register({ operationId: 'other-register' }); assert.equal(duplicate.applied, false);
  await rejects(f.register({ operationId: 'changed', requestedSettings: { model: 'different' } }), 'RUN_CONFLICT');
});
test('concurrent SQL CAS yields one registration and one observed writer', async t => {
  const f = await fixture(t), other = await f.create();
  const result = await Promise.all([f.register(), f.register({}, other.service)]);
  assert.equal(result.filter(x => x.replayed).length, 1);
  const outcomes = await Promise.allSettled([f.observe({ eventId: 'e1', sequence: 1, status: 'running' }), f.observe({ eventId: 'e2', sequence: 2, status: 'queued' }, {}, other.service)]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(x => x.status === 'rejected').reason.code, 'STALE_RUN');
});
test('second connection revocation between snapshot and commit blocks all worker writes', async t => {
  const changes = [
    ["UPDATE relay_control_records SET body=json_set(body,'$.owner','rook','$.ownershipFence',2) WHERE kind='projects' AND id='project'", 'project reassignment'],
    ["UPDATE relay_control_records SET body=json_set(body,'$.status','completed') WHERE kind='projects' AND id='project'", 'project completion'],
    ["UPDATE relay_control_records SET body=json_set(body,'$.version',4) WHERE kind='tasks' AND id='task'", 'task edit'],
    ["UPDATE relay_control_records SET body=json_set(body,'$.paused',true,'$.executionFence',2) WHERE kind='agents' AND id='forge'", 'pause'],
    ["UPDATE relay_control_records SET body=json_set(body,'$.paused',false,'$.executionFence',3) WHERE kind='agents' AND id='forge'", 'pause-unpause execution fence'],
    ["UPDATE relay_control_meta SET epoch='next',revision=2 WHERE id='main'", 'epoch change'],
  ];
  for (const [sql, label] of changes) {
    const f = await fixture(t), writer = await f.create();
    const commit = f.store.commit.bind(f.store);
    f.store.commit = async (...args) => { await writer.store.db.exec(`${sql}; UPDATE relay_control_meta SET revision=revision+1 WHERE id='main'`); f.store.commit = commit; return commit(...args); };
    await rejects(f.register(), 'STALE_AUTHORITY');
    assert.equal(await f.store.db.prepare('SELECT revision FROM relay_worker_run_registry').bind().first(), null, `${label} must leave no registry row`);
  }
});
test('replay and reads reauthorize namespace, epoch, fence and pause', async t => {
  const f = await fixture(t); await f.register();
  f.context.projectFence = 2; await rejects(f.register(), 'STALE_PROJECT_FENCE');
  f.context.projectFence = 1; f.context.namespace.epoch = 'new'; await rejects(f.register(), 'STALE_NAMESPACE');
  f.context.namespace.epoch = 'epoch'; f.context.namespace.instanceId = 'other'; await rejects(f.register(), 'STALE_NAMESPACE');
  f.context.namespace.instanceId = 'instance'; f.deny(); await rejects(f.register(), 'PAUSED');
  await rejects(f.service.list({ namespace: f.base.namespace, taskId: 'task', projectFence: 1 }), 'PAUSED');
});
test('revoked authority denies idempotent replay and list through guarded SQL reads', async t => {
  const f = await fixture(t); await f.register();
  await f.store.db.exec(`UPDATE relay_control_meta SET revision=2; UPDATE relay_control_records SET body=json_set(body,'$.owner','rook','$.ownershipFence',2) WHERE kind='projects' AND id='project';`);
  await rejects(f.register(), 'STALE_AUTHORITY');
  await rejects(f.service.list({ namespace: f.base.namespace, taskId: 'task', projectFence: 1 }), 'STALE_AUTHORITY');
});
test('server authority derives actor, project and fences from the current control store', async () => {
  const state = { meta: { ownerId: 'owner', epoch: 'live-epoch', revision: 9 }, projects: [{ id: 'project', owner: 'forge', ownershipFence: 4, status: 'active', recoveryRequired: false }], tasks: [{ id: 'task', projectId: 'project', version: 6 }], agents: [{ id: 'forge', paused: false, executionFence: 8 }] };
  const withAuthority = createServerWithAuthority({ currentControlStore: { read: async () => structuredClone(state) }, identity: { kind: 'agent', actor: 'forge', subject: 'authenticated-subject' }, instanceId: 'instance', workspaceId: 'workspace', sourceId: 'server-adapter' });
  const snapshot = await withAuthority({ taskId: 'task', projectFence: 4 }, async value => value);
  assert.deepEqual(snapshot, { namespace: { instanceId: 'instance', workspaceId: 'workspace', epoch: 'live-epoch' }, actor: 'forge', sourceId: 'server-adapter', taskId: 'task', projectId: 'project', projectFence: 4, taskVersion: 6, controlRevision: 9, projectOwner: 'forge', projectRecordOwner:'forge',projectRecordFence:4,projectRecoveryRequired: false, agentPaused: false, executionFence: 8 });
});
test('team worker authority follows task owner while retaining the underlying project SQL guard',async()=>{
 const state={meta:{ownerId:'owner',epoch:'epoch',revision:10},projects:[{id:'p',owner:'dot',ownershipFence:7,status:'active',recoveryRequired:false}],tasks:[{id:'t',projectId:'p',version:4,team:{owner:'scout',fence:2,phase:'assigned'}}],agents:[{id:'dot',paused:false},{id:'scout',paused:false}]};
 const authority=actor=>createServerWithAuthority({currentControlStore:{read:async()=>structuredClone(state)},identity:{kind:'agent',actor,subject:'bound-'+actor},instanceId:'i',workspaceId:'w',sourceId:'s'});
 const result=await authority('scout')({taskId:'t',projectFence:2},async value=>value);
 assert.equal(result.projectOwner,'scout');assert.equal(result.projectRecordOwner,'dot');assert.equal(result.projectRecordFence,7);
 await rejects(authority('dot')({taskId:'t',projectFence:2},async value=>value),'STALE_PROJECT_FENCE');
 state.tasks[0].team.owner='dot';state.tasks[0].team.fence++;
 await rejects(authority('scout')({taskId:'t',projectFence:2},async value=>value),'STALE_PROJECT_FENCE');
});
test('parents must exist locally; cycles and task rebinding rejected', async t => {
  const f = await fixture(t);
  await rejects(f.register({ parent: { runId: f.base.runId, attemptId: f.base.attemptId } }), 'RUN_PARENT_CYCLE');
  await rejects(f.register({ parent: { runId: 'missing', attemptId: 'a' } }), 'RUN_PARENT_NOT_FOUND');
  await f.register();
  const child = await f.register({ runId: 'child', operationId: 'child', parent: { runId: f.base.runId, attemptId: f.base.attemptId } });
  assert.equal(child.workerRun.parent.runId, f.base.runId);
  await rejects(f.register({ operationId: 'reparent', parent: { runId: 'child', attemptId: f.base.attemptId } }), 'RUN_CONFLICT');
  f.context.namespace.epoch = 'new';
  await rejects(f.register({ namespace: f.context.namespace, operationId: 'cross', parent: { runId: 'child', attemptId: f.base.attemptId } }), 'STALE_AUTHORITY');
  f.context.namespace.epoch = 'epoch'; f.context.taskId = 'other-task';
  await rejects(f.register({ taskId: 'other-task', attemptId: 'a2', operationId: 'rebind' }), 'STALE_AUTHORITY');
});
test('terminal before running, stale source ordering, terminal dispute and evidence retention', async t => {
  const f = await fixture(t); await f.register();
  const terminal = await f.observe({ eventId: 'done', sequence: 8, status: 'succeeded', reportedAt: 50 });
  assert.equal(terminal.workerRun.status, 'succeeded');
  const late = await f.observe({ eventId: 'late', sequence: 2, status: 'running', reportedAt: 20, settings: { model: 'stale' } }, { expectedRevision: 2 });
  assert.equal(late.workerRun.status, 'succeeded'); assert.deepEqual(late.workerRun.observedSettings, {});
  const conflict = await f.observe({ eventId: 'conflict', sequence: 9, status: 'failed', evidenceRef: 'opaque:private-evidence' }, { expectedRevision: 3 });
  assert.equal(conflict.workerRun.status, 'succeeded'); assert.equal(conflict.workerRun.disputed, true);
  assert.equal(conflict.workerRun.terminalRecordedAt, terminal.workerRun.terminalRecordedAt);
  const persisted = (await f.store.read(f.base.namespace, f.guard())).body.runs[0];
  assert.equal(persisted.events[1].stale, true); assert.equal(persisted.events[2].conflict, true);
  assert.equal(persisted.events[2].evidenceRef, 'opaque:private-evidence');
  assert.equal(conflict.workerRun.events, undefined);
});
test('duplicate and conflicting events, independent streams, stale CAS', async t => {
  const f = await fixture(t); await f.register();
  const e = { eventId: 'event', sequence: 2, status: 'running' }; await f.observe(e);
  const duplicate = await f.observe(e, { operationId: 'duplicate', expectedRevision: 2 }); assert.equal(duplicate.applied, false);
  await rejects(f.observe({ ...e, status: 'failed' }, { operationId: 'conflict', expectedRevision: 2 }), 'RUN_EVENT_CONFLICT');
  await rejects(f.observe({ eventId: 'fresh', sequence: 3, status: 'succeeded' }), 'STALE_RUN');
  f.context.sourceId = 'adapter-two';
  const next = await f.observe({ eventId: 'other-source', sequence: 0, status: 'succeeded' }, { expectedRevision: 2 }); assert.equal(next.workerRun.status, 'succeeded');
});
test('requested settings never masquerade as verified; projection excludes raw evidence', async t => {
  const f = await fixture(t), initial = await f.register(); assert.deepEqual(initial.workerRun.observedSettings, {});
  const seen = await f.observe({ eventId: 'settings', sequence: 1, status: 'running', settings: { model: 'observed-model' }, evidenceRef: 'private-ref' });
  assert.equal(seen.workerRun.requestedSettings.model, 'requested-model');
  assert.equal(seen.workerRun.observedSettings.model.provenance.source, 'authenticated-principal-assertion');
  assert.equal(seen.workerRun.observedSettings.reasoningEffort, undefined);
  const list = await f.service.list({ namespace: f.base.namespace, taskId: 'task', projectFence: 1 });
  assert.equal(JSON.stringify(list).includes('private-ref'), false); assert.equal(list[0].streams, undefined);
  await rejects(f.observe({ eventId: 'forged', sequence: 2, status: 'running', provenance: { source: 'provider-verified' } }, { expectedRevision: 2 }), 'INVALID_RUN');
  await rejects(f.register({ actor: 'human' }), 'INVALID_RUN');
  await rejects(f.observe({ eventId: 'oversize', sequence: 2, status: 'running', evidenceRef: 'x'.repeat(2049) }), 'INVALID_RUN');
  await rejects(f.register({ requestedSettings: { model: 'x'.repeat(121) } }), 'INVALID_RUN');
});
test('new owner reconciles without changing original registration fence', async t => {
  const f = await fixture(t); await f.register(); f.context.projectFence = 2; f.context.actor = 'rook'; f.context.projectOwner = 'rook'; f.context.controlRevision = 2; f.context.executionFence = 1; f.store.db.exec(`UPDATE relay_control_meta SET revision=2; UPDATE relay_control_records SET body='{"id":"project","owner":"rook","ownershipFence":2,"recoveryRequired":false,"status":"active"}' WHERE kind='projects' AND id='project'; INSERT INTO relay_control_records VALUES('agents','rook','{"id":"rook","paused":false,"executionFence":1}');`);
  const r = await f.observe({ eventId: 'reconcile', sequence: 1, status: 'succeeded' }, { projectFence: 2 });
  assert.equal(r.workerRun.originProjectFence, 1); assert.equal(r.workerRun.status, 'succeeded');
});
test('dispatch correlation is immutable even when omitted in a repeated registration', async t => {
  const f = await fixture(t); await f.register({ sourceDispatchId: 'dispatch' });
  await rejects(f.register({ operationId: 'omit-dispatch' }), 'RUN_CONFLICT');
  await rejects(f.register({ operationId: 'change-dispatch', sourceDispatchId: 'other' }), 'RUN_CONFLICT');
});
test('equal and older sequences retain evidence without advancing model or lifecycle', async t => {
  const f = await fixture(t); await f.register();
  await f.observe({ eventId: 'running', sequence: 3, status: 'running', settings: { model: 'first' } });
  const equal = await f.observe({ eventId: 'equal', sequence: 3, status: 'succeeded', settings: { model: 'second' } }, { expectedRevision: 2 });
  assert.equal(equal.workerRun.status, 'running'); assert.equal(equal.workerRun.observedSettings.model.value, 'first');
  assert.equal((await f.store.read(f.base.namespace, f.guard())).body.runs[0].events[1].stale, true);
});
test('non-string lifecycle values reject before mutation, including coercible arrays', async t => {
  const f = await fixture(t); await f.register();
  const before = await f.store.read(f.base.namespace, f.guard());
  for (const status of [['succeeded'], ['failed'], { toString: 'succeeded' }, {}, null, true, 3]) {
    await rejects(f.observe({ eventId: 'invalid-status', sequence: 1, status }), 'INVALID_RUN');
    assert.deepEqual(await f.store.read(f.base.namespace, f.guard()), before);
  }
  await rejects(f.register({ action: ['register'] }), 'INVALID_RUN');
  assert.deepEqual(await f.store.read(f.base.namespace, f.guard()), before);
  const terminal = await f.observe({ eventId: 'success', sequence: 1, status: 'succeeded' });
  await rejects(f.observe({ eventId: 'invalid-after-terminal', sequence: 2, status: ['failed'] }, { expectedRevision: 2 }), 'INVALID_RUN');
  const dispute = await f.observe({ eventId: 'actual-conflict', sequence: 2, status: 'failed' }, { expectedRevision: 2 });
  assert.equal(dispute.workerRun.status, 'succeeded'); assert.equal(dispute.workerRun.disputed, true);
  assert.equal(dispute.workerRun.terminalRecordedAt, terminal.workerRun.terminalRecordedAt);
});
