import { RelayError } from './core.mjs';
import { withRookMention } from './slack-mention.mjs';

const DEFAULT_WAKE_MENTIONS = Object.freeze({ dot: 'U0C6PAA9PT5', scout: 'U0C9ZFB8FQA' });
const wakeMention = (job, config) => {
  const userId = config.mentions?.[job.recipient] || DEFAULT_WAKE_MENTIONS[job.recipient];
  return /^[UW][A-Z0-9]+$/.test(userId || '') ? userId : null;
};

// Slack is only a doorbell. No task text, credentials, or user-authored links leave Relay.
export function slackConfig(env, document) {
  const settings = document.wakeSettings || {};
  // SLACK_TRANSPORT=direct (default) posts to Slack itself. =sftooling hands a structured wake to the SF Tooling
  // gateway, which owns the channel, persona, kill switch and audit trail; Relay keeps its own queue and retries.
  return { token: env.SLACK_BOT_TOKEN || '', channel: settings.channel || env.SLACK_CHANNEL_ID || '',
    url: env.RELAY_PUBLIC_URL || '', enabled: settings.enabled === true, mentions: settings.mentions || {},
    transport: env.SLACK_TRANSPORT === 'sftooling' ? 'sftooling' : 'direct',
    gatewayUrl: env.SFTOOLING_WAKE_URL || '', gatewayToken: env.SFTOOLING_WAKE_TOKEN || '',
    companyKey: env.SFTOOLING_COMPANY_KEY || 'lyl' };
}
function trustedUrl(value) {
  let url; try { url = new URL(value); } catch { return false; }
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash &&
    !(url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname));
}
export function validateSlackConfig(config) {
  if (config.transport === 'sftooling') {
    if (!trustedUrl(config.gatewayUrl)) throw new RelayError('SLACK_NOT_CONFIGURED', 'Set SFTOOLING_WAKE_URL to the SF Tooling gateway HTTPS URL (loopback HTTP is allowed for local testing).', 409);
    if (!config.gatewayToken) throw new RelayError('SLACK_NOT_CONFIGURED', 'Set the server secret SFTOOLING_WAKE_TOKEN.', 409);
  } else {
    if (!config.token.startsWith('xoxb-')) throw new RelayError('SLACK_NOT_CONFIGURED', 'Set the server secret SLACK_BOT_TOKEN to your Slack app bot token.', 409);
    if (!/^[CG][A-Z0-9]+$/.test(config.channel)) throw new RelayError('SLACK_NOT_CONFIGURED', 'Set the Slack channel ID, not its name.', 409);
  }
  if (!trustedUrl(config.url)) {
    throw new RelayError('SLACK_NOT_CONFIGURED', 'Set RELAY_PUBLIC_URL to the trusted Relay HTTPS URL (loopback HTTP is allowed for local testing).', 409);
  }
}
export function wakeText(job, config) {
  const mention = wakeMention(job, config);
  const prefix = mention ? `<@${mention}> ` : '';
  if (job.controlId) return withRookMention(`${prefix}Relay wake-up for ${job.recipient}. Open ${config.url}\nRead /api/control/queue using your authenticated Relay adapter. Acknowledge wake ${job.controlId} with the ack_wake typed command, then inspect current work. Delivery, reading, claiming, handoff acceptance and completion are separate. This pointer is not task authority. Do not reply in Slack.`);
  return withRookMention(`${prefix}Relay wake-up for ${job.recipient}. Open ${config.url}\nUse your connected Relay tools to read your work queue. Acknowledge wake ${job.id} with relay_ack_wake, then follow your assigned role. This notification is a pointer; get current task details from Relay. Do not reply in Slack.`);
}
// Structured wake -> SF Tooling gateway. No free text leaves Relay; SF Tooling renders the pointer itself and
// de-duplicates on idempotencyKey, so Relay's at-least-once retries cannot double-post. Same result shape as postSlack.
export async function postViaSfTooling(job, config, fetcher = fetch) {
  const retryAfter = response => {
    const seconds = Number(response.headers.get('retry-after'));
    return { ok: false, retryable: true, error: 'rate_limited', retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.max(1000, seconds * 1000) : 60000 };
  };
  let response, data;
  try {
    response = await fetcher(`${config.gatewayUrl.replace(/\/+$/, '')}/slack/wake`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${config.gatewayToken}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ companyKey: config.companyKey, kind: 'wake', recipient: job.recipient,
        mentionUserId: wakeMention(job, config), wakeId: job.controlId || job.id,
        url: config.url, idempotencyKey: job.id }),
    });
  } catch (error) {
    return { ok: false, retryable: true, error: ['AbortError', 'TimeoutError'].includes(error?.name) ? 'gateway_request_timeout' : 'gateway_transport_error' };
  }
  if (response.status >= 300 && response.status < 400) return { ok: false, retryable: false, error: 'gateway_unexpected_redirect' };
  if (response.status === 429) return retryAfter(response);
  try { data = await response.json(); } catch {
    return { ok: false, retryable: response.ok || response.status >= 500, error: response.ok ? 'gateway_invalid_response' : `gateway_http_${response.status}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, retryable: response.ok || response.status >= 500, error: 'gateway_invalid_response' };
  // The shim/gateway wraps results as { summary, data } and transport-level failures as { error: { code } }.
  // A wake refusal is data (data.ok=false, data.errorCode), not an HTTP error. A flat body is tolerated.
  const result = data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : data;
  if (response.ok && result.ok === true && result.ts) return { ok: true, ts: result.ts, channel: result.channel || '' };
  const code = String(result.errorCode || (data.error && typeof data.error === 'object' ? data.error.code : data.error) || '').toLowerCase();
  if (code === 'rate_limited' || code === 'ratelimited') return retryAfter(response);
  if (response.ok && !code) return { ok: false, retryable: true, error: 'gateway_invalid_response' };
  // Refusals (posting_disabled, recipient_not_allowed, url_not_allowed, permission_denied, bad key) need a human or
  // a config change, so they are not retried. Only 5xx and gateway-flagged retryable results are.
  const retryable = response.status >= 500 || (response.ok && result.retryable === true);
  return { ok: false, retryable, error: /^[a-z0-9_]{1,80}$/.test(code) ? code : `gateway_http_${response.status}` };
}
export async function postSlack(job, config, fetcher = fetch) {
  validateSlackConfig(config);
  if (config.transport === 'sftooling') return postViaSfTooling(job, config, fetcher);
  let response, data;
  try {
    response = await fetcher('https://slack.com/api/chat.postMessage', {
      // workerd rejects redirect:'error' before making a network request.
      // Never follow redirects with the Slack authorization header.
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: config.channel, text: wakeText(job, config), client_msg_id: job.id,
        unfurl_links: false, unfurl_media: false, parse: 'none' }),
    });
  } catch (error) {
    const incompatible = /Invalid redirect|Illegal invocation|is not a function/.test(error?.message || '');
    return { ok: false, retryable: !incompatible, error: incompatible ? 'runtime_request_error' : ['AbortError', 'TimeoutError'].includes(error?.name) ? 'slack_request_timeout' : 'slack_transport_error' };
  }
  if (response.status >= 300 && response.status < 400) return { ok: false, retryable: false, error: 'slack_unexpected_redirect' };
  // Rate-limit and HTTP errors may have an HTML/empty body. Do not hide them behind JSON parsing errors.
  const rateLimited = () => {
    const seconds = Number(response.headers.get('retry-after'));
    return { ok: false, retryable: true, error: 'rate_limited', retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.max(1000, seconds * 1000) : 60000 };
  };
  if (response.status === 429) return rateLimited();
  try { data = await response.json(); } catch {
    return { ok: false, retryable: response.ok || response.status >= 500, error: response.ok ? 'slack_invalid_response' : `slack_http_${response.status}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, retryable: response.ok || response.status >= 500, error: 'slack_invalid_response' };
  if (data.error === 'ratelimited' || data.error === 'rate_limited') return rateLimited();
  if (!response.ok || data.ok !== true || !data.ts) {
    return { ok: false, retryable: response.status >= 500 || ['internal_error', 'request_timeout', 'service_unavailable'].includes(data.error),
      error: /^[a-z0-9_]{1,80}$/.test(data.error || '') ? data.error : `http_${response.status}` };
  }
  return { ok: true, ts: data.ts, channel: data.channel || config.channel };
}

