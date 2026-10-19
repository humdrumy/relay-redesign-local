import { buildSync, transformSync } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=new URL('.',import.meta.url),assets={};
// Build browser assets only. app.mjs is a browser demo, never a server entry.
for(const name of ['task-dag-three','workspace-motion']){
 const body=buildSync({entryPoints:[fileURLToPath(new URL(`${name}.mjs`,root))],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false}).outputFiles[0].text;
 assets[`/${name}.bundle.mjs`]={body,type:'text/javascript; charset=utf-8'};
}
const files=['control-app.mjs','task-thread-chat.mjs','adapters/voice-dictation-contract.mjs','task-dag-model.mjs','task-dag-view.mjs','task-dag-demo.mjs','network-view.mjs','network-demo.mjs','inline-composer.mjs','network-motion.mjs','network-interactions.mjs','network-transition.mjs','site-editor.mjs','theme.css','control.css','ide.css','wake.html','wake.mjs','wake.css'];
for(const name of ['control.html','login.html','login.css','login.mjs',...files]){
 let body=readFileSync(new URL(name,root),'utf8');
 const type=name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':'text/html';
 if(type==='text/javascript')body=transformSync(body,{loader:'js',format:'esm',target:'es2022'}).code;
 assets[name==='control.html'?'/index.html':`/${name}`]={body,type:`${type}; charset=utf-8`};
}
mkdirSync(new URL('generated/',root),{recursive:true});
mkdirSync(new URL('public/',root),{recursive:true});
writeFileSync(new URL('public/robots.txt',root),'User-agent: *\nDisallow: /\n');
writeFileSync(new URL('generated/assets.mjs',root),`export default ${JSON.stringify(assets)};\n`);
console.log(`Built ${Object.keys(assets).length} browser assets for Vercel.`);
