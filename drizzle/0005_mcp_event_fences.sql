CREATE TABLE relay_mcp_verifications (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, actor TEXT NOT NULL, generation TEXT NOT NULL);
--> statement-breakpoint
ALTER TABLE relay_mcp_subscriptions ADD COLUMN generation TEXT NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE relay_mcp_subscriptions ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE relay_mcp_deliveries ADD COLUMN claim_token TEXT;
