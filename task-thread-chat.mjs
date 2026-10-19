let loading=false,lastTask=null;
async function refreshThread(){
 const panel=document.querySelector('dialog[open] [data-task-thread]');
 if(!panel||loading||document.visibilityState==='hidden')return;
 const id=panel.dataset.taskThread;loading=true;lastTask=id;
 let status=panel.querySelector('[data-thread-status]');
 if(!status){status=document.createElement('p');status.dataset.threadStatus='';status.className='subtle';status.setAttribute('role','status');panel.querySelector('.chat-heading').after(status);}
 try{
  const response=await fetch('/api/control/task-threads/conversation?taskId='+encodeURIComponent(id));
  const data=await response.json();if(!response.ok)throw new Error(data.message||'Could not load Slack conversation.');
  if(!panel.isConnected||panel.dataset.taskThread!==id)return;
  const conversation=data.conversation;
  status.textContent=conversation.status==='complete'?'Synced with this task’s Slack thread.':conversation.reason==='root_unconfirmed'?'Waiting for the task’s Slack thread to be created.':'Slack history is incomplete: '+conversation.reason;
  if(conversation.status==='unreadable')return;
  const log=panel.querySelector('.chat-log'),fragment=document.createDocumentFragment();
  for(const message of conversation.messages){
   const article=document.createElement('article');article.className='message';
   const header=document.createElement('header');header.className='message-byline';
   const name=document.createElement('strong');name.textContent=message.isRoot?'Task':message.author.userId||message.author.botId||'Slack';
   const time=document.createElement('time');time.textContent=new Date(Number(message.messageTs)*1000).toLocaleString();header.append(name,time);
   const text=document.createElement('p');text.style.whiteSpace='pre-wrap';text.textContent=message.text+(message.textTruncated?'\n[Message truncated]':'');
   article.append(header,text);fragment.append(article);
  }
  const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<80;log.replaceChildren(fragment);if(nearBottom)log.scrollTop=log.scrollHeight;
 }catch(error){status.textContent=error.message;}finally{loading=false;}
}
new MutationObserver(()=>{const panel=document.querySelector('dialog[open] [data-task-thread]');if(panel&&panel.dataset.taskThread!==lastTask)void refreshThread();if(!panel)lastTask=null;}).observe(document.body,{childList:true,subtree:true});
setInterval(refreshThread,10000);
