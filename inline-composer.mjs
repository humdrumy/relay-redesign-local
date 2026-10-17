// Draft mentions carry explicit IDs. Pasted text and link labels never create references.
const inlineKey=r=>`${r.referenceType}:${r.id}`;
const inlineTypes=new Set(['project','task','feature','file','relationship']);
const inlineEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cleanInlineContent(value){
 const out=[];
 for(const part of Array.isArray(value)?value:[]){
  if(part?.type==='text'&&typeof part.text==='string'){
   const text=part.text.replace(/\r\n?/g,'\n');if(!text)continue;
   if(out.at(-1)?.type==='text')out.at(-1).text+=text;else out.push({type:'text',text});
  }else if(part?.type==='reference'&&inlineTypes.has(part.referenceType)&&typeof part.id==='string'&&part.id.length>0&&part.id.length<=8192&&typeof part.label==='string'){
   out.push({type:'reference',referenceType:part.referenceType,id:part.id,label:part.label.slice(0,1000)});
  }
 }
 return out;
}
export function inlinePayload(content){
 const parts=cleanInlineContent(content),references=[];
 for(const part of parts)if(part.type==='reference'&&!references.some(r=>r.type===part.referenceType&&r.id===part.id))references.push({type:part.referenceType,id:part.id});
 return{text:parts.map(p=>p.type==='text'?p.text:p.label).join(''),content:parts.map(p=>p.type==='text'?p:{type:'reference',referenceType:p.referenceType,id:p.id}),references};
}
const inlineLength=parts=>parts.reduce((sum,p)=>sum+(p.type==='text'?p.text.length:1),0);
function inlineSlice(parts,start,end=Infinity){
 let at=0;const out=[];
 for(const p of parts){const len=p.type==='text'?p.text.length:1;if(at<end&&at+len>start)out.push(p.type==='text'?{type:'text',text:p.text.slice(Math.max(0,start-at),Math.min(len,end-at))}:{...p});at+=len;}
 return out;
}
export function inlineMessageMarkup(message){
 const refs=message.references||[],context=message.referenceContext||[],allowed=p=>refs.some(r=>r.type===p.referenceType&&r.id===p.id);
 const link=p=>{const resolved=context.find(r=>r.type===p.referenceType&&r.id===p.id),label=resolved?.label||p.label||'Unavailable reference';return `<a class="inline-reference" href="#portfolio" data-action="network-reference-open" data-reference-mode="real" data-type="${inlineEscape(p.referenceType)}" data-id="${inlineEscape(p.id)}">${inlineEscape(label)}</a>`;};
 if(Array.isArray(message.content))return message.content.map(p=>p?.type==='text'?inlineEscape(p.text):p?.type==='reference'&&allowed(p)?link(p):'').join('');
 // Old messages did not record positions. Keep their references inline after the
 // original text without guessing where a mention originally belonged.
 return inlineEscape(message.text)+(refs.length?' '+refs.map(r=>link({referenceType:r.type,id:r.id})).join(' '):'');
}
export function mountInlineComposer(editor,{draft,onChange=()=>{},onError=()=>{}}){
 const doc=editor.ownerDocument,win=doc.defaultView,known=new WeakMap(),registry=new Map(),listeners=[];
 let composing=false,destroyed=false;
 draft.content=cleanInlineContent(draft.content);draft.selection||={start:inlineLength(draft.content),end:inlineLength(draft.content)};
 draft.undo||=[];draft.redo||=[];
 const listen=(target,type,fn,opts)=>{target.addEventListener(type,fn,opts);listeners.push(()=>target.removeEventListener(type,fn,opts));};
 const snapshot=()=>({content:structuredClone(draft.content),selection:{...draft.selection}});
 const changed=(before)=>{
  if(JSON.stringify(before.content)!==JSON.stringify(draft.content)){draft.undo.push(before);if(draft.undo.length>80)draft.undo.shift();draft.redo=[];}
  editor.dataset.empty=String(!inlinePayload(draft.content).text);onChange(draft);
 };
 function partsOf(root,cloned=false){
  const parts=[],text=t=>{if(t)parts.push({type:'text',text:t});};
  const walk=node=>{
   if(node.nodeType===3){text(node.nodeValue||'');return;}
   if(node.nodeType!==1&&node.nodeType!==11)return;
   const mention=known.get(node)||(cloned?registry.get(node.dataset?.mentionKey):null);
   if(mention){parts.push({...mention});return;}
   if(node.nodeName==='BR'){text('\n');return;}
   const block=/^(DIV|P|LI)$/.test(node.nodeName)&&node!==root;
   if(block&&node.previousSibling)text('\n');
   for(const child of node.childNodes)walk(child);
  };
  for(const child of root.childNodes)walk(child);
  return cleanInlineContent(parts);
 }
 function mentionAt(node){
  for(let current=node?.nodeType===3?node.parentNode:node;current&&current!==editor;current=current.parentNode)if(known.has(current)&&editor.contains(current))return current;
  return null;
 }
 function offsetBefore(node){const prefix=doc.createRange();prefix.selectNodeContents(editor);prefix.setEndBefore(node);return inlineLength(partsOf(prefix.cloneContents(),true));}
 function rangeOffsets(range){
  const offset=(container,n)=>{const prefix=doc.createRange();prefix.selectNodeContents(editor);prefix.setEnd(container,n);return inlineLength(partsOf(prefix.cloneContents(),true));};
  const first=mentionAt(range.startContainer),last=mentionAt(range.endContainer);
  if(range.collapsed&&first){const end=offsetBefore(first)+1;return{start:end,end};}
  return{start:first?offsetBefore(first):offset(range.startContainer,range.startOffset),end:last?offsetBefore(last)+1:offset(range.endContainer,range.endOffset)};
 }
 function selectionOffsets(){
  const selection=win.getSelection?.();if(!selection?.rangeCount)return null;
  const range=selection.getRangeAt(0);if(!editor.contains(range.startContainer)||!editor.contains(range.endContainer))return null;
  return rangeOffsets(range);
 }
 function rememberSelection(){const current=selectionOffsets();if(current){draft.selection=current;onChange(draft);}}
 function pointAt(offset){
  let remaining=Math.max(0,offset),found=null;
  const edge=(node,after=false)=>({node:node.parentNode,offset:[...node.parentNode.childNodes].indexOf(node)+(after?1:0)});
  const walk=node=>{
   if(found)return;
   if(known.has(node)){if(remaining<=1){found=edge(node,remaining===1);return;}remaining--;return;}
   if(node.nodeType===3){if(remaining<=node.nodeValue.length){found={node,offset:remaining};return;}remaining-=node.nodeValue.length;return;}
   if(node.nodeName==='BR'){if(remaining<=1){found=edge(node,remaining===1);return;}remaining--;return;}
   if(/^(DIV|P|LI)$/.test(node.nodeName)&&node!==editor&&node.previousSibling){if(remaining===0){found=edge(node);return;}remaining--;}
   for(const child of node.childNodes)walk(child);
  };
  walk(editor);return found||{node:editor,offset:editor.childNodes.length};
 }
 function restoreSelection(focus=true){
  if(destroyed)return;if(focus)editor.focus({preventScroll:true});
  const selection=win.getSelection?.();if(!selection)return;
  const max=inlineLength(draft.content),a=pointAt(Math.min(draft.selection.start,max)),b=pointAt(Math.min(draft.selection.end,max)),range=doc.createRange();
  range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);selection.removeAllRanges();selection.addRange(range);
 }
 function paint(){
  editor.replaceChildren();registry.clear();
  for(const part of draft.content){
   if(part.type==='text'){editor.append(doc.createTextNode(part.text));continue;}
   const node=doc.createElement('span'),label=doc.createElement('a'),remove=doc.createElement('button'),key=crypto.randomUUID();
   node.className='inline-mention';node.setAttribute('contenteditable','false');node.tabIndex=0;node.dataset.mentionKey=key;node.setAttribute('role','group');node.setAttribute('aria-label',`${part.label}, reference`);
   label.href='#portfolio';label.className='inline-reference';label.tabIndex=-1;label.textContent=part.label;
   remove.type='button';remove.className='inline-mention-remove';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${part.label} reference`);remove.title=`Remove ${part.label} reference`;
   node.append(label,remove);known.set(node,{...part});registry.set(key,{...part});editor.append(node);
  }
  if(!editor.lastChild||known.has(editor.lastChild))editor.append(doc.createTextNode(''));
  editor.dataset.empty=String(!inlinePayload(draft.content).text);
 }
 function sync(record=true){
  if(destroyed)return;const before=snapshot(),selection=selectionOffsets();draft.content=partsOf(editor);if(selection)draft.selection=selection;
  if(record&&!composing)changed(before);else onChange(draft);
  editor.dataset.empty=String(!inlinePayload(draft.content).text);
 }
 function replaceSelection(inserted,selection=null){
  sync();const before=snapshot(),max=inlineLength(draft.content),range=selection||draft.selection,start=Math.max(0,Math.min(max,range.start)),end=Math.max(start,Math.min(max,range.end));
  const next=cleanInlineContent([...inlineSlice(draft.content,0,start),...inserted,...inlineSlice(draft.content,end)]),payload=inlinePayload(next);
  if(payload.text.length>12000)throw Error('Messages can contain up to 12,000 characters.');
  if(payload.references.length>8)throw Error('Use up to eight different references.');
  if(next.length>256)throw Error('Use fewer inline references in this message.');
  draft.content=next;const caret=start+inlineLength(inserted);draft.selection={start:caret,end:caret};paint();restoreSelection();changed(before);
 }
 function history(redo=false){
  sync();const source=redo?draft.redo:draft.undo,target=redo?draft.undo:draft.redo,next=source.pop();if(!next)return;
  target.push(snapshot());draft.content=cleanInlineContent(next.content);draft.selection={...next.selection};paint();restoreSelection();onChange(draft);
 }
 function removeMention(node){
  if(!known.has(node)||!editor.contains(node)||composing)return;
  sync();const saved={...draft.selection},start=offsetBefore(node);
  replaceSelection([],{start,end:start+1});
  const adjust=value=>value<=start?value:Math.max(start,value-1);
  draft.selection={start:adjust(saved.start),end:adjust(saved.end)};restoreSelection();onChange(draft);
 }
 function deleteAtomic(event,back){
  if(composing||event.isComposing)return false;
  sync();const selection=win.getSelection?.(),inside=mentionAt(event.target)||(selection?.rangeCount?mentionAt(selection.getRangeAt(0).startContainer):null);
  let range={...draft.selection};
  if(range.start===range.end){
   if(inside){const start=offsetBefore(inside);range={start,end:start+1};}
   else range={start:range.start-(back?1:0),end:range.start+(back?0:1)};
  }
  if(range.start<0||!inlineSlice(draft.content,range.start,range.end).some(p=>p.type==='reference'))return false;
  event.preventDefault();replaceSelection([],range);return true;
 }
 const safely=fn=>{try{fn();}catch(error){onError(error.message);}};
 listen(editor,'input',()=>sync());
 listen(editor,'compositionstart',()=>{composing=true;draft.compositionStart=snapshot();});
 listen(editor,'compositionend',()=>{composing=false;sync(false);changed(draft.compositionStart||snapshot());delete draft.compositionStart;});
 listen(editor,'beforeinput',e=>{
  if(e.isComposing)return;
  if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();history(e.inputType==='historyRedo');return;}
  if(e.inputType?.startsWith('format')||e.inputType==='insertHTML'||e.inputType==='insertLink'){e.preventDefault();return;}
  if(['insertParagraph','insertLineBreak'].includes(e.inputType)){e.preventDefault();safely(()=>replaceSelection([{type:'text',text:'\n'}]));return;}
  if(e.inputType?.startsWith('delete')){
   safely(()=>{
    const target=e.getTargetRanges?.()[0];
    if(target&&editor.contains(target.startContainer)&&editor.contains(target.endContainer)){
     const range=rangeOffsets(target);sync();
     if(range.start!==range.end&&inlineSlice(draft.content,range.start,range.end).some(p=>p.type==='reference')){e.preventDefault();replaceSelection([],range);return;}
    }
    deleteAtomic(e,e.inputType.endsWith('Backward'));
   });
  }
 });
 listen(editor,'keydown',e=>{
  if(e.isComposing||composing)return;
  if(e.key==='Backspace'||e.key==='Delete'){safely(()=>deleteAtomic(e,e.key==='Backspace'));return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();history(e.shiftKey);}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();history(true);}
 });
 listen(editor,'paste',e=>{e.preventDefault();safely(()=>replaceSelection([{type:'text',text:e.clipboardData?.getData('text/plain')||''}]));});
 listen(editor,'drop',e=>{e.preventDefault();safely(()=>replaceSelection([{type:'text',text:e.dataTransfer?.getData('text/plain')||''}]));});
 listen(editor,'dragstart',e=>e.preventDefault());
 listen(editor,'cut',e=>{
  sync();const range={...draft.selection};if(range.start===range.end||!inlineSlice(draft.content,range.start,range.end).some(p=>p.type==='reference'))return;
  if(e.clipboardData){e.preventDefault();e.clipboardData.setData('text/plain',inlinePayload(inlineSlice(draft.content,range.start,range.end)).text);safely(()=>replaceSelection([],range));}
 });
 listen(editor,'pointerdown',e=>{if(e.target.closest('.inline-mention-remove')){e.preventDefault();e.stopPropagation();}});
 listen(editor,'click',e=>{
  const remove=e.target.closest('.inline-mention-remove');
  if(remove){e.preventDefault();e.stopImmediatePropagation();safely(()=>removeMention(remove.closest('.inline-mention')));return;}
  if(e.target.closest('a'))e.preventDefault();rememberSelection();
 });
 listen(editor,'blur',()=>sync());
 listen(doc,'selectionchange',rememberSelection);
 // Preserve the text selection before clicking a graph item moves focus away.
 listen(doc,'pointerdown',()=>rememberSelection(),true);
 paint();
 return{
  draft,sync,focus:()=>restoreSelection(),payload:()=>{sync();return inlinePayload(draft.content);},
  clear(){draft.content=[];draft.selection={start:0,end:0};draft.undo=[];draft.redo=[];paint();onChange(draft);},
  insertReference(ref,label){safely(()=>{if(composing)throw Error('Finish composing the current text before inserting a reference.');replaceSelection([{type:'reference',referenceType:ref.type,id:ref.id,label},{type:'text',text:' '}]);});},
  destroy(){sync();destroyed=true;for(const remove of listeners)remove();}
 };
}
