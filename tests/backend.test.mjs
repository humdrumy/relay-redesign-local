import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { openSqlite } from '../backend/sqlite-local.mjs';
import { applyMigrations } from '../backend/migrations-local.mjs';
import { WorkspaceStore } from '../backend/store.mjs';
import { createHandler, MCP_TOOLS } from '../backend/http.mjs';
import { readRoom, readInbox, resolvePrincipal, ROLE_DEFINITIONS } from '../backend/core.mjs';
const OWNER = 'test-owner', bindings = { 'engineer-a': 'forge', 'engineer-b': 'flux', 'reviewer-a': 'lens', 'coordinator-a': 'dot' };
const input = suffix => ({ title: `Synthetic backend test ${suffix}`, component: `Component-${suffix}`, environment: 'Sandbox / test', revision: 'test-r1', type: 'Task', priority: 'Normal', area: 'Test', object: 'Synthetic', description: 'Inert synthetic coordination record.' });
async function fixture(t, { bound = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-backend-')), file = join(directory, 'state.sqlite'), db = openSqlite(file);
  await applyMigrations(db); let now = 1900000000000;
  const options = { bindings: bound ? bindings : {}, now: () => now }, store = new WorkspaceStore(db, options);
  await store.bootstrap(OWNER);
  const connections = [db];
  t.after(() => { for (const connection of connections) { try { connection.close(); } catch {} } rmSync(directory, { recursive: true, force: true }); });
  const request = async (command, overrides = {}) => { const doc = await store.read(); const task = doc.state.tasks.find(item => item.id === command.taskId); return { command: { token: task?.lease?.token, resourceFence: task?.resourceFence, ...command }, epoch: doc.state.epoch, expectedVersion: task?.version, operationId: crypto.randomUUID(), ...overrides }; };
  const run = async (subject, command, overrides) => store.command(subject, await request(command, overrides));
  const create = async suffix => { const result = await run(OWNER, { type: 'create', input: input(suffix) }); const id = result.result.taskId; await run(OWNER, { type: 'triage', taskId: id }); return id; };
  return { directory, file, db, connections, store, options, request, run, create, advance: delta => { now += delta; } };
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);
test('private bootstrap is immutable, durable and owner restricted', async t => {
  const f = await fixture(t); const before = await f.store.read();
  await rejectsCode(f.store.bootstrap('another-owner'), 'FORBIDDEN');
  assert.deepEqual(await f.store.read(), before); assert.equal(before.executionEnabled, false);
  assert.equal(before.state.messages.length, 0); assert.ok(before.state.tasks.every(task => task.synthetic && !task.owner));
});
test('default role identities are unbound and caller actor fields are rejected', async t => {
  const f = await fixture(t, { bound: false });
  await rejectsCode(f.run('engineer-a', { type: 'create', input: input('x') }), 'FORBIDDEN');
  await rejectsCode(f.run(OWNER, { type: 'message', actor: 'dot', channel: 'general', text: 'spoof' }), 'INVALID_COMMAND');
  const request = await f.request({ type: 'message', channel: 'general', text: 'hello' });
  await rejectsCode(f.store.command(OWNER, { ...request, actor: 'forge' }), 'INVALID_REQUEST');
});
test('owner MCP identity is a read-only coordinator context, not agent attestation', async t => {
  const f = await fixture(t); const doc = await f.store.read();
  const principal = resolvePrincipal(doc, OWNER, { mcp: true });
  assert.equal(principal.actor, 'dot'); assert.equal(principal.readOnly, true);
  assert.throws(() => resolvePrincipal(doc, 'engineer-a', { mcp: true, bindings }), error => error.code === 'FORBIDDEN');
  assert.deepEqual(Object.keys(ROLE_DEFINITIONS).sort(), ['coordinator', 'engineer', 'human', 'reviewer']);
});
test('two independent SQL connections competing for one version produce one owner', async t => {
  const f = await fixture(t), id = await f.create('race'), otherDB = openSqlite(f.file); f.connections.push(otherDB);
  const other = new WorkspaceStore(otherDB, f.options), request = await f.request({ type: 'claim', taskId: id });
  const results = await Promise.allSettled([f.store.command('engineer-a', request), other.command('engineer-b', { ...request, operationId: crypto.randomUUID() })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'STALE_TASK');
  const doc = await f.store.read(), task = doc.state.tasks.find(item => item.id === id);
  assert.ok(['forge', 'flux'].includes(task.owner)); assert.equal(task.lease.token, 1); assert.equal(Object.values(doc.resources).filter(item => item.taskId === id).length, 1);
});
test('separate worker processes race against durable SQLite CAS', async t => {
  const f = await fixture(t), id = await f.create('process-race'), request = await f.request({ type: 'claim', taskId: id });
  const children = ['engineer-a', 'engineer-b'].map(subject => fork(new URL('./claim-worker.mjs', import.meta.url), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }));
  t.after(() => children.forEach(child => child.kill()));
  const closed = children.map(child => once(child, 'close'));
  const ready = children.map(child => once(child, 'message')); await Promise.all(ready);
  const outcomes = children.map(child => once(child, 'message'));
  children.forEach((child, index) => child.send({ file: f.file, subject: index ? 'engineer-b' : 'engineer-a', request: { ...request, operationId: crypto.randomUUID() } }));
  const results = (await Promise.all(outcomes)).map(([value]) => value);
  await Promise.all(closed);
  assert.equal(results.filter(value => value.ok).length, 1); assert.equal(results.find(value => !value.ok).code, 'STALE_TASK');
});
test('component scope conflicts across distinct tasks and fencing is monotonic', async t => {
  const f = await fixture(t), first = await f.create('scope-a');
  const data = { ...input('scope-b'), component: 'Component-scope-a' };
  const second = (await f.run(OWNER, { type: 'create', input: data })).result.taskId; await f.run(OWNER, { type: 'triage', taskId: second });
  await f.run('engineer-a', { type: 'claim', taskId: first });
  await assert.rejects(f.run('engineer-b', { type: 'claim', taskId: second }), /scope/i);
  const old = (await f.store.read()).state.tasks.find(item => item.id === first).resourceFence;
  await f.run('engineer-a', { type: 'release', taskId: first });
  const result = await f.run('engineer-b', { type: 'claim', taskId: second });
  assert.ok(result.state.tasks.find(item => item.id === second).resourceFence > old);
});
test('lease expiry, reclaim and stale task/component fences reject old writers', async t => {
  const f = await fixture(t), id = await f.create('expiry'); await f.run('engineer-a', { type: 'claim', taskId: id });
  const old = (await f.store.read()).state.tasks.find(item => item.id === id);
  f.advance(16 * 60000); await rejectsCode(f.run('engineer-a', { type: 'heartbeat', taskId: id }), 'LEASE_REQUIRED');
  await f.run('engineer-b', { type: 'claim', taskId: id });
  await rejectsCode(f.run('engineer-b', { type: 'heartbeat', taskId: id, token: old.lease.token }), 'STALE_FENCE');
  await rejectsCode(f.run('engineer-b', { type: 'heartbeat', taskId: id, resourceFence: old.resourceFence }), 'STALE_RESOURCE_FENCE');
});
test('heartbeat extends both leases; release revokes resource ownership', async t => {
  const f = await fixture(t), id = await f.create('heartbeat'); await f.run('engineer-a', { type: 'claim', taskId: id });
  const before = (await f.store.read()).state.tasks.find(item => item.id === id).lease.expiresAt;
  f.advance(1000); await f.run('engineer-a', { type: 'heartbeat', taskId: id }); const doc = await f.store.read();
  assert.ok(doc.state.tasks.find(item => item.id === id).lease.expiresAt > before);
  assert.equal(Object.values(doc.resources).find(item => item.taskId === id).expiresAt, before + 1000);
  await f.run('engineer-a', { type: 'release', taskId: id }); assert.ok(Object.values((await f.store.read()).resources).every(item => item.taskId !== id));
});
test('idempotency survives intervening writes and conflicting reuse fails', async t => {
  const f = await fixture(t), request = await f.request({ type: 'message', channel: 'general', text: 'one message', recipients: ['dot'] });
  await f.store.command(OWNER, request); await f.run(OWNER, { type: 'message', channel: 'general', text: 'intervening' });
  const result = await f.store.command(OWNER, request); assert.equal(result.result.replayed, true); assert.equal(result.state.messages.length, 2);
  await rejectsCode(f.store.command(OWNER, { ...request, command: { ...request.command, text: 'different' } }), 'IDEMPOTENCY_KEY_REUSED');
  await f.run(OWNER, { type: 'create', input: input('owner-same-key') }, { operationId: 'same-key' });
  const differentActor = await f.run('coordinator-a', { type: 'create', input: input('coordinator-same-key') }, { operationId: 'same-key' });
  assert.equal(differentActor.state.events.at(-1).actor, 'dot');
});
test('handoff is an explicit offer and acceptance transfers ownership atomically', async t => {
  const f = await fixture(t), id = await f.create('handoff'); await f.run('engineer-a', { type: 'claim', taskId: id });
  const offer = await f.run('engineer-a', { type: 'handoff', taskId: id, target: 'flux', reason: 'Please inspect this component.' });
  assert.equal(offer.state.tasks.find(item => item.id === id).owner, 'forge');
  const accepted = await f.run('engineer-b', { type: 'accept_handoff', taskId: id, handoffId: offer.result.handoffId });
  assert.equal(accepted.state.tasks.find(item => item.id === id).owner, 'flux');
  await rejectsCode(f.run('engineer-a', { type: 'release', taskId: id }), 'LEASE_REQUIRED');
});
test('stale or wrong-recipient handoff acceptance fails', async t => {
  const f = await fixture(t), id = await f.create('stale-offer');
  const offer = await f.run(OWNER, { type: 'offer_handoff', taskId: id, target: 'forge', reason: 'Please own this record.' });
  await rejectsCode(f.run('engineer-b', { type: 'accept_handoff', taskId: id, handoffId: offer.result.handoffId }), 'HANDOFF_NOT_ADDRESSED');
  await f.run(OWNER, { type: 'edit', taskId: id, input: input('stale-offer') });
  await rejectsCode(f.run('engineer-a', { type: 'accept_handoff', taskId: id, handoffId: offer.result.handoffId }), 'STALE_HANDOFF');
});
test('review and human approval require independent accepted handoffs', async t => {
  const f = await fixture(t), id = await f.create('approval'); await f.run('engineer-a', { type: 'claim', taskId: id });
  await f.run('engineer-a', { type: 'artifact', taskId: id, path: 'synthetic.txt', summary: 'Inert artifact record.' });
  await f.run('engineer-a', { type: 'tests', taskId: id, passed: 1, failed: 0, note: 'Synthetic evidence for policy test.' });
  const submitted = await f.run('engineer-a', { type: 'submit', taskId: id });
  await rejectsCode(f.run('reviewer-a', { type: 'review', taskId: id }), 'HANDOFF_REQUIRED');
  await f.run('reviewer-a', { type: 'accept_handoff', taskId: id, handoffId: submitted.result.handoffId });
  const reviewed = await f.run('reviewer-a', { type: 'review', taskId: id });
  await rejectsCode(f.run(OWNER, { type: 'approve', taskId: id }), 'HANDOFF_REQUIRED');
  await f.run(OWNER, { type: 'accept_handoff', taskId: id, handoffId: reviewed.result.handoffId });
  const result = await f.run(OWNER, { type: 'approve', taskId: id }); const task = result.state.tasks.find(item => item.id === id);
  assert.equal(task.status, 'done'); assert.equal(task.deployment, 'not_deployed'); assert.equal(result.executionEnabled, false);
  const reopened = await f.run(OWNER, { type: 'reopen', taskId: id, reason: 'New revision needs review.' }); assert.equal(reopened.state.tasks.find(item => item.id === id).approval, null);
});
test('role policy denies human claims, engineer approval and coordinator live editing', async t => {
  const f = await fixture(t), id = await f.create('role-policy');
  await rejectsCode(f.run(OWNER, { type: 'claim', taskId: id }), 'FORBIDDEN');
  await f.run('engineer-a', { type: 'claim', taskId: id });
  await rejectsCode(f.run('engineer-a', { type: 'approve', taskId: id }), 'FORBIDDEN');
  await rejectsCode(f.run('coordinator-a', { type: 'edit', taskId: id, input: input('role-policy') }), 'FORBIDDEN');
});
test('coordinator planning changes keep its own actor in audit', async t => {
  const f = await fixture(t), id = await f.create('coordinator');
  const result = await f.run('coordinator-a', { type: 'edit', taskId: id, input: { ...input('coordinator'), title: 'Updated planning description' } });
  assert.equal(result.state.events.at(-1).actor, 'dot');
  const blocked = await f.run('coordinator-a', { type: 'block', taskId: id, reason: 'Needs a human decision.' }); assert.equal(blocked.state.events.at(-1).actor, 'dot');
});
test('human override requires a reason, revokes immediately and leaves an offered handoff', async t => {
  const f = await fixture(t), id = await f.create('override'); await f.run('engineer-a', { type: 'claim', taskId: id });
  await rejectsCode(f.run(OWNER, { type: 'override', taskId: id, target: 'flux', reason: '' }), 'INVALID_INPUT');
  const result = await f.run(OWNER, { type: 'override', taskId: id, target: 'flux', reason: 'Owner unavailable; transfer planning responsibility.' });
  assert.equal(result.state.tasks.find(item => item.id === id).owner, null);
  assert.ok(result.state.events.some(event => event.kind === 'human_override' && event.detail.includes('Owner unavailable')));
  assert.equal(result.offers.at(-1).status, 'pending');
});
test('room membership protects direct messages and cursor reads do not acknowledge', async t => {
  const f = await fixture(t); await f.run(OWNER, { type: 'message', channel: 'direct:dot', text: 'Coordinator context', recipients: ['dot'] });
  await f.run(OWNER, { type: 'message', channel: 'direct:forge', text: 'Engineer private context', recipients: ['forge'] });
  const doc = await f.store.read(), dot = resolvePrincipal(doc, OWNER, { mcp: true });
  const room = readRoom(doc, dot, 'direct:dot'); assert.equal(room.messages.length, 1); assert.equal(readRoom(doc, dot, 'direct:dot', room.nextCursor).messages.length, 0);
  assert.throws(() => readRoom(doc, dot, 'direct:forge'), error => error.code === 'FORBIDDEN');
  assert.equal(readInbox(doc, dot).items.length, 1); assert.equal(doc.receipts.length, 0);
});
test('receipts are seen-only and loops, self-replies and fifth hops are rejected', async t => {
  const f = await fixture(t); let result = await f.run(OWNER, { type: 'message', channel: 'general', text: 'Question', recipients: ['dot'] }); let id = result.result.messageId;
  await f.run('coordinator-a', { type: 'ack_message', messageId: id }); assert.equal((await f.store.read()).receipts[0].meaning, 'seen-only');
  await rejectsCode(f.run(OWNER, { type: 'message', channel: 'general', text: 'self reply', parentId: id }), 'LOOP_PREVENTED');
  for (let hop = 1; hop <= 4; hop++) { result = await f.run(hop % 2 ? 'coordinator-a' : OWNER, { type: 'message', channel: 'general', text: `reply ${hop}`, parentId: id }); id = result.result.messageId; }
  await rejectsCode(f.run('coordinator-a', { type: 'message', channel: 'general', text: 'fifth reply', parentId: id }), 'HOP_LIMIT');
});
test('duplicate intake, unresolved dependencies and task execution are rejected', async t => {
  const f = await fixture(t), id = await f.create('dedupe'); await assert.rejects(f.run(OWNER, { type: 'create', input: input('dedupe') }), /Duplicate/);
  const dependent = (await f.run(OWNER, { type: 'create', input: { ...input('dependent'), dependencies: [id] } })).result.taskId;
  await f.run(OWNER, { type: 'triage', taskId: dependent }); await assert.rejects(f.run('engineer-a', { type: 'claim', taskId: dependent }), /dependency/);
  await rejectsCode(f.run(OWNER, { type: 'execute', taskId: id }), 'COMMAND_NOT_SUPPORTED');
});
test('messages and operation identities survive reopening the database', async t => {
  const f = await fixture(t), request = await f.request({ type: 'message', channel: 'direct:dot', text: 'durable test marker' }); await f.store.command(OWNER, request);
  f.db.close(); const db = openSqlite(f.file); f.connections.push(db); await applyMigrations(db);
  const store = new WorkspaceStore(db, f.options), result = await store.command(OWNER, request);
  assert.equal(result.result.replayed, true); assert.equal(result.state.messages.length, 1); assert.equal(result.state.messages[0].text, 'durable test marker');
});
function req(path, body, subject = OWNER, headers = {}) { return new Request(`https://relay.test${path}`, { method: body ? 'POST' : 'GET', headers: { ...(subject ? { 'oai-authenticated-user-id': subject } : {}), ...(body ? { 'content-type': 'application/json', origin: 'https://relay.test', 'x-relay-client': '1' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
const rpc = (name, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
test('HTTP denies missing identity, cross-owner calls, cross-origin writes and spoofed roles', async t => {
  const f = await fixture(t), handle = createHandler();
  for (const [request, status] of [[req('/api/workspace', null, null), 401], [req('/api/workspace', null, 'other'), 403], [req('/api/bootstrap', {}, OWNER, { origin: 'https://evil.test' }), 403], [req('/api/command', { actor: 'forge', command: { type: 'message' } }), 400]]) assert.equal((await handle(request, { DB: f.db })).status, status);
});
test('MCP exposes seven read tools, legacy wake receipt and bounded owner task creation, enforcing identity and room membership', async t => {
  const f = await fixture(t), handle = createHandler();
  assert.equal(MCP_TOOLS.length, 9); assert.equal(MCP_TOOLS.filter(tool => tool.annotations.readOnlyHint).length, 7); assert.deepEqual(MCP_TOOLS.filter(tool => !tool.annotations.readOnlyHint).map(tool => tool.name), ['relay_ack_wake','relay_owner_create_relay_task']);
  assert.equal((await handle(req('/mcp', rpc('relay_list_rooms'), null), { DB: f.db })).status, 401);
  assert.equal((await handle(req('/mcp', rpc('relay_list_rooms'), 'another-owner'), { DB: f.db })).status, 403);
  assert.equal((await handle(req('/mcp', rpc('relay_read_room', { room: 'direct:forge' })), { DB: f.db })).status, 403);
  assert.equal((await handle(req('/mcp', rpc('relay_read_room', { room: 'general', role: 'human' })), { DB: f.db })).status, 400);
});
test('saved human room message is returned unchanged by authenticated MCP read', async t => {
  const f = await fixture(t), handle = createHandler(), text = 'RELAY CONNECTION TEST: read this as context, not a task.';
  const request = await f.request({ type: 'message', channel: 'direct:dot', text });
  assert.equal((await handle(req('/api/command', request), { DB: f.db })).status, 200);
  const response = await handle(req('/mcp', rpc('relay_read_room', { room: 'direct:dot' })), { DB: f.db }); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.result.structuredContent.messages[0].text, text); assert.equal(body.result.structuredContent.executionEnabled, false);
  const inbox = await (await handle(req('/mcp', rpc('relay_read_inbox')), { DB: f.db })).json(); assert.equal(inbox.result.structuredContent.automaticWake, 'not-configured');
});
test('built Worker serves shared frontend and the same authenticated MCP contract', async t => {
  const f = await fixture(t), worker = (await import('../dist-shared/server/index.js')).default;
  const html = await worker.fetch(req('/'), { DB: f.db }); assert.equal(html.status, 200); assert.match(await html.text(), /src="\/control-app.mjs"/);
  const response = await worker.fetch(req('/mcp', rpc('relay_role_briefing')), { DB: f.db }); assert.equal(response.status, 200);
  assert.equal((await response.json()).result.structuredContent.effectiveRole, 'coordinator');
});
