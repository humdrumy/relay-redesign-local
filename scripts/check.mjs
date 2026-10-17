import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const roots=['.','backend','adapters','scripts','tests'];
let checked=0;
for(const root of roots)for(const entry of readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.mjs')){
  const file=join(root,entry.name),r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);checked++;
}
console.log(`Syntax checked ${checked} JavaScript modules.`);
