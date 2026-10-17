# Verification

npm run test:all builds the exact Worker and tests SQLite reducers/APIs, project claim races, manual gates, expiry without ownership loss, human recovery fencing, idempotent replay, notification retries, scoped reads, migration preservation, adapter serialization, DOM interactions and Cloudflare workerd/D1 batches.

Network tests cover node/edge inspection, keyboard focus, pan/zoom, chat attachment persistence, relationship editors, current server resolution and stale/deleted/unauthorized references. See network-verification.md for the 102-test release and visual verification limits.

Historical model/backend tests cover retired local-demo compatibility and the isolated Slack transport test; they do not define the current project ownership contract. Current behavior is defined by backend/control.mjs, backend/control-http.mjs and tests/control.test.mjs.

Local test logs and deployment receipts are kept in ignored artifacts/. No live agents, model calls, Slack messages or project deployments are needed for verification. Live publication checks are read-only.
