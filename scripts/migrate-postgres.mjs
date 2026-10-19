import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {openPostgres} from '../backend/postgres.mjs';
const db=openPostgres(process.env.DATABASE_URL);
await db.exec('CREATE TABLE IF NOT EXISTS relay_schema_migrations (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL)');
for(const name of readdirSync(new URL('../migrations-postgres/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()){
 const sql=readFileSync(new URL('../migrations-postgres/'+name,import.meta.url),'utf8'),hash=createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex');
 const old=await db.prepare('SELECT sha256 FROM relay_schema_migrations WHERE id=?').bind(name).first();
 if(old){if(old.sha256!==hash)throw new Error(`Changed applied migration: ${name}`);continue;}
 await db.batch([...sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s).bind()),db.prepare('INSERT INTO relay_schema_migrations(id,sha256) VALUES (?,?)').bind(name,hash)]);
 console.log('Applied '+name);
}
