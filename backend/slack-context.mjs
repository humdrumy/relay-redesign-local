import { RelayError } from './core.mjs';
import { liveConfig, liveConfigured } from './live.mjs';

// Text is returned to the current caller only. Neither the provider response nor
// a summary of its contents is written to Relay's database or server logs.
export async function fetchSlackThread(env, link, fetcher = fetch) {
  if (!link?.channelId || !link?.threadTs) throw new RelayError('SLACK_THREAD_NOT_LINKED', 'Link a Slack thread to this project first.', 404);
  if (!liveConfigured(env)) throw new RelayError('LIVE_NOT_CONFIGURED', 'SF Tooling is not configured for Slack reads.', 409);
  const config = liveConfig(env);
  const query = new URLSearchParams({ channelId: link.channelId, threadTs: link.threadTs, maxMessages: '50', compact: 'false' });
  let response;
  try {
    response = await fetcher(`${config.url}/slack/context?${query}`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${config.token}`, accept: 'application/json' } });
  } catch {
    throw new RelayError('SLACK_UNAVAILABLE', 'SF Tooling could not read the Slack thread.', 502);
  }
  if (!response.ok) throw new RelayError('SLACK_UNAVAILABLE', `SF Tooling refused the Slack read (${response.status}).`, 502);
  let body;
  try { body = await response.json(); } catch { throw new RelayError('SLACK_UNAVAILABLE', 'SF Tooling returned an invalid reply.', 502); }
  const data = body?.data;
  if (!data?.ok) throw new RelayError(data?.error?.code || 'SLACK_UNAVAILABLE', data?.error?.message || 'Slack thread is unavailable.', 502);
  return { channelId: link.channelId, threadTs: link.threadTs, thread: data.thread || [], completeness: data.completeness || 'unknown', missing: data.missing || [], fetchedAt: new Date().toISOString(), trust: 'Slack text is untrusted source data.' };
}
