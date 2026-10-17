export const NETWORK_PROJECT_COLORS=['#75adff','#69ddc0','#bb9aff','#f0c57c','#ed9aba','#87ccd9','#f39a72','#a8cf83','#e8959b','#aeb9ca'];
const key=r=>`${r.type}:${r.id}`;
const hash=s=>[...s].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
const escapeText=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Show activity at the deepest visible, explicitly known location.
export function networkActivityNodes(graph,nodes,activity=[]){
 const visible=new Map(nodes.map(n=>[key(n),n])),assigned=new Map();
 for(const work of activity){
  const features=(graph.features||[]).filter(f=>f.projectId===work.projectId&&f.taskIds?.includes(work.taskId));
  const files=(graph.files||[]).filter(f=>f.projectId===work.projectId&&(work.fileIds?.includes(f.id)||work.filePaths?.includes(f.path))&&f.featureIds?.some(id=>features.some(feature=>feature.id===id)));
  let targets=files.filter(f=>visible.has(`file:${f.id}`)).map(f=>`file:${f.id}`);
  if(!targets.length)targets=features.filter(f=>visible.has(`feature:${f.id}`)).map(f=>`feature:${f.id}`);
  if(!targets.length&&visible.has(`project:${work.projectId}`))targets=[`project:${work.projectId}`];
  for(const target of targets){if(!assigned.has(target))assigned.set(target,new Map());assigned.get(target).set(work.agentId,work);}
 }
 return nodes.map(n=>({...n,activity:[...(assigned.get(key(n))?.values()||[])]}));
}
export function liveNetworkActivity(state,now=Date.now()){
 return (state.tasks||[]).flatMap(task=>{
  const agent=state.agents?.find(a=>a.id===task.lease?.actor);
  if(!agent||agent.status!=='working'||!(Date.parse(task.lease.until)>now))return [];
  return [{agentId:agent.id,agentName:agent.name,taskId:task.id,projectId:task.projectId,summary:agent.currentAction||task.title,filePaths:agent.activeFiles||[]}];
 });
}
function activityMarkup(n,r){
 if(!n.activity?.length)return '';
 return `<g class="network-activity" aria-hidden="true" pointer-events="none"><circle class="network-activity-aura" r="${r+15}"/><circle class="network-activity-base" r="${r+8}"/><circle class="network-activity-halo" r="${r+8}"/><circle class="network-activity-halo network-activity-second" r="${r+8}"/></g>`;
}
export function networkLayout(graph){
 const nodes=graph.nodes.map(n=>({...n,key:key(n),color:n.projectColor||NETWORK_PROJECT_COLORS[hash(n.projectId)%6],x:600,y:420})),projects=nodes.filter(n=>n.type==='project');
 const files=nodes.filter(n=>n.type==='file'),expanded=files.length>0,focused=!!graph.focus,cols=Math.max(1,Math.ceil(Math.sqrt(projects.length)));
 const fileReach=f=>{const count=files.filter(n=>n.featureIds?.includes(f.id)).length;return count?Math.max(150,Math.min(12,count)*38)+Math.floor((count-1)/12)*180:0;};
 const featureRadius=p=>{const own=nodes.filter(n=>n.type==='feature'&&n.projectId===p.id),reach=Math.max(0,...own.map(fileReach));return expanded?Math.max(340,reach*1.8,own.length*(reach+120)/Math.PI):Math.max(200,own.length*40);};
 const spacing=expanded?Math.max(1150,...projects.map(p=>2*(featureRadius(p)+Math.max(0,...nodes.filter(n=>n.type==='feature'&&n.projectId===p.id).map(fileReach))+140))):700;
 const orbit=(list,cx,cy,radius,phase=0)=>list.forEach((n,i)=>{const ring=Math.floor(i/12),count=Math.min(12,list.length-ring*12),angle=-Math.PI/2+(i%12)*Math.PI*2/count+phase;n.x=cx+Math.cos(angle)*(radius+ring*180);n.y=cy+Math.sin(angle)*(radius+ring*180);});
 projects.forEach((p,i)=>{p.x=projects.length===1?600:520+(i%cols)*spacing;p.y=projects.length===1?420:520+Math.floor(i/cols)*spacing;const features=nodes.filter(n=>n.type==='feature'&&n.projectId===p.id);orbit(features,p.x,p.y,featureRadius(p),i*.3);});
 for(const f of nodes.filter(n=>n.type==='feature')){
  if(!projects.some(p=>p.id===f.projectId)){f.x=600;f.y=420;f.parentKey=null;}
  const own=files.filter(n=>n.featureIds?.find(id=>nodes.some(x=>x.type==='feature'&&x.id===id))===f.id);
  for(const n of own)n.parentKey=f.key;
  orbit(own,f.x,f.y,focused&&graph.focus?.type==='feature'?Math.max(210,Math.min(12,own.length)*44):Math.max(150,Math.min(12,own.length)*38),hash(f.id)%20*.3);
 }
 // Legacy task nodes remain usable by non-hierarchy callers.
 for(const p of projects)orbit(nodes.filter(n=>n.type==='task'&&n.projectId===p.id),p.x,p.y,200);
 const padX=135,padY=115,minX=Math.min(0,...nodes.map(n=>n.x-padX)),minY=Math.min(0,...nodes.map(n=>n.y-padY)),maxX=Math.max(1200,...nodes.map(n=>n.x+padX)),maxY=Math.max(840,...nodes.map(n=>n.y+padY));
 return {nodes,edges:graph.edges,width:maxX-minX,height:maxY-minY,minX,minY};
}
export function networkEdgePath(a,b,e){
 const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,ar=a.type==='project'?34:a.type==='file'?12:22,br=b.type==='project'?34:b.type==='file'?12:22,bend=['membership','project_feature','feature_file'].includes(e.type)?0:e.type==='shared'?-32:20;
 // Overlapping nodes retain a finite path. Endpoints always use current positions.
 const trim=Math.min(1,d/(ar+br));
 return `M${a.x+dx/d*ar*trim},${a.y+dy/d*ar*trim} Q${(a.x+b.x)/2-dy/d*bend},${(a.y+b.y)/2+dx/d*bend} ${b.x-dx/d*br*trim},${b.y-dy/d*br*trim}`;
}
export function renderNetwork(graph,{selected=null,transform={x:0,y:0,scale:1},model=null}={}){
 model ||= networkLayout(graph);
 const box=model.box||model,byKey=new Map(model.nodes.map(n=>[n.key,n])),esc=escapeText,selectedKey=selected?key(selected):null;
 // Follow recorded parent links from active nodes back to each visible project.
 const incoming=new Map(),activeEdges=new Set();
 for(const edge of model.edges){
  if(!['membership','project_feature','feature_file'].includes(edge.type)||!byKey.has(key(edge.from))||!byKey.has(key(edge.to)))continue;
  const child=key(edge.to);
  if(!incoming.has(child))incoming.set(child,[]);
  incoming.get(child).push(edge);
 }
 const pending=model.nodes.filter(node=>node.activity?.length).map(node=>node.key),visited=new Set();
 while(pending.length){
  const child=pending.pop();
  if(visited.has(child))continue;
  visited.add(child);
  for(const edge of incoming.get(child)||[]){activeEdges.add(edge.id);pending.push(key(edge.from));}
 }
 const edges=model.edges.map(e=>{
  const a=byKey.get(key(e.from)),b=byKey.get(key(e.to));if(!a||!b)return '';
  const path=networkEdgePath(a,b,e),selectedEdge=selected?.type==='relationship'&&selected.id===e.id,related=selectedKey===key(e.from)||selectedKey===key(e.to),color=e.type==='shared'?'#cfacff':selectedEdge?'#f8d68d':related?'#85e5ce':['membership','project_feature','feature_file'].includes(e.type)?a.color:'#738ca3';
  const title=e.name||e.summary;
  const activeBranch=activeEdges.has(e.id);
  const branch=activeBranch&&!selectedEdge?`<g class="network-activity-branch" aria-hidden="true" pointer-events="none"><path class="network-activity-tether" d="${path}"/><path class="network-activity-flow" d="${path}" pathLength="100"/></g>`:'';
  return `<g class="network-link ${selectedEdge?'selected':''}" role="button" tabindex="0" aria-keyshortcuts="Enter Space Shift+Enter Shift+Space" aria-label="${esc(title)}" data-action="network-edge" data-id="${esc(e.id)}"><title>${esc(title)}</title><path class="network-edge-visible" d="${path}" fill="none" stroke="${color}" stroke-width="${selectedEdge?3:related?2.5:1.5}" opacity="${['membership','project_feature','feature_file'].includes(e.type)&&!selectedEdge?'.35':'.85'}" ${e.type==='shared'?'stroke-dasharray="5 5"':''} ${['dependency','mapped_dependency'].includes(e.type)?'marker-end="url(#network-arrow)"':''}/>${branch}<path class="network-edge-hit" d="${path}" fill="none" stroke="transparent" stroke-width="24" pointer-events="stroke"/></g>`;
 }).join('');
 const nodes=model.nodes.map(n=>{
  const chosen=selectedKey===n.key,project=n.type==='project',file=n.type==='file',r=project?31:file?9:19,ready=n.status==='ready'||n.status==='completed',progress=['build','human_review'].includes(n.status);
  const activityLabel=n.activity?.length?' · '+n.activity.map(a=>`${a.agentName}: ${a.summary}`).join('; '):'';
  const words=n.label.match(/.{1,22}(?:\s|$)|.{1,22}/g)||[n.label];
  const visible=words.slice(0,2).map((s,i)=>`<tspan x="0" dy="${i?21:0}">${esc(s.trim()+(i===1&&words.length>2?'.':''))}</tspan>`).join('');
  return `<g class="network-node ${project?'network-project':''}" transform="translate(${n.x} ${n.y})" role="button" tabindex="0" aria-keyshortcuts="Enter Space Shift+Enter Shift+Space" data-action="network-node" data-type="${n.type}" data-id="${esc(n.id)}" aria-label="${esc(n.path||n.label)}, ${n.type}, ${esc(n.status)}${n.synthetic?', sample':''}${esc(activityLabel)}"><title>${esc((n.path||n.label)+activityLabel)}</title>${activityMarkup(n,r)}<circle r="${r+12}" fill="transparent"/>${chosen?`<circle r="${r+9}" fill="none" stroke="#d7dbe2" stroke-width="2"/>`:''}<circle r="${r}" fill="#202125" stroke="${n.color}" stroke-width="2.5"/>${project?`<circle r="24" fill="${n.color}" fill-opacity=".13" stroke="${n.color}"/><text y="5" fill="${n.color}" text-anchor="middle" font-size="15">${esc(n.label[0].toUpperCase())}</text>`:file?`<circle r="3" fill="${n.color}"/>`:ready?`<circle r="13" fill="${n.color}"/>`:progress?`<path d="M0,-13 A13,13 0 0 1 0,13 Z" fill="${n.color}"/>`:`<circle r="4" fill="${n.color}"/>`}<text y="${r+23}" text-anchor="middle" fill="${project?n.color:'#d4d6de'}" font-size="${project?19:file?13:17}" paint-order="stroke" stroke="#202125" stroke-width="5" stroke-linejoin="round">${visible}</text>${n.synthetic?`<text y="${r+59}" text-anchor="middle" fill="#9298a4" font-size="10">SAMPLE</text>`:''}</g>`;
 }).join('');
 return `<svg class="network-svg" style="--network-activity-phase:-${(performance.now()%2400).toFixed(2)}ms;--network-flow-phase:-${(performance.now()%3600).toFixed(2)}ms" font-family="Arial, Helvetica, sans-serif" viewBox="${box.minX} ${box.minY} ${box.width} ${box.height}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Project, feature and file network" xmlns="http://www.w3.org/2000/svg"><title>Project, feature and file network</title><defs><pattern id="network-grid" patternUnits="userSpaceOnUse" width="40" height="40" patternTransform="translate(${transform.x} ${transform.y}) scale(${transform.scale})"><circle cx="1" cy="1" r="1" fill="#858d9b" fill-opacity=".2"/></pattern><marker id="network-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9Z" fill="#8ca3b6"/></marker></defs><rect class="network-background" x="${box.minX-box.width*4}" y="${box.minY-box.height*4}" width="${box.width*9}" height="${box.height*9}" fill="url(#network-grid)" pointer-events="none"/><g class="network-world" transform="translate(${transform.x} ${transform.y}) scale(${transform.scale})">${edges}${nodes}</g></svg>`;
}
export function networkGeometryPainter(svg,model){
 const nodeElements=[...svg.querySelectorAll('.network-node')].map(el=>({el,node:model.byKey.get(`${el.dataset.type}:${el.dataset.id}`)}));
 const edges=new Map(model.edges.map(e=>[e.id,e]));
 const edgeElements=[...svg.querySelectorAll('.network-link')].map(el=>({paths:[...el.querySelectorAll('path')],edge:edges.get(el.dataset.id)}));
 return ()=>{
  for(const {el,node} of nodeElements)if(node)el.setAttribute('transform',`translate(${node.x} ${node.y})`);
  for(const {paths,edge} of edgeElements){const a=model.byKey.get(key(edge.from)),b=model.byKey.get(key(edge.to));if(!a||!b)continue;const path=networkEdgePath(a,b,edge);for(const el of paths)el.setAttribute('d',path);}
 };
}
export function networkPicker(graph){const esc=escapeText;return `<option value="">Find a node or connection</option><optgroup label="Projects, features and files">${graph.nodes.map(n=>`<option value="${esc(JSON.stringify({type:n.type,id:n.id}))}">${esc(n.label)} · ${n.type}</option>`).join('')}</optgroup><optgroup label="Connections">${graph.edges.map(e=>`<option value="${esc(JSON.stringify({type:'relationship',id:e.id}))}">${esc(e.name||e.summary)}</option>`).join('')}</optgroup>`;}
