import {send} from '@vercel/queue';
import {createHmac,timingSafeEqual} from 'node:crypto';

const topic='relay-task-dispatch';
function signature(id,env){
 if(!env.NEON_AUTH_COOKIE_SECRET)throw new Error('Dispatch signing key is missing');
 return createHmac('sha256',env.NEON_AUTH_COOKIE_SECRET).update('relay-dispatch:'+id).digest('hex');
}
export async function scheduleTaskDispatch(env,{publish=send}={}){
 const id=crypto.randomUUID();
 const result=await publish(topic,{id,signature:signature(id,env)},{retentionSeconds:86400});
 return {status:'scheduled',messageId:result.messageId};
}
export function validDispatch(message,env){
 if(typeof message?.id!=='string'||message.id.length>64||!/^[a-f0-9]{64}$/.test(message?.signature||''))return false;
 return timingSafeEqual(Buffer.from(signature(message.id,env)),Buffer.from(message.signature));
}
export async function processTaskDispatch(message,env,drain){
 if(!validDispatch(message,env))throw new Error('Invalid dispatch signature');
 const result=await drain();
 if(result.status==='pending')throw new Error('Slack delivery remains pending');
 return result;
}
export function dispatchRetry(error,metadata){
 // Receipts and unsent source records remain in Postgres after retry exhaustion.
 if(metadata.deliveryCount>=32){console.error('Relay dispatch exhausted retries',metadata.messageId);return {acknowledge:true};}
 return {afterSeconds:Math.min(900,15*2**Math.min(metadata.deliveryCount,6))};
}
