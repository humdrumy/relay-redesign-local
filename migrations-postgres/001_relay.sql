CREATE TABLE IF NOT EXISTS relay_workspaces (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, version BIGINT NOT NULL,
 body TEXT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS relay_control_meta (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, epoch TEXT NOT NULL,
 revision BIGINT NOT NULL, commit_id TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS relay_control_records (
 kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
 ordinal BIGSERIAL UNIQUE, PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS relay_control_kind ON relay_control_records(kind);
CREATE TABLE IF NOT EXISTS relay_task_threads (
 instance_id TEXT NOT NULL, epoch TEXT NOT NULL, workspace_id TEXT NOT NULL,
 task_id TEXT NOT NULL, revision BIGINT NOT NULL, body TEXT NOT NULL,
 PRIMARY KEY(instance_id,epoch,workspace_id,task_id)
);
CREATE TABLE IF NOT EXISTS relay_worker_run_registry (
 instance_id TEXT NOT NULL, workspace_id TEXT NOT NULL, epoch TEXT NOT NULL,
 revision BIGINT NOT NULL, body TEXT NOT NULL,
 PRIMARY KEY(instance_id,workspace_id,epoch)
);
CREATE TABLE IF NOT EXISTS relay_mcp_subscriptions (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, actor TEXT NOT NULL,
 name TEXT NOT NULL, callback_url TEXT NOT NULL, secret TEXT NOT NULL,
 expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL,
 generation TEXT NOT NULL DEFAULT 'legacy', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS relay_mcp_deliveries (
 id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, wake_id TEXT NOT NULL,
 event_id TEXT NOT NULL, occurred_at TEXT NOT NULL, status TEXT NOT NULL,
 attempts INTEGER NOT NULL, next_at BIGINT NOT NULL, lock_until BIGINT NOT NULL,
 last_error TEXT, claim_token TEXT, UNIQUE(subscription_id,wake_id)
);
CREATE INDEX IF NOT EXISTS relay_mcp_deliveries_due ON relay_mcp_deliveries(status,next_at);
CREATE TABLE IF NOT EXISTS relay_mcp_verifications (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, actor TEXT NOT NULL, generation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relay_schema_migrations (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL);
