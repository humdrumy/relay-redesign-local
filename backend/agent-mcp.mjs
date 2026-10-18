import { controlIdentity } from './control-http.mjs';
import { ControlStore } from './control.mjs';
import { createManagedMcp, managedMcpTools } from './managed-mcp.mjs';

// Machine credentials are validated independently of browser sessions. A Dot
// credential never receives the owner's human tools or Scout's tools.
export async function agentMcp(request,{env,db,onCommandCommitted,taskThreadTransportFactory,resolveIdentity}){
 const identity=await resolveIdentity?.(request)??await controlIdentity(request,env,null);
 if(identity.kind!=='agent'||!['dot','scout'].includes(identity.actor))return Response.json({error:'FORBIDDEN'},{status:403});
 if(request.method!=='POST')return new Response(null,{status:405});
 const raw=await request.text();if(raw.length>65536)return new Response(null,{status:413});
 let rpc;try{rpc=JSON.parse(raw);}catch{return new Response(null,{status:400});}
 const reply=result=>Response.json({jsonrpc:'2.0',id:rpc.id??null,result});
 const failure=(code,message)=>Response.json({jsonrpc:'2.0',id:rpc.id??null,error:{code,message}});
 if(!rpc||Array.isArray(rpc)||rpc.jsonrpc!=='2.0')return failure(-32600,'Invalid JSON-RPC request');
 const config={...env,RELAY_MCP_DOT_ENABLED:'true',RELAY_MCP_SCOUT_SUBJECT:'relay-agent:scout'};
 const definitions=managedMcpTools(config).filter(tool=>tool.name.startsWith(`relay_${identity.actor}_`));
 if(rpc.method==='initialize')return reply({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'relay-vercel',version:'4.0.0'},instructions:'Read your queue. Collaborate on planning, then only the assigned owner executes. Ingest the complete task thread before each Luna step.'});
 if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
 if(rpc.method==='ping')return reply({});
 if(rpc.method==='tools/list')return reply({tools:definitions});
 if(rpc.method!=='tools/call')return failure(-32601,'Method not found');
 if(!definitions.some(tool=>tool.name===rpc.params?.name))return failure(-32601,'Tool is not available to this agent');
 const state=await new ControlStore(db).read();
 const managed=createManagedMcp({env:config,db,resolveSubject:async()=>identity.actor==='dot'?state.meta.ownerId:'relay-agent:scout',onCommandCommitted,taskThreadTransportFactory});
 return managed.handle(new Request(request.url,{method:'POST',headers:{'content-type':'application/json'},body:raw}));
}
