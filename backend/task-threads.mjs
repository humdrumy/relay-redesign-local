import { RelayError } from './core.mjs';

const fail = (code, message, status = 409) => { throw new RelayError(code, message, status); };
const text = (value, name, max = 512) => {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > max)
    fail('INVALID_THREAD_REQUEST', `${name} must be a bounded nonempty string.`, 400);
  return value;
};
const timestamp = value => typeof value === 'string' && /^\d+\.\d+$(?![\s\S])/.test(value);
const copy = value => structuredClone(value);
function input(value) {
  const fields = ['namespace', 'taskId', 'channelId', 'operationId', 'payloadRef'];
  if (!value || Object.keys(value).some(key => !fields.includes(key))) fail('INVALID_THREAD_REQUEST', 'Use the typed thread envelope.', 400);
  const ns = value.namespace;
  if (!ns || Object.keys(ns).sort().join(',') !== 'epoch,instanceId,workspaceId') fail('INVALID_THREAD_REQUEST', 'Use instanceId, epoch and workspaceId namespace.', 400);
  const namespace = Object.fromEntries(['instanceId', 'epoch', 'workspaceId'].map(key => [key, text(ns[key], key)]));
  return { namespace, ...Object.fromEntries(fields.slice(1).map(key => [key, text(value[key], key, key === 'payloadRef' ? 2048 : 512)])) };
}
function authoritySnapshot(value, request) {
  if (!value || value.controlEpoch !== request.namespace.epoch ||
      !Number.isSafeInteger(value.controlRevision) || value.controlRevision < 1)
    fail('THREAD_AUTHORITY_REQUIRED', 'Provide a trusted exact control snapshot.', 403);
  return copy(value);
}
const keyOf = request => [request.namespace.instanceId, request.namespace.epoch, request.namespace.workspaceId, request.taskId];

// Explicit adapter for the existing openSqlite / D1 prepare().bind() contract.
// Initialization is opt-in; importing this file changes nothing.
export const TASK_THREADS_SCHEMA = `CREATE TABLE IF NOT EXISTS relay_task_threads (
  instance_id TEXT NOT NULL, epoch TEXT NOT NULL, workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (instance_id, epoch, workspace_id, task_id)
);`;
export class SqlTaskThreadStore {
  constructor(database) { this.db = database; }
  async initialize() { await this.db.exec(TASK_THREADS_SCHEMA); }
  async read(key) {
    const row = await this.db.prepare('SELECT revision, body FROM relay_task_threads WHERE instance_id=? AND epoch=? AND workspace_id=? AND task_id=?').bind(...key).first();
    return row ? { revision: row.revision, body: JSON.parse(row.body) } : null;
  }
  async commit(key, previous, body, guard) {
    const json = JSON.stringify(body);
    if (new TextEncoder().encode(json).length > 1024 * 1024) fail('THREAD_CAPACITY', 'Task thread record exceeds capacity.', 507);
    // Only reservations carry a guard. Receipt/reconciliation writes retain evidence
    // after transfer and cannot grant another dispatch.
    const predicate = guard ? " AND EXISTS (SELECT 1 FROM relay_control_meta WHERE id='main' AND epoch=? AND revision=?)" : '';
    const bindings = guard ? [guard.controlEpoch, guard.controlRevision] : [];
    const result = previous
      ? await this.db.prepare('UPDATE relay_task_threads SET revision=?, body=? WHERE instance_id=? AND epoch=? AND workspace_id=? AND task_id=? AND revision=?' + predicate).bind(previous.revision + 1, json, ...key, previous.revision, ...bindings).run()
      : await this.db.prepare('INSERT INTO relay_task_threads (instance_id,epoch,workspace_id,task_id,revision,body) SELECT ?,?,?,?,1,? WHERE 1=1' + predicate + ' ON CONFLICT(instance_id,epoch,workspace_id,task_id) DO NOTHING').bind(...key, json, ...bindings).run();
    if (Number(result.meta?.changes) !== 1 && guard) {
      const current = await this.db.prepare("SELECT epoch, revision FROM relay_control_meta WHERE id='main'").bind().first();
      if (!current || current.epoch !== guard.controlEpoch || current.revision !== guard.controlRevision)
        fail('THREAD_STALE_AUTHORITY', 'Control authority changed. Re-authorize before reserving.', 403);
    }
    return Number(result.meta?.changes) === 1;
  }
}

