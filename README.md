# Relay

Persistent project ownership, task approvals, agent activity and a network workspace with contextual chat.

Each agent is a generalist. An agent atomically claims a project and retains it through research, human plan approval, implementation, human final approval and project completion. Heartbeat loss, lease expiry and pauses never free ownership. Only the human can reassign or release a project. The application does not deploy project code.

Projects opens a network canvas for projects, features, recorded paths, and their mapped relationships. Tasks stay in Tasks and open into their own dependency view. Nodes and lines open recorded-detail dialogs. Explicit references can be attached to chat; the server resolves current authorized data. Chat collapses or resizes beside the canvas and stacks below it on smaller screens.

## Run

Node 24.11 or newer is required. Run `npm ci`, then `npm start`, and open `http://127.0.0.1:4174`. This starts a loopback-only SQLite owner harness; it is not an Internet authentication server. `npm run check` checks module syntax and `npm run test:all` builds the hosted Worker and runs the broader suite.

## Integrate

The Projects map shows active task leases as AI badges at the deepest visible location. Agents can include `filePaths: ["src/example.ts"]` in a `heartbeat` command to identify files currently being touched (up to 20 paths). Paths must match recorded files linked to the active task to receive a file badge; otherwise activity stays on the feature or project. Each heartbeat replaces the reported paths, and omitting `filePaths` clears them. Offline agents and expired task leases do not produce activity badges. The sample map includes two fictional agents in Atlas and one in Meridian, with a fourth agent online and idle in the sample sidebar.

- [API](docs/control-api.md)
- [Network and chat references](docs/network-references.md)
- [Ownership and storage](docs/control-room.md)
- [Agent setup](docs/agent-integration.md)
- [Source prompts](backend/prompts.mjs)
- [Verification](docs/control-verification.md)

Sites provides a saved gallery, desktop/mobile preview, per-site chat, and container selection for scoped edit requests. Connected project agents can complete site-edit-request/v2 jobs with a full `siteHtml` document to save a new preview revision. The human can publish or unpublish an exact revision at `/published/<site-id>/`; later edits do not change the published snapshot. Output currently supports static HTML/CSS (48 KiB), with scripts and forms disabled. The loopback server remains local; Internet access requires deploying Relay with production authentication and allowing the published routes through any upstream access gate. The Integrations screen is deliberately read-only in this local preview: it cannot configure Slack, dispatch notifications, connect providers, or handle credentials. Slack and agent adapters need server-side configuration outside this preview. Voice dictation is an interface declaration only; it never requests microphone permission, captures audio, uploads audio, or selects a transcription service. No model service or API credit is assumed. AI requests stay queued until a connected agent claims them.

Historical local-demo modules and their tests remain only for prior record compatibility and Slack-test support; they are not served as the current app. Their task workflow and role contracts are retired.
