export const STORAGE_KEY = 'relay-room-demo-v1';
export const LEASE_MS = 15 * 60 * 1000;
export const BOTS = [
  { id: 'dot', name: 'dot', initials: 'd', role: 'Coordinator', skills: 'Triage · planning · handoffs', color: 'violet' },
  { id: 'forge', name: 'Forge', initials: 'F', role: 'Apex engineer', skills: 'Apex · SOQL · unit tests', color: 'blue' },
  { id: 'flux', name: 'Flux', initials: 'F', role: 'Experience engineer', skills: 'Flow · LWC · accessibility', color: 'teal' },
  { id: 'lens', name: 'Lens', initials: 'L', role: 'Independent reviewer', skills: 'Review · evidence · risk', color: 'amber' },
];
export const STATUSES = ['inbox', 'ready', 'in_progress', 'blocked', 'review', 'approval', 'done'];
export const LABELS = { inbox: 'Intake', ready: 'Ready', in_progress: 'In progress', blocked: 'Blocked', review: 'In review', approval: 'Human approval', done: 'Finished' };
export const PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'];
const clone = value => structuredClone(value);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const isBot = actor => BOTS.some(bot => bot.id === actor);
const text = (value, min, max, label) => {
  need(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max, `${label} must be ${min}–${max} characters.`);
  return value.trim();
};
export const nameOf = id => id === 'human' ? 'You' : BOTS.find(bot => bot.id === id)?.name || 'Unassigned';
export const scopeOf = task => `${task.environment.trim().toLowerCase()}:${task.component.trim().toLowerCase()}`;
export const hasLease = (task, now) => Boolean(task.owner && task.lease && task.lease.expiresAt > now);
export const keyOf = title => title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nowISO = now => new Date(now).toISOString();
function append(state, task, actor, kind, detail, now) {
  const event = { id: `event-${state.nextEvent++}`, taskId: task?.id || null, actor, kind, detail, at: nowISO(now) };
  state.events.push(event);
  if (task) { task.version++; task.updatedAt = nowISO(now); }
}
function baseTask(id, title, extra, now) {
  return {
    id, title, description: '', type: 'Bug', priority: 'Normal', area: 'Salesforce', status: 'ready',
    object: 'Opportunity', component: '', error: '', environment: 'Sandbox / demo', revision: 'demo-r1',
    dedupeKey: keyOf(title), dependencies: [], owner: null, lease: null, fence: 0, version: 1,
    blocker: '', reviewer: null, approval: null, tests: null, artifacts: [], deployment: 'not_deployed',
    createdAt: nowISO(now - 86400000), updatedAt: nowISO(now), ...extra,
  };
}
export function demoState(now = Date.now(), epoch = `demo-${now}`) {
  const tasks = [
    baseTask('RLY-101', 'Guard against null account on renewal', {
      description: 'A synthetic renewal fixture reaches the account selector without an AccountId. Add a guard and cover the empty relationship before selecting contacts.',
      priority: 'High', status: 'in_progress', component: 'RenewalService.cls', error: 'System.NullPointerException · line 84', owner: 'forge', fence: 1,
      lease: { token: 1, expiresAt: now + LEASE_MS }, revision: 'demo-r3',
      artifacts: [{ path: 'classes/RenewalService.cls', summary: 'Guard empty AccountId before contact lookup', revision: 'demo-r3', at: nowISO(now - 900000), actor: 'forge' }],
    }, now),
    baseTask('RLY-102', 'Stop duplicate follow-up tasks in Flow', {
      description: 'The synthetic record-triggered flow creates a second follow-up after an unrelated update. Gate task creation on the relevant field transition.',
      priority: 'High', status: 'review', component: 'Opportunity_Followup.flow', owner: 'flux', fence: 2,
      lease: null, revision: 'demo-r2',
      artifacts: [{ path: 'flows/Opportunity_Followup.flow-meta.xml', summary: 'Add change-only entry criteria', revision: 'demo-r2', at: nowISO(now - 3600000), actor: 'flux' }],
      tests: { passed: 8, failed: 0, revision: 'demo-r2', note: 'Synthetic create/update/retry scenarios', actor: 'flux', at: nowISO(now - 1800000), simulated: true },
    }, now),
    baseTask('RLY-103', 'Make the case activity panel keyboard friendly', {
      description: 'Give the synthetic case activity panel a predictable tab order, visible focus, and accessible control names.',
      type: 'Feature', priority: 'Normal', component: 'caseActivityPanel', object: 'Case', status: 'approval', owner: 'flux', fence: 1,
      revision: 'demo-r4', reviewer: { actor: 'lens', revision: 'demo-r4', at: nowISO(now - 600000) },
      artifacts: [{ path: 'lwc/caseActivityPanel/caseActivityPanel.html', summary: 'Named controls and semantic list markup', revision: 'demo-r4', at: nowISO(now - 3600000), actor: 'flux' }],
      tests: { passed: 12, failed: 0, revision: 'demo-r4', note: 'Synthetic keyboard + focus checks', actor: 'flux', at: nowISO(now - 1200000), simulated: true },
    }, now),
    baseTask('RLY-104', 'Bulkify the contact preference update', { description: 'Move synthetic preference reads out of the record loop and exercise a 200-record batch.', priority: 'High', component: 'ContactPreference.cls', object: 'Contact', error: 'System.LimitException: Too many SOQL queries: 101' }, now),
    baseTask('RLY-105', 'Improve the renewal error message', { description: 'Use a useful inline explanation when the account is missing. This depends on the service guard.', type: 'Feature', component: 'RenewalService.cls', dependencies: ['RLY-101'], priority: 'Normal' }, now),
    baseTask('RLY-106', 'Confirm the approval routing rule', { description: 'A synthetic policy decision is needed before changing the Flow.', type: 'Question', component: 'Approval_Router.flow', status: 'blocked', blocker: 'Human decision needed: regional manager or record owner?', priority: 'Low' }, now),
    baseTask('RLY-107', 'Document sandbox test data setup', { description: 'Keep a short, repeatable guide to fictional test records.', type: 'Task', area: 'Internal', object: '—', component: 'docs/demo-fixtures.md', status: 'inbox', priority: 'Low' }, now),
    baseTask('RLY-108', 'Handle an empty search result', {
      description: 'Synthetic reference task showing the full review trail. Task completion is separate from deployment.', type: 'Bug', component: 'globalSearch', object: 'Contact', status: 'done', owner: 'forge', revision: 'demo-r2',
      artifacts: [{ path: 'lwc/globalSearch/globalSearch.js', summary: 'Render a useful empty state', revision: 'demo-r2', at: nowISO(now - 7200000), actor: 'forge' }],
      tests: { passed: 6, failed: 0, revision: 'demo-r2', note: 'Synthetic empty/one/many result checks', actor: 'forge', at: nowISO(now - 6000000), simulated: true },
      reviewer: { actor: 'lens', revision: 'demo-r2', at: nowISO(now - 5400000) }, approval: { actor: 'human', revision: 'demo-r2', at: nowISO(now - 3600000) },
    }, now),
  ];
  return {
    schemaVersion: 1, epoch, version: 1, nextTask: 109, nextEvent: 5, operations: [], tasks,
    messages: [
      { id: 'message-1', channel: 'general', actor: 'dot', text: 'The renewal guard is the highest-priority item. Forge owns the service scope; Flux is ready for an independent review.', at: nowISO(now - 3600000) },
      { id: 'message-2', channel: 'general', actor: 'lens', text: 'Review queue is clear after the Flow check. Every change still needs human approval before the task is finished.', at: nowISO(now - 3000000) },
      { id: 'message-3', channel: 'task:RLY-101', actor: 'forge', text: 'Reproduced with a fictional Opportunity that has no account. The guard is in the local change set; test evidence is next.', at: nowISO(now - 900000) },
      { id: 'message-4', channel: 'direct:dot', actor: 'dot', text: 'This is a local demo room. Use the actor switcher to try a handoff or send a sample message. No bot is connected.', at: nowISO(now - 2400000) },
    ],
    events: [
      { id: 'event-1', taskId: 'RLY-108', actor: 'human', kind: 'approved', detail: 'Demo task approved. No deployment performed.', at: nowISO(now - 3600000) },
      { id: 'event-2', taskId: 'RLY-102', actor: 'flux', kind: 'review_requested', detail: '8 simulated checks passed; independent review requested.', at: nowISO(now - 1800000) },
      { id: 'event-3', taskId: 'RLY-101', actor: 'forge', kind: 'artifact', detail: 'RenewalService.cls · demo-r3', at: nowISO(now - 900000) },
      { id: 'event-4', taskId: 'RLY-103', actor: 'lens', kind: 'reviewed', detail: 'Review complete. Waiting for human approval.', at: nowISO(now - 600000) },
    ],
  };
}
export function validateTaskInput(input) {
  const title = text(input.title, 5, 140, 'Title');
  const result = { title, description: text(input.description || '', 0, 2000, 'Description'),
    component: text(input.component, 1, 180, 'Component'), object: text(input.object || '—', 1, 80, 'Object'),
    environment: text(input.environment, 1, 80, 'Environment'), revision: text(input.revision, 1, 80, 'Revision'),
    error: text(input.error || '', 0, 500, 'Error signature'), area: text(input.area || 'Salesforce', 1, 80, 'Area'),
    type: input.type, priority: input.priority };
  need(['Bug', 'Feature', 'Task', 'Question'].includes(result.type), 'Choose a valid task type.');
  need(PRIORITIES.includes(result.priority), 'Choose a valid priority.');
  return result;
}
function evidenceReady(task) {
  need(task.artifacts.length > 0, 'Add at least one changed artifact before review.');
  need(task.tests && task.tests.passed > 0 && task.tests.failed === 0 && task.tests.revision === task.revision, 'Passing test evidence must match the current revision.');
  need(task.artifacts.some(file => file.revision === task.revision), 'Add an artifact for the current revision.');
}
function invalidate(task) { task.tests = null; task.reviewer = null; task.approval = null; }
export function applyCommand(previous, command, context) {
  const { actor, now = Date.now(), expectedVersion, epoch, operationId } = context;
  need(actor === 'human' || isBot(actor), 'Unknown actor.');
  need(epoch === previous.epoch, 'This session was reset. Reload the latest demo.');
  need(typeof operationId === 'string' && operationId.length > 0, 'An operation ID is required.');
  const signature = JSON.stringify({ actor, command, expectedVersion, epoch });
  const duplicate = previous.operations.find(op => op.id === operationId);
  if (duplicate) { need(duplicate.signature === signature, 'An idempotency key cannot be reused for a different request.'); return previous; }
  const state = clone(previous);
  let task = null;
  const dependenciesDone = item => need(item.dependencies.every(id => state.tasks.find(t => t.id === id)?.status === 'done'), 'Finish the dependency tasks first.');
  const noScopeConflict = item => {
    const conflict = state.tasks.find(t => t.id !== item.id && hasLease(t, now) && scopeOf(t) === scopeOf(item));
    need(!conflict, `Component scope is leased by ${conflict?.id || 'another task'}.`);
  };
  const ownerOnly = item => {
    need(item.owner === actor && hasLease(item, now), 'An active lease owned by this bot is required.');
    need(command.token === item.lease.token, 'Stale fencing token. Claim the latest lease before writing.');
  };
  const canEdit = item => { if (actor !== 'human') ownerOnly(item); };
  if (command.type === 'create') {
    const input = validateTaskInput(command.input);
    const dedupeKey = keyOf(command.input.dedupeKey || input.title);
    need(dedupeKey.length > 0 && dedupeKey.length <= 160, 'Use a dedupe key between 1 and 160 characters.');
    const existing = state.tasks.find(t => t.dedupeKey === dedupeKey);
    need(!existing, `Duplicate request: ${existing?.id || ''} already has this dedupe key.`);
    const dependencies = command.input.dependencies || [];
    need(Array.isArray(dependencies) && dependencies.every(id => state.tasks.some(t => t.id === id)), 'A dependency does not exist.');
    task = baseTask(`RLY-${state.nextTask++}`, input.title, { ...input, dedupeKey, dependencies: [...new Set(dependencies)], status: 'inbox' }, now);
    state.tasks.push(task);
    append(state, task, actor, 'created', 'Task captured in intake.', now);
  } else if (command.type === 'message') {
    const body = text(command.text, 1, 2000, 'Message');
    const channel = command.channel;
    need(channel === 'general' || BOTS.some(b => channel === `direct:${b.id}`) || state.tasks.some(t => channel === `task:${t.id}`), 'Unknown discussion room.');
    state.messages.push({ id: `message-${state.nextEvent++}`, actor, channel, text: body, at: nowISO(now) });
  } else {
    task = state.tasks.find(t => t.id === command.taskId);
    need(task, 'Task not found.');
    need(task.version === expectedVersion, 'Stale task version. Refresh and try again; nothing was overwritten.');
    const reason = () => text(command.reason, 5, 500, 'Reason');
    switch (command.type) {
      case 'triage':
        need(task.status === 'inbox', 'Only intake tasks can be marked ready.');
        task.status = 'ready'; append(state, task, actor, 'triaged', 'Accepted into the ready queue.', now); break;
      case 'claim': {
        need(isBot(actor), 'Choose a bot in the actor switcher to claim work.');
        need(['ready', 'in_progress'].includes(task.status), 'Only ready or expired in-progress tasks can be claimed.');
        need(!hasLease(task, now), 'This task already has an active owner.'); dependenciesDone(task); noScopeConflict(task);
        task.owner = actor; task.fence++; task.lease = { token: task.fence, expiresAt: now + LEASE_MS }; task.status = 'in_progress'; invalidate(task);
        append(state, task, actor, 'claimed', `${nameOf(actor)} acquired lease #${task.fence}.`, now); break;
      }
      case 'heartbeat':
        ownerOnly(task); task.lease.expiresAt = now + LEASE_MS;
        append(state, task, actor, 'heartbeat', 'Lease renewed for 15 minutes.', now); break;
      case 'release':
        ownerOnly(task); need(task.status === 'in_progress', 'Release work from In progress.');
        task.owner = null; task.lease = null; task.fence++; task.status = 'ready'; invalidate(task);
        append(state, task, actor, 'released', 'Lease released; task returned to ready.', now); break;
      case 'handoff':
        ownerOnly(task); need(task.status === 'in_progress', 'Handoff is available during active work.');
        need(isBot(command.target) && command.target !== actor, 'Choose a different bot.');
        task.owner = command.target; task.fence++; task.lease = { token: task.fence, expiresAt: now + LEASE_MS }; invalidate(task);
        append(state, task, actor, 'handoff', `Handed off to ${nameOf(command.target)}. ${reason()}`, now); break;
      case 'override':
        need(actor === 'human', 'Only the human supervisor can override ownership.');
        need(['ready', 'in_progress'].includes(task.status) && isBot(command.target), 'Choose an eligible task and bot.');
        dependenciesDone(task); noScopeConflict(task);
        task.owner = command.target; task.fence++; task.lease = { token: task.fence, expiresAt: now + LEASE_MS }; task.status = 'in_progress'; invalidate(task);
        append(state, task, actor, 'override', `Human reassigned ownership to ${nameOf(command.target)}. Reason: ${reason()}`, now); break;
      case 'expire':
        need(actor === 'human' && task.lease, 'Only the human supervisor can simulate lease expiry.');
        task.lease.expiresAt = now - 1;
        append(state, task, actor, 'expired', 'Simulated lease expiry. Old writer fencing tokens cannot be reused after a new claim.', now); break;
      case 'edit': {
        canEdit(task); need(['inbox', 'ready', 'in_progress', 'blocked'].includes(task.status), 'Reopen this task before changing approved or reviewed work.');
        const input = validateTaskInput(command.input);
        const updated = { ...task, ...input }; noScopeConflict(updated);
        Object.assign(task, input); invalidate(task);
        append(state, task, actor, 'edited', 'Task details updated; prior test/review evidence invalidated.', now); break;
      }
      case 'artifact':
        ownerOnly(task); need(task.status === 'in_progress', 'Add artifacts during active work.');
        task.artifacts.push({ path: text(command.path, 1, 200, 'Artifact path'), summary: text(command.summary, 3, 500, 'Change summary'), revision: task.revision, at: nowISO(now), actor }); invalidate(task);
        append(state, task, actor, 'artifact', `${command.path.trim()} · ${task.revision}`, now); break;
      case 'tests':
        ownerOnly(task); need(task.status === 'in_progress', 'Record evidence during active work.');
        need(Number.isInteger(command.passed) && command.passed > 0 && command.passed <= 10000 && Number.isInteger(command.failed) && command.failed >= 0 && command.failed <= 10000, 'Enter valid test counts (1–10000 passed, 0–10000 failed).');
        task.tests = { passed: command.passed, failed: command.failed, note: text(command.note, 3, 500, 'Evidence note'), revision: task.revision, actor, at: nowISO(now), simulated: true }; task.reviewer = null;
        append(state, task, actor, 'tests', `${command.passed} passed, ${command.failed} failed · simulated · ${task.revision}`, now); break;
      case 'submit':
        ownerOnly(task); need(task.status === 'in_progress', 'Only active work can enter review.'); dependenciesDone(task); evidenceReady(task);
        task.status = 'review'; task.lease = null;
        append(state, task, actor, 'review_requested', 'Independent review requested; work lease released.', now); break;
      case 'review':
        need(isBot(actor) && actor !== task.owner, 'Review must be performed by a different bot from the work owner.');
        need(task.status === 'review', 'This task is not waiting for review.'); evidenceReady(task); dependenciesDone(task);
        task.reviewer = { actor, revision: task.revision, at: nowISO(now) }; task.status = 'approval';
        append(state, task, actor, 'reviewed', 'Independent demo review recorded; waiting for human approval.', now); break;
      case 'approve':
        need(actor === 'human', 'Only the human supervisor can approve completion.');
        need(task.status === 'approval' && task.reviewer && task.reviewer.actor !== task.owner && task.reviewer.revision === task.revision, 'A current independent review is required.'); evidenceReady(task); dependenciesDone(task);
        task.approval = { actor, revision: task.revision, at: nowISO(now) }; task.status = 'done'; task.lease = null;
        append(state, task, actor, 'approved', 'Human approved task completion. No deployment performed.', now); break;
      case 'block':
        canEdit(task); need(['inbox', 'ready', 'in_progress'].includes(task.status), 'Only queued or active work can be blocked.');
        task.blocker = reason(); task.status = 'blocked'; task.lease = null; invalidate(task);
        append(state, task, actor, 'blocked', task.blocker, now); break;
      case 'unblock':
        need(actor === 'human' && task.status === 'blocked', 'Only the human supervisor can clear this blocker.');
        task.blocker = ''; task.status = 'ready'; task.owner = null;
        append(state, task, actor, 'unblocked', reason(), now); break;
      case 'reopen':
        need(actor === 'human' && ['review', 'approval', 'done'].includes(task.status), 'Only the human supervisor can reopen reviewed work.');
        task.status = 'ready'; task.owner = null; task.lease = null; task.fence++; invalidate(task);
        append(state, task, actor, 'reopened', reason(), now); break;
      default: throw new Error('Unknown command.');
    }
  }
  state.operations.push({ id: operationId, signature });
  if (state.operations.length > 200) state.operations.shift();
  state.version++;
  return state;
}
export function validateState(value) {
  try {
    need(value && value.schemaVersion === 1 && typeof value.epoch === 'string', 'Invalid schema.');
    for (const field of ['version', 'nextTask', 'nextEvent']) need(Number.isInteger(value[field]) && value[field] > 0, 'Invalid counter.');
    for (const field of ['tasks', 'messages', 'events', 'operations']) need(Array.isArray(value[field]), 'Invalid collection.');
    need(value.tasks.length <= 5000 && value.messages.length <= 20000 && value.events.length <= 50000 && value.operations.length <= 200, 'Demo storage is too large.');
    const ids = new Set();
    for (const task of value.tasks) {
      validateTaskInput(task);
      need(/^RLY-\d+$/.test(task.id) && !ids.has(task.id), 'Invalid task ID.'); ids.add(task.id);
      need(STATUSES.includes(task.status) && Number.isInteger(task.version) && task.version > 0 && Number.isInteger(task.fence) && task.fence >= 0, 'Invalid task version.');
      need(task.owner === null || isBot(task.owner), 'Invalid owner.');
      need(task.lease === null || (task.owner && Number.isInteger(task.lease.token) && task.lease.token === task.fence && Number.isFinite(task.lease.expiresAt)), 'Invalid lease.');
      need(typeof task.dedupeKey === 'string' && typeof task.blocker === 'string' && Array.isArray(task.dependencies) && Array.isArray(task.artifacts), 'Invalid task data.');
      need(task.deployment === 'not_deployed' && Number.isFinite(Date.parse(task.updatedAt)) && Number.isFinite(Date.parse(task.createdAt)), 'Invalid lifecycle.');
      for (const artifact of task.artifacts) for (const field of ['path', 'summary', 'revision', 'actor', 'at']) need(typeof artifact[field] === 'string', 'Invalid artifact.');
      if (task.tests) need(Number.isInteger(task.tests.passed) && Number.isInteger(task.tests.failed) && typeof task.tests.note === 'string' && typeof task.tests.revision === 'string' && task.tests.simulated === true, 'Invalid test evidence.');
      for (const approval of [task.reviewer, task.approval]) if (approval) need(typeof approval.actor === 'string' && typeof approval.revision === 'string' && typeof approval.at === 'string', 'Invalid review.');
    }
    for (const task of value.tasks) need(task.dependencies.every(id => ids.has(id) && id !== task.id), 'Invalid dependency.');
    for (const message of value.messages) for (const field of ['id', 'channel', 'actor', 'text', 'at']) need(typeof message[field] === 'string', 'Invalid message.');
    for (const event of value.events) {
      for (const field of ['id', 'actor', 'kind', 'detail', 'at']) need(typeof event[field] === 'string', 'Invalid event.');
      need(event.taskId === null || ids.has(event.taskId), 'Invalid event task.');
    }
    for (const op of value.operations) need(typeof op.id === 'string' && typeof op.signature === 'string', 'Invalid operation.');
    return true;
  } catch { return false; }
}
export function loadState(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { state: demoState(now), warning: '' };
    const parsed = JSON.parse(raw);
    if (validateState(parsed)) return { state: parsed, warning: '' };
    return { state: demoState(now), warning: 'Saved demo data was invalid. A fresh demo is loaded; the invalid copy has not been overwritten.' };
  } catch { return { state: demoState(now), warning: 'Browser storage is unavailable or unreadable. Changes may not survive a reload.' }; }
}
export function saveState(storage, state) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return ''; }
  catch { return 'Changes are kept in this tab only because browser storage could not be written.'; }
}
export function filterTasks(tasks, { search = '', owner = 'all', priority = 'all', status = 'all' } = {}) {
  const query = search.trim().toLowerCase();
  return tasks.filter(task => (!query || [task.id, task.title, task.component, task.object, task.error, task.area].join(' ').toLowerCase().includes(query))
    && (owner === 'all' || (owner === 'unassigned' ? !task.owner : task.owner === owner))
    && (priority === 'all' || task.priority === priority) && (status === 'all' || task.status === status));
}
