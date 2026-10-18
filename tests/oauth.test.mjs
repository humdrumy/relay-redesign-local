import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSqlite} from '../backend/sqlite-local.mjs';
import {openPostgres} from '../backend/postgres.mjs';
import {handleOAuth,resolveOAuthIdentity,OAUTH_CLIENT,OAUTH_REDIRECT} from '../backend/oauth.mjs';
const origin='https://relay.example',env={RELAY_PUBLIC_URL:origin,RELAY_ALLOWED_EMAILS:'ethanjamesmenezes@gmail.com,alex@lockeyourloan.com'};
const verifier='a'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
const params=()=>new URLSearchParams({client_id:OAUTH_CLIENT,redirect_uri:OAUTH_REDIRECT,response_type:'code',code_challenge_method:'S256',code_challenge:challenge,resource:origin+'/mcp',scope:'relay:agent',state:'test-state'});
async function fixture(t){
 let db;
 if(process.env.RELAY_OAUTH_TEST_POSTGRES==='1'){
  const admin=openPostgres(process.env.DATABASE_URL),schema='relay_test_'+crypto.randomUUID().replaceAll('-','');await admin.exec(`CREATE SCHEMA ${schema}`);
  t.after(()=>admin.exec(`DROP SCHEMA ${schema} CASCADE`));db=openPostgres(process.env.DATABASE_URL,{schema});
  assert.equal((await db.prepare('SELECT current_schema() AS name').bind().first()).name,schema);
 }else{
  const dir=mkdtempSync(join(tmpdir(),'relay-oauth-'));db=openSqlite(join(dir,'db.sqlite'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 }
 for(const sql of readFileSync(new URL('../migrations-postgres/003_oauth.sql',import.meta.url),'utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.exec(sql);
 let clock=1900000000000,user={subject:'relay-owner',email:'ethanjamesmenezes@gmail.com',cookies:[]};
 const options={resolveUser:async()=>user,now:()=>clock};
 const request=(path,body,headers={})=>new Request(origin+path,body?{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(body)}:{headers});
 const call=(path,body,headers)=>handleOAuth(request(path,body,headers),env,db,options);
 async function authorize(){
  const response=await call('/oauth/authorize?'+params()),html=await response.text(),cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal(response.headers.get('referrer-policy'),'same-origin','Consent POST must retain its same-origin Origin header');
  assert.ok(response.headers.get('content-security-policy').includes("form-action 'self' "+OAUTH_REDIRECT+';'));
  const request_id=html.match(/name="request_id" value="([^"]+)"/)[1],csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
  const consent=await call('/oauth/authorize',{request_id,csrf,decision:'allow'},{cookie});assert.equal(consent.status,303);
  const redirect=new URL(consent.headers.get('location'));assert.equal(redirect.searchParams.get('state'),'test-state');assert.equal(redirect.searchParams.get('iss'),origin);
  return {grant_type:'authorization_code',client_id:OAUTH_CLIENT,redirect_uri:OAUTH_REDIRECT,resource:origin+'/mcp',code_verifier:verifier,code:redirect.searchParams.get('code')};
 }
 return {db,call,authorize,options,setUser:value=>user=value,advance:ms=>clock+=ms,identity:token=>resolveOAuthIdentity(new Request(origin+'/mcp',{headers:{authorization:'Bearer '+token}}),env,db,options)};
}
test('OAuth binds consent to account, PKCE, resource and single-use codes; rotates and revokes tokens',async t=>{
 const f=await fixture(t),exchange=await f.authorize();
 assert.equal((await f.call('/oauth/token',{...exchange,code_verifier:'b'.repeat(43)})).status,400);
 assert.equal((await f.call('/oauth/token',{...exchange,resource:origin+'/other'})).status,400);
 const responses=await Promise.all([f.call('/oauth/token',exchange),f.call('/oauth/token',exchange)]);assert.deepEqual(responses.map(x=>x.status).sort(),[200,400]);
 const token=await responses.find(x=>x.status===200).json();assert.equal((await f.identity(token.access_token)).actor,'scout');
 const refresh={grant_type:'refresh_token',client_id:OAUTH_CLIENT,resource:origin+'/mcp',refresh_token:token.refresh_token};
 const rotated=await (await f.call('/oauth/token',refresh)).json();assert.ok(rotated.access_token);
 await assert.rejects(f.identity(token.access_token),e=>e.status===401);assert.equal((await f.call('/oauth/token',refresh)).status,400);
 assert.equal((await f.identity(rotated.access_token)).actor,'scout');
 await f.call('/oauth/revoke',{client_id:OAUTH_CLIENT,token:rotated.refresh_token});await assert.rejects(f.identity(rotated.access_token),e=>e.status===401);
});
test('OAuth denies invalid redirects, missing PKCE, cross-origin consent and uninvited accounts',async t=>{
 const f=await fixture(t);let q=params();q.set('redirect_uri','https://attacker.example/');assert.equal((await f.call('/oauth/authorize?'+q)).status,400);
 q=params();q.set('code_challenge_method','plain');assert.equal((await f.call('/oauth/authorize?'+q)).status,400);
 assert.equal((await f.call('/oauth/authorize',{decision:'allow'},{origin:'https://attacker.example'})).status,403);
 f.setUser({subject:'relay-owner',email:'outsider@example.com'});assert.equal((await f.call('/oauth/authorize?'+params())).status,403);
 f.setUser({subject:null,cookies:[]});const login=await f.call('/oauth/authorize?'+params());assert.equal(login.status,303);assert.ok(login.headers.get('location').startsWith('/login?next='));
});
test('Alex is bound to Dot and expired codes cannot issue tokens',async t=>{
 const f=await fixture(t);f.setUser({subject:'relay-owner',email:'alex@lockeyourloan.com',cookies:[]});
 const exchange=await f.authorize();const tokens=await (await f.call('/oauth/token',exchange)).json();assert.equal((await f.identity(tokens.access_token)).actor,'dot');
 const expired=await f.authorize();f.advance(120001);assert.equal((await f.call('/oauth/token',expired)).status,400);
 f.advance(3600000);await assert.rejects(f.identity(tokens.access_token),e=>e.status===401);
});
