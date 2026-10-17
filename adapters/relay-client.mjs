// Import into the actual worker runtime. No tasks, AI calls or approvals run here.
export class RelayClient {
  constructor({url,siteToken,agentToken,fetcher=fetch}){
    this.url=new URL(url);if(this.url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(this.url.hostname))throw new Error('Use the trusted Relay HTTPS origin.');
    if(this.url.username||this.url.password||this.url.search||this.url.hash||this.url.pathname!=='/')throw new Error('Use a bare Relay origin.');
    if(!agentToken)throw new Error('A distinct agent credential is required.');
    this.siteToken=siteToken;this.agentToken=agentToken;this.fetcher=fetcher;
  }
  async request(path,body){
    if(!/^(state|queue|prompts|command|dispatch|integrations|network|context\?(?:messageId|jobId)=[A-Za-z0-9%._~-]+)$/.test(path))throw new Error('Unknown endpoint.');
    const response=await this.fetcher(new URL(`/api/control/${path}`,this.url),{method:body===undefined?'GET':'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${this.agentToken}`,...this.siteToken?{'OAI-Sites-Authorization':`Bearer ${this.siteToken}`}:{},...body===undefined?{}:{'content-type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}});
    if(response.status>=300&&response.status<400)throw new Error('Relay redirected; credentials were not forwarded.');
    const data=await response.json();if(!response.ok){const error=new Error(data.message||`Relay HTTP ${response.status}`);error.code=data.error;error.status=response.status;throw error;}return data;
  }
  state(){return this.request('state');}
  queue(){return this.request('queue');}
  network(){return this.request('network');}
  context({messageId,jobId}){if(!!messageId===!!jobId)throw new Error('Supply one messageId or jobId.');return this.request('context?'+new URLSearchParams(messageId?{messageId}:{jobId}));}
  prompts(){return this.request('prompts');}
  envelope(snapshot,command,operationId=crypto.randomUUID()){
    const task=command.taskId?snapshot.tasks.find(t=>t.id===command.taskId):null;if(command.taskId&&!task)throw new Error('Task missing from snapshot.');
    const job=command.jobId?(snapshot.jobs||snapshot.aiJobs||[]).find(j=>j.id===command.jobId):null;
    const message=command.messageId?snapshot.messages?.find(m=>m.id===command.messageId):null;
    const projectId=task?.projectId||job?.context.projectId||message?.projectId||command.projectId||command.input?.projectId||(command.type==='create_task'?'relay':null);
    const project=projectId?snapshot.projects.find(p=>p.id===projectId):null;
    return {operationId,epoch:snapshot.meta?.epoch||snapshot.epoch,...task?{expectedVersion:task.version}:{},...['claim_project','reassign_project','complete_project','reopen_project'].includes(command.type)?{expectedProjectVersion:project?.version}:{},command:{...project?{projectFence:project.ownershipFence}:{},...task?.lease?{fence:task.fence}:{},...command}};
  }
  // Persist this envelope in your durable runtime before calling send. Retry it
  // unchanged; this client never substitutes updated fences or approval versions.
  send(envelope){return this.request('command',envelope);}
  dispatch(){return this.request('dispatch',{});}
  static fromEnvironment(env=process.env){return new RelayClient({url:env.RELAY_URL,siteToken:env.RELAY_SITE_ACCESS_TOKEN,agentToken:env.RELAY_AGENT_TOKEN});}
}
