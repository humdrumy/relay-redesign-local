CREATE TABLE relay_worker_run_registry (
  instance_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  epoch TEXT NOT NULL,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (instance_id, workspace_id, epoch)
);
--> statement-breakpoint
