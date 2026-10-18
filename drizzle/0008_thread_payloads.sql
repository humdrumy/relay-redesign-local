CREATE TABLE IF NOT EXISTS relay_thread_payloads (
 ref TEXT PRIMARY KEY, task_id TEXT NOT NULL, epoch TEXT NOT NULL, text TEXT NOT NULL
);
