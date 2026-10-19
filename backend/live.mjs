import { RelayError } from './core.mjs';

// Read-only proxy from the Relay owner's browser to SF Tooling's gateway read routes (through the shim).
// Server-side so the shared key never reaches the page. Anything not listed here is refused, so the
// panel can never reach a write route (lead, task, note, sandbox, slack) even though the same key could.
export const LIVE_ROUTES = Object.freeze({
  meta: { id: false }, search: { id: false }, record: { id: true }, 'my-work': { id: false }, tasks: { id: false },
  report: { id: true }, greatness: { id: false }, 'realtor-metrics': { id: false }, refi: { id: false },
  board: { id: false }, 'team-tasks': { id: false }, query: { id: false },
});
const ID = /^[A-Za-z0-9]{15,18}$/;
const PARAM_NAME = /^[A-Za-z][A-Za-z0-9]{0,23}$/;

export function liveConfig(env) {
  return { url: String(env.SFTOOLING_WAKE_URL || '').replace(/\/+$/, ''), token: env.SFTOOLING_WAKE_TOKEN || '' };
}
export function liveConfigured(env) {
  const config = liveConfig(env);
  return /^https:\/\//.test(config.url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(config.url) ? !!config.token : false;
}

export function liveUrl(config, route, id, searchParams) {
  if (!Object.hasOwn(LIVE_ROUTES, route)) throw new RelayError('LIVE_ROUTE_UNKNOWN', 'That SF Tooling route is not available in the live panel.', 404);
  if (LIVE_ROUTES[route].id) {
    if (!ID.test(id || '')) throw new RelayError('INVALID_REQUEST', 'This route needs a Salesforce record id.', 400);
  } else if (id) throw new RelayError('INVALID_REQUEST', 'This route takes no id.', 400);
  const out = new URLSearchParams();
  let count = 0;
  for (const [name, value] of searchParams) {
    if (!PARAM_NAME.test(name) || value.length > 500 || ++count > 12) throw new RelayError('INVALID_REQUEST', 'Unsupported query parameter.', 400);
    out.append(name, value);
  }
  const query = out.toString();
  return `${config.url}/${route}${LIVE_ROUTES[route].id ? `/${id}` : ''}${query ? `?${query}` : ''}`;
}

export async function fetchLive(env, route, id, searchParams, fetcher = fetch) {
  const config = liveConfig(env);
  // Route allowlist first, so a write route is always "unknown" whether or not the server is configured.
  if (!Object.hasOwn(LIVE_ROUTES, route)) throw new RelayError('LIVE_ROUTE_UNKNOWN', 'That SF Tooling route is not available in the live panel.', 404);
  if (!liveConfigured(env)) throw new RelayError('LIVE_NOT_CONFIGURED', 'Set SFTOOLING_WAKE_URL and SFTOOLING_WAKE_TOKEN on the Relay server.', 409);
  const target = liveUrl(config, route, id, searchParams);
  let response;
  try {
    response = await fetcher(target, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${config.token}`, accept: 'application/json' } });
  } catch {
    throw new RelayError('LIVE_UNAVAILABLE', 'SF Tooling could not be reached.', 502);
  }
  if (response.status >= 300 && response.status < 400) throw new RelayError('LIVE_UNAVAILABLE', 'SF Tooling answered with a redirect, which is refused.', 502);
  let body;
  try { body = await response.json(); } catch { throw new RelayError('LIVE_UNAVAILABLE', `SF Tooling returned a non-JSON reply (${response.status}).`, 502); }
  if (!response.ok) {
    const code = String(body?.error?.code || `http_${response.status}`).slice(0, 80);
    throw new RelayError('LIVE_UPSTREAM_ERROR', `SF Tooling refused the request (${code}).`, response.status === 401 || response.status === 403 ? 502 : response.status);
  }
  // The gateway wraps every reply as { summary, data }. Pass both through unchanged.
  return { route, id: id || null, summary: body?.summary ?? null, data: body?.data ?? body, fetchedAt: new Date().toISOString() };
}

// Wake and delivery activity from Relay's own store. A safe subset: ids, status and timing only, never task text.
export function liveFeed(state, env, now = Date.now()) {
  const wakes = (state.wakes || []).slice(-30).reverse().map(w => ({
    id: w.id, status: w.status, attempts: w.attempts || 0, recipient: w.recipient || w.target?.agentId || null,
    reason: w.reason || null, error: w.error || null, sentAt: w.sentAt || null, slackTs: w.slackTs || null,
    acknowledgedAt: w.acknowledgedAt || null, nextAt: w.nextAt ? new Date(w.nextAt).toISOString() : null,
  }));
  const events = (state.events || []).slice(-40).reverse().map(e => ({
    id: e.id, actor: e.actor, kind: e.kind, summary: String(e.summary || '').slice(0, 240), at: e.at, wakeId: e.wakeId || null,
  }));
  const counts = wakes.reduce((acc, w) => { acc[w.status] = (acc[w.status] || 0) + 1; return acc; }, {});
  return {
    at: new Date(now).toISOString(),
    transport: env.SLACK_TRANSPORT === 'sftooling' ? 'sftooling' : 'direct',
    sfToolingConfigured: liveConfigured(env),
    slackEnabled: state.settings?.[0]?.slackEnabled === true,
    counts, wakes, events,
  };
}
