import test from 'node:test';
import assert from 'node:assert/strict';
import { demoState, applyCommand, hasLease, LEASE_MS, validateState, filterTasks, loadState, saveState, STORAGE_KEY } from '../model.mjs';
const NOW = Date.parse('2026-10-08T18:00:00Z');
const fresh = () => demoState(NOW, 'test-epoch');
let operation = 0;
const run = (state, command, actor = 'human', overrides = {}) => {
  const task = state.tasks.find(item => item.id === command.taskId);
  return applyCommand(state, { token: task?.lease?.token, ...command }, { actor, now: NOW, expectedVersion: task?.version, epoch: state.epoch, operationId: `test-${++operation}`, ...overrides });
};
const input = { title: 'Add an example task', description: 'Synthetic description', component: 'Example.cls', object: 'Case', environment: 'Sandbox / demo', revision: 'demo-r1', type: 'Task', priority: 'Normal', area: 'Salesforce', error: '' };
const task = (s, id = 'RLY-104') => s.tasks.find(t => t.id === id);
test('seed is valid and deployment is separate from completed work', () => {
  const s = fresh(); assert.equal(validateState(s), true); assert.equal(s.tasks.length, 8); assert.equal(task(s, 'RLY-102').lease, null);
  assert.equal(task(s, 'RLY-108').status, 'done'); assert.equal(task(s, 'RLY-108').deployment, 'not_deployed');
});
test('claim is immutable and two contenders with one version cannot both win', () => {
  const s = fresh(); const claimed = run(s, { type: 'claim', taskId: 'RLY-104' }, 'forge');
  assert.equal(task(s).owner, null); assert.equal(task(claimed).owner, 'forge'); assert.equal(task(claimed).fence, 1);
  assert.throws(() => run(claimed, { type: 'claim', taskId: 'RLY-104' }, 'flux', { expectedVersion: task(s).version }), /Stale task version/);
});
test('a new version still cannot steal a live task lease', () => {
  const s = run(fresh(), { type: 'claim', taskId: 'RLY-104' }, 'forge');
  assert.throws(() => run(s, { type: 'claim', taskId: 'RLY-104' }, 'flux'), /active owner/);
});
test('human cannot claim as a bot', () => assert.throws(() => run(fresh(), { type: 'claim', taskId: 'RLY-104' }), /Choose a bot/));
test('dependency blocks claiming until finished', () => assert.throws(() => run(fresh(), { type: 'claim', taskId: 'RLY-105' }, 'dot'), /dependency/));
test('component scope cannot be claimed twice even with different task IDs', () => {
  let s = run(fresh(), { type: 'create', input: { ...input, title: 'Second renewal change', component: 'renewalservice.CLS' } });
  s = run(s, { type: 'triage', taskId: 'RLY-109' });
  assert.throws(() => run(s, { type: 'claim', taskId: 'RLY-109' }, 'flux'), /Component scope is leased by RLY-101/);
});
test('expired ownership is reclaimed with a larger fence; stale writer is rejected', () => {
  let s = run(fresh(), { type: 'claim', taskId: 'RLY-104' }, 'forge'); const token = task(s).lease.token;
  s = run(s, { type: 'claim', taskId: 'RLY-104' }, 'forge', { now: NOW + LEASE_MS + 1 });
  assert.equal(task(s).fence, 2);
  assert.throws(() => run(s, { type: 'heartbeat', taskId: 'RLY-104', token }, 'forge', { now: NOW + LEASE_MS + 2 }), /Stale fencing token/);
});
test('lease expiry has an exact exclusive boundary', () => {
  const t = task(fresh(), 'RLY-101'); assert.equal(hasLease(t, NOW + LEASE_MS - 1), true); assert.equal(hasLease(t, NOW + LEASE_MS), false);
});
test('heartbeat extends a live lease but cannot revive an expired one', () => {
  const s = run(fresh(), { type: 'heartbeat', taskId: 'RLY-101' }, 'forge', { now: NOW + 1000 });
  assert.equal(task(s, 'RLY-101').lease.expiresAt, NOW + 1000 + LEASE_MS);
  assert.throws(() => run(fresh(), { type: 'heartbeat', taskId: 'RLY-101' }, 'forge', { now: NOW + LEASE_MS }), /active lease/);
});
test('release allows another bot to claim and invalidates old writes', () => {
  let s = run(fresh(), { type: 'release', taskId: 'RLY-101' }, 'forge');
  assert.equal(task(s, 'RLY-101').status, 'ready'); assert.equal(task(s, 'RLY-101').owner, null);
  s = run(s, { type: 'claim', taskId: 'RLY-101' }, 'flux'); assert.equal(task(s, 'RLY-101').fence, 3);
  assert.throws(() => run(s, { type: 'artifact', taskId: 'RLY-101', path: 'old.cls', summary: 'Old write' }, 'forge'), /active lease/);
});
test('handoff requires an explanation and transfers ownership atomically', () => {
  assert.throws(() => run(fresh(), { type: 'handoff', taskId: 'RLY-101', target: 'flux', reason: '' }, 'forge'), /Reason/);
  const s = run(fresh(), { type: 'handoff', taskId: 'RLY-101', target: 'flux', reason: 'Flow expertise needed' }, 'forge');
  assert.equal(task(s, 'RLY-101').owner, 'flux'); assert.equal(task(s, 'RLY-101').fence, 2); assert.match(s.events.at(-1).detail, /Flow expertise/);
});
test('override is human-only, reasoned and audited', () => {
  const command = { type: 'override', taskId: 'RLY-101', target: 'dot', reason: 'Take over the stalled work' };
  assert.throws(() => run(fresh(), command, 'lens'), /human supervisor/);
  const s = run(fresh(), command); assert.equal(task(s, 'RLY-101').owner, 'dot'); assert.equal(s.events.at(-1).kind, 'override');
});
test('duplicate idempotency request is a no-op; different payload with same key fails', () => {
  const s = fresh(); const command = { type: 'claim', taskId: 'RLY-104' }; const ctx = { actor: 'forge', now: NOW, expectedVersion: 1, epoch: s.epoch, operationId: 'stable' };
  const result = applyCommand(s, command, ctx); assert.equal(applyCommand(result, command, ctx), result);
  assert.throws(() => applyCommand(result, { ...command, taskId: 'RLY-107' }, ctx), /idempotency key/);
});
test('new task has a stable dedupe key and duplicate capture is rejected', () => {
  const s = run(fresh(), { type: 'create', input }); assert.equal(task(s, 'RLY-109').status, 'inbox');
  assert.throws(() => run(s, { type: 'create', input: { ...input, title: 'ADD an example TASK!' } }), /Duplicate request: RLY-109/);
  assert.throws(() => run(s, { type: 'create', input: { ...input, title: 'bad' } }), /Title/);
  assert.throws(() => run(s, { type: 'create', input: { ...input, title: 'Unknown dependency', dependencies: ['RLY-999'] } }), /dependency does not exist/);
});
test('review requires artifacts and passing evidence bound to revision', () => {
  let s = run(fresh(), { type: 'claim', taskId: 'RLY-104' }, 'forge');
  assert.throws(() => run(s, { type: 'submit', taskId: 'RLY-104' }, 'forge'), /changed artifact/);
  s = run(s, { type: 'artifact', taskId: 'RLY-104', path: 'classes/ContactPreference.cls', summary: 'Move queries out of the loop' }, 'forge');
  assert.throws(() => run(s, { type: 'submit', taskId: 'RLY-104' }, 'forge'), /Passing test evidence/);
  s = run(s, { type: 'tests', taskId: 'RLY-104', passed: 2, failed: 1, note: 'One failing scenario' }, 'forge');
  assert.throws(() => run(s, { type: 'submit', taskId: 'RLY-104' }, 'forge'), /Passing test evidence/);
  s = run(s, { type: 'tests', taskId: 'RLY-104', passed: 3, failed: 0, note: 'All synthetic scenarios' }, 'forge');
  s = run(s, { type: 'submit', taskId: 'RLY-104' }, 'forge'); assert.equal(task(s).status, 'review'); assert.equal(task(s).lease, null);
});
test('independent review and human approval are both required', () => {
  let s = fresh();
  assert.throws(() => run(s, { type: 'review', taskId: 'RLY-102' }, 'flux'), /different bot/);
  assert.throws(() => run(s, { type: 'approve', taskId: 'RLY-102' }), /current independent review/);
  s = run(s, { type: 'review', taskId: 'RLY-102' }, 'lens');
  assert.throws(() => run(s, { type: 'approve', taskId: 'RLY-102' }, 'dot'), /human supervisor/);
  s = run(s, { type: 'approve', taskId: 'RLY-102' }); assert.equal(task(s, 'RLY-102').status, 'done'); assert.equal(task(s, 'RLY-102').deployment, 'not_deployed');
});
test('editing invalidates old evidence; reviewed work must be reopened', () => {
  const old = task(fresh(), 'RLY-101');
  const s = run(fresh(), { type: 'edit', taskId: old.id, input: { ...old, revision: 'demo-r5' } });
  assert.equal(task(s, old.id).tests, null); assert.equal(task(s, old.id).revision, 'demo-r5');
  assert.throws(() => run(fresh(), { type: 'edit', taskId: 'RLY-103', input: task(fresh(), 'RLY-103') }), /Reopen/);
});
test('reopen clears approval and preserves the audit trail', () => {
  const s = run(fresh(), { type: 'reopen', taskId: 'RLY-108', reason: 'Another edge case was found' });
  const t = task(s, 'RLY-108'); assert.equal(t.status, 'ready'); assert.equal(t.approval, null); assert.equal(t.reviewer, null); assert.equal(t.tests, null); assert.equal(t.artifacts.length, 1);
});
test('block releases the lease and only human can clear a blocker', () => {
  let s = run(fresh(), { type: 'block', taskId: 'RLY-101', reason: 'Waiting for a routing decision' }, 'forge');
  assert.equal(task(s, 'RLY-101').lease, null); assert.equal(task(s, 'RLY-101').status, 'blocked');
  assert.throws(() => run(s, { type: 'unblock', taskId: 'RLY-101', reason: 'Policy now confirmed' }, 'dot'), /human supervisor/);
  s = run(s, { type: 'unblock', taskId: 'RLY-101', reason: 'Policy now confirmed' }); assert.equal(task(s, 'RLY-101').status, 'ready');
});
test('messages are scoped and invalid room or blank text is rejected', () => {
  const s = run(fresh(), { type: 'message', channel: 'task:RLY-104', text: 'Please review this task only.' }, 'dot');
  assert.equal(s.messages.at(-1).channel, 'task:RLY-104');
  assert.throws(() => run(s, { type: 'message', channel: 'direct:unknown', text: 'Hello' }), /Unknown discussion/);
  assert.throws(() => run(s, { type: 'message', channel: 'general', text: '  ' }), /Message/);
});
test('search covers error signatures and owner/status/priority filters intersect', () => {
  const s = fresh(); assert.equal(filterTasks(s.tasks, { search: 'too many soql' })[0].id, 'RLY-104');
  assert.equal(filterTasks(s.tasks, { owner: 'flux', status: 'review', priority: 'High' }).length, 1);
  assert.equal(filterTasks(s.tasks, { search: 'not-found-xyz' }).length, 0);
});
test('storage round-trip, reset epoch and corrupt storage are guarded', () => {
  const map = new Map(); const storage = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v) };
  const s = fresh(); assert.equal(saveState(storage, s), ''); assert.deepEqual(loadState(storage, NOW).state, s);
  assert.throws(() => run(s, { type: 'claim', taskId: 'RLY-104' }, 'forge', { epoch: 'old-session' }), /session was reset/);
  storage.setItem(STORAGE_KEY, '{}'); assert.match(loadState(storage, NOW).warning, /invalid/);
  const malformed = fresh(); malformed.tasks[0].lease = { token: 'bad' }; assert.equal(validateState(malformed), false);
  assert.match(saveState({ setItem() { throw new Error('quota'); } }, s), /this tab only/);
});
