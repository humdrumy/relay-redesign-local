import { RelayError, newWorkspace, validateWorkspace, resolvePrincipal, execute, digestCommand, projection } from './core.mjs';
export class WorkspaceStore {
  constructor(database, { bindings = {}, now = () => Date.now() } = {}) { this.db = database; this.bindings = bindings; this.now = now; }
  async read() {
    const row = await this.db.prepare('SELECT owner_id, version, body FROM relay_workspaces WHERE id = ?').bind('main').first();
    if (!row) throw new RelayError('SETUP_REQUIRED', 'Open Relay in your browser to initialize the private workspace.', 409);
    const document = validateWorkspace(JSON.parse(row.body));
    if (row.owner_id !== document.ownerId || row.version !== document.revision) throw new RelayError('INVALID_DATABASE_STATE', 'Stored workspace metadata does not match its document.', 503);
    return document;
  }
  async bootstrap(subject) {
    if (!subject) throw new RelayError('UNAUTHENTICATED', 'Sign in to this private Site.', 401);
    const document = newWorkspace(subject, this.now());
    await this.db.prepare('INSERT INTO relay_workspaces (id, owner_id, version, body, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind('main', subject, document.revision, JSON.stringify(document), this.now()).run();
    return this.view(subject);
  }
  principal(document, subject, mcp = false) { return resolvePrincipal(document, subject, { mcp, bindings: this.bindings }); }
  async mutate(change) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await this.read(), next = structuredClone(before);
      const result = change(next);
      if (result === null) return null;
      next.revision++;
      if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 1024 * 1024) throw new RelayError('WORKSPACE_CAPACITY', 'Workspace capacity reached. Export before continuing.', 507);
      const saved = await this.db.prepare('UPDATE relay_workspaces SET version = ?, body = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?')
        .bind(next.revision, JSON.stringify(next), this.now(), 'main', before.ownerId, before.revision).run();
      if (Number(saved.meta?.changes) === 1) return result;
    }
    throw new RelayError('BUSY', 'Concurrent updates are busy. Retry the same operation.', 409);
  }
  async view(subject, mcp = false) { const document = await this.read(); return projection(document, this.principal(document, subject, mcp)); }
  async command(subject, request, mcp = false) {
    if (!request || !request.command || Object.keys(request).some(key => !['command', 'operationId', 'expectedVersion', 'epoch'].includes(key))) throw new RelayError('INVALID_REQUEST', 'Use the typed command envelope; identity is server-owned.', 400);
    const hash = await digestCommand(request);
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await this.read(), principal = this.principal(before, subject, mcp);
      const outcome = execute(before, principal, request.command, { ...request, hash, now: this.now() });
      if (outcome.result.replayed) return { ...projection(before, principal), result: outcome.result };
      const result = await this.db.prepare('UPDATE relay_workspaces SET version = ?, body = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?')
        .bind(outcome.document.revision, JSON.stringify(outcome.document), this.now(), 'main', before.ownerId, before.revision).run();
      if (Number(result.meta?.changes) === 1) return { ...projection(outcome.document, principal), result: outcome.result };
    }
    throw new RelayError('BUSY', 'Concurrent updates are busy. Refresh and retry with the same operation key.', 409);
  }
}
