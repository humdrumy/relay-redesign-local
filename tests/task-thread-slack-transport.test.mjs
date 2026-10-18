import test from 'node:test';
import assert from 'node:assert/strict';
import {createSlackTaskThreadTransport} from '../backend/task-thread-slack-transport.mjs';

const binding={workspaceId:'T-RELAY',userId:'U-RELAY-BOT',botId:'B-RELAY-BOT'};
const namespace={instanceId:'relay-test',epoch:'epoch-test',workspaceId:binding.workspaceId};
const channelId='C-RELAY';
const rootTs='1792288112.680309';
const payload={text:'Relay task: Confirm Dot and Scout received the task\nTask ID: RLY-TEST1234\nhttps://relay-redesign-local.vercel.app'};
const rootOperation={namespace,taskId:'RLY-TEST1234',channelId,operationId:'task-root:test',payloadRef:'relay-content:v1:test',kind:'root',rootMessageTs:null};
const rootMessage={type:'message',channel:channelId,user:binding.userId,bot_id:binding.botId,ts:rootTs,
 text:payload.text.replace('https://relay-redesign-local.vercel.app','<https://relay-redesign-local.vercel.app>')};

function transportFor(route){
 return createSlackTaskThreadTransport({enabled:true,authorizationHeader:'Bearer xoxb-test-token',binding,
  resolvePayload:async()=>payload,fetch:async(url,init={})=>{
   const method=new URL(url).pathname.split('/').at(-1);
   let body;
   if(method==='auth.test')body={ok:true,team_id:binding.workspaceId,user_id:binding.userId,bot_id:binding.botId};
   else body=route(method,init);
   return{ok:true,status:200,json:async()=>body};
  }});
}

test('accepts exact-content Slack roots with Slack autoformatted URLs when metadata is omitted',async()=>{
 const transport=transportFor(method=>method==='chat.postMessage'?{ok:true,channel:channelId,ts:rootTs,message:rootMessage}:null);
 const receipt=await transport.send(rootOperation,{beforePost:async()=>true});
 assert.deepEqual(receipt,{namespace,taskId:rootOperation.taskId,operationId:rootOperation.operationId,
  channelId,payloadRef:rootOperation.payloadRef,messageTs:rootTs,rootMessageTs:null});
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
