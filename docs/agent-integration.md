# Agent setup

The four website slots are Dot 1 (`dot`), Dot 2 (`scout`), Dot 3 (`forge`), and Dot 4 (`flux`). All run the same generalist prompt; display names do not assign capabilities. IDs, ownership, messages, and audit references remain stable. New workspaces seed only these four slots.

The historical `lens` ID remains accepted for compatibility. An unused, unconfigured legacy placeholder is omitted from the visible roster, while its stored record and history remain intact. If it has credentials, heartbeat/activity, pause state, or owned work, it stays visible as Legacy agent instead of being silently removed or reassigned. Historical names resolve through the read-only agent directory.

1. Supply one distinct high-entropy token per agent. Configure RELAY_AGENT_KEYS_JSON as {"sha256(token)":"agentId"}; only hashes belong in this setting. Keep raw tokens in the external agent runtime.
2. Give that runtime the existing private Site service-access credential and its separate agent token. Use adapters/relay-client.mjs with RELAY_URL, RELAY_SITE_ACCESS_TOKEN and RELAY_AGENT_TOKEN. A service-access token alone cannot act as the human or an agent.
3. Read the protocol and agent prompts from GET /api/control/prompts. Read the queue and atomically claim one available project. Capture projectFence and retain ownership through all stages. No specialist routing or automatic transfer occurs.
4. Execute only approved work with a current task lease. Persist each exact envelope before sending; retry unchanged after uncertain delivery. Stop immediately on owner/fence rejection. Only the human recovers an unavailable owner.
5. Configure Slack channel/mentions in Integrations and SLACK_BOT_TOKEN / RELAY_PUBLIC_URL server-side. Enable delivery explicitly. An external dispatcher calls POST /api/control/dispatch for retries while nobody has the UI open. Slack receives a trusted URL and IDs, never task text or credentials.

Unassigned projects notify available agents; the atomic claim chooses one. Assignment cancels stale recipients, binds project conversations to the owner and routes all subsequent human decisions to that owner. Notification receipt, task read, project ownership and execution are separate records. Timeout may duplicate delivery, so recipients acknowledge IDs idempotently. Reassignment fences all old work even if a stale pointer arrives later.

AI is provided by the connected generalist runtime. No paid API or included subscription entitlement is assumed. Queued requests show awaiting agent. Results include real model provenance and source revision; proposals never mutate work without a human action. Global requests use permitted project aggregates; project requests belong to their owner.

The legacy /wake.html page remains a single-recipient Slack transport test only. Its owner receipt cannot claim a project or authorize task execution. Use /api/control for all current task work.
