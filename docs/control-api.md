# Relay project API v2

Network relationships and structured chat references are documented in [network-references.md](network-references.md). Their API, authorization and source prompts are included in the current build.

GET /api/control/state returns the authorized snapshot; GET /queue returns project opportunities, owned tasks, addressed messages/notifications and eligible AI requests. GET /room?room=task:ID or admin supports an after message cursor. GET /prompts returns protocol and agent prompts. GET /integrations reports connection metadata. GET /export is subject to the same read restrictions. Paths share /api/control.

POST /command accepts { epoch, operationId, expectedVersion?, expectedProjectVersion?, command }. operationId must be persisted and retried unchanged after uncertain completion. expectedVersion is mandatory for taskId commands. expectedProjectVersion is mandatory for claim_project, reassign_project, complete_project and reopen_project. Never replace a displayed approval version with a newly fetched version and approve silently.

Agent project-scoped commands include command.projectFence, captured from assignment. Leased task writes also include command.fence from claim. An expired execution lease may be reacquired by its project owner. Never refresh fences to evade a reassignment rejection. POST /dispatch drains one currently addressed notification; it does not execute work.

| Command | Fields | Authority |
| --- | --- | --- |
| create_project | name, description | Human |
| claim_project | projectId | Any agent; active, unassigned project only |
| reassign_project | projectId, target (agent ID or null), reason | Human |
| complete_project | projectId | Human; all tasks approved |
| reopen_project | projectId, reason | Human |
| create_task | input | Human or project owner |
| edit_task | taskId, input | Human or owner with execution lease during research |
| read_task | taskId | Project owner |
| claim | taskId | Project owner; intake/research/build only |
| renew, release | taskId, fence | Owner with lease; human may revoke lease |
| heartbeat | summary | Authenticated agent |
| journal | taskId, fence, summary | Owner with lease |
| save_plan | taskId, research, files:[{path,reason}], steps, acceptance, risks | Human or leased owner |
| submit_plan | taskId | Human or leased owner |
| approve_plan | taskId, scopeRevision, planRevision, note? | Human |
| request_plan_changes | taskId, reason | Human |
| save_evidence | taskId, revision, artifacts:[{path,summary}], passed, failed, commands, output, summary | Leased owner with current approved plan |
| submit_build | taskId | Leased owner; current evidence and passing tests |
| approve_final | taskId, scopeRevision, planRevision, buildRevision, note? | Human |
| request_build_changes, reopen | taskId, reason | Human |
| block | taskId, reason | Human or leased owner |
| unblock | taskId | Human |
| agent_pause | agentId, paused | Human; assignment retained |
| message | room, text, projectId?, parentId? | Human or addressed owning agent |
| ack_message | messageId | Addressed agent; projectFence when scoped |
| ack_wake | wakeId | Current recipient |
| request_ai | insight, contextTaskId?, projectId?, input? | Human |
| claim_ai | jobId | Scoped project owner or any agent for an unassigned global request |
| complete_ai | jobId, fence, output, model, proposals? | Job owner with current execution lease |
| reset_ai | jobId, reason | Human; fences previous execution |
| apply_proposal | jobId, proposalId | Human |
| configure_slack | enabled, channel, mentions:{agentId:slackUserId} | Human |
| retry_wake | wakeId | Human; current failed notification only |

Task input: title, description, projectId, type (Task/Feature/Bug/Question), component, environment, priority, dependencies (task IDs), featureId (same-project Feature or null), featureGroup, layer. Omitted groups and layers stay unclassified. Move attached tasks before moving or changing the type of their feature.

offer_handoff, accept_handoff, decline_handoff and review_build are retired. No specialist roles or role-assignment commands exist. Agents cannot approve, reassign, complete projects or change server settings. The Site MCP connection is owner read access; it is not an agent credential.

Important failures: PROJECT_OWNED, PROJECT_NOT_OWNED, PROJECT_UNAVAILABLE, STALE_PROJECT, STALE_PROJECT_FENCE, STALE_TASK, STALE_FENCE, STALE_APPROVAL, AGENT_PAUSED, LEASE_REQUIRED, PLAN_APPROVAL_REQUIRED, DEPENDENCIES_PENDING. A conflict is not an approval and does not authorize automatic reassignment.

### Project / feature / file hierarchy

`GET /api/control/network` now returns schema `relay-network-v2`, with `features` and `files` in addition to nodes and edges. The graph UI renders project → feature → file; executable tasks remain intact in Tasks and in feature/project details. Existing tasks explicitly typed `Feature` receive a derived `task-feature:<task id>` view until explicitly mapped to a standalone feature. Ordinary tasks are never silently recast as features.

The human-only `save_feature` command accepts `projectId`, optional `featureId`, `featureVersion` for an existing feature, `name`, `description`, `taskIds` (at most 200 same-project tasks), and `files:[{path,reason}]` (at most 200). The normal epoch/idempotency envelope and atomic database commit apply. Existing mappings require an exact version. Features are stored as a new `features` kind in the existing generic `relay_control_records` table; no schema change or destructive data migration is needed. This command changes planning metadata only and cannot approve, execute, or deploy task work.

File identities are stable project/path pairs, deduplicated across features. Paths come only from explicit feature mappings and the current recorded plans of linked tasks. Sources include the mapping or plan revision and rationale. A file node does not assert that the file exists, was scanned, or has accessible contents. Feature/file references resolve under the owning project's access policy; unavailable mappings resolve unavailable. Reference types now include `feature` and `file`. IDs are opaque strings up to 8,192 characters to support exact paths and structural edge identities; the existing eight-distinct-reference limit remains.

`project_feature` and `feature_file` connections describe hierarchy and recorded associations. They are not imports, runtime calls, execution gates, or deployment authorization. Task dependency edges keep their existing meaning; shared links remain descriptive.

The overview defaults to Projects + Features. Depth controls expose projects only, projects/features, or all three levels. Project and feature focus use an isolated layout with all their mapped files. Back restores the prior graph, camera, depth, selection, and conversation scope in the same session. Feature focus retains the project conversation; only explicit inline references are sent as feature/file context. Demo mode has separate drafts and fictional file fixtures; it never sends or persists workspace data.

Graph navigation retains the outgoing SVG until the incoming view is ready. A 320 ms geometry/camera transition reuses common keyed dots and edges, expands new file dots from their feature anchors, and fades only departing context. Back targets the saved positions and camera through the same path. Repeated navigation retargets the retained scene from its current geometry; resize/scroll rebases its viewport. Physics is prepared offscreen and stays paused through the transition and handoff until an interaction wakes it. Reduced-motion preference skips spatial animation without inserting a blank frame. These changes are presentation-only; no task, mapping, permission, or approval records are modified by navigation.