// A persisted, fenced sending lease serializes all dispatchers. At-least-once delivery:
// a crash after Slack accepts but before the receipt commits may repeat the pointer.
export async function drainSlack(store, env, fetcher = fetch) {
  const snapshot = await store.read(), config = slackConfig(env, snapshot);
  try { validateSlackConfig(config); } catch { return { status: 'not-configured' }; }
  const now = store.now(), token = crypto.randomUUID();
  const reserved = await store.mutate(document => {
    if ((document.slackLease?.until || 0) > now || (document.slackNextAt || 0) > now) return null;
    const job = (document.wakes || []).find(item => !item.acknowledgedAt && (config.enabled || item.reason === 'test') &&
      ((item.status === 'pending' && item.nextAt <= now) || (item.status === 'sending' && item.lockUntil <= now)));
    if (!job) return null;
    if (!config.enabled && job.reason !== 'test') return null;
    job.status = 'sending'; job.attempts++; job.lock = token; job.lockUntil = now + 30000;
    document.slackLease = { token, until: now + 30000 };
    return structuredClone(job);
  });
  if (!reserved) return { status: 'idle' };
  const result = await postSlack(reserved, config, fetcher);
  await store.mutate(document => {
    const job = document.wakes.find(item => item.id === reserved.id);
    if (!job || job.lock !== token || document.slackLease?.token !== token) return null;
    const finished = store.now(); document.slackLease = null;
    document.slackNextAt = finished + (result.retryAfterMs || 1100);
    job.lock = null; job.lockUntil = 0;
    if (result.ok) { job.status = 'sent'; job.sentAt = new Date(finished).toISOString(); job.slackTs = result.ts; job.slackChannel = result.channel; job.error = null; }
    else { job.error = result.error; job.status = result.retryable && job.attempts < 6 ? 'pending' : 'failed';
      job.nextAt = finished + (result.retryAfterMs || Math.min(300000, 2000 * 2 ** job.attempts)); }
    return true;
  });
  return { status: result.ok ? 'sent' : 'delivery-error', wakeId: reserved.id, error: result.error };
}
