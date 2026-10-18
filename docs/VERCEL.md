# Relay on Vercel

Production: https://relay-redesign-local.vercel.app

The browser is served by api/index.mjs. Verified invited Neon Auth users share the human administrator role. ChatGPT MCP connections use authorization-code OAuth with S256 PKCE, explicit consent, hashed opaque tokens and refresh-token rotation. Verified Ethan maps to Scout and verified Alex maps to Dot. Legacy actor-scoped keys remain supported for explicit server adapters. Secrets belong in Vercel environment settings, never this repository or plugin packages.

Postgres stores task state, approvals, ownership, operation replay, thread receipts and worker observations. Apply migrations-postgres with npm run db:migrate:postgres using DATABASE_URL. Tests may use the same Neon project ONLY through the explicitly isolated schema adapter; the integration test asserts current_schema before creating any tables.

Every task has one root in Slack channel C0C9J2ZLCCX. Task messages, planning notes, wakes and worker observations are queued to that thread by Vercel Queues. Ambiguous sends reconcile by stable operation ID instead of blindly posting again. Retries are bounded; durable unsent source records remain available for authenticated /api/control/dispatch recovery. Queue publication failure is reported in command responses.

Dot and Scout must install Relay Vercel version 1.2.0 or later and authenticate separately using their invited Relay email accounts. ChatGPT does not provide an API-key connection field. The package is in plugins/relay-vercel. Each task gets one primary owner before planning, at most five active assignments per bot. Available agents with fresh capacity reports can receive intake assignments automatically; a responding bot can also claim an unassigned task directly without waiting for a separate report. Idle peers may optionally research and contribute notes during initial planning. No peer response or acceptance is required. The owner saves and submits the plan, retains ownership through revisions and reviews, and alone executes it. Human task reassignment in the task overview provides recovery if that owner is unavailable. Worker launch remains the bots' built-in Codex/Luna tool. Registering a run never launches one. A real runtime must deliver completion to the supervisor or call its authenticated observation tool; recorded observations then generate Slack thread notifications. Never claim unattended completion until this has been tested using the actual ChatGPT bots.

Verification completed: production login access reported by the user; private API rejects anonymous reads; live actor-specific MCP discovery and queue reads; real Neon transaction/CAS integration; local task-thread and worker authorization tests. Still pending: connection in the ChatGPT bots and a complete real Luna task with Slack completion delivery. No real Luna run has been launched by these tests.

Run targeted checks with node --test tests/agent-mcp.test.mjs tests/dispatch-queue.test.mjs tests/thread-dispatch.test.mjs tests/team-planning.test.mjs tests/task-thread-service.test.mjs tests/worker-runs.test.mjs tests/backend.test.mjs tests/control.test.mjs. The Postgres integration test requires DATABASE_URL and uses its own temporary schema. Build the Vercel deployment with npm run build:vercel.

OAuth validation: three authorization-flow tests also pass against isolated Neon schemas, covering PKCE/resource binding, code replay, refresh rotation, revocation, expiry, CSRF rejection and account mapping. Live discovery and unauthenticated challenges verified; the final ChatGPT consent callback still needs a user connection test.

## Work and Agentic modes

Relay opens in Work mode by default. The sidebar selector persists a browser-local task view and new-task default, not a global permission grant. Work tasks require manual plan approval before implementation and manual final review before readiness. Agentic tasks are explicitly enabled by a human at creation or in the task overview; the existing execution policy grants both app review checkpoints. Agents cannot enable their own autonomy. Both modes still enforce task identity, assignment, revisions, execution leases, dependencies and evidence. Neither grants production deployment or extra external credentials. Work scope may inspect production code while implementing in an approved sandbox.

Selecting a view does not change existing task policies. Returning an Agentic task to Work revokes its autonomous decisions and restores outstanding human reviews. Existing tasks without an explicit Agentic policy remain Work. Policies remain bound to the task's actual owner when an unassigned task is first claimed.

Legacy tasks waiting on both planners do not require a data migration: the first available bot claims the unassigned task and submits the existing plan alone. Completed tasks, recorded plans, notes, evidence and human approvals are retained.
