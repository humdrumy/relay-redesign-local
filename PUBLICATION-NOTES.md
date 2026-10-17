# Publication preparation note

This is an independent sanitized snapshot of the local Relay redesign. The original repository and its Git history are not included.

The source checkout had no LICENSE file or package license field. No license was added during this preparation. Public visibility alone does not grant others permission to reuse this code; select a license separately if that is intended.

Workspace-specific Slack defaults and deployment identifiers were replaced with placeholders. The token-shaped Slack test sentinel was shortened to a synthetic fixture value, not a credential. Runtime databases, caches, preview logs, build output, dependencies, local handoff notes, and capture scripts were excluded. Existing Slack wake behavior and server-authenticated API source were kept unchanged.

## Validation status

- npm run check passed; 55 JavaScript modules were syntax-checked.
- node --test tests/wake.test.mjs passed all 13 tests after the synthetic fixture sanitization.
- npm run test:all did not complete: the initial Worker build failed because esbuild was denied access to ../../../../.. while resolving task-dag-three.mjs in the sandbox.
- Running the test file list directly produced 100 passes and 18 failures. The failures included two built-Worker tests without generated output, multiple graph/UI VM cases, and a UI DOM case where URLSearchParams was unavailable. Those failures remain unresolved.
