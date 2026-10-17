# Network camera, dragging and composer

This update is local only until publication is separately approved. It changes
presentation and asset delivery; it makes no database, migration, permission,
approval, membership, dependency or agent-adapter changes.

## Controls

- Wheel, trackpad scroll or trackpad pinch over the canvas zooms about the cursor.
  The scale ranges from 15% to 600%. The +/− controls zoom about the view center.
- Drag empty canvas space to pan. Arrow keys pan when the canvas has focus;
  +/− zoom and 0 fits. Enter/Space on a node or connection opens its existing popup.
- Drag a project hub to reposition its cluster. Its tasks lag on damped springs,
  overshoot slightly, then settle around the new hub position. Release momentum
  is capped. Cross-project links continue to connect their real endpoints and
  never pull another project's tasks into this project's membership.
- Drag a task to stretch its tether; release returns it to its position relative
  to its project. All visible paths and 24px hit paths use current node positions.
- Fit frames current positions. Reset restores initial layout and camera. Positions
  survive ordinary UI refreshes in the current page session, not reloads or exports.

The procedural SVG dot pattern shares the camera transform. SVG conversion handles
page offsets, both letterbox directions and resizing; it does not assume a fixed
1200px screen. Background geometry covers the currently visible SVG area.

## Stability and input lifecycle

Spring integration subdivides elapsed time into at most six steps of no more than
1/120 second and clamps elapsed time to 50ms. Velocity, drag distance and world
bounds are capped. Physics is O(nodes); path painting is O(edges). Animation uses
requestAnimationFrame, stops at rest, and changes only SVG attributes. It never
rerenders chat during animation. Hidden tabs cancel the active gesture, settle and
stop; subsequent interactions resume with a fresh frame clock, without catch-up.

A 5px screen-distance threshold separates clicks from drags. Pointer capture starts
after that threshold so taps retain native click targets. Pointer ID filtering,
cancel, lost capture, Escape and window blur release the gesture. The following
drag-generated click is suppressed; later clicks and keyboard activation work.
Listeners and observers are disposed on navigation or replacement of the canvas.

Reduced-motion preferences are observed live: dragging still works, but followers
move directly and release settles without autonomous bounce or momentum.

## Composer placement

In v7 the <=1050px layout put chat below a 72dvh/minimum-540px graph, while the
workspace itself had a 580px minimum height. The composer could be below the fold.

The network app now occupies the viewport. At widths above 900px, the chat panel
stays beside the graph, including 1024px-wide windows. Narrower panes reserve a
245–300px bottom chat area inside the workspace. Message history has a zero minimum
height and independent overflow; composer, heading and controls stay outside that
scroll region. References have bounded internal scrolling. Short-height spacing is
reduced. The visible Message label and Write message control make entry explicit;
the latter expands chat if needed and focuses the textarea. Disconnected/queued
status remains visible next to Send. Chat scrolling and typing are not intercepted
by graph listeners.

Automatic refresh does not replace active input/select/textarea elements or dirty
forms, open dialogs or a canvas gesture. DOM tests retain the exact textarea node,
draft text, selection/caret, composition event flow, focus and reference chips
while physics and refresh run. Explicit navigation uses the existing per-project
draft map. Browser-native IME behavior still needs an actual browser check.

## Verification and evidence

`npm run test:all` builds the actual Worker and tests domain/API/SQLite/D1, security,
outbox/adapter, DOM interactions and deterministic camera/spring behavior. The
actual workerd test checks that both new frontend modules are served byte-for-byte
as JavaScript. `npm run check` syntax-checks all source and test modules.

Ignored local evidence:

- `artifacts/v8-test-results.txt`: complete regression output.
- `artifacts/v8-syntax-check.txt`: syntax check output.
- `artifacts/v8-motion-contact-sheet.png`: initial, moving and settled SVG frames.
- `artifacts/v8-motion-1.svg` through `v8-motion-3.svg`: source frames.
- `artifacts/v8-local-review.html`: offline read-only UI fixture using production
  CSS/modules and clearly synthetic data. Writes are refused and no live API is used.
- `artifacts/v8-visual-evidence.json`: evidence scope and requested viewport matrix.

The supported browser inventory returned `{"apps":[],"browsers":[]}` during this
update. Full browser layout, browser pointer capture and native IME verification
were unavailable. The contact sheet was rendered with Sharp/librsvg and visually
inspected; it is **not a browser screenshot**. CSS viewport constraints were
reviewed for 1440×900, 1280×720, 1024×768, 800×600 and 390×844, but those dimensions
are not claimed as browser-verified. The offline fixture is available for that
remaining visual check.
