import { RelayError } from './core.mjs';
import { controlIdentity } from './control-http.mjs';
import { controlPrincipal } from './control.mjs';
import {taskAuthority} from './team-planning.mjs';
import { SqlWorkerRunStore, WorkerRuns, createServerWithAuthority, workerRunProjection } from './worker-runs.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const fail = (code, message, status = 400) => { throw new RelayError(code, message, status); };
const enabled = env => env.RELAY_WORKER_RUNS_ENABLED === 'true';
function boundedInt(value) { if (!/^(0|[1-9][0-9]*)$/.test(value || '')) fail('INVALID_RUN', 'Expected a nonnegative integer.', 400); const n = Number(value); if (!Number.isSafeInteger(n)) fail('INVALID_RUN', 'Expected a nonnegative integer.', 400); return n; }
async function readJSON(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail('CONTENT_TYPE', 'Use application/json.', 415);
  const reader = request.body?.getReader(); let size = 0; const chunks = [];
  if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); fail('BODY_TOO_LARGE', 'Worker run request exceeds 8 KiB.', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('INVALID_JSON', 'Body must be valid JSON.', 400); }
}
const overrides = new Set(['actor', 'subject', 'sourceId', 'namespace', 'instanceId', 'workspaceId', 'epoch']);
function noOverrides(body) { if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => overrides.has(k))) fail('INVALID_RUN', 'Identity and namespace are server controlled.', 400); }
function config(env) {
  const instanceId = env.RELAY_WORKER_RUNS_INSTANCE_ID, workspaceId = env.RELAY_WORKER_RUNS_WORKSPACE_ID;
  if (!instanceId || instanceId.length > 200 || !workspaceId || workspaceId.length > 200) fail('RUN_CONFIGURATION', 'Worker run namespace configuration is missing.', 503);
  return { instanceId, workspaceId };
}
export function createWorkerRunsHttp({ env, db, currentControlStore, authenticateSubject, onCommandCommitted }) {
  return async function handleWorkerRuns(request) {
    if (!enabled(env)) return json({ error: 'FEATURE_DISABLED', message: 'Worker run HTTP integration is disabled.' }, 404);
    try {
      if (!db || !currentControlStore || !authenticateSubject) fail('RUN_CONFIGURATION', 'Worker run server dependencies are unavailable.', 503);
      const { instanceId, workspaceId } = config(env);
      const subject = authenticateSubject(request);
      const identity = await controlIdentity(request, env, subject);
      const sourceId = identity.subject;
      const snapshot = await currentControlStore.read();
      const namespace = { instanceId, workspaceId, epoch: snapshot.meta?.epoch };
      if (!namespace.epoch || namespace.epoch.length > 200) fail('RUN_CONFIGURATION', 'Current control epoch is unavailable.', 503);
      const store = new SqlWorkerRunStore(db);
      const service = new WorkerRuns(store, { withAuthority: createServerWithAuthority({ currentControlStore, identity, instanceId, workspaceId, sourceId }) });
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/worker-runs') {
        if ([...url.searchParams.keys()].some(k => !['taskId', 'projectFence'].includes(k))) fail('INVALID_RUN', 'Unexpected query fields.', 400);
        const taskId = url.searchParams.get('taskId'); if (!taskId || taskId.length > 200) fail('INVALID_RUN', 'Provide a bounded taskId.', 400);
        const projectFence = boundedInt(url.searchParams.get('projectFence'));
        if (identity.kind === 'human') {
          // Human access is a genuine, read-only Site-owner path. Keep caller
          // identity out of the agent authority callback and guard the SQL read
          // against concurrent owner, epoch, task, or assignment changes.
          controlPrincipal(snapshot, identity);
          const task = snapshot.tasks.find(record => record.id === taskId);
          if (!task) fail('TASK_NOT_FOUND', 'Task not found.', 404);
          const project = snapshot.projects.find(record => record.id === task.projectId);
          if (!project || taskAuthority(snapshot,task)?.ownershipFence !== projectFence) fail('STALE_PROJECT_FENCE', 'Task authority changed.');
          const current = await store.readOwner(namespace, { siteOwnerId: identity.subject, controlRevision: snapshot.meta.revision, taskId: task.id, projectId: task.projectId, taskVersion: task.version, projectFence: project.ownershipFence });
          const workerRuns = (current?.body.runs || []).filter(run => run.taskId === task.id && run.projectId === task.projectId).map(workerRunProjection);
          return json({ workerRuns });
        }
        return json({ workerRuns: await service.list({ namespace, taskId, projectFence }) });
      }
      if (request.method === 'POST' && url.pathname === '/api/worker-runs') {
        const body = await readJSON(request); noOverrides(body);
        const result = await service.mutate({ ...body, namespace });
        if(onCommandCommitted){try{result.delivery=await onCommandCommitted({kind:'worker_run',identity});}catch{result.delivery={status:'delivery-error'};}}
        return json(result, result.replayed ? 200 : 201);
      }
      return json({ error: 'NOT_FOUND', message: 'Endpoint not found.' }, 404);
    } catch (error) {
      if (error instanceof RelayError) return json({ error: error.code, message: error.message }, error.status);
      return json({ error: 'INTERNAL_ERROR', message: 'Worker run request failed.' }, 500);
    }
  };
}

