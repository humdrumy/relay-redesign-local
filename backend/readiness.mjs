import {createHash,timingSafeEqual} from 'node:crypto';
export async function readiness(request,env,db){
 if(request.method!=='GET')return new Response(null,{status:405});
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 const hash=createHash('sha256').update(token).digest('hex');
 if(!/^[a-f0-9]{64}$/.test(env.RELAY_DIAGNOSTIC_TOKEN_HASH||'')||!timingSafeEqual(Buffer.from(hash),Buffer.from(env.RELAY_DIAGNOSTIC_TOKEN_HASH)))return new Response(null,{status:401});
 const database=await db.prepare('SELECT id FROM relay_schema_migrations ORDER BY id').bind().all();
 const slack={configured:!!env.SLACK_BOT_TOKEN};
 if(slack.configured){
  const auth=await fetch('https://slack.com/api/auth.test',{method:'POST',headers:{authorization:`Bearer ${env.SLACK_BOT_TOKEN}`},signal:AbortSignal.timeout(10000)});
  const data=await auth.json();Object.assign(slack,{authenticated:data.ok===true,error:data.error||null,teamId:data.team_id,userId:data.user_id,botId:data.bot_id,scopes:auth.headers.get('x-oauth-scopes')});
  if(data.ok){
   const info=await fetch('https://slack.com/api/conversations.info?channel=C0C9J2ZLCCX',{headers:{authorization:`Bearer ${env.SLACK_BOT_TOKEN}`},signal:AbortSignal.timeout(10000)});
   const channel=await info.json();Object.assign(slack,{channelAccessible:channel.ok===true,channelError:channel.error||null,isMember:channel.channel?.is_member,privateChannel:channel.channel?.is_private});
   const history=await fetch('https://slack.com/api/conversations.history?channel=C0C9J2ZLCCX&limit=1',{headers:{authorization:`Bearer ${env.SLACK_BOT_TOKEN}`},signal:AbortSignal.timeout(10000)});
   const recent=await history.json();slack.historyReadable=recent.ok===true;slack.historyError=recent.error||null;
   const root=recent.messages?.[0]?.thread_ts||recent.messages?.[0]?.ts;
   if(root){const replies=await fetch('https://slack.com/api/conversations.replies?channel=C0C9J2ZLCCX&limit=1&ts='+encodeURIComponent(root),{headers:{authorization:`Bearer ${env.SLACK_BOT_TOKEN}`},signal:AbortSignal.timeout(10000)});const thread=await replies.json();slack.threadReadable=thread.ok===true;slack.threadError=thread.error||null;}
  }
 }
 return Response.json({database:{ready:true,migrations:database.results.map(x=>x.id)},auth:{configured:!!env.NEON_AUTH_BASE_URL&&!!env.NEON_AUTH_COOKIE_SECRET},slack},{headers:{'cache-control':'no-store'}});
}
