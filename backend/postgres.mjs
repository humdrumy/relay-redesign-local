import { neon } from '@neondatabase/serverless';

// The domain layer uses a small prepared-statement interface. Preserve its
// transaction and compare-and-swap semantics while moving storage to Postgres.
export function postgresSql(source){
 let sql=source.replace(/ORDER BY rowid\b/g,'ORDER BY ordinal');
 sql=sql.replace(/json_extract\((\w+(?:\.\w+)?),\s*'\$\.([\w.]+)'\)/g,(_,column,key)=>{
  const value=`(${column}::jsonb #>> '{${key.split('.').join(',')}}')`;
  if(['paused','recoveryRequired','synthetic'].includes(key))return `(CASE ${value} WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE NULL END)`;
  if(['ownershipFence','version','executionFence','team.fence'].includes(key))return `(${value}::bigint)`;
  return value;
 });
 let out='',index=0,quoted=false;
 for(let i=0;i<sql.length;i++){
  const ch=sql[i];
  if(ch==="'"){out+=ch;if(quoted&&sql[i+1]==="'"){out+=sql[++i];continue;}quoted=!quoted;continue;}
  out+=ch==='?'&&!quoted?`$${++index}`:ch;
 }
 return out.replace(/\bIS\s+(\$\d+)/g,'IS NOT DISTINCT FROM $1');
}
const numeric=new Set(['revision','version','created_at','updated_at','expires_at','next_at','lock_until','attempts','ordinal','active']);
function row(value){return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,numeric.has(key)&&typeof v==='string'&&/^-?\d+$/.test(v)&&Number.isSafeInteger(Number(v))?Number(v):v]));}
function result(value){return {results:value.rows.map(row),meta:{changes:['SELECT','SHOW'].includes(value.command)?0:value.rowCount},success:true};}
export function openPostgres(url,{schema}={}){
 if(!url)throw new Error('DATABASE_URL is required');
 if(schema&&!/^relay_test_[a-f0-9]{32}$/.test(schema))throw new Error('Invalid isolated test schema');
 const client=neon(url,{fullResults:true});
 // Neon HTTP does not apply URL search_path options. Set it within each
 // transaction so pooled connections can never escape a test's schema.
 const prefix=schema?[client.query(`SET LOCAL search_path TO ${schema}`,[])]:[];
 const query=async(sql,values=[])=>schema?(await client.transaction([...prefix,client.query(sql,values)]))[1]:client.query(sql,values);
 return {
  async exec(sql){return query(sql,[]);},
  async batch(statements){
   // A serialization failure rolls back the entire batch. Retrying its same
   // compare-and-swap predicates is safe and lets the domain detect stale state.
   for(let attempt=0;;attempt++)try{
    const values=await client.transaction([...prefix,...statements.map(s=>client.query(s.sql,s.values))],{isolationLevel:'Serializable'});return values.slice(prefix.length).map(result);
   }catch(error){if(!['40001','40P01'].includes(error.code)||attempt>=5)throw error;await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)));}
  },
  prepare(source){const sql=postgresSql(source);return {bind(...values){const statement={sql,values};return {...statement,
   async first(){return (await query(sql,values)).rows.map(row)[0]??null;},
   async all(){return result(await query(sql,values));},
   async run(){return result(await query(sql,values));}
  };}};},
  close(){}
 };
}
