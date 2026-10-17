-- Add reference envelopes to prior messages without altering text, routing,
-- ownership, approvals, or evidence. Relationship records use the existing
-- transactional entity store; no external graph service is required.
UPDATE relay_control_records
SET body = json_set(body, '$.references', json('[]'))
WHERE kind = 'messages' AND json_type(body, '$.references') IS NULL;
