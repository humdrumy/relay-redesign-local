# Relay on Vercel

Production: https://relay-redesign-local.vercel.app

The browser is served by api/index.mjs. Verified invited Neon Auth users share the human administrator role. Agent MCP requests use independently hashed, actor-scoped bearer credentials. Secrets belong in Vercel environment settings, never this repository or plugin packages.

Postgres stores task state, approvals, ownership, operation replay, thread receipts and worker observations. Apply migrations-postgres with npm run db:migrate:postgres using DATABASE_URL. Tests may use the same Neon project ONLY through the explicitly isolated schema adapter; the integration test asserts current_schema before creating any tables.

Every task has one root in Slack channel C0C9J2ZLCCX. Task messages, planning notes, wakes and worker observations are queued to that thread by Vercel Queues. Ambiguous sends reconcile by stable operation ID instead of blindly posting again. Retries are bounded; durable unsent source records remain available for authenticated /api/control/dispatch recovery. Queue publication failure is reported in command responses.

Dot and Scout must install Relay Vercel and authenticate separately. The package is in plugins/relay-vercel. Both plan; accepted plans assign one owner from fresh capacity reports, at most five each. Worker launch remains the bots' built-in Codex/Luna tool. Registering a run never launches one. A real runtime must deliver completion to the supervisor or call its authenticated observation tool; recorded observations then generate Slack thread notifications. Never claim unattended completion until this has been tested using the actual ChatGPT bots.

Verification completed: production login access reported by the user; private API rejects anonymous reads; live actor-specific MCP discovery and queue reads; real Neon transaction/CAS integration; local task-thread and worker authorization tests. Still pending: connection in the ChatGPT bots and a complete real Luna task with Slack completion delivery. No real Luna run has been launched by these tests.

Run targeted checks with node --test tests/agent-mcp.test.mjs tests/dispatch-queue.test.mjs tests/thread-dispatch.test.mjs tests/team-planning.test.mjs tests/task-thread-service.test.mjs tests/worker-runs.test.mjs tests/backend.test.mjs tests/control.test.mjs. The Postgres integration test requires DATABASE_URL and uses its own temporary schema. Build the Vercel deployment with npm run build:vercel.
