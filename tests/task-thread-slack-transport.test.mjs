import test from 'node:test';
import assert from 'node:assert/strict';
import {createSlackTaskThreadTransport} from '../backend/task-thread-slack-transport.mjs';
import {SLACK_MESSAGE_VIEW_LIMIT, withActorMentions} from '../backend/slack-mention.mjs';

const binding={workspaceId:'T-RELAY',userId:'U-RELAY-BOT',botId:'B-RELAY-BOT'};
const namespace={instanceId:'relay-test',epoch:'epoch-test',workspaceId:binding.workspaceId};
const channelId='C-RELAY';
const rootTs='1792288112.680309';
const payload={text:'Relay task: Confirm Dot and Scout received the task\nTask ID: RLY-TEST1234\nhttps://relay-redesign-local.vercel.app'};
const rootOperation={namespace,taskId:'RLY-TEST1234',channelId,operationId:'task-root:test',payloadRef:'relay-content:v1:test',kind:'root',rootMessageTs:null};
const rootMessage={type:'message',channel:channelId,user:binding.userId,bot_id:binding.botId,ts:rootTs,
 text:payload.text.replace('https://relay-redesign-local.vercel.app','<https://relay-redesign-local.vercel.app>')};

function transportFor(route,resolved=payload){
 return createSlackTaskThreadTransport({enabled:true,authorizationHeader:'Bearer xoxb-test-token',binding,
  resolvePayload:async()=>resolved,fetch:async(url,init={})=>{
   const method=new URL(url).pathname.split('/').at(-1);
   let body;
   if(method==='auth.test')body={ok:true,team_id:binding.workspaceId,user_id:binding.userId,bot_id:binding.botId};
   else body=route(method,init);
   return{ok:true,status:200,json:async()=>body};
  }});
}

test('posts both real mentions on task creation and accepts autoformatted URLs',async()=>{
 let posted;
 const mentions=withActorMentions('', ['dot','scout']);
 const transport=transportFor((method,init)=>{
  if(method!=='chat.postMessage')return null;
  posted=JSON.parse(init.body);
  return{ok:true,channel:channelId,ts:rootTs,message:{...rootMessage,text:`${mentions}${rootMessage.text}`}};
 },{text:`${mentions}${payload.text}`});
 const receipt=await transport.send(rootOperation,{beforePost:async()=>true});
 assert.equal(posted.text,`${mentions}${payload.text}`);
 assert.deepEqual(receipt,{namespace,taskId:rootOperation.taskId,operationId:rootOperation.operationId,
  channelId,payloadRef:rootOperation.payloadRef,messageTs:rootTs,rootMessageTs:null});
});

test('reads a full-length bot message after adding both mentions',async()=>{
 const longText='a'.repeat(4000);
 const fullText=withActorMentions(longText,['dot','scout']);
 const message={...rootMessage,text:fullText};
 const transport=createSlackTaskThreadTransport({enabled:true,authorizationHeader:'Bearer xoxb-test-token',binding,
  resolvePayload:async()=>({text:fullText}),fetch:async(url)=>({ok:true,status:200,json:async()=>{
   const method=new URL(url).pathname.split('/').at(-1);
   return method==='auth.test'?{ok:true,team_id:binding.workspaceId,user_id:binding.userId,bot_id:binding.botId}:
    {ok:true,channel:channelId,messages:[message],has_more:false};
  }})});
 const result=await transport.readConfirmedThread({namespace,taskId:rootOperation.taskId,channelId,
  root:{kind:'root',status:'confirmed',operationId:rootOperation.operationId,payloadRef:rootOperation.payloadRef,
   attempt:1,messageTs:rootTs,rootMessageTs:rootTs}});
 assert.equal(result.status,'complete');
 assert.equal(result.messages[0].text.length,SLACK_MESSAGE_VIEW_LIMIT);
 assert.equal(result.messages[0].textTruncated,false);
});

test('reconciles an uncertain Slack root by normalized exact text and trusted sender',async()=>{
 const transport=transportFor(method=>method==='conversations.history'?{ok:true,channel:channelId,messages:[rootMessage],has_more:false}:null);
 assert.deepEqual(await transport.lookup(rootOperation),{namespace,taskId:rootOperation.taskId,
  operationId:rootOperation.operationId,channelId,payloadRef:rootOperation.payloadRef,messageTs:rootTs,rootMessageTs:null});
});

test('reads the confirmed task thread when Slack omits root metadata',async()=>{
 const transport=transportFor(method=>method==='conversations.replies'?{ok:true,channel:channelId,messages:[rootMessage],has_more:false}:null);
 const result=await transport.readConfirmedThread({namespace,taskId:rootOperation.taskId,channelId,
  root:{kind:'root',status:'confirmed',operationId:rootOperation.operationId,payloadRef:rootOperation.payloadRef,
   attempt:1,messageTs:rootTs,rootMessageTs:rootTs}});
 assert.equal(result.status,'complete');
 assert.deepEqual(result.messages,[{text:rootMessage.text,textTruncated:false,messageTs:rootTs,rootMessageTs:rootTs,isRoot:true,
  author:{userId:binding.userId,botId:binding.botId}}]);
});
