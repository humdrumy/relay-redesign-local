import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleTaskDispatch,processTaskDispatch,dispatchRetry} from '../backend/dispatch-queue.mjs';
const env={NEON_AUTH_COOKIE_SECRET:'test-secret-with-at-least-thirty-two-characters'};
test('queued work authenticates before accessing task data and retries pending delivery',async()=>{
 let payload,reads=0;
 await scheduleTaskDispatch(env,{publish:async(topic,message)=>{assert.equal(topic,'relay-task-dispatch');payload=message;return {messageId:'test'};}});
 await assert.rejects(processTaskDispatch({...payload,id:'forged'},env,async()=>{reads++;}),/signature/);
 assert.equal(reads,0);
 await assert.rejects(processTaskDispatch(payload,env,async()=>({status:'pending'})),/pending/);
 assert.deepEqual(await processTaskDispatch(payload,env,async()=>({status:'idle',sent:0})),{status:'idle',sent:0});
 assert.equal(dispatchRetry(new Error(),{deliveryCount:3}).afterSeconds,120);
});
