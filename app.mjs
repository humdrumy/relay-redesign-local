import { BOTS, LABELS, STATUSES, PRIORITIES, STORAGE_KEY, demoState, applyCommand, nameOf, hasLease, filterTasks, loadState, saveState, validateState } from './model.mjs';
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const toast = document.querySelector('#toast');
const storage = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) };
const sharedMode = document.querySelector('meta[name="relay-mode"]')?.content === 'shared';
let sharedView = null;
let loaded = sharedMode ? { state: demoState(), warning: null } : loadState(storage);
let state = loaded.state;
let storageWarning = loaded.warning;
let memoryOnly = Boolean(storageWarning);
let ui = { page: 'board', view: 'board', actor: 'human', search: '', owner: 'all', priority: 'all', status: 'all', channel: 'general', detail: null, tab: 'overview', form: null };
let returnFocus = null;
let noticeTimer;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3H13a8 8 0 0 1 8 8.5Z"/><path d="M7 10h10M7 14h6"/>',
  pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2l-1.5 1v2M12 17h.01"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.grid}</svg>`;
const badge = (label, className = '') => `<span class="badge ${className}">${esc(label)}</span>`;
const avatar = (id, small = false) => {
  const bot = BOTS.find(item => item.id === id);
  return `<span class="avatar ${bot?.color || 'human'} ${small ? 'small' : ''}" aria-hidden="true">${esc(bot?.initials || (id === 'human' ? 'Y' : '·'))}</span>`;
};
const time = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const relative = value => {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  return mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
};
const selected = (a, b) => a === b ? 'selected' : '';
const botOptions = value => BOTS.map(bot => `<option value="${bot.id}" ${selected(bot.id, value)}>${bot.name}</option>`).join('');
const taskById = id => state.tasks.find(task => task.id === id);
const currentTask = () => taskById(ui.detail);
function notify(message, error = false) {
  (modal.open ? modal : document.body).append(toast);
  clearTimeout(noticeTimer); toast.textContent = message; toast.className = `visible ${error ? 'error' : ''}`;
  noticeTimer = setTimeout(() => { toast.className = ''; }, 7000);
}
function save() { storageWarning = saveState(storage, state); memoryOnly = Boolean(storageWarning); }
function syncBeforeWrite() {
  if (memoryOnly) return true;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const latest = JSON.parse(raw);
    if (validateState(latest) && (latest.epoch !== state.epoch || latest.version !== state.version)) {
      state = latest; render(); if (ui.detail) renderDetail();
      notify('Updated from another tab. Retry your action.', true); return false;
    }
  } catch { /* Storage errors are reported by save/load, while in-memory use remains available. */ }
  return true;
}
async function dispatch(command, actor = ui.actor, overrides = {}) {
  if (sharedMode) return sharedDispatch(command, overrides);
  if (!syncBeforeWrite()) return false;
  const task = taskById(command.taskId);
  try {
    state = applyCommand(state, { token: task?.lease?.token, ...command }, { actor, now: Date.now(), expectedVersion: task?.version, epoch: state.epoch, operationId: crypto.randomUUID(), ...overrides });
    save(); render(); return true;
  } catch (error) { notify(error.message, true); return false; }
}
function render() {
  const active = document.activeElement;
  const focus = active?.id;
  const start = active?.selectionStart;
  const end = active?.selectionEnd;
  const approval = state.tasks.filter(task => task.status === 'approval').length;
  app.innerHTML = `<aside class="sidebar">
    <a class="brand" href="#" data-action="page" data-page="board" aria-label="Relay home"><span class="brand-mark">r<span></span></span><span>relay</span></a>
    <div class="workspace-name"><span class="workspace-symbol">W</span><div>Workshop<span>Personal workspace</span></div></div>
    <div class="nav-label">WORKSPACE</div>
    <nav aria-label="Workspace navigation">
      <button class="nav-item ${ui.page === 'board' ? 'active' : ''}" data-action="page" data-page="board" ${ui.page === 'board' ? 'aria-current="page"' : ''}>${icon('grid')}<span>Tasks</span><span class="nav-count">${state.tasks.filter(t => t.status !== 'done').length}</span></button>
      <button class="nav-item ${ui.page === 'rooms' ? 'active' : ''}" data-action="page" data-page="rooms" ${ui.page === 'rooms' ? 'aria-current="page"' : ''}>${icon('chat')}<span>Rooms</span></button>
      <button class="nav-item ${ui.page === 'activity' ? 'active' : ''}" data-action="page" data-page="activity" ${ui.page === 'activity' ? 'aria-current="page"' : ''}>${icon('pulse')}<span>Activity</span></button>
    </nav>

    <div class="sidebar-bottom"><button class="nav-item" data-action="workflow">${icon('help')}<span>Workflow</span></button><button class="nav-item" data-action="reset">${icon('reset')}<span>Reset demo</span></button><div class="profile">${avatar('human', true)}<div>You<span>Owner</span></div><span class="online-dot"></span></div></div>
  </aside>
  <div class="workspace">
    <header class="topbar"><div class="breadcrumb">Workshop <span>/</span> <strong>Engineering</strong></div><div class="top-actions"><button class="demo-label" data-action="workflow" aria-label="About the local demo"><span></span> LOCAL DEMO</button><label class="actor-label" for="actor">Act as</label><select id="actor" aria-label="Demo actor"><option value="human" ${selected(ui.actor, 'human')}>You · human</option>${botOptions(ui.actor)}</select></div></header>
    <main id="main" tabindex="-1"><div class="page-heading"><div><h1>${ui.page === 'board' ? 'Tasks' : ui.page === 'rooms' ? 'Rooms' : 'Activity'}</h1></div><button class="button primary" data-action="new">${icon('plus')} New task</button></div>
    <div class="demo-strip">${icon('shield')}<span>Sample data · no live agents or deployments</span><button data-action="workflow">Workflow ${icon('arrow')}</button></div>
    ${storageWarning ? `<div class="warning" role="alert">${esc(storageWarning)}</div>` : ''}
    <section class="team-grid" aria-label="Four-bot roster">${BOTS.map(bot => {
      const work = state.tasks.filter(task => task.owner === bot.id && ['in_progress', 'review', 'approval'].includes(task.status));
      const activeWork = work.find(task => task.status === 'in_progress');
      return `<button class="bot-card" data-action="room" data-channel="direct:${bot.id}"><div class="bot-top">${avatar(bot.id)}<div><strong>${bot.name}</strong><span>${bot.role}</span></div><span class="bot-arrow">${icon('arrow')}</span></div><p>${bot.skills}</p><div class="bot-activity"><span class="activity-light ${activeWork ? 'working' : ''}"></span>${activeWork ? `Working on ${esc(activeWork.id)}` : work.length ? `${work.length} awaiting review / approval` : 'Idle'}<span class="simulated">DEMO</span></div></button>`;
    }).join('')}</section>
    ${ui.page === 'board' ? board(approval) : ui.page === 'rooms' ? rooms() : activity()}
    <footer class="main-footer"><span>Local demo</span></footer>
    </main>
  </div>`;
  if (sharedMode) enhanceShared(app);
  if (focus) {
    const next = document.getElementById(focus);
    if (next) { next.focus({ preventScroll: true }); if (typeof start === 'number' && ['INPUT', 'TEXTAREA'].includes(next.tagName)) { try { next.setSelectionRange(start, end); } catch { /* Select-like input. */ } } }
  }
}
function board(approval) {
  const tasks = filterTasks(state.tasks, ui);
  const active = state.tasks.filter(task => task.status === 'in_progress').length;
  const waiting = state.tasks.filter(task => task.status === 'blocked').length;
  return `<section class="work-section" aria-labelledby="work-title"><div class="section-heading"><div><h2 id="work-title">Tasks <span>${state.tasks.length}</span></h2></div><div class="metrics"><button data-action="filter-status" data-status="in_progress"><strong>${active}</strong> in progress</button><button data-action="filter-status" data-status="approval" class="${approval ? 'attention' : ''}"><strong>${approval}</strong> awaiting approval</button><button data-action="filter-status" data-status="blocked"><strong>${waiting}</strong> blocked</button></div></div>
  <div class="toolbar"><div class="view-switch" aria-label="Work view"><button data-action="view" data-view="board" class="${ui.view === 'board' ? 'selected' : ''}" aria-pressed="${ui.view === 'board'}">${icon('grid')} Board</button><button data-action="view" data-view="list" class="${ui.view === 'list' ? 'selected' : ''}" aria-pressed="${ui.view === 'list'}">${icon('list')} List</button></div><label class="search">${icon('search')}<input id="search" type="search" placeholder="Search tasks" aria-label="Search tasks" value="${esc(ui.search)}"></label><select id="owner-filter" aria-label="Filter by owner"><option value="all">All owners</option><option value="unassigned" ${selected(ui.owner, 'unassigned')}>Unassigned</option>${botOptions(ui.owner)}</select><select id="priority-filter" aria-label="Filter by priority"><option value="all">All priorities</option>${PRIORITIES.map(priority => `<option ${selected(ui.priority, priority)}>${priority}</option>`).join('')}</select><select id="status-filter" aria-label="Filter by status"><option value="all">All statuses</option>${STATUSES.map(status => `<option value="${status}" ${selected(ui.status, status)}>${LABELS[status]}</option>`).join('')}</select></div>
  <div class="filter-summary"><span>${tasks.length} task${tasks.length === 1 ? '' : 's'} shown</span>${ui.search || ui.owner !== 'all' || ui.priority !== 'all' || ui.status !== 'all' ? '<button data-action="clear-filters">Clear filters</button>' : ''}</div>
  ${tasks.length === 0 ? '<div class="empty-state"><h3>No matching tasks</h3><button class="button" data-action="clear-filters">Clear filters</button></div>' : ui.view === 'board' ? `<div class="board">${[
    ['queue', 'Queued', ['inbox', 'ready', 'blocked']], ['progress', 'In progress', ['in_progress']], ['review', 'Review & approval', ['review', 'approval']], ['done', 'Finished', ['done']],
  ].map(([key, label, statuses]) => `<section class="lane ${key}" aria-label="${label}"><div class="lane-heading"><span class="lane-dot"></span><h3>${label}</h3><span>${tasks.filter(task => statuses.includes(task.status)).length}</span></div><div class="lane-cards">${tasks.filter(task => statuses.includes(task.status)).map(card).join('') || '<div class="lane-empty">No tasks</div>'}</div></section>`).join('')}</div>` : `<div class="task-list">${tasks.map(task => `<button class="task-row" data-action="task" data-id="${task.id}"><span class="task-id">${task.id}</span><strong>${esc(task.title)}</strong>${badge(LABELS[task.status], task.status)}<span>${esc(task.priority)}</span><span class="owner-inline">${avatar(task.owner, true)}${nameOf(task.owner)}</span><span class="muted">${relative(task.updatedAt)}</span></button>`).join('')}</div>`}
  </section>`;
}
function card(task) {
  const live = hasLease(task, Date.now());
  return `<button class="task-card ${task.status === 'approval' ? 'needs-approval' : ''}" data-action="task" data-id="${task.id}" aria-label="Open ${task.id}: ${esc(task.title)}"><span class="card-meta"><span class="task-id">${task.id}</span><span class="priority ${task.priority.toLowerCase()}"><span></span>${task.priority}</span></span><span class="card-title">${esc(task.title)}</span><span class="card-tags">${badge(task.type)}${task.status === 'blocked' || task.status === 'inbox' || task.status === 'approval' ? badge(LABELS[task.status], task.status) : ''}</span><span class="component">${icon('code')}<span>${esc(task.component)}</span></span>${task.blocker ? `<span class="card-blocker">${esc(task.blocker)}</span>` : task.dependencies.length ? `<span class="dependency">Depends on ${esc(task.dependencies.join(', '))}</span>` : task.status === 'approval' ? '<span class="approval-note">Independent review complete</span>' : task.status === 'done' ? '<span class="done-note">Approved · not deployed</span>' : ''}<span class="card-footer"><span class="owner-inline">${avatar(task.owner, true)}${nameOf(task.owner)}</span><span>${task.status === 'in_progress' ? (live ? 'Lease active' : 'Lease expired') : relative(task.updatedAt)}</span></span></button>`;
}
function channelLabel(channel) { return channel === 'general' ? 'General' : channel.startsWith('direct:') ? `${nameOf(channel.split(':')[1])} · direct room` : `${channel.split(':')[1]} · task room`; }
function conversation(channel) {
  const messages = state.messages.filter(message => message.channel === channel);
  return `<div class="message-list" aria-label="Messages in ${esc(channelLabel(channel))}">${messages.length ? messages.map(message => `<article class="message">${avatar(message.actor, true)}<div><div class="message-meta"><strong>${nameOf(message.actor)}</strong><time datetime="${esc(message.at)}">${time(message.at)}</time><span>SIMULATED</span></div><p>${esc(message.text)}</p></div></article>`).join('') : '<div class="empty-conversation"><span>No messages</span></div>'}</div><form class="message-form" data-form="message" data-channel="${esc(channel)}"><label for="message-input">Message as ${nameOf(ui.actor)} <span>· local simulation</span></label><div><textarea id="message-input" name="message" required maxlength="2000" rows="2" placeholder="Message"></textarea><button class="button primary" type="submit" aria-label="Send local message">${icon('arrow')}</button></div><span class="field-hint">Local demo · no delivery</span></form>`;
}
function rooms() {
  return `<section class="rooms"><aside class="channel-list" aria-label="Discussion rooms"><div class="channel-category">TEAM ROOM</div><button data-action="room" data-channel="general" class="channel ${ui.channel === 'general' ? 'selected' : ''}"><span>#</span> General</button><div class="channel-category">DIRECT ROOMS</div>${BOTS.map(bot => `<button data-action="room" data-channel="direct:${bot.id}" class="channel ${ui.channel === `direct:${bot.id}` ? 'selected' : ''}">${avatar(bot.id, true)} ${bot.name}</button>`).join('')}<div class="channel-category">TASK ROOMS</div>${state.tasks.map(task => `<button data-action="room" data-channel="task:${task.id}" class="channel ${ui.channel === `task:${task.id}` ? 'selected' : ''}"><span>#</span> ${task.id}<span class="channel-task-title">${esc(task.component)}</span></button>`).join('')}</aside><div class="conversation"><header class="conversation-header"><div><h2>${esc(channelLabel(ui.channel))}</h2><p>${ui.channel.startsWith('task:') ? esc(taskById(ui.channel.split(':')[1])?.title) : ''}</p></div>${ui.channel.startsWith('task:') ? `<button class="button" data-action="task" data-id="${ui.channel.split(':')[1]}">Open task ${icon('arrow')}</button>` : badge('Local only', 'ready')}</header>${conversation(ui.channel)}</div></section>`;
}
function timeline(events) {
  return events.length ? `<ol class="timeline">${[...events].reverse().map(event => `<li><span class="timeline-dot"></span><div><div><strong>${nameOf(event.actor)}</strong> <span>${esc(event.kind.replaceAll('_', ' '))}</span><time datetime="${esc(event.at)}">${relative(event.at)}</time></div><p>${esc(event.detail)}</p>${event.taskId ? `<button class="text-link" data-action="task" data-id="${event.taskId}">${event.taskId} ${icon('arrow')}</button>` : ''}</div></li>`).join('')}</ol>` : '<p class="empty-copy">No activity</p>';
}
function activity() { return `<section class="activity-panel"><div class="section-heading"><div><h2>Workspace activity</h2></div>${badge(`${state.events.length} events`)}</div>${timeline(state.events)}</section>`; }
function openModal(html, className = '') {
  if (toast.parentElement === modal) document.body.append(toast);
  if (!modal.open) returnFocus = document.activeElement;
  modal.className = className; modal.innerHTML = html;
  if (sharedMode) enhanceShared(modal);
  if (!modal.open) modal.showModal();
  if (toast.classList.contains('visible')) modal.append(toast);
  modal.querySelector('input:not([type="hidden"]), textarea, select, button')?.focus();
}
function closeModal() {
  if (toast.parentElement === modal) document.body.append(toast);
  const closingId = ui.detail; modal.close(); ui.detail = null; ui.form = null;
  const matchingCard = closingId && document.querySelector(`[data-action="task"][data-id="${closingId}"]`);
  if (matchingCard) matchingCard.focus(); else if (returnFocus?.isConnected) returnFocus.focus(); else document.querySelector('[data-action="new"]')?.focus();
}
const dialogHeader = (eyebrow, title) => `<header class="dialog-header"><div><div class="eyebrow">${esc(eyebrow)}</div><h2 id="dialog-title">${esc(title)}</h2></div><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button></header>`;
function showDetail(id, tab = 'overview') { ui.detail = id; ui.tab = tab; ui.form = null; renderDetail(); }
function renderDetail() {
  const task = currentTask(); if (!task) { closeModal(); return; }
  const live = hasLease(task, Date.now());
  openModal(`${dialogHeader(`${task.id} / ${task.type}`, task.title)}<div class="detail-summary">${badge(LABELS[task.status], task.status)}${badge(task.priority)}<span>Version ${task.version}</span><span>Updated ${relative(task.updatedAt)}</span></div><div class="detail-tabs" role="tablist" aria-label="Task details">${[['overview', 'Overview'], ['changes', `Changes & evidence (${task.artifacts.length})`], ['discussion', 'Discussion'], ['history', 'History']].map(([key, label]) => `<button role="tab" tabindex="${ui.tab === key ? 0 : -1}" aria-selected="${ui.tab === key}" data-action="tab" data-tab="${key}" class="${ui.tab === key ? 'selected' : ''}">${label}</button>`).join('')}</div><div class="detail-body" role="tabpanel">${ui.tab === 'overview' ? `<p class="description">${esc(task.description || 'No description')}</p><div class="detail-actions"><button class="button" data-action="edit">Edit details</button><button class="button subtle" data-action="task-room">Open task room ${icon('arrow')}</button></div><dl class="metadata"><div><dt>Component scope</dt><dd>${esc(task.component)}</dd></div><div><dt>Salesforce object</dt><dd>${esc(task.object)}</dd></div><div><dt>Environment</dt><dd>${esc(task.environment)}</dd></div><div><dt>Revision</dt><dd>${esc(task.revision)}</dd></div><div><dt>System area</dt><dd>${esc(task.area)}</dd></div><div><dt>Deployment</dt><dd><span class="neutral-dot"></span> Not deployed</dd></div><div class="full"><dt>Error signature</dt><dd>${esc(task.error || 'No error signature recorded')}</dd></div><div class="full"><dt>Dedupe key</dt><dd>${esc(task.dedupeKey)}</dd></div>${task.dependencies.length ? `<div class="full"><dt>Dependencies</dt><dd>${task.dependencies.map(id => `<button class="text-link" data-action="task" data-id="${id}">${id} · ${LABELS[taskById(id)?.status]}</button>`).join('')}</dd></div>` : ''}</dl>
  ${task.blocker ? `<div class="warning"><strong>Blocked</strong><p>${esc(task.blocker)}</p></div>` : ''}
  <section class="ownership-panel"><div class="section-heading compact"><h3>Ownership & handoff</h3>${badge(live ? 'Active lease' : task.lease ? 'Expired lease' : 'No active lease', live ? 'ready' : '')}</div><div class="ownership-person">${avatar(task.owner)}<div><strong>${nameOf(task.owner)}</strong><span>${task.lease ? `Lease #${task.lease.token} · expires ${time(task.lease.expiresAt)}` : task.owner ? 'Author' : 'Unassigned'}</span></div></div><p class="field-hint">Lease: 15 minutes · exclusive component and environment</p><div class="action-grid">${task.status === 'inbox' ? '<button class="button primary" data-action="command" data-command="triage">Mark ready</button>' : ''}${['ready', 'in_progress'].includes(task.status) && !live ? '<button class="button primary" data-action="command" data-command="claim">Claim task</button>' : ''}${task.status === 'in_progress' && task.owner === ui.actor && live ? '<button class="button" data-action="command" data-command="heartbeat">Renew lease</button><button class="button" data-action="command" data-command="release">Release task</button><button class="button" data-action="handoff">Hand off</button>' : ''}${ui.actor === 'human' && ['ready', 'in_progress'].includes(task.status) ? '<button class="button" data-action="override">Human reassign</button>' : ''}</div></section>
  <section class="review-panel"><h3>Review</h3><ol class="checklist"><li class="${task.artifacts.some(a => a.revision === task.revision) ? 'checked' : ''}">${icon('check')} Changed artifact at this revision</li><li class="${task.tests?.failed === 0 && task.tests?.revision === task.revision ? 'checked' : ''}">${icon('check')} Passing test evidence at this revision</li><li class="${task.reviewer ? 'checked' : ''}">${icon('check')} Independent bot review</li><li class="${task.approval ? 'checked' : ''}">${icon('check')} Human approval</li></ol><div class="action-grid">${task.status === 'in_progress' ? '<button class="button primary" data-action="command" data-command="submit">Request review</button>' : task.status === 'review' ? '<button class="button primary" data-action="command" data-command="review">Record independent review</button>' : task.status === 'approval' ? '<button class="button primary" data-action="command" data-command="approve">Approve completion</button>' : ''}${['inbox', 'ready', 'in_progress'].includes(task.status) ? '<button class="button" data-action="reason" data-command="block">Mark blocked</button>' : ''}${task.status === 'blocked' && ui.actor === 'human' ? '<button class="button" data-action="reason" data-command="unblock">Resolve blocker</button>' : ''}${['review', 'approval', 'done'].includes(task.status) && ui.actor === 'human' ? '<button class="button" data-action="reason" data-command="reopen">Reopen work</button>' : ''}</div><p class="field-hint">Approval does not merge or deploy code.</p></section>
  <details class="simulation-tools"><summary>Coordination tests</summary><p>Local simulation</p><div class="action-grid"><button class="button" data-action="race">Simulate two claims</button><button class="button" data-action="stale">Try stale update</button>${ui.actor === 'human' && task.lease ? '<button class="button" data-action="command" data-command="expire">Simulate lease expiry</button>' : ''}</div></details>` : ui.tab === 'changes' ? changes(task) : ui.tab === 'discussion' ? conversation(`task:${task.id}`) : timeline(state.events.filter(event => event.taskId === task.id))}</div><footer class="dialog-footer"><span>Acting as <strong>${nameOf(ui.actor)}</strong> · demo only</span><select id="dialog-actor" aria-label="Task demo actor"><option value="human" ${selected(ui.actor, 'human')}>You · human</option>${botOptions(ui.actor)}</select></footer>`, 'task-dialog');
}
function changes(task) {
  return `<div class="section-heading compact"><h3>Changed artifacts</h3><button class="button" data-action="artifact">${icon('plus')} Add artifact</button></div><p class="field-hint">Sample artifacts · files unchanged</p><div class="artifact-list">${task.artifacts.length ? [...task.artifacts].reverse().map(file => `<article>${icon('code')}<div><strong>${esc(file.path)}</strong><p>${esc(file.summary)}</p><span>${esc(file.revision)} · ${nameOf(file.actor)} · ${relative(file.at)}</span></div></article>`).join('') : '<p class="empty-copy">No changes</p>'}</div><div class="section-heading compact"><h3>Test evidence</h3><button class="button" data-action="evidence">Record evidence</button></div>${task.tests ? `<div class="evidence-card"><span class="evidence-count">${task.tests.passed}<span>passed</span></span><span class="evidence-count ${task.tests.failed ? 'failed' : ''}">${task.tests.failed}<span>failed</span></span><div>${badge('Simulated', 'approval')}<p>${esc(task.tests.note)}</p><span class="muted">${esc(task.tests.revision)} · ${nameOf(task.tests.actor)}</span></div></div>` : '<p class="empty-copy">No test evidence</p>'}<p class="field-hint">Simulated evidence · no test execution</p>${task.reviewer ? `<div class="review-stamp">${icon('shield')} Reviewed by ${nameOf(task.reviewer.actor)} · ${esc(task.reviewer.revision)}</div>` : ''}`;
}
function field(label, name, value = '', options = {}) {
  const { textarea = false, required = false, max = 180, min = 0, type = 'text', hint = '' } = options;
  const attrs = `id="field-${name}" name="${name}" ${required ? 'required' : ''} maxlength="${max}" ${min ? `minlength="${min}"` : ''}`;
  return `<label class="field ${textarea ? 'full' : ''}" for="field-${name}"><span>${label}${required ? ' *' : ''}</span>${textarea ? `<textarea ${attrs} rows="3">${esc(value)}</textarea>` : `<input ${attrs} type="${type}" value="${esc(value)}" ${type === 'number' ? 'min="0" max="10000" step="1"' : ''}>`}${hint ? `<small>${hint}</small>` : ''}</label>`;
}
function taskForm(edit = false) {
  const task = edit ? currentTask() : { type: 'Bug', priority: 'Normal', area: 'Salesforce', object: 'Opportunity', environment: 'Sandbox / demo', revision: 'demo-r1' };
  ui.form = edit ? 'edit' : 'new';
  ui.formVersion = edit ? task.version : undefined; ui.formEpoch = state.epoch;
  openModal(`${dialogHeader(edit ? task.id : 'TASK INTAKE', edit ? 'Edit task details' : 'New task')}<form data-form="${ui.form}" class="form-body"><p class="field-hint">Demo data only · * required</p><div class="form-grid">${field('Title', 'title', task.title, { required: true, min: 5, max: 140 })}<label class="field">Type<select name="type">${['Bug', 'Feature', 'Task', 'Question'].map(value => `<option ${selected(value, task.type)}>${value}</option>`).join('')}</select></label>${field('Description / expected behavior', 'description', task.description, { textarea: true, max: 2000 })}<label class="field">Priority<select name="priority">${PRIORITIES.map(value => `<option ${selected(value, task.priority)}>${value}</option>`).join('')}</select></label>${field('System area', 'area', task.area, { required: true, max: 80 })}${field('Component / exclusive scope', 'component', task.component, { required: true })}${field('Salesforce object', 'object', task.object, { max: 80 })}${field('Environment', 'environment', task.environment, { required: true, max: 80 })}${field('Source revision', 'revision', task.revision, { required: true, max: 80 })}${field('Error signature', 'error', task.error, { textarea: true, max: 500 })}${!edit ? `${field('Dedupe key (optional)', 'dedupeKey', '', { max: 160, hint: 'Defaults to a normalized title.' })}<label class="field">Dependency (optional)<select name="dependency"><option value="">No dependency</option>${state.tasks.map(t => `<option value="${t.id}">${t.id} · ${esc(t.title)}</option>`).join('')}</select></label>` : ''}</div><div class="form-actions"><button type="button" class="button" data-action="cancel-form">Cancel</button><button type="submit" class="button primary">${edit ? 'Save details' : 'Create task'}</button></div></form>`, 'form-dialog');
}
function actionForm(kind, command = kind) {
  ui.form = kind; ui.formVersion = currentTask().version; ui.formEpoch = state.epoch;
  const titles = { handoff: 'Handoff', override: 'Reassign task', reason: command === 'block' ? 'Blocker' : command === 'reopen' ? 'Reopen task' : 'Resolve blocker', artifact: 'Add artifact', evidence: 'Test evidence' };
  openModal(`${dialogHeader(currentTask().id, titles[kind])}<form class="form-body" data-form="${kind}" data-command="${command}">${['handoff', 'override'].includes(kind) ? `<label class="field">New owner<select name="target">${botOptions('')}</select></label>` : ''}${['handoff', 'override', 'reason'].includes(kind) ? field('Reason / handoff context', 'reason', '', { required: true, textarea: true, min: 5, max: 500 }) : kind === 'artifact' ? field('Relative artifact path', 'path', '', { required: true, max: 200 }) + field('What changed', 'summary', '', { required: true, textarea: true, min: 3, max: 500 }) : `<div class="warning">Demo evidence only. This does not execute a test.</div><div class="form-grid">${field('Passed', 'passed', '1', { required: true, type: 'number' })}${field('Failed', 'failed', '0', { required: true, type: 'number' })}</div>${field('Checks and outcome', 'note', '', { required: true, textarea: true, min: 3, max: 500 })}`}<div class="form-actions"><button type="button" class="button" data-action="cancel-form">Cancel</button><button class="button primary" type="submit">Save ${kind === 'evidence' ? 'evidence' : kind === 'artifact' ? 'artifact' : 'change'}</button></div></form>`, 'form-dialog');
}
function workflow() {
  ui.detail = null;
  openModal(`${dialogHeader('DEMO', 'Workflow')}<div class="form-body"><div class="flow-steps"><span>Intake</span>→<span>Ready</span>→<span>Owned work</span>→<span>Review</span>→<span>Human approval</span>→<span>Finished</span></div><h3>Roles</h3><p>Simulated roles: dot coordinates; Forge handles Apex; Flux handles Flow and LWC; Lens reviews.</p><h3>Ownership</h3><p>Exclusive task and component lease: 15 minutes. Stale versions, expired leases and competing claims are rejected.</p><h3>Approval</h3><p>Requires current artifacts, passing tests, independent review and human approval. Changes invalidate evidence. Approval does not deploy.</p><h3>Storage</h3><p>Browser storage only. Tasks, agents, messages and evidence are simulated. No external connections or deployments.</p><div class="action-grid"><button class="button primary" data-action="close">Close ${icon('arrow')}</button><button class="button" data-action="reset">Reset demo</button></div></div>`, 'form-dialog');
}
async function simulateRace() {
  const task = currentTask();
  if (!['ready', 'in_progress'].includes(task.status) || hasLease(task, Date.now())) { notify('Use a ready, unowned task to try competing claims.', true); return; }
  const version = task.version;
  if (await dispatch({ type: 'claim', taskId: task.id }, 'forge', { expectedVersion: version })) {
    try {
      applyCommand(state, { type: 'claim', taskId: task.id }, { actor: 'flux', now: Date.now(), expectedVersion: version, epoch: state.epoch, operationId: crypto.randomUUID() });
      notify('Unexpected simulation result.', true);
    } catch (error) { notify(`Simulated race: Forge won. Flux was rejected: ${error.message}`); }
    renderDetail();
  }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  if (sharedMode && ['reset', 'confirm-reset', 'race', 'stale'].includes(action)) return;
  if (action === 'refresh-shared') { await refreshShared(); return; }
  if (action === 'accept-offer' || action === 'decline-offer') {
    if (await dispatch({ type: action === 'accept-offer' ? 'accept_handoff' : 'decline_handoff', taskId: ui.detail, handoffId: button.dataset.offer, reason: 'Human declined this proposed responsibility.' })) renderDetail();
    return;
  }
  if (button.tagName === 'A') event.preventDefault();
  if (action === 'page') { ui.page = button.dataset.page; render(); }
  else if (action === 'view') { ui.view = button.dataset.view; render(); }
  else if (action === 'filter-status') { ui.status = ui.status === button.dataset.status ? 'all' : button.dataset.status; render(); }
  else if (action === 'clear-filters') { Object.assign(ui, { search: '', owner: 'all', priority: 'all', status: 'all' }); render(); }
  else if (action === 'new') { ui.detail = null; taskForm(); }
  else if (action === 'task') showDetail(button.dataset.id);
  else if (action === 'tab') { ui.tab = button.dataset.tab; renderDetail(); }
  else if (action === 'close') closeModal();
  else if (action === 'cancel-form') { ui.form = null; if (ui.detail) renderDetail(); else closeModal(); }
  else if (action === 'edit') taskForm(true);
  else if (action === 'room' || action === 'task-room') {
    const channel = action === 'room' ? button.dataset.channel : `task:${ui.detail}`;
    if (modal.open) closeModal(); ui.channel = channel; ui.page = 'rooms'; render();
  }
  else if (action === 'workflow') sharedMode ? sharedWorkflow() : workflow();
  else if (action === 'command') { if (await dispatch({ type: button.dataset.command, taskId: ui.detail })) { renderDetail(); notify(sharedMode ? 'Saved' : 'Saved'); } }
  else if (['handoff', 'override', 'artifact', 'evidence'].includes(action)) actionForm(action);
  else if (action === 'reason') actionForm('reason', button.dataset.command);
  else if (action === 'race') await simulateRace();
  else if (action === 'stale') await dispatch({ type: 'heartbeat', taskId: ui.detail }, ui.actor, { expectedVersion: currentTask().version - 1 });
  else if (action === 'reset') {
    ui.detail = null;
    openModal(`${dialogHeader('DEMO', 'Reset this local demo?')}<div class="form-body"><p>Replaces this browser’s tasks, messages and activity with sample data.</p><div class="form-actions"><button class="button" data-action="close">Keep my changes</button><button class="button danger" data-action="confirm-reset">Reset demo data</button></div></div>`, 'form-dialog');
  } else if (action === 'confirm-reset') {
    state = demoState(Date.now(), crypto.randomUUID()); save(); Object.assign(ui, { page: 'board', channel: 'general', search: '', owner: 'all', priority: 'all', status: 'all' }); closeModal(); render(); notify('Demo reset');
  }
});
document.addEventListener('change', event => {
  const id = event.target.id;
  if ((id === 'actor' || id === 'dialog-actor') && !sharedMode) { ui.actor = event.target.value; render(); if (ui.detail) renderDetail(); }
  else if (['owner-filter', 'priority-filter', 'status-filter'].includes(id)) { ui[id.split('-')[0]] = event.target.value; render(); }
});
document.addEventListener('input', event => { if (event.target.id === 'search') { ui.search = event.target.value; render(); } });
document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form]'); if (!form) return; event.preventDefault();
  const data = Object.fromEntries(new FormData(form)); const kind = form.dataset.form;
  if (kind === 'message') {
    if (await dispatch({ type: 'message', channel: form.dataset.channel, text: data.message })) { if (ui.detail) renderDetail(); notify(sharedMode ? 'Message saved' : 'Message saved'); }
    return;
  }
  let command;
  if (kind === 'new' || kind === 'edit') { data.dependencies = data.dependency ? [data.dependency] : []; command = { type: kind === 'new' ? 'create' : 'edit', input: data, taskId: ui.detail }; }
  else if (kind === 'evidence') command = { type: 'tests', taskId: ui.detail, passed: Number(data.passed), failed: Number(data.failed), note: data.note };
  else command = { type: kind === 'reason' ? form.dataset.command : kind, taskId: ui.detail, ...data };
  if (await dispatch(command, ui.actor, { expectedVersion: ui.formVersion, epoch: ui.formEpoch })) {
    if (kind === 'new') { showDetail(state.tasks.at(-1).id); notify('Task created'); }
    else { ui.form = null; renderDetail(); notify(sharedMode ? 'Saved' : 'Saved'); }
  }
});
modal.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    const stops = [...modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]')]
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    if (stops.length) {
      event.preventDefault();
      const current = stops.indexOf(document.activeElement);
      const next = event.shiftKey ? (current <= 0 ? stops.length - 1 : current - 1) : (current < 0 || current === stops.length - 1 ? 0 : current + 1);
      stops[next].focus();
    }
    return;
  }
  if (!event.target.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const tabs = ['overview', 'changes', 'discussion', 'history']; const index = tabs.indexOf(ui.tab);
  ui.tab = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[3] : tabs[(index + (event.key === 'ArrowRight' ? 1 : 3)) % 4];
  renderDetail(); modal.querySelector(`[data-tab="${ui.tab}"]`).focus();
});
modal.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
modal.addEventListener('click', event => { if (event.target === modal) { const box = modal.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeModal(); } });
window.addEventListener('storage', event => {
  if (sharedMode || event.key !== STORAGE_KEY) return;
  if (memoryOnly) { notify('Another tab changed stored data. This tab is keeping its unsaved local changes.', true); return; }
  loaded = loadState(storage); state = loaded.state; storageWarning = loaded.warning; render();
  if (ui.detail && !ui.form) renderDetail();
  notify('Updated from another tab');
});

