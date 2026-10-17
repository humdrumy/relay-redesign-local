const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let initialized = false, busy = false, pollBusy = false;
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; }
async function api(path, body) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: body ? { 'content-type':'application/json', 'x-relay-client':'1' } : {}, ...(body ? {body:JSON.stringify(body)} : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(value.message || 'Request failed'); return value;
}
async function refresh() {
  if (pollBusy) return; pollBusy = true;
  try {
    const data = await api('/api/wake-status');
    $('connection').textContent = data.configured ? 'Bot token configured' : data.configurationMessage;
    $('test').disabled = busy || !data.configured;
    if (!initialized) { $('channel').value = data.channel || ''; $('mention').value = data.mentions.dot || ''; $('enabled').checked = data.enabled; initialized = true; notice('Ready'); }
    $('receipts').innerHTML = data.wakes.length ? data.wakes.slice().reverse().map(wake => {
      const label = wake.acknowledgedAt ? 'Acknowledged' : wake.status === 'sent' ? 'Delivered · awaiting acknowledgment' : wake.status === 'failed' ? 'Delivery failed' : wake.status === 'sending' ? 'Sending to Slack' : 'Queued for Slack';
      return `<article class="receipt"><strong>${label}</strong><p>${escape(wake.reason)}${wake.taskId ? ` · ${escape(wake.taskId)}` : ''} · ${escape(new Date(wake.createdAt).toLocaleString())}</p><small>Wake ID: ${escape(wake.id)}</small>${wake.error ? `<p>${escape(wake.error)}</p>` : ''}${wake.acknowledgedAt ? `<p>Acknowledged ${escape(new Date(wake.acknowledgedAt).toLocaleString())} · execution unverified</p>` : ''}${wake.status === 'failed' && !wake.acknowledgedAt ? `<button data-retry="${escape(wake.id)}">Retry delivery</button>` : ''}</article>`;
    }).join('') : '<p class="muted">No notifications</p>';
  } catch(error) { notice(error.message, true); } finally { pollBusy = false; }
}
async function perform(action) { if (busy) return; busy = true; $('test').disabled = true;
  try { await action(); } catch(error) { notice(error.message, true); } finally { busy = false; await refresh(); } }
$('config').addEventListener('submit', event => { event.preventDefault(); void perform(async () => { await api('/api/wake-config', { enabled:$('enabled').checked, channel:$('channel').value.trim(), mention:$('mention').value.trim() }); notice('Settings saved.'); }); });
$('test').addEventListener('click', () => void perform(async () => {
  const operationId = crypto.randomUUID(); let result;
  try { result = await api('/api/wake-test', { operationId }); } catch(error) { if (!(error instanceof TypeError)) throw error; result = await api('/api/wake-test', { operationId }); }
  notice(`Queued: ${result.wakeId}`);
}));
$('receipts').addEventListener('click', event => { const button = event.target.closest('[data-retry]'); if (button) void perform(async () => { await api('/api/wake-retry', { wakeId:button.dataset.retry }); notice('Retry queued'); }); });
$('refresh').addEventListener('click', () => void refresh());
await refresh();
setInterval(() => { if (!document.hidden && !busy) void refresh(); }, 4000);
