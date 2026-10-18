import { waitUntil } from '@vercel/functions';
import assets from '../generated/assets.mjs';
import { createHandler } from '../backend/http.mjs';
import { openPostgres } from '../backend/postgres.mjs';
import { resolveWebUser, handleWebAuth } from '../backend/vercel-auth.mjs';
import { readiness } from '../backend/readiness.mjs';
import { agentMcp } from '../backend/agent-mcp.mjs';
import {threadTransport} from '../backend/thread-dispatch.mjs';
import {scheduleTaskDispatch} from '../backend/dispatch-queue.mjs';

let database;
export async function fetch(request) {
  const env={...process.env,RELAY_HOSTING:'vercel'},url=new URL(request.url);
  try {
    if(url.pathname==='/api/internal/readiness')return await readiness(request,env,database??=openPostgres(env.DATABASE_URL));
    const dispatch=async()=>scheduleTaskDispatch(env);
    if(url.pathname==='/mcp')return await agentMcp(request,{env,db:database??=openPostgres(env.DATABASE_URL),onCommandCommitted:dispatch,taskThreadTransportFactory:()=>threadTransport(env,database)});
    if(url.pathname.startsWith('/api/auth/'))return await handleWebAuth(request,env);
    if(['/login','/login.mjs','/login.css'].includes(url.pathname)){
      const asset=assets[url.pathname==='/login'?'/login.html':url.pathname];
      return new Response(asset.body,{headers:{'content-type':asset.type,'cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'"}});
    }
    const machine=request.headers.has('authorization')&&(url.pathname.startsWith('/api/control/')||url.pathname==='/api/worker-runs');
    const user=machine?{subject:null,cookies:[]}:await resolveWebUser(request,env);
    if(!machine&&!user.subject){
      if(url.pathname.startsWith('/api/')||url.pathname==='/mcp')return Response.json({error:'UNAUTHENTICATED',message:'Sign in to Relay.'},{status:401});
      return Response.redirect(new URL('/login',url),303);
    }
    database??=openPostgres(env.DATABASE_URL);
    const handler=createHandler({assets,authenticate:()=>user.subject,storeOptions:{teamPlanning:env.RELAY_TEAM_PLANNING_ENABLED==='true'},taskThreadTransportFactory:()=>threadTransport(env,database),onCommandCommitted:dispatch});
    const result=await handler(request,{...env,DB:database},{waitUntil});
    const response=new Response(result.body,result);
    response.headers.set('cache-control','private, no-store');
    for(const cookie of user.cookies)response.headers.append('set-cookie',cookie);
    return response;
  }catch(error){
    console.error('Relay request failed',error?.code||error?.name||'Error');
    return Response.json({error:error?.code||'SERVICE_UNAVAILABLE',message:error?.status?error.message:'Relay could not complete this request. Retry shortly.'},{status:error?.status||503});
  }
}
export default {fetch};
