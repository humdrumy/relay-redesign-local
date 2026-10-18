import { RelayError } from './core.mjs';
import { ControlStore, currentWake } from './control.mjs';

const EVENT_NAME = 'relay.wake.created';
const MAX_CHALLENGE_BYTES = 4096;
const MAX_ATTEMPTS = 5;
const encoder = new TextEncoder();
const definition = {
  name: EVENT_NAME,
  description: 'A current Relay work or message wake is waiting for this signed-in Dot. Read your Relay queue, then acknowledge the wake. A delivery alone does not claim or complete work.',
  delivery: ['webhook'], inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  payloadSchema: { type: 'object', properties: { wakeId: { type: 'string' }, actor: { type: 'string' } }, required: ['wakeId', 'actor'], additionalProperties: false }
};
const invalid = (message, status = 400) => { throw new RelayError('INVALID_EVENT_SUBSCRIPTION', message, status); };
const constantEqual = (a, b) => {
  const x = encoder.encode(a), y = encoder.encode(b); let mismatch = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) mismatch |= (x[i] || 0) ^ (y[i] || 0);
  return mismatch === 0;
};
function secretBytes(secret) {
  if (typeof secret !== 'string' || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) invalid('A Standard Webhooks whsec_ signing secret is required.');
  let bytes; try { bytes = Uint8Array.from(atob(secret.slice(6)), c => c.charCodeAt(0)); } catch { invalid('Invalid signing secret.'); }
  if (bytes.length < 24 || bytes.length > 64 || btoa(String.fromCharCode(...bytes)).replace(/=+$/, '') !== secret.slice(6).replace(/=+$/, '')) invalid('Signing secret must decode to 24–64 bytes.');
  return bytes;
}
function callbackUrl(value) {
  let url; try { url = new URL(value); } catch { invalid('Invalid callback URL.'); }
  const host = url.hostname.toLowerCase();
  const trusted = ['openai.com', 'chatgpt.com', 'oaiusercontent.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !trusted || url.href.length > 2048) invalid('Callback must be a trusted ChatGPT HTTPS hostname without credentials, fragment or custom port.');
  return url.href;
}
const nowValue = clock => typeof clock === 'function' ? clock() : Date.now();
async function signedHeaders(secret, id, body, subscriptionId, clock) {
  const timestamp = String(Math.floor(nowValue(clock) / 1000));
  const key = await crypto.subtle.importKey('raw', secretBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${timestamp}.${body}`)));
  return { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${btoa(String.fromCharCode(...signature))}`, 'X-MCP-Subscription-Id': subscriptionId };
}
async function post(sub, id, payload, webhookFetch, clock, timeoutMs = 10000, consume = response => response) {
  const body = JSON.stringify(payload), url = callbackUrl(sub.callback_url);
  const headers = await signedHeaders(sub.secret, id, body, sub.id, clock);
  const controller = new AbortController(); let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); const error = new Error('Callback timed out'); error.name = 'TimeoutError'; reject(error); }, timeoutMs); });
  try { return await Promise.race([(async () => consume(await webhookFetch(url, { method: 'POST', redirect: 'manual', signal: controller.signal, headers, body })))(), timeout]); }
  finally { clearTimeout(timer); }
}
async function boundedChallenge(response, expected) {
  if (!response?.body?.getReader) return false;
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CHALLENGE_BYTES) { void reader.cancel().catch(() => {}); return false; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed; try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return false; }
  return response.ok && typeof parsed?.challenge === 'string' && constantEqual(parsed.challenge, expected);
}
const subIdFor = async (subject, actor, url) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([subject, actor, EVENT_NAME, url]))));
  return `sub_${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)}`;
};
export async function eventActor(db, subject, env) {
  if (!subject || env.RELAY_MCP_DOT_ENABLED !== 'true' || (env.RELAY_MCP_EVENTS_ENABLED !== undefined && env.RELAY_MCP_EVENTS_ENABLED !== 'true')) return null;
  const state = await new ControlStore(db).read();
  if (subject === state.meta.ownerId) return 'dot';
  if (env.RELAY_MCP_SCOUT_SUBJECT && subject === env.RELAY_MCP_SCOUT_SUBJECT) return 'scout';
  return null;
}
export async function handleMcpEvent(rpc, db, subject, env, webhookFetch = fetch, clock = Date.now, { verificationTimeoutMs = 10000 } = {}) {
  const actor = await eventActor(db, subject, env);
  if (!actor) throw new RelayError('FORBIDDEN', 'No Dot event access for this Site sign-in.', 403);
  const params = rpc.params || {};
  if (rpc.method === 'events/list') return { events: [definition] };
  if (rpc.method === 'events/subscribe') {
    const args = params.arguments ?? {};
    if (params.name !== EVENT_NAME || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length || params.delivery?.mode !== 'webhook' || (params.cursor !== undefined && params.cursor !== null)) invalid('Use relay.wake.created with no filters and webhook delivery.');
    const url = callbackUrl(params.delivery.url), secret = params.delivery.secret; secretBytes(secret);
    const id = await subIdFor(subject, actor, url), generation = crypto.randomUUID(), challenge = crypto.randomUUID();
    // Store only a generation fence while verifying; failed challenges never create a subscription.
    await db.prepare(`INSERT INTO relay_mcp_verifications (id, owner_id, actor, generation) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, actor=excluded.actor, generation=excluded.generation`).bind(id, subject, actor, generation).run();
    let response;
    try { response = await post({ id, callback_url: url, secret }, `msg_verification_${crypto.randomUUID()}`, { type: 'verification', challenge }, webhookFetch, clock, verificationTimeoutMs, response => boundedChallenge(response, challenge)); }
    catch (error) {
      await db.prepare('DELETE FROM relay_mcp_verifications WHERE id=? AND generation=?').bind(id, generation).run();
      return { __error: { code: -32015, message: 'CallbackEndpointError', data: { reason: error?.name === 'TimeoutError' ? 'timeout' : 'challenge_failed' } } };
    }
    if (!response) {
      await db.prepare('DELETE FROM relay_mcp_verifications WHERE id=? AND generation=?').bind(id, generation).run();
      return { __error: { code: -32015, message: 'CallbackEndpointError', data: { reason: 'challenge_failed' } } };
    }
    const ttl = params.ttlMs === null ? 30 * 86400000 : Math.min(30 * 86400000, Number.isFinite(params.ttlMs) && params.ttlMs > 0 ? params.ttlMs : 7 * 86400000);
    const completedAt = nowValue(clock), expires = completedAt + ttl;
    const activated = await db.batch([
      db.prepare(`INSERT INTO relay_mcp_subscriptions (id, owner_id, actor, name, callback_url, secret, expires_at, created_at, generation, active)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM relay_mcp_verifications WHERE id=? AND owner_id=? AND generation=?)
        ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, actor=excluded.actor, name=excluded.name, callback_url=excluded.callback_url, secret=excluded.secret, expires_at=excluded.expires_at, generation=excluded.generation, active=1`).bind(id, subject, actor, EVENT_NAME, url, secret, expires, completedAt, generation, id, subject, generation),
      db.prepare('DELETE FROM relay_mcp_verifications WHERE id=? AND owner_id=? AND generation=?').bind(id, subject, generation)
    ]);
    if (!activated[0]?.meta?.changes) return { __error: { code: -32015, message: 'CallbackEndpointError', data: { reason: 'challenge_failed' } } };
    return { id, refreshBefore: new Date(expires).toISOString(), cursor: null, truncated: false };
  }
  if (rpc.method === 'events/unsubscribe') {
    if (params.name !== EVENT_NAME || !params.arguments || Array.isArray(params.arguments) || Object.keys(params.arguments).length || !params.delivery?.url) invalid('Supply the event name, empty arguments, and callback URL.');
    const url = callbackUrl(params.delivery.url), id = await subIdFor(subject, actor, url);
    await db.batch([
      db.prepare('DELETE FROM relay_mcp_verifications WHERE id = ? AND owner_id = ? AND actor = ?').bind(id, subject, actor),
      db.prepare('DELETE FROM relay_mcp_subscriptions WHERE id = ? AND owner_id = ? AND actor = ?').bind(id, subject, actor),
      db.prepare('DELETE FROM relay_mcp_deliveries WHERE subscription_id = ? AND NOT EXISTS (SELECT 1 FROM relay_mcp_subscriptions WHERE id = ?)').bind(id, id)
    ]);
    return {};
  }
  invalid('Unknown event method.', 404);
}
function actorStillAllowed(sub, state, env) {
  return sub.actor === 'dot' ? sub.owner_id === state.meta.ownerId
    : sub.actor === 'scout' && sub.owner_id === env.RELAY_MCP_SCOUT_SUBJECT;
}
async function eligible(db, env, id, wakeId, claimToken, clock) {
  const now = nowValue(clock), control = new ControlStore(db), state = await control.read();
  const sub = await db.prepare('SELECT * FROM relay_mcp_subscriptions WHERE id = ? AND active = 1').bind(id).first();
  const delivery = await db.prepare('SELECT * FROM relay_mcp_deliveries WHERE id = ?').bind(id + ':' + wakeId).first();
  const wake = state.wakes.find(item => item.id === wakeId);
  const allowed = sub && sub.expires_at > now && actorStillAllowed(sub, state, env) && delivery?.status === 'sending' && delivery.claim_token === claimToken && delivery.lock_until > now && wake && !wake.acknowledgedAt && wake.recipient === sub.actor && Date.parse(wake.at) >= sub.created_at && currentWake(state, wake);
  return allowed ? { sub, delivery, wake, state, now } : null;
}
export async function drainMcpEvents(db, env, webhookFetch = fetch, clock = Date.now) {
  if (env.RELAY_MCP_DOT_ENABLED !== 'true' || (env.RELAY_MCP_EVENTS_ENABLED !== undefined && env.RELAY_MCP_EVENTS_ENABLED !== 'true')) return { status: 'disabled' };
  const control = new ControlStore(db), state = await control.read(), discoveryNow = nowValue(clock);
  const subscriptions = (await db.prepare('SELECT * FROM relay_mcp_subscriptions WHERE active = 1 AND expires_at > ?').bind(discoveryNow).all()).results;
  for (const sub of subscriptions) {
    if (sub.name !== EVENT_NAME || !actorStillAllowed(sub, state, env)) continue;
    for (const wake of state.wakes.filter(w => w.recipient === sub.actor && !w.acknowledgedAt && Date.parse(w.at) >= sub.created_at && currentWake(state, w))) {
      await db.prepare('INSERT INTO relay_mcp_deliveries (id, subscription_id, wake_id, event_id, occurred_at, status, attempts, next_at, lock_until, claim_token) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, NULL) ON CONFLICT(subscription_id, wake_id) DO NOTHING').bind(`${sub.id}:${wake.id}`, sub.id, wake.id, `evt_${crypto.randomUUID()}`, wake.at, 'pending', nowValue(clock)).run();
    }
  }
  const due = (await db.prepare("SELECT d.id, d.subscription_id, d.wake_id FROM relay_mcp_deliveries d JOIN relay_mcp_subscriptions s ON s.id=d.subscription_id WHERE s.active=1 AND ((d.status='pending' AND d.next_at<=?) OR (d.status='sending' AND d.lock_until<=?)) ORDER BY d.next_at LIMIT 6").bind(nowValue(clock), nowValue(clock)).all()).results;
  let sent = 0, attempted = 0;
  for (const candidate of due) {
    const claimAt = nowValue(clock), claimToken = crypto.randomUUID();
    const claimed = await db.prepare("UPDATE relay_mcp_deliveries SET status='sending', attempts=attempts+1, lock_until=?, claim_token=? WHERE id=? AND ((status='pending' AND next_at<=?) OR (status='sending' AND lock_until<=?))").bind(claimAt + 15000, claimToken, candidate.id, claimAt, claimAt).run();
    if (!claimed.meta?.changes) continue;
    attempted++;
    const first = await eligible(db, env, candidate.subscription_id, candidate.wake_id, claimToken, clock);
    if (!first) {
      await db.prepare("UPDATE relay_mcp_deliveries SET status='cancelled', lock_until=0, claim_token=NULL WHERE id=? AND status='sending' AND claim_token=?").bind(candidate.id, claimToken).run();
      continue;
    }
    // Re-read subscription, wake, and claim immediately before transmission to honor concurrent unsubscribe/acknowledgement.
    const current = await eligible(db, env, candidate.subscription_id, candidate.wake_id, claimToken, clock);
    if (!current) {
      await db.prepare("UPDATE relay_mcp_deliveries SET status='cancelled', lock_until=0, claim_token=NULL WHERE id=? AND status='sending' AND claim_token=?").bind(candidate.id, claimToken).run();
      continue;
    }
    let ok = false, status = 0;
    try { const response = await post(current.sub, current.delivery.event_id, { eventId: current.delivery.event_id, name: EVENT_NAME, timestamp: current.delivery.occurred_at, data: { wakeId: current.wake.id, actor: current.sub.actor }, cursor: null }, webhookFetch, clock); ok = response.ok; status = response.status; } catch { status = 0; }
    // HTTP success means only transport delivery. A timeout/network failure is uncertain and retried at-least-once.
    const final = ok ? 'sent' : status === 410 || status === 413 || current.delivery.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    const completedAt = nowValue(clock), delay = Math.min(300000, 2000 * 2 ** Math.max(0, current.delivery.attempts - 1));
    await db.prepare('UPDATE relay_mcp_deliveries SET status=?, next_at=?, lock_until=0, last_error=?, claim_token=NULL WHERE id=? AND status=? AND claim_token=?').bind(final, completedAt + delay, ok ? null : `HTTP_${status}`, candidate.id, 'sending', claimToken).run();
    if (ok) sent++;
  }
  return { status: 'ok', attempted, sent };
}
