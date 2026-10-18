import {handleCallback} from '@vercel/queue';
import {openPostgres} from '../backend/postgres.mjs';
import {drainTaskThreads} from '../backend/thread-dispatch.mjs';
import {processTaskDispatch,dispatchRetry} from '../backend/dispatch-queue.mjs';

let database;
const handler=handleCallback(async message=>{
 const env={...process.env,RELAY_HOSTING:'vercel'};
 return processTaskDispatch(message,env,()=>drainTaskThreads(database??=openPostgres(env.DATABASE_URL),env));
},{retry:dispatchRetry});
export default {fetch:request=>request.method==='POST'?handler(request):new Response(null,{status:405})};
