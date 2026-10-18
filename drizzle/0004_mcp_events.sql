CREATE TABLE relay_mcp_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  name TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  secret TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE relay_mcp_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  subscription_id TEXT NOT NULL,
  wake_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  next_at INTEGER NOT NULL,
  lock_until INTEGER NOT NULL,
  last_error TEXT,
  UNIQUE(subscription_id, wake_id)
);
--> statement-breakpoint
CREATE INDEX relay_mcp_deliveries_due ON relay_mcp_deliveries (status, next_at);
