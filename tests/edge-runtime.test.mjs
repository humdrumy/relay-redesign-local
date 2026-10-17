import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run with MINIFLARE_MODULE pointing at an installed Miniflare entry point,
// or install Miniflare separately. No real Slack token or network call is used.
const runtime = await import(process.env.MINIFLARE_MODULE ? pathToFileURL(process.env.MINIFLARE_MODULE).href : 'miniflare');
test('the real Workers runtime accepts the Slack request and refuses redirects', async () => {
  const root = new URL('../', import.meta.url);
  const script = `import { postSlack } from './backend/slack.mjs';
    export default { async fetch() {
      const config = {token:'xoxb-test-only',channel:'CTEST',url:'https://relay.example',mentions:{}};
      const job = {id:crypto.randomUUID(),recipient:'dot'};
      let constructed = false;
      const success = await postSlack(job, config, async (url, options) => {
        const request = new Request(url, options); // Runtime-specific option validation, unlike a fetch stub.
        constructed = request.redirect === 'manual';
        return Response.json({ok:true,ts:'123.456',channel:'CTEST'});
      });
      const redirect = await postSlack(job, config, async (url, options) => {
        new Request(url, options);
        return new Response('', {status:302,headers:{location:'https://untrusted.example'}});
      });
      return Response.json({constructed,success,redirect});
    }};`;
  const options = { compatibilityDate:'2026-08-06', modulesRoot: fileURLToPath(root),
    modules:[{type:'ESModule',path:fileURLToPath(new URL('edge-probe.mjs',root)),contents:script},
      ...['backend/slack.mjs','backend/core.mjs','model.mjs'].map(name=>({type:'ESModule',path:fileURLToPath(new URL(name,root)),contents:readFileSync(new URL(name,root),'utf8')}))] };
  const mf = new runtime.Miniflare(runtime.convertV4MiniflareOptions ? runtime.convertV4MiniflareOptions(options) : options);
  try {
    const result = await (await mf.dispatchFetch('https://probe.test')).json();
    assert.equal(result.constructed,true);assert.equal(result.success.ok,true);
    assert.deepEqual(result.redirect,{ok:false,retryable:false,error:'slack_unexpected_redirect'});
  } finally { await mf.dispose(); }
});