/** Internal authorized service. No actor selection, HTTP routes, timers or Slack credentials. */
export class TaskThreads {
  constructor(store, transport, { assertCanSend } = {}) {
    if (!store || typeof transport?.send !== 'function' || typeof transport?.lookup !== 'function' || typeof assertCanSend !== 'function')
      fail('THREAD_CONFIGURATION', 'Provide a durable store, trusted transport and final authorization checker.', 500);
    this.store = store; this.transport = transport; this.assertCanSend = assertCanSend;
  }
  async #change(request, mutate, guard) {
    const key = keyOf(request);
    for (let i = 0; i < 32; i++) {
      const previous = await this.store.read(key);
      const body = previous ? copy(previous.body) : { channelId: request.channelId, root: null, replies: [] };
      if (body.channelId !== request.channelId) fail('THREAD_CHANNEL_CONFLICT', 'The task channel is immutable.');
      const outcome = mutate(body);
      if (!outcome.write || await this.store.commit(key, previous, body, guard)) return copy(outcome.value);
    }
    fail('THREAD_BUSY', 'Retry this same operation.');
  }
  #match(record, request) {
    if (record.payloadRef !== request.payloadRef) fail('THREAD_OPERATION_CONFLICT', 'The operation payload reference is immutable.');
  }
  async #reserve(request, kind, guard) {
    return this.#change(request, body => {
      let record = kind === 'root' ? body.root : body.replies.find(row => row.operationId === request.operationId);
      if (kind === 'reply' && body.root?.status !== 'confirmed') fail('THREAD_ROOT_UNCONFIRMED', 'Confirm the root before enqueueing replies.');
      if ((kind === 'reply' && body.root?.operationId === request.operationId) ||
          (kind === 'root' && body.replies.some(row => row.operationId === request.operationId)))
        fail('THREAD_OPERATION_CONFLICT', 'An operation cannot be both a root and a reply.');
      if (record) {
        if (record.operationId !== request.operationId) fail('THREAD_OPERATION_CONFLICT', 'Use the original root operation ID.');
        this.#match(record, request);
        return { write: false, value: { record, dispatch: false } };
      }
      if (body.replies.length >= 5000) fail('THREAD_CAPACITY', 'Task reply capacity reached.', 507);
      record = { kind, operationId: request.operationId, payloadRef: request.payloadRef, status: 'reserved',
        attempt: 1, messageTs: null, rootMessageTs: kind === 'reply' ? body.root.messageTs : null };
      if (kind === 'root') body.root = record; else body.replies.push(record);
      return { write: true, value: { record, dispatch: true } };
    }, guard);
  }
  async #finish(request, reserved, evidence) {
    const confirmed = evidence && !Array.isArray(evidence) && evidence.taskId === request.taskId &&
      ['instanceId', 'epoch', 'workspaceId'].every(key => evidence.namespace?.[key] === request.namespace[key]) &&
      evidence.operationId === reserved.operationId && evidence.channelId === request.channelId &&
      evidence.payloadRef === reserved.payloadRef && timestamp(evidence.messageTs) &&
      (reserved.kind === 'root' ? evidence.rootMessageTs === null : evidence.rootMessageTs === reserved.rootMessageTs && evidence.messageTs !== reserved.rootMessageTs);
    return this.#change(request, body => {
      const record = reserved.kind === 'root' ? body.root : body.replies.find(row => row.operationId === reserved.operationId);
      if (!record || record.attempt !== reserved.attempt || record.status === 'confirmed')
        return { write: false, value: record };
      record.status = confirmed ? 'confirmed' : 'uncertain';
      if (confirmed) {
        record.messageTs = evidence.messageTs;
        if (record.kind === 'root') record.rootMessageTs = evidence.messageTs;
      }
      return { write: true, value: record };
    });
  }
  async #dispatch(value, kind, authority) {
    const request = input(value), guard = authoritySnapshot(authority, request);
    const { record, dispatch } = await this.#reserve(request, kind, guard);
    if (!dispatch) return record;
    let evidence, checked = false, allowed = false;
    const operation = copy({ ...request, ...record });
    const beforePost = async () => {
      if (checked) return false;
      checked = true; // Consume even on denial/error; this grant never resets.
      allowed = await this.assertCanSend(copy(operation), copy(guard)) === true;
      return allowed;
    };
    try {
      evidence = await this.transport.send(copy(operation), Object.freeze({ beforePost }));
      if (!checked || !allowed) evidence = null;
    } catch { /* Denied or ambiguous send: preserve uncertainty and never resend. */ }
    return this.#finish(request, record, evidence);
  }
  ensureRoot(request, authority) { return this.#dispatch(request, 'root', authority); }
  enqueueReply(request, authority) { return this.#dispatch(request, 'reply', authority); }
  async reconcile(value, kind) {
    if (!['root', 'reply'].includes(kind)) fail('INVALID_THREAD_REQUEST', 'Choose root or reply.', 400);
    const request = input(value);
    const reserved = await this.#change(request, body => {
      const record = kind === 'root' ? body.root : body.replies.find(row => row.operationId === request.operationId);
      if (!record) fail('THREAD_OPERATION_NOT_FOUND', 'Reserve the operation before reconciliation.', 404);
      if (record.operationId !== request.operationId) fail('THREAD_OPERATION_CONFLICT', 'Reconcile the original operation.');
      this.#match(record, request);
      if (record.status === 'confirmed') return { write: false, value: record };
      record.attempt++;
      record.status = 'uncertain';
      return { write: true, value: record };
    });
    if (reserved.status === 'confirmed') return reserved;
    let evidence;
    try { evidence = await this.transport.lookup(copy({ ...request, ...reserved })); } catch { /* Remain uncertain. */ }
    return this.#finish(request, reserved, evidence);
  }
}