async function api(path, body) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'content-type': 'application/json', 'x-relay-client': '1' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.message || 'The server rejected this request.'); error.code = data.error; throw error; }
  return data;
}
function receiveShared(view) { sharedView = view; state = view.state; ui.actor = view.viewer.actor; storageWarning = null; }
async function refreshShared() {
  try { receiveShared(await api('/api/workspace')); render(); if (ui.detail && !ui.form) renderDetail(); notify('Refreshed'); }
  catch (error) { notify(error.message, true); }
}
async function sharedDispatch(command, overrides) {
  const task = taskById(command.taskId);
  const envelope = { command: { token: task?.lease?.token, resourceFence: task?.resourceFence, ...command }, operationId: crypto.randomUUID(), expectedVersion: task?.version, epoch: state.epoch, ...overrides };
  if (command.type === 'message') envelope.command.recipients = command.channel.startsWith('direct:') ? [command.channel.slice(7)] : ['dot'];
  try {
    let result;
    // One network retry reuses exactly the same operation key and envelope. Rejections are never auto-retried.
    try { result = await api('/api/command', envelope); }
    catch (error) { if (error instanceof TypeError) result = await api('/api/command', envelope); else throw error; }
    receiveShared(result); render(); return true;
  } catch (error) {
    notify(`${error.message} Refresh before submitting. Unsaved edits retained.`, true); return false;
  }
}
function enhanceShared(root) {
  root.querySelectorAll('#actor, #dialog-actor').forEach(select => { select.innerHTML = '<option>You · authenticated owner</option>'; select.disabled = true; select.setAttribute('aria-label', 'Authenticated owner identity'); });
  root.querySelectorAll('.actor-label').forEach(label => label.textContent = 'Identity');
  root.querySelectorAll('[data-action="reset"], .simulation-tools').forEach(element => element.remove());
  root.querySelectorAll('[data-command="claim"], [data-command="review"], [data-command="submit"], [data-action="artifact"], [data-action="evidence"]').forEach(element => element.remove());
  root.querySelectorAll('.demo-label').forEach(element => { element.textContent = 'PRIVATE'; element.setAttribute('aria-label', 'About the shared workspace'); });
  root.querySelectorAll('.demo-strip span').forEach(element => element.textContent = 'Private workspace · sample tasks · execution disabled');
  root.querySelectorAll('.main-footer span:last-child').forEach(element => element.textContent = 'Server storage');
  root.querySelectorAll('.page-heading p').forEach(element => { if (ui.page === 'rooms') element.textContent = ''; });
  root.querySelectorAll('.bot-activity').forEach((element, index) => { element.replaceChildren(); const span = document.createElement('span'); span.className = 'activity-light'; element.append(span, index === 0 ? 'Read connection: test required' : 'Identity not connected'); });
  root.querySelectorAll('.message-meta span').forEach(element => element.textContent = 'SAVED');
  root.querySelectorAll('.empty-conversation p').forEach(element => element.textContent = '');
  root.querySelectorAll('.message-form label span').forEach(element => element.textContent = '· authenticated owner');
  root.querySelectorAll('.message-form .field-hint').forEach(element => element.textContent = 'Recipient: dot');
  root.querySelectorAll('.message-form button').forEach(element => element.setAttribute('aria-label', 'Save room message'));
  root.querySelectorAll('.conversation-header .badge').forEach(element => element.textContent = 'Shared storage');
  root.querySelectorAll('.activity-panel .section-heading p').forEach(element => element.textContent = '');
  root.querySelectorAll('.ownership-panel .field-hint').forEach(element => element.textContent = 'Lease: 15 minutes · agents disconnected');
  root.querySelectorAll('[data-action="override"]').forEach(element => element.textContent = 'Offer / revoke ownership');
  root.querySelectorAll('.dialog-footer').forEach(element => { element.textContent = 'Owner · execution disabled'; });
  root.querySelectorAll('form.form-body > .field-hint').forEach(element => element.textContent = 'Demo data only · * required');
  root.querySelectorAll('select[name="target"] option').forEach(element => { if (!['forge', 'flux'].includes(element.value)) element.remove(); });
  const bar = root.querySelector('.top-actions');
  if (bar) { const link = document.createElement('a'); link.className = 'button'; link.href = '/wake.html'; link.textContent = 'Slack test'; bar.prepend(link); }
  if (bar) { const button = document.createElement('button'); button.className = 'button'; button.dataset.action = 'refresh-shared'; button.textContent = 'Refresh'; bar.prepend(button); }
  const panel = root.querySelector('.ownership-panel');
  if (panel && ui.detail) for (const offer of sharedView?.offers.filter(item => item.taskId === ui.detail && item.status === 'pending') || []) {
    const box = document.createElement('div'); box.className = 'warning';
    const text = document.createElement('p'); text.textContent = `Pending ${offer.phase} handoff to ${nameOf(offer.to)}. ${offer.reason}`; box.append(text);
    if (offer.to === ui.actor) for (const [action, label] of [['accept-offer', 'Accept responsibility'], ['decline-offer', 'Decline handoff']]) {
      const button = document.createElement('button'); button.className = 'button'; button.dataset.action = action; button.dataset.offer = offer.id; button.textContent = label; box.append(button);
    }
    panel.append(box);
  }
}
function sharedWorkflow() {
  ui.detail = null;
  openModal(`${dialogHeader('PRIVATE', 'Workflow')}<div class="form-body"><h3>Storage</h3><p>Private database: tasks, messages, leases, handoffs and activity. Code execution and deployment are disabled.</p><h3>Approval</h3><p>Requires engineer ownership, artifact evidence, independent review and human approval. Handoffs require recipient acceptance. Approval does not deploy.</p><h3>Connections</h3><p>Owner authenticated. Engineer and reviewer disconnected. The Site plugin has owner read access; individual dot identity is unverified. Slack delivery and agent acknowledgment are separate.</p><h3>Messages</h3><p>Messages do not authorize work. Read receipts do not indicate completion. Automatic replies and execution are disabled.</p><h3>Limits</h3><p>Legacy workspace limit: 1 MiB. Sample data only. No Salesforce connection.</p><button class="button primary" data-action="close">Back to Relay</button></div>`, 'form-dialog');
}
if (sharedMode) {
  document.body.classList.add('shared-mode');
  app.innerHTML = '<main><h1>Loading…</h1></main>';
  try {
    let view; try { view = await api('/api/workspace'); } catch (error) { if (error.code === 'SETUP_REQUIRED') view = await api('/api/bootstrap', {}); else throw error; }
    receiveShared(view); render();
  } catch (error) { app.innerHTML = `<main class="form-body"><h1>Unable to load</h1><p role="alert">${esc(error.message)}</p><a href="/">Retry loading</a></main>`; }
} else render();
