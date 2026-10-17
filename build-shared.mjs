import { buildSync, transformSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
const root = new URL('.', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const modules = ['model.mjs', 'backend/core.mjs', 'backend/site-drafts.mjs', 'backend/store.mjs', 'backend/hierarchy.mjs', 'backend/network.mjs', 'backend/control.mjs', 'backend/prompts.mjs', 'backend/slack.mjs', 'backend/control-http.mjs', 'backend/http.mjs'];
const exportNames = [['demoState', 'applyCommand', 'hasLease', 'LEASE_MS', 'validateTaskInput'], ['RelayError', 'newWorkspace', 'validateWorkspace', 'resolvePrincipal', 'execute', 'digestCommand', 'projection', 'listRooms', 'readRoom', 'readInbox', 'roleBriefing', 'SYSTEM_BRIEFING', 'enqueueWake'], ['generatedSiteArtifact', 'siteElementReferences', 'siteDocumentResponse', 'normalizeSiteArtifactPath', 'siteSampleArtifact', 'siteArtifactView', 'siteDraftView', 'invalidateSiteReview', 'makePublishProposal', 'approvePublishProposal', 'SITE_EDIT_ADAPTER_CONTRACT'], ['WorkspaceStore'], ['hierarchyInventory'], ['networkGraph', 'networkRelationships', 'normalizeReferences', 'resolveReferences'], ['ControlStore', 'CONTROL_AGENTS', 'controlPrincipal', 'controlProjection', 'canReadMessage', 'canReadJob', 'currentWake', 'messageRoom', 'messageRecipients', 'messageProjection'], ['AGENT_PROMPTS'], ['slackConfig', 'validateSlackConfig', 'drainSlack', 'postSlack'], ['handleControl', 'drainControlSlack'], ['createHandler']];
let output = '// Generated from byte-verified Relay source. Do not edit.\n';
modules.forEach((path, index) => {
  const source = read(path).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  output += `const { ${exportNames[index].join(', ')} } = (() => {\n${source}\nreturn { ${exportNames[index].join(', ')} };\n})();\n`;
});
const assets = {};
const dagBundle=buildSync({entryPoints:[fileURLToPath(new URL('task-dag-three.mjs',root))],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'eof'}).outputFiles[0].text;
assets['/task-dag-three.bundle.mjs']={body:dagBundle,type:'text/javascript; charset=utf-8'};
const motionBundle=buildSync({entryPoints:[fileURLToPath(new URL('workspace-motion.mjs',root))],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'eof'}).outputFiles[0].text;
assets['/workspace-motion.bundle.mjs']={body:motionBundle,type:'text/javascript; charset=utf-8'};
for (const [name, type] of [['index.html', 'text/html'], ['control-app.mjs', 'text/javascript'], ['adapters/voice-dictation-contract.mjs', 'text/javascript'], ['task-dag-model.mjs', 'text/javascript'], ['task-dag-view.mjs', 'text/javascript'], ['task-dag-demo.mjs', 'text/javascript'], ['network-view.mjs', 'text/javascript'], ['network-demo.mjs', 'text/javascript'], ['inline-composer.mjs', 'text/javascript'], ['network-motion.mjs', 'text/javascript'], ['network-interactions.mjs', 'text/javascript'], ['network-transition.mjs', 'text/javascript'], ['site-editor.mjs', 'text/javascript'], ['theme.css', 'text/css'], ['control.css', 'text/css'], ['ide.css', 'text/css'], ['wake.html', 'text/html'], ['wake.mjs', 'text/javascript'], ['wake.css', 'text/css'], ['slack-app-manifest.json', 'application/json']]) {
  let body = read(name === 'index.html' ? 'control.html' : name);
  if(type==='text/javascript')body=transformSync(body,{loader:'js',format:'esm',target:'es2022',sourcefile:name}).code;
  assets[`/${name}`] = { body, type: `${type}; charset=utf-8` };
}
output += `const handler = createHandler({ assets: ${JSON.stringify(assets)} });\nexport default { fetch: handler };\n`;
rmSync(new URL('dist-shared', root), { recursive: true, force: true });
mkdirSync(new URL('dist-shared/server', root), { recursive: true });
mkdirSync(new URL('dist-shared/.openai', root), { recursive: true });
writeFileSync(new URL('dist-shared/server/index.js', root), output);
cpSync(new URL('.openai/hosting.json', root), new URL('dist-shared/.openai/hosting.json', root));
cpSync(new URL('drizzle', root), new URL('dist-shared/drizzle', root), { recursive: true });
rmSync(new URL('dist', root), { recursive: true, force: true });
cpSync(new URL('dist-shared', root), new URL('dist', root), { recursive: true });
console.log(`Built Cloudflare Worker with embedded frontend (${Buffer.byteLength(output)} bytes).`);
