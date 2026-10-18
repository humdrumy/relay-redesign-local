CREATE TABLE relay_task_threads (
  instance_id TEXT NOT NULL,
  epoch TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (instance_id, epoch, workspace_id, task_id)
);
--> statement-breakpoint
