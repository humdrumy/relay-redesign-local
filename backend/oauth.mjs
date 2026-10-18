import {createHash,randomBytes} from 'node:crypto';
import {resolveWebUser,allowedEmails} from './vercel-auth.mjs';

export const OAUTH_CLIENT='relay-chatgpt';
export const OAUTH_REDIRECT='https://chatgpt.com/connector_platform_oauth_redirect';
const scope='relay:agent',opaque=()=>randomBytes(32).toString('base64url');
export const oauthHash=value=>createHash('sha256').update(value).digest('hex');
const pkce=value=>createHash('sha256').update(value).digest('base64url');
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','pragma':'no-cache'}});
const error=(code,status=400)=>{throw Object.assign(new Error(code),{oauthCode:code,status});};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function oauthOrigin(env){return new URL(env.RELAY_PUBLIC_URL).origin;}
export function oauthActor(email,env){
 const normalized=String(email||'').toLowerCase();
 if(!allowedEmails(env).has(normalized))return null;
 return {'ethanjamesmenezes@gmail.com':'scout','alex@lockeyourloan.com':'dot'}[normalized]||null;
}
export function oauthChallenge(env){return `Bearer resource_metadata="${oauthOrigin(env)}/.well-known/oauth-protected-resource", scope="${scope}"`;}
async function readBody(request){
 const reader=request.body?.getReader();let size=0;const chunks=[];
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();error('invalid_request',413);}chunks.push(value);}
 const body=new TextDecoder().decode(Buffer.concat(chunks));
 if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))error('invalid_request',415);
 const params=new URLSearchParams(body);for(const key of params.keys())if(params.getAll(key).length!==1)error('invalid_request');
 return Object.fromEntries(params);
}
function authorization(query,env){
 for(const key of query.keys())if(query.getAll(key).length!==1)error('invalid_request');
 const p=Object.fromEntries(query),resource=oauthOrigin(env)+'/mcp';
 if(p.client_id!==OAUTH_CLIENT)error('invalid_client');
 if(p.redirect_uri!==OAUTH_REDIRECT)error('invalid_redirect_uri');
 if(p.response_type!=='code'||p.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge||''))error('invalid_request');
 if(p.resource!==resource)error('invalid_target');
 if(p.scope!==scope)error('invalid_scope');
 if(typeof p.state!=='string'||!p.state||p.state.length>2048)error('invalid_request');
 return {clientId:p.client_id,redirectUri:p.redirect_uri,challenge:p.code_challenge,resource,scope,state:p.state};
}
function withCookies(response,cookies=[]){for(const value of cookies)response.headers.append('set-cookie',value);return response;}
export async function resolveOAuthIdentity(request,env,db,{now=Date.now}={}){
 const raw=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!raw?.startsWith('rlyoauth_'))return null;
 if(raw.length>256)error('invalid_token',401);
 const row=await db.prepare('SELECT body FROM relay_oauth_tokens WHERE access_hash=? AND access_expires_at>? AND expires_at>?').bind(oauthHash(raw),now(),now()).first();
 if(!row)error('invalid_token',401);
 const grant=JSON.parse(row.body);
 if(grant.issuer!==oauthOrigin(env)||grant.resource!==oauthOrigin(env)+'/mcp'||grant.scope!==scope||oauthActor(grant.email,env)!==grant.actor)error('invalid_token',401);
 return {kind:'agent',actor:grant.actor,subject:'oauth:'+grant.actor};
}
export async function handleOAuth(request,env,db,{resolveUser=resolveWebUser,now=Date.now}={}){
 const url=new URL(request.url),origin=oauthOrigin(env),resource=origin+'/mcp';
 try{
  if(request.method==='GET'&&['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(url.pathname))return json({resource,authorization_servers:[origin],scopes_supported:[scope],bearer_methods_supported:['header']});
  if(request.method==='GET'&&url.pathname==='/.well-known/oauth-authorization-server')return json({issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',revocation_endpoint:origin+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:[scope],authorization_response_iss_parameter_supported:true});
  if(url.pathname==='/oauth/authorize'&&request.method==='GET'){
   const params=authorization(url.searchParams,env),user=await resolveUser(request,env);
   if(!user.subject)return withCookies(new Response(null,{status:303,headers:{location:'/login?next='+encodeURIComponent(url.pathname+url.search),'cache-control':'no-store'}}),user.cookies);
   const actor=oauthActor(user.email,env);if(!actor)error('access_denied',403);
   const id=opaque(),csrf=opaque();
   await db.prepare('INSERT INTO relay_oauth_requests(id,body,expires_at) VALUES(?,?,?)').bind(id,JSON.stringify({...params,email:user.email.toLowerCase(),actor,csrfHash:oauthHash(csrf)}),now()+600000).run();
   const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Relay</title><link rel="stylesheet" href="/login.css"></head><body><main><h1>Connect ChatGPT to Relay</h1><p>Signed in as ${escape(user.email)}.</p><p>Allow this connection to act as <strong>${escape(actor)}</strong>: read tasks, collaborate on plans, update assigned work, and post in task Slack threads. It cannot grant human approvals.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="${id}"><input type="hidden" name="csrf" value="${csrf}"><button name="decision" value="allow">Connect as ${escape(actor)}</button><button name="decision" value="deny">Cancel</button></form></main></body></html>`;
   return withCookies(new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'set-cookie':`relay_oauth_csrf=${csrf}; Path=/oauth/authorize; HttpOnly; Secure; SameSite=Lax; Max-Age=600`}}),user.cookies);
  }
  if(url.pathname==='/oauth/authorize'&&request.method==='POST'){
   if(request.headers.get('origin')!==origin)error('access_denied',403);
   const body=await readBody(request),cookie=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('relay_oauth_csrf='))?.slice('relay_oauth_csrf='.length);
   if(!/^[A-Za-z0-9_-]{43}$/.test(body.request_id||'')||!body.csrf||body.csrf!==cookie||!['allow','deny'].includes(body.decision))error('access_denied',403);
   const row=await db.prepare('SELECT body FROM relay_oauth_requests WHERE id=? AND expires_at>?').bind(body.request_id,now()).first();if(!row)error('invalid_request');
   const pending=JSON.parse(row.body),user=await resolveUser(request,env);
   if(!user.subject||user.email?.toLowerCase()!==pending.email||oauthActor(user.email,env)!==pending.actor||oauthHash(body.csrf)!==pending.csrfHash)error('access_denied',403);
   const removed=await db.prepare('DELETE FROM relay_oauth_requests WHERE id=? AND expires_at>? RETURNING id').bind(body.request_id,now()).first();if(!removed)error('invalid_request');
   const redirect=new URL(pending.redirectUri);redirect.searchParams.set('state',pending.state);redirect.searchParams.set('iss',origin);
   if(body.decision==='deny')redirect.searchParams.set('error','access_denied');
   else{const code=opaque();await db.prepare('INSERT INTO relay_oauth_codes(hash,body,expires_at) VALUES(?,?,?)').bind(oauthHash(code),JSON.stringify(pending),now()+120000).run();redirect.searchParams.set('code',code);}
   return withCookies(new Response(null,{status:303,headers:{location:redirect.toString(),'cache-control':'no-store','referrer-policy':'no-referrer','set-cookie':'relay_oauth_csrf=; Path=/oauth/authorize; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}}),user.cookies);
  }
  if(url.pathname==='/oauth/token'&&request.method==='POST'){
   const body=await readBody(request);if(body.client_id!==OAUTH_CLIENT)error('invalid_client');if(body.resource!==resource)error('invalid_target');
   const access='rlyoauth_'+opaque(),refresh='rlyrefresh_'+opaque();let grant;
   if(body.grant_type==='authorization_code'){
    if(body.redirect_uri!==OAUTH_REDIRECT||!/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier||'')||!/^[A-Za-z0-9_-]{43}$/.test(body.code||''))error('invalid_grant');
    const row=await db.prepare('SELECT body FROM relay_oauth_codes WHERE hash=? AND expires_at>?').bind(oauthHash(body.code),now()).first();if(!row)error('invalid_grant');
    grant=JSON.parse(row.body);
    if(grant.challenge!==pkce(body.code_verifier)||grant.clientId!==body.client_id||grant.resource!==body.resource||grant.redirectUri!==body.redirect_uri||oauthActor(grant.email,env)!==grant.actor)error('invalid_grant');
    const removed=await db.prepare('DELETE FROM relay_oauth_codes WHERE hash=? AND expires_at>? RETURNING hash').bind(oauthHash(body.code),now()).first();if(!removed)error('invalid_grant');
    grant={issuer:origin,resource,scope,clientId:OAUTH_CLIENT,email:grant.email,actor:grant.actor};
    await db.prepare('INSERT INTO relay_oauth_tokens(access_hash,refresh_hash,body,access_expires_at,expires_at) VALUES(?,?,?,?,?)').bind(oauthHash(access),oauthHash(refresh),JSON.stringify(grant),now()+3600000,now()+604800000).run();
   }else if(body.grant_type==='refresh_token'){
    if(!/^rlyrefresh_[A-Za-z0-9_-]{43}$/.test(body.refresh_token||''))error('invalid_grant');
    const row=await db.prepare('SELECT body FROM relay_oauth_tokens WHERE refresh_hash=? AND expires_at>?').bind(oauthHash(body.refresh_token),now()).first();if(!row)error('invalid_grant');grant=JSON.parse(row.body);
    if(grant.clientId!==body.client_id||grant.resource!==resource||grant.issuer!==origin||oauthActor(grant.email,env)!==grant.actor)error('invalid_grant');
    const rotated=await db.prepare('UPDATE relay_oauth_tokens SET access_hash=?,refresh_hash=?,access_expires_at=? WHERE refresh_hash=? AND expires_at>? RETURNING body').bind(oauthHash(access),oauthHash(refresh),now()+3600000,oauthHash(body.refresh_token),now()).first();if(!rotated)error('invalid_grant');
   }else error('unsupported_grant_type');
   return json({access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope});
  }
  if(url.pathname==='/oauth/revoke'&&request.method==='POST'){
   const body=await readBody(request);if(body.client_id!==OAUTH_CLIENT)error('invalid_client');
   const hash=oauthHash(String(body.token||''));await db.prepare('DELETE FROM relay_oauth_tokens WHERE access_hash=? OR refresh_hash=?').bind(hash,hash).run();return json({});
  }
  return json({error:'invalid_request'},404);
 }catch(e){if(e.oauthCode)return json({error:e.oauthCode},e.status);throw e;}
}
