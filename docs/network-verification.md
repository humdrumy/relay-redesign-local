# Network workspace verification

The network and contextual chat use production API projections, not the separate
design-study dataset. The six comparison views are removed. Existing task stages,
human approval gates, persistent generalist ownership, private rooms, outbox routing
and authentication remain in place.

`npm run test:all` builds the exact Worker and runs 117 tests, including SQLite and
real workerd/D1. New coverage includes node/edge clicks, 24px edge hit paths, keyboard
inspection, popup close/reopen/Escape/backdrop, preserved zoom/pan, focus restoration
and removed-opener fallback, collapsed/resized chat, multiple explicit references,
removal, persistence, canonical server resolution, forged client labels, stale and
deleted references, cross-project access, relationship edit races, explanation
versions, duplicate prevention, XSS escaping and disconnected queued conversations.

Access regressions check state, export, queue, network, context and command responses.
Raw relationship records are filtered by the same endpoint permissions as graph
edges. A readable global conversation/job never expands access to its references.

No enabled browser surface exists in this environment: the supported browser
inventory returned `{"apps":[],"browsers":[]}`. Full browser layout and screenshot
verification is therefore unavailable. Linkedom tests exercise DOM behavior; they
are not browser tests. The shipped SVG renderer was rasterized with Sharp/librsvg
using clearly labeled local QA fixtures and visually inspected for labels, edges
and state marks. This is a canvas render, not a full-page browser screenshot.

Local evidence is in ignored `artifacts/v7-test-results.txt`,
`artifacts/v7-syntax-check.txt` and `artifacts/v7-network-fixture.png`.

The local camera/spring/composer update and its verification scope are described in
[network-motion.md](network-motion.md). Publication of that update requires separate approval.
