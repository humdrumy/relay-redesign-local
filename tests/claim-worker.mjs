import { openSqlite } from '../backend/sqlite-local.mjs';
import { WorkspaceStore } from '../backend/store.mjs';
process.send({ ready: true });
process.once('message', async ({ file, subject, request }) => {
  const db = openSqlite(file), store = new WorkspaceStore(db, { bindings: { 'engineer-a': 'forge', 'engineer-b': 'flux' }, now: () => 1900000000000 });
  try { const result = await store.command(subject, request); process.send({ ok: true, actor: result.viewer.actor }); }
  catch (error) { process.send({ ok: false, code: error.code, message: error.message }); }
  finally { db.close(); process.disconnect(); }
});
