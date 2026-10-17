import { buildSync, transformSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openSqlite } from './backend/sqlite-local.mjs';
import { applyMigrations } from './backend/migrations-local.mjs';
import { createHandler } from './backend/http.mjs';
import { drainSlack } from './backend/slack.mjs';
import { WorkspaceStore } from './backend/store.mjs';
import { ControlStore } from './backend/control.mjs';
import { drainControlSlack } from './backend/control-http.mjs';
import { workspaceFiles } from './workspace-files.mjs';
// This loopback development harness is NOT hosted authentication. It ignores all supplied identity headers.
const directory = resolve(process.env.RELAY_DATA_DIR || '.relay-local'); mkdirSync(directory, { recursive: true });
const db = openSqlite(resolve(directory, 'relay.sqlite'));
await applyMigrations(db);
const assets = {};
const dagBundle=buildSync({entryPoints:[fileURLToPath(new URL('task-dag-three.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'eof'}).outputFiles[0].text;
assets['/task-dag-three.bundle.mjs']={body:dagBundle,type:'text/javascript; charset=utf-8'};
const motionBundle=buildSync({entryPoints:[fileURLToPath(new URL('workspace-motion.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'eof'}).outputFiles[0].text;
assets['/workspace-motion.bundle.mjs']={body:motionBundle,type:'text/javascript; charset=utf-8'};
for (const [name, type] of [['index.html', 'text/html'], ['control-app.mjs', 'text/javascript'], ['adapters/voice-dictation-contract.mjs', 'text/javascript'], ['task-dag-model.mjs', 'text/javascript'], ['task-dag-view.mjs', 'text/javascript'], ['task-dag-demo.mjs', 'text/javascript'], ['network-view.mjs', 'text/javascript'], ['network-demo.mjs', 'text/javascript'], ['inline-composer.mjs', 'text/javascript'], ['network-motion.mjs', 'text/javascript'], ['network-interactions.mjs', 'text/javascript'], ['network-transition.mjs', 'text/javascript'], ['site-editor.mjs', 'text/javascript'], ['theme.css', 'text/css'], ['control.css', 'text/css'], ['ide.css', 'text/css'], ['wake.html', 'text/html'], ['wake.mjs', 'text/javascript'], ['wake.css', 'text/css'], ['slack-app-manifest.json', 'application/json']]) {
  let body = readFileSync(name === 'index.html' ? 'control.html' : name, 'utf8');
  if(type==='text/javascript')body=transformSync(body,{loader:'js',format:'esm',target:'es2022',sourcefile:name}).code;
  assets[`/${name}`] = { body, type: `${type}; charset=utf-8` };
}
const handle = createHandler({ assets, authenticate: () => 'local-development-owner' });
const workspaceRoot = fileURLToPath(new URL('.', import.meta.url));
const env = { ...process.env, DB: db };
const pending = new Set();
const context = { waitUntil(promise) { pending.add(promise); promise.finally(() => pending.delete(promise)); } };
const timer = setInterval(() => context.waitUntil((async () => {
  const control = new ControlStore(db);
  if (await control.exists()) await drainControlSlack(control, env);
  else await drainSlack(new WorkspaceStore(db), env);
})().catch(() => {})), 2000);
const server = createServer(async (incoming, outgoing) => {
  const url = `http://127.0.0.1:${server.address().port}${incoming.url}`;
  try {
    if (incoming.method === 'GET' && incoming.url?.split('?')[0] === '/api/local/workspace-files') {
      outgoing.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      outgoing.end(JSON.stringify(workspaceFiles(workspaceRoot)));
      return;
    }
    const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body: incoming, duplex: 'half' }) });
    const response = await handle(request, env, context); outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Local request failed.'); }
});
server.listen(Number(process.env.PORT || 4174), '127.0.0.1', () => console.log(`Relay shared local test server http://127.0.0.1:${server.address().port}; task execution disabled; loopback owner only.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); server.close(async () => { await Promise.allSettled([...pending]); db.close(); process.exit(0); }); });
