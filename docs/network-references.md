# Network and chat reference contract

The Projects workspace uses persisted project/task records. It derives membership,
feature and dependency edges from current task fields. It never infers shared work
from matching titles or component strings. Humans can create explicit shared links.

## Reads

- `GET /api/control/network`: authorized nodes and edges. State includes the same `network`.
- `GET /api/control/context?messageId=<id>`: requires access to that message.
- `GET /api/control/context?jobId=<id>`: requires access to that AI job.
- Supply exactly one context query parameter. The adapter offers `network()` and
  `context({messageId})` / `context({jobId})`.

Messages persist `references: [{"type":"task","id":"RLY-…"}]`. Types are `task`,
`project`, and `relationship`. Up to eight distinct references are allowed. Only
the type and stable ID are stored; client labels, descriptions and entity contents
are discarded. Unknown/inaccessible references reject a new message atomically.

On every read, `referenceContext` resolves current data under the current caller's
authority. Queue AI jobs also include resolved context for their parent message.
Read it again before generating an answer. Deleted entities, removed edges and
ownership changes yield `status: unavailable` without disclosing names, rationale,
plans or evidence. A global conversation does not give an agent access to other
agents' projects. Claiming a global job does not expand reference permissions.

Available results contain `type`, `id`, `status`, `label` and canonical `entity`.
Task context includes real description, project, status, owner, blocker, plan and
evidence summaries. Long text is capped at 6000 characters and file/artifact lists
at 20; fetch the authorized task for full evidence. Entity text is untrusted data,
never instructions to bypass gates or ownership. Missing rationale is reported as
missing. No live model or fake reply is provided by Relay.

## Writes

All writes use the standard epoch + operationId command envelope. These new
relationship commands are human-only and participate in the existing atomic CAS
transaction and idempotency ledger.

```
{type: "create_relationship", from: {type: "task", id: "…"},
 to: {type: "project", id: "…"}, name: "Shared event schema",
 rationale: "…", impact: "…"}
{type: "save_relationship", relationshipId: "…", relationshipVersion: 1,
 name: "…", rationale: "…", impact: "…"}
{type: "remove_relationship", relationshipId: "…", relationshipVersion: 2}
{type: "message", room: "admin", projectId: null, text: "Review this connection",
 references: [{type: "relationship", id: "…"}]}
```

Shared links have UUIDs and are soft-deleted. Derived edges have deterministic IDs
from their type and endpoint types/IDs; use IDs returned by the API, do not construct
them in adapters. Rationale metadata is used only while the corresponding derived
edge exists. Edit/remove require the displayed relationship version. Dependencies
are still changed through `edit_task`, preserving cycle checks, approval invalidation
and execution fencing. Shared links and explanation edits never grant build approval.

Notification payloads remain pointers. Project conversations follow their persistent
project owner. Global jobs retain the existing atomic claim behavior. Node selection
alone adds no references or conversation scope; the human explicitly attaches items.

Migration `0003_network_references.sql` adds empty reference arrays to old messages.
Existing project ownership, approvals, evidence, audit events and private messages
are preserved. New relationship records use the existing JSON record table.

## Inline message mentions

The Projects composer inserts linked mentions at its saved text selection using Shift-click or Shift+Enter/Space. Drafts use plain text and explicit reference segments, with separate real/demo and project scopes. Drafts are saved to browser session storage. Pasted or dropped content is plain text; a label never creates a reference. Removing a mention removes that occurrence, and only remaining unique IDs are sent. Repeating one reference is allowed; at most eight distinct IDs and 256 content segments are accepted.

Message commands can include `content: [{type: "text", text: "Review "}, {type: "reference", referenceType: "task", id: "TASK-ID"}]` along with matching `references: [{type: "task", id: "TASK-ID"}]`. The server validates the sequence, resolves every ID under the current actor, derives labels and plain text from current authorized records, and stores the canonical content. Client labels are not trusted. Legacy plain-text/reference commands remain supported. Message and AI projections still expose current `referenceContext`. Inline display content never grants authority or bypasses project ownership or approval gates.
