-- Add durable project assignment without deleting tasks, evidence or approvals.
-- Ambiguous in-flight assignments require human recovery; never pick a specialist.
UPDATE relay_control_records AS project
SET body = json_set(body,
  '$.owner', CASE WHEN (
    SELECT count(DISTINCT json_extract(task.body, '$.owner'))
    FROM relay_control_records AS task WHERE task.kind = 'tasks'
      AND json_extract(task.body, '$.projectId') = project.id
      AND json_extract(task.body, '$.owner') IN ('dot','scout','forge','flux','lens')
  ) = 1 THEN (
    SELECT json_extract(task.body, '$.owner') FROM relay_control_records AS task
    WHERE task.kind = 'tasks' AND json_extract(task.body, '$.projectId') = project.id
      AND json_extract(task.body, '$.owner') IN ('dot','scout','forge','flux','lens') LIMIT 1
  ) ELSE NULL END,
  '$.recoveryRequired', json(CASE WHEN (
    SELECT count(DISTINCT json_extract(task.body, '$.owner'))
    FROM relay_control_records AS task WHERE task.kind = 'tasks'
      AND json_extract(task.body, '$.projectId') = project.id
      AND json_extract(task.body, '$.owner') IN ('dot','scout','forge','flux','lens')
  ) > 1 OR ((
    SELECT count(DISTINCT json_extract(task.body, '$.owner'))
    FROM relay_control_records AS task WHERE task.kind = 'tasks'
      AND json_extract(task.body, '$.projectId') = project.id
      AND json_extract(task.body, '$.owner') IN ('dot','scout','forge','flux','lens')
  ) = 0 AND EXISTS (
    SELECT 1 FROM relay_control_records AS task WHERE task.kind = 'tasks'
      AND json_extract(task.body, '$.projectId') = project.id
      AND coalesce(json_extract(task.body, '$.synthetic'), 0) = 0
      AND json_extract(task.body, '$.stage') != 'intake'
  )) THEN 'true' ELSE 'false' END),
  '$.ownershipFence', 1, '$.ownershipVersion', 1, '$.status', 'active',
  '$.version', coalesce(json_extract(body, '$.version'), 0) + 1)
WHERE kind = 'projects' AND json_extract(body, '$.ownershipVersion') IS NULL;
--> statement-breakpoint
UPDATE relay_control_records AS task
SET body = json_set(body,
  '$.legacyOwner', json_extract(body, '$.owner'),
  '$.owner', (SELECT json_extract(project.body, '$.owner') FROM relay_control_records AS project
    WHERE project.kind = 'projects' AND project.id = json_extract(task.body, '$.projectId')),
  '$.lease', NULL, '$.fence', coalesce(json_extract(body, '$.fence'),0) + 1,
  '$.version', coalesce(json_extract(body, '$.version'),0) + 1,
  '$.stage', CASE WHEN json_extract(body, '$.stage') = 'build_review' THEN 'human_review' ELSE json_extract(body, '$.stage') END)
WHERE kind = 'tasks';
--> statement-breakpoint
UPDATE relay_control_records SET body = json_remove(body, '$.role') WHERE kind = 'agents';
--> statement-breakpoint
UPDATE relay_control_records SET body = json_set(body, '$.status', 'superseded', '$.migration', 'project-ownership')
WHERE kind = 'offers' AND json_extract(body, '$.status') = 'pending';
--> statement-breakpoint
UPDATE relay_control_records SET body = json_set(body, '$.status', 'cancelled', '$.lock', NULL, '$.error', 'ownership_migration')
WHERE kind = 'wakes' AND json_extract(body, '$.status') IN ('pending','sending','failed');
--> statement-breakpoint
UPDATE relay_control_records AS job SET body = json_set(body,
  '$.context.projectId', coalesce(json_extract(body, '$.context.projectId'),
    (SELECT json_extract(task.body, '$.projectId') FROM relay_control_records AS task
      WHERE task.kind = 'tasks' AND task.id = json_extract(job.body, '$.context.taskId'))))
WHERE kind = 'jobs';
--> statement-breakpoint
UPDATE relay_control_records SET body = json_set(body, '$.owner', NULL, '$.until', NULL,
  '$.fence', coalesce(json_extract(body, '$.fence'),0) + 1, '$.status', 'queued')
WHERE kind = 'jobs' AND json_extract(body, '$.status') != 'complete';
--> statement-breakpoint
UPDATE relay_control_records AS message SET body = json_set(body,
  '$.projectId', coalesce(json_extract(body, '$.projectId'),
    (SELECT json_extract(task.body, '$.projectId') FROM relay_control_records AS task
      WHERE task.kind = 'tasks' AND 'task:' || task.id = json_extract(message.body, '$.room')),
    (SELECT json_extract(job.body, '$.context.projectId') FROM relay_control_records AS job
      WHERE job.kind = 'jobs' AND job.id = json_extract(message.body, '$.jobId'))))
WHERE kind = 'messages';
--> statement-breakpoint
UPDATE relay_control_records AS message SET body = json_set(body,
  '$.projectId', coalesce(json_extract(body, '$.projectId'),
    (SELECT json_extract(parent.body, '$.projectId') FROM relay_control_records AS parent
      WHERE parent.kind = 'messages' AND parent.id = json_extract(message.body, '$.parentId'))))
WHERE kind = 'messages';
--> statement-breakpoint
UPDATE relay_control_records SET body = json_set(body, '$.recipients', json('[]'))
WHERE kind = 'messages' AND json_extract(body, '$.actor') = 'human'
  AND json_extract(body, '$.room') NOT LIKE 'direct:%';
--> statement-breakpoint
UPDATE relay_control_records AS message SET body = json_set(body, '$.recipients',
  json_array((SELECT json_extract(project.body, '$.owner') FROM relay_control_records AS project
    WHERE project.kind = 'projects' AND project.id = json_extract(message.body, '$.projectId'))))
WHERE kind = 'messages' AND json_extract(body, '$.actor') = 'human'
  AND EXISTS (SELECT 1 FROM relay_control_records AS project WHERE project.kind = 'projects'
    AND project.id = json_extract(message.body, '$.projectId') AND json_extract(project.body, '$.owner') IS NOT NULL);
--> statement-breakpoint
INSERT INTO relay_control_records (kind, id, body)
SELECT 'events', 'ownership-migration:' || id,
  json_object('id', 'ownership-migration:' || id, 'actor', 'system', 'kind', 'ownership_migration',
    'projectId', id, 'taskId', NULL, 'at', strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    'summary', CASE WHEN json_extract(body,'$.recoveryRequired') = 1
      THEN 'Project assignment requires human recovery.' ELSE 'Project ownership migrated. Execution leases revoked.' END)
FROM relay_control_records WHERE kind = 'projects'
ON CONFLICT(kind,id) DO NOTHING;
--> statement-breakpoint
UPDATE relay_control_meta SET revision = revision + 1, epoch = lower(hex(randomblob(16))), commit_id = lower(hex(randomblob(16))) WHERE id = 'main';
