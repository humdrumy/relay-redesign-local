import { SLACK_MESSAGE_VIEW_LIMIT, legacyTextAlternatives } from './slack-mention.mjs';

const FAKE_ORIGIN = 'https://slack.invalid/api/';
const SLACK_ORIGIN = 'https://slack.com/api/';
const TS = /^\d+\.\d+$(?![\s\S])/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
const comparableSlackText = value => typeof value === 'string'
  ? value.replace(/(?<!<)https?:\/\/[^\s<>]+(?!>)/g, link => `<${link}>`)
  : null;
const EVENT = 'relay.task_thread.v1';

export async function taskThreadCorrelation(operation) {
  const { namespace: n, kind } = operation;
  const bytes=new TextEncoder().encode(JSON.stringify([EVENT,n.instanceId,n.epoch,
    n.workspaceId,operation.taskId,operation.operationId,kind,operation.channelId,
    operation.payloadRef,kind==='reply'?operation.rootMessageTs:null]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

const COMMON_OPTIONS = ['fetch', 'resolvePayload', 'binding', 'maxPages', 'pageSize', 'timeoutMs', 'onDiagnostic'];
function optionsOnly(options, extra = []) {
  if (!object(options) || Object.keys(options).some(key => ![...COMMON_OPTIONS, ...extra].includes(key)))
    throw new TypeError('Unsupported transport configuration.');
}

/** Protocol harness only: no credentials, global fetch, live endpoint, or route wiring. */
export function createFakeSlackTaskThreadTransport(options = {}) {
  optionsOnly(options);
  return createTransport(options, FAKE_ORIGIN, null);
}

/** Inert until explicitly enabled and invoked by authorized server integration. */
export function createSlackTaskThreadTransport(options = {}) {
  optionsOnly(options, ['enabled', 'authorizationHeader']);
  if (options.enabled !== true) throw new TypeError('Slack transport is disabled; explicit server enablement is required.');
  // Capture one header for the lifetime of this transport: identity checks and operations
  // must use the same authentication. Never read environment variables or acquire grants.
  const authorization = options.authorizationHeader;
  if (typeof authorization !== 'string' || authorization.length > 4096 ||
      !/^Bearer xoxb-[A-Za-z0-9-]+$(?![\s\S])/.test(authorization))
    throw new TypeError('Provide one valid server-owned bot authorization header.');
  return createTransport(options, SLACK_ORIGIN, authorization);
}

function createTransport({ fetch, resolvePayload, binding, maxPages = 20, pageSize = 100, timeoutMs = 5000, onDiagnostic = () => {} }, origin, authorization) {
  if (typeof fetch !== 'function' || typeof resolvePayload !== 'function' || typeof onDiagnostic !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || !object(binding) ||
      !['workspaceId', 'userId', 'botId'].every(key => nonempty(binding[key])) ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new TypeError('Provide explicit fetch, immutable payload resolver, trusted bot binding and bounded pagination.');
  const expected = Object.freeze({ ...binding });
  const codes = new Set(['invalid_auth', 'not_authed', 'token_expired', 'token_revoked', 'missing_scope',
    'no_permission', 'channel_not_found', 'not_in_channel', 'thread_not_found', 'ratelimited',
    'invalid_metadata_format', 'metadata_too_large', 'internal_error', 'fatal_error', 'service_unavailable']);
  const report = (category, code) => {
    try { const result = onDiagnostic(Object.freeze({ category, ...(code ? { code } : {}) }));
      // An async observer is also isolated; it cannot alter a receipt or leak an unhandled rejection.
      Promise.resolve(result).catch(() => {});
    } catch { /* Diagnostics must not affect delivery state. */ }
  };
  async function bounded(action) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([Promise.resolve().then(() => action(controller.signal)),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(Object.assign(new Error('Bound exceeded'), { code: 'ADAPTER_TIMEOUT' }));
        }, timeoutMs); })]);
    } finally { clearTimeout(timer); }
  }
  const failure = error => report(error?.code === 'ADAPTER_TIMEOUT' ? 'timeout' : 'transport_ambiguity');
  const valid = op => object(op) && object(op.namespace) &&
    ['instanceId', 'epoch', 'workspaceId'].every(key => nonempty(op.namespace[key]) && op.namespace[key].length <= 512) &&
    ['taskId', 'operationId', 'channelId', 'payloadRef'].every(key => nonempty(op[key]) && op[key].length <= (key === 'payloadRef' ? 2048 : 512)) &&
    op.namespace.workspaceId === expected.workspaceId && ['root', 'reply'].includes(op.kind) &&
    (op.kind === 'root' ? op.rootMessageTs === null : typeof op.rootMessageTs === 'string' && TS.test(op.rootMessageTs));
  async function request(method, parameters, write = false, beforePost) {
    const url = new URL(method, origin);
    if (!write) for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
    return bounded(async signal => {
      const headers = authorization ? { Authorization: authorization } : {};
      if (write) headers['Content-Type'] = 'application/json';
      // Final local authority check follows all payload/authentication awaits.
      // No further asynchronous preparation occurs before the provider attempt.
      if (method === 'chat.postMessage') {
        if (signal.aborted || typeof beforePost !== 'function' || await beforePost() !== true || signal.aborted) {
          report('authorization_denied'); return null;
        }
      }
      const response = await fetch(url.href, write
        ? { method: 'POST', redirect: 'error', signal, headers, body: JSON.stringify(parameters) }
        : { method: 'GET', redirect: 'error', signal, headers });
      if (!response || response.ok !== true) {
        report(response?.status === 429 ? 'rate_limited' : 'http_error'); return null;
      }
      let body;
      try { body = await response.json(); } catch { report('malformed_response'); return null; }
      if (!object(body)) { report('malformed_response'); return null; }
      if (body.ok !== true) {
        if (body.ok === false && typeof body.error === 'string') report(body.error === 'ratelimited' ? 'rate_limited' : 'provider_error', codes.has(body.error) ? body.error : 'unknown_provider_error');
        else report('malformed_response');
        return null;
      }
      return body;
    });
  }
  async function identity() {
    // auth.test uses POST, but is read-only. It uses the same fixed origin and authentication.
    const auth = await request('auth.test', {}, true);
    if (!auth) return false;
    const verified = auth.team_id === expected.workspaceId && auth.user_id === expected.userId && auth.bot_id === expected.botId;
    if (!verified) report('identity_mismatch');
    return verified;
  }
  async function matches(message, op, expectedText = null) {
    const trustedSenderAndThread = object(message) && message.type === 'message' &&
      message.user === expected.userId && message.bot_id === expected.botId &&
      (message.channel === undefined || message.channel === op.channelId) &&
      typeof message.ts === 'string' && TS.test(message.ts) &&
      (op.kind === 'root' ? message.thread_ts === undefined || message.thread_ts === message.ts
        : message.thread_ts === op.rootMessageTs && message.ts !== op.rootMessageTs);
    if (!trustedSenderAndThread) return false;
    const correlated = object(message.metadata) && message.metadata.event_type === EVENT &&
      object(message.metadata.event_payload) && message.metadata.event_payload.correlation_id === await taskThreadCorrelation(op);
    // Slack installations and history responses can omit message metadata even when
    // the original post succeeded. In that case, bind only one exact-content match
    // from the configured bot in the exact destination/thread. Ambiguous matches
    // remain uncertain; task content is still treated as untrusted by Relay agents.
    const alternatives = Array.isArray(expectedText) ? expectedText : [expectedText];
    return correlated || alternatives.some(text => typeof text === 'string' &&
      comparableSlackText(message.text) === comparableSlackText(text));
  }
  const receipt = (op, ts) => ({ namespace: { ...op.namespace }, taskId: op.taskId,
    operationId: op.operationId, channelId: op.channelId, payloadRef: op.payloadRef,
    messageTs: ts, rootMessageTs: op.kind === 'root' ? null : op.rootMessageTs });
  // Read projections are plain untrusted data, never Slack rendering/action instructions.
  const authorId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$(?![\s\S])/.test(value);
  function confirmedBinding(value) {
    if (!object(value) || Object.keys(value).sort().join(',') !== 'channelId,namespace,root,taskId' ||
        !object(value.namespace) || Object.keys(value.namespace).sort().join(',') !== 'epoch,instanceId,workspaceId' ||
        !object(value.root) || Object.keys(value.root).some(key => !['kind', 'operationId', 'payloadRef', 'status', 'attempt', 'messageTs', 'rootMessageTs'].includes(key))) return null;
    const root = value.root;
    if (root.kind !== 'root' || root.status !== 'confirmed' || typeof root.messageTs !== 'string' ||
        !TS.test(root.messageTs) || root.rootMessageTs !== root.messageTs) return null;
    const operation = { namespace: value.namespace, taskId: value.taskId, channelId: value.channelId,
      operationId: root.operationId, payloadRef: root.payloadRef, kind: 'root', rootMessageTs: null };
    return valid(operation) ? { operation, rootTs: root.messageTs } : null;
  }
  function projectMessage(message, channelId, rootTs) {
    if (!object(message) || message.type !== 'message' || typeof message.ts !== 'string' || !TS.test(message.ts) ||
        (message.channel !== undefined && message.channel !== channelId) ||
        (message.ts === rootTs ? message.thread_ts !== undefined && message.thread_ts !== rootTs : message.thread_ts !== rootTs) ||
        typeof message.text !== 'string' || message.text.length > 40000 ||
        (message.user !== undefined && !authorId(message.user)) ||
        (message.bot_id !== undefined && !authorId(message.bot_id)) ||
        (message.user === undefined && message.bot_id === undefined) ||
        (message.subtype !== undefined && message.subtype !== 'bot_message' && message.subtype !== 'thread_broadcast')) return null;
    return { text: message.text.slice(0, SLACK_MESSAGE_VIEW_LIMIT), textTruncated: message.text.length > SLACK_MESSAGE_VIEW_LIMIT,
      messageTs: message.ts, rootMessageTs: rootTs, isRoot: message.ts === rootTs,
      author: { userId: message.user ?? null, botId: message.bot_id ?? null } };
  }
  return Object.freeze({
    async readConfirmedThread(serverBinding) {
      let rootVerified = false, pagesRead = 0, textSize = 0;
      const messages = new Map(), cursors = new Set();
      const result = (reason, hasMore = null, discard = false) => ({
        status: !rootVerified || discard ? 'unreadable' : reason === null ? 'complete' : 'partial',
        reason: !rootVerified && reason === null ? 'root_unverified' : reason,
        messages: rootVerified && !discard ? [...messages.values()] : [],
        pagination: { pagesRead, hasMore },
      });
      try {
        const resolved = confirmedBinding(structuredClone(serverBinding));
        if (!resolved) return result('invalid_binding');
        if (!await identity()) return result('identity_unverified');
        const { operation: op, rootTs } = resolved;
        const rootPayload = await bounded(() => resolvePayload(op.payloadRef, op));
        const expectedRootText = object(rootPayload) && typeof rootPayload.text === 'string'
          ? legacyTextAlternatives(rootPayload.text) : null;
        let cursor;
        for (let page = 0; page < maxPages; page++) {
          const parameters = { channel: op.channelId, ts: rootTs, include_all_metadata: true, limit: pageSize };
          if (cursor) parameters.cursor = cursor;
          const body = await request('conversations.replies', parameters);
          if (!body) return result('provider_unreadable');
          if (!Array.isArray(body.messages) || body.messages.length > pageSize ||
              (body.channel !== undefined && body.channel !== op.channelId) ||
              (body.has_more !== undefined && typeof body.has_more !== 'boolean') ||
              (body.response_metadata !== undefined && !object(body.response_metadata))) return result('malformed_page');
          const next = body.response_metadata?.next_cursor;
          if (next !== undefined && (typeof next !== 'string' || next.length > 2048 || /[\s\x00-\x1f\x7f]/.test(next))) return result('malformed_page');
          const staged = new Map(); let verifiedOnPage = false, addedSize = 0;
          for (const message of body.messages) {
            if (message?.ts === rootTs) {
              if (!await matches(message, op, expectedRootText)) return result('root_mismatch', null, true);
              verifiedOnPage = true;
            }
            const projected = projectMessage(message, op.channelId, rootTs);
            if (!projected) return result('malformed_message');
            const previous = staged.get(projected.messageTs) ?? messages.get(projected.messageTs);
            if (previous && JSON.stringify(previous) !== JSON.stringify(projected)) return result('inconsistent_message');
            if (!previous) { staged.set(projected.messageTs, projected); addedSize += projected.text.length; }
          }
          if (messages.size + staged.size > 1000 || textSize + addedSize > 256000) return result('projection_limit', true);
          for (const [key, message] of staged) messages.set(key, message);
          rootVerified ||= verifiedOnPage; textSize += addedSize; pagesRead++;
          if (!next) {
            if (body.has_more === true) return result('incomplete_pagination', true);
            return result(null, false);
          }
          if (cursors.has(next)) return result('repeated_cursor', true);
          cursors.add(next); cursor = next;
        }
        return result('page_limit', true);
      } catch (error) {
        failure(error);
        return result(error?.code === 'ADAPTER_TIMEOUT' ? 'timeout' : 'transport_ambiguity');
      }
    },
    async send(operation, { beforePost } = {}) {
      try {
        const op = structuredClone(operation);
        if (!valid(op) || typeof beforePost !== 'function') return null;
        const payload = await bounded(() => resolvePayload(op.payloadRef, op));
        if (!object(payload) || Object.keys(payload).some(key => key !== 'text') ||
            !nonempty(payload.text) || payload.text.length > SLACK_MESSAGE_VIEW_LIMIT || !await identity()) return null;
        const messageText = payload.text;
        const parameters = { channel: op.channelId, text: messageText,
          metadata: { event_type: EVENT, event_payload: { correlation_id: await taskThreadCorrelation(op) } },
          unfurl_links: false, unfurl_media: false, reply_broadcast: false };
        if (op.kind === 'reply') parameters.thread_ts = op.rootMessageTs;
        const response = await request('chat.postMessage', parameters, true, beforePost);
        if (!response) return null;
        if (response.channel !== op.channelId || !await matches(response.message, op, messageText) || response.ts !== response.message.ts) {
          report('unproven_receipt'); return null;
        }
        return receipt(op, response.ts);
      } catch (error) { failure(error); return null; }
    },
    async lookup(operation) {
      try {
        const op = structuredClone(operation);
        if (!valid(op) || !await identity()) return null;
        const payload = await bounded(() => resolvePayload(op.payloadRef, op));
        const expectedText = object(payload) && typeof payload.text === 'string'
          ? legacyTextAlternatives(payload.text) : null;
        const found = new Map(), cursors = new Set();
        let cursor;
        for (let page = 0; page < maxPages; page++) {
          const parameters = { channel: op.channelId, include_all_metadata: true, limit: pageSize };
          if (op.kind === 'reply') parameters.ts = op.rootMessageTs;
          if (cursor) parameters.cursor = cursor;
          const body = await request(op.kind === 'root' ? 'conversations.history' : 'conversations.replies', parameters);
          if (!body) return null;
          if (!Array.isArray(body.messages) || body.messages.some(message => !object(message)) ||
              (body.channel !== undefined && body.channel !== op.channelId) ||
              (body.has_more !== undefined && typeof body.has_more !== 'boolean') ||
              (body.response_metadata !== undefined && !object(body.response_metadata))) { report('malformed_response'); return null; }
          for (const message of body.messages) if (await matches(message, op, expectedText)) found.set(message.ts, message);
          if (found.size > 1) { report('ambiguous_match'); return null; }
          const next = body.response_metadata?.next_cursor;
          if (next !== undefined && typeof next !== 'string') { report('malformed_response'); return null; }
          if (!next) {
            if (body.has_more === true) { report('incomplete_lookup'); return null; }
            if (!found.size) { report('absent_match'); return null; }
            return receipt(op, found.keys().next().value);
          }
          if (next.trim() !== next || cursors.has(next)) { report('incomplete_lookup'); return null; }
          cursors.add(next); cursor = next;
        }
        report('incomplete_lookup'); return null;
      } catch (error) { failure(error); return null; }
    },
  });
}
