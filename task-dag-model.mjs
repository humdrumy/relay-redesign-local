export const DAG_CARD={width:260,height:160};
export const DAG_TEXT_SCALE_MAX=1.25;
export const DAG_CARD_TYPE={title:24,stage:17,padding:12};
export const DAG_ARROW={length:15,halfWidth:6,overlap:1};
// The shaft finishes inside the broad base of the head, never at its point.
export function dagArrowReveal(length,progress,segments){
 const p=Math.max(0,Math.min(1,progress)),headScale=Math.min(1,p*length/DAG_ARROW.length);
 const shaftLength=Math.max(0,p*length-(DAG_ARROW.length-DAG_ARROW.overlap)*headScale);
 return {progress:p,headScale,shaftSegments:Math.floor(shaftLength/Math.max(length,Number.EPSILON)*segments)};
}
// Use recorded completion when present; readiness approval is labelled separately.
export function dagRecordedDate(task){
 if(Number.isFinite(Date.parse(task.completedAt)))return {at:task.completedAt,label:'Completed'};
 if(task.stage==='ready'&&Number.isFinite(Date.parse(task.finalApproval?.at)))return {at:task.finalApproval.at,label:'Ready for production'};
 return {at:task.createdAt,label:'Created'};
}
export const DAG_STAGES={intake:'Not started',research:'Research',plan_review:'Plan approval',build:'Build',human_review:'Final approval',ready:'Ready for production'};
export const dagEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Iterative SCC decomposition keeps malformed/imported cycles explicit, including
// cycles larger than the visible slice. Timestamps never participate in ranking.
function components(ids,edges){
 const next=new Map(ids.map(id=>[id,[]])),back=new Map(ids.map(id=>[id,[]]));
 for(const e of edges){next.get(e.from)?.push(e.to);back.get(e.to)?.push(e.from);}
 const visited=new Set(),order=[];
 for(const id of ids){if(visited.has(id))continue;visited.add(id);const stack=[[id,0]];while(stack.length){const pair=stack.at(-1),children=next.get(pair[0]);if(pair[1]<children.length){const child=children[pair[1]++];if(!visited.has(child)){visited.add(child);stack.push([child,0]);}}else{order.push(pair[0]);stack.pop();}}}
 const component=new Map(),groups=[];
 for(const id of order.reverse()){if(component.has(id))continue;const index=groups.length,group=[],stack=[id];component.set(id,index);while(stack.length){const at=stack.pop();group.push(at);for(const child of back.get(at))if(!component.has(child)){component.set(child,index);stack.push(child);}}groups.push(group);}
 return {component,groups};
}
export function taskDagModel(records,selectedId,{limit=18,history=true}={}){
 const tasks=new Map(records.tasks.map(t=>[t.id,{...t,recordedDate:dagRecordedDate(t)}])),selected=tasks.get(selectedId);if(!selected)return null;
 const dep=[],links=[],adjacent=new Map([...tasks.keys()].map(id=>[id,[]])),missing=new Set();
 const connect=e=>{adjacent.get(e.from)?.push(e.to);adjacent.get(e.to)?.push(e.from);};
 for(const t of tasks.values())for(const id of new Set(t.dependencies||[])){if(tasks.has(id)){const e={id:`dependency:${id}:${t.id}`,from:id,to:t.id,type:'dependency'};dep.push(e);connect(e);}else if(t.id===selectedId)missing.add(id);}
 const features=(records.features||[]).map(f=>({...f,taskIds:[...new Set(f.taskIds||[])].filter(id=>tasks.has(id))}));
 // Support older explicit Feature task mappings when no projected feature was supplied.
 for(const t of tasks.values())if(t.type==='Feature'&&!features.some(f=>f.taskIds.includes(t.id)))features.push({id:`task-feature:${t.id}`,name:t.title,taskIds:[t.id,...[...tasks.values()].filter(x=>x.featureId===t.id).map(x=>x.id)]});
 if(history)for(const f of features){
  const dated=f.taskIds.filter(id=>Number.isFinite(Date.parse(tasks.get(id).recordedDate.at))).sort((a,b)=>Date.parse(tasks.get(a).recordedDate.at)-Date.parse(tasks.get(b).recordedDate.at)||a.localeCompare(b));
  for(let i=1;i<dated.length;i++){const a=dated[i-1],b=dated[i],different=Date.parse(tasks.get(a).recordedDate.at)!==Date.parse(tasks.get(b).recordedDate.at);const e={id:`history:${f.id}:${a}:${b}`,from:a,to:b,type:different?'chronology':'feature',featureName:f.name||'Recorded feature',featureId:f.id};links.push(e);connect(e);}
  const root=dated[0]||f.taskIds[0];for(const id of f.taskIds)if(id!==root&&!dated.includes(id)){const e={id:`feature:${f.id}:${root}:${id}`,from:root,to:id,type:'feature',featureName:f.name||'Recorded feature',featureId:f.id};links.push(e);connect(e);}
 }
 const queue=[selectedId],seen=new Set(queue);for(let i=0;i<queue.length;i++)for(const id of adjacent.get(queue[i])||[])if(!seen.has(id)){seen.add(id);queue.push(id);}
 const allDeps=dep.filter(e=>seen.has(e.from)&&seen.has(e.to)),scc=components(queue,allDeps),cyclic=new Set();
 const selfLinks=new Set(allDeps.filter(e=>e.from===e.to).map(e=>e.from));
 scc.groups.forEach((group,i)=>{if(group.length>1||selfLinks.has(group[0]))cyclic.add(i);});
 const maximum=Math.min(72,Math.max(6,limit)),visible=queue.slice(0,maximum),ids=new Set(visible),allEdges=[...allDeps,...links].filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>({...e,cycle:e.type==='dependency'&&scc.component.get(e.from)===scc.component.get(e.to)&&cyclic.has(scc.component.get(e.from))}));
 const edgePriority=e=>(e.cycle?4:0)+(e.from===selectedId||e.to===selectedId?10:0)+(e.type==='dependency'?1:0);
 const edges=[...allEdges].sort((a,b)=>edgePriority(b)-edgePriority(a)).slice(0,180);
 const groups=[...new Set(visible.map(id=>scc.component.get(id)))],ranks=new Map(groups.map(id=>[id,0])),inDegree=new Map(groups.map(id=>[id,0])),out=new Map(groups.map(id=>[id,new Set()]));
 for(const e of edges.filter(e=>e.type==='dependency')){const a=scc.component.get(e.from),b=scc.component.get(e.to);if(a!==b&&!out.get(a).has(b)){out.get(a).add(b);inDegree.set(b,inDegree.get(b)+1);}}
 const ready=groups.filter(id=>!inDegree.get(id));for(let i=0;i<ready.length;i++)for(const child of out.get(ready[i])){ranks.set(child,Math.max(ranks.get(child),ranks.get(ready[i])+1));inDegree.set(child,inDegree.get(child)-1);if(!inDegree.get(child))ready.push(child);}
 const columns=new Map();for(const id of visible){const rank=ranks.get(scc.component.get(id));if(!columns.has(rank))columns.set(rank,[]);columns.get(rank).push(id);}
 const nodes=[],byId=new Map();let left=60;
 for(const rank of [...columns.keys()].sort((a,b)=>a-b)){
  const own=columns.get(rank).sort((a,b)=>queue.indexOf(a)-queue.indexOf(b));
  own.forEach((id,i)=>{const t=tasks.get(id),node={...t,x:left+Math.floor(i/4)*(DAG_CARD.width+72)+DAG_CARD.width/2,y:60+(i%4)*(DAG_CARD.height+52)+DAG_CARD.height/2,selected:id===selectedId,cycle:cyclic.has(scc.component.get(id)),componentId:scc.component.get(id),rank};nodes.push(node);byId.set(id,node);});left+=Math.ceil(own.length/4)*(DAG_CARD.width+72);
 }
 // Reserve space only for nonlocal routes; local history links need no overhead lanes.
 const routingModel={byId,edges,nodes};
 const laneCount=edges.filter(e=>dagLongRoute(e,routingModel)).length;
 for(const node of nodes)node.y+=laneCount*14;
 const remaining=queue.slice(maximum).map(id=>tasks.get(id)),dates=visible.map(id=>tasks.get(id)).filter(t=>Number.isFinite(Date.parse(t.recordedDate.at))).sort((a,b)=>Date.parse(a.recordedDate.at)-Date.parse(b.recordedDate.at));
 const model={selectedId,nodes,byId,edges,allEdges,omittedEdges:Math.max(0,allEdges.length-edges.length),features:features.filter(f=>f.taskIds.includes(selectedId)),total:queue.length,remaining,limit:maximum,history,cycleGroups:scc.groups.filter((g,i)=>cyclic.has(i)),missingCount:missing.size,dates,width:Math.max(450,left),height:Math.max(300,...nodes.map(n=>n.y+DAG_CARD.height/2+150)),signature:JSON.stringify([selectedId,maximum,history,nodes.map(n=>[n.id,n.title,n.stage,n.createdAt,n.recordedDate]),edges.map(e=>[e.id,e.cycle])])};
 // Include lower routes in Fit all as well as the cards.
 let routePoints=edges.flatMap(e=>dagRoute(e,model).flatMap(segment=>segment.points));
 const topInset=Math.max(0,24-Math.min(24,...routePoints.map(p=>p.y)));
 if(topInset){for(const node of nodes)node.y+=topInset;model.height+=topInset;routePoints=edges.flatMap(e=>dagRoute(e,model).flatMap(segment=>segment.points));}
 model.height=Math.max(model.height,...routePoints.map(p=>p.y+36));
 model.width=Math.max(model.width,...routePoints.map(p=>p.x+36));
 return model;
}
function dagLongRoute(edge,model){
 const a=model.byId.get(edge.from),b=model.byId.get(edge.to);
 return a.id===b.id||Math.abs(b.x-a.x)>DAG_CARD.width+73;
}
// Choose the side of intervening cards from the destination's height.
// Both renderers consume these same smooth cubic Bezier curves.
export function dagRoute(edge,model){
 const a=model.byId.get(edge.from),b=model.byId.get(edge.to),w=DAG_CARD.width/2,h=DAG_CARD.height/2;
 const cubic=(...points)=>({type:'cubic',points});
 const direction=b.x>=a.x?1:-1;
 const port=(field,id)=>{
  const other=field==='to'?'from':'to';
  const peers=model.edges.filter(e=>e[field]===id).sort((x,y)=>model.byId.get(x[other]).y-model.byId.get(y[other]).y||x.id.localeCompare(y.id));
  return ((peers.findIndex(e=>e.id===edge.id)+1)/(peers.length+1)-.5)*(DAG_CARD.height-40);
 };
 // Same-column history is a small side bow, never an overhead hairpin.
 if(a.x===b.x){
  const from={x:a.x+w,y:a.y+(a.id===b.id?-30:port('from',a.id))};
  const to={x:b.x+w,y:b.y+(a.id===b.id?30:port('to',b.id))};
  const reach=a.id===b.id?48:40;
  return [cubic(from,{x:from.x+reach,y:from.y},{x:to.x+reach,y:to.y},to)];
 }
 const from={x:a.x+direction*w,y:a.y+port('from',a.id)},to={x:b.x-direction*w,y:b.y+port('to',b.id)};
 if(!dagLongRoute(edge,model)){
  if(edge.type==='dependency'&&Math.abs(a.y-b.y)<.01){from.y=a.y;to.y=b.y;}
  const bend=(to.x-from.x)*.3;
  return [cubic(from,{x:from.x+bend,y:from.y},{x:to.x-bend,y:to.y},to)];
 }
 const blockers=model.nodes.filter(n=>n.x>Math.min(a.x,b.x)&&n.x<Math.max(a.x,b.x));
 const below=blockers.length?b.y>Math.min(...blockers.map(n=>n.y))+.01:b.y>a.y+.01;
 const obstacles=blockers.length?blockers:[a,b];
 const lanes=model.edges.filter(e=>dagLongRoute(e,model)).sort((a,b)=>a.id.localeCompare(b.id));
 const clearance=26+lanes.findIndex(e=>e.id===edge.id)*10;
 const laneY=below?Math.max(...obstacles.map(n=>n.y+h))+clearance:Math.min(...obstacles.map(n=>n.y-h))-clearance;
 // Use the outward card faces for blue bypasses so the entire span can
 // form one broad curve instead of squeezing two turns into a narrow gutter.
 if(edge.type==='dependency'){
  const side=below?1:-1;
  const start={x:a.x,y:a.y+side*h};
  const lowerDestination=below&&b.y>a.y;
  const end=lowerDestination?to:{x:b.x,y:b.y+side*h};
  const span=Math.abs(end.x-start.x);
  const archY=below?laneY:laneY-Math.min(180,Math.max(80,span*.16));
  const candidate=cubic(start,{x:start.x,y:archY},lowerDestination?{x:end.x-direction*span*.3,y:end.y}:{x:end.x,y:archY},end);
  // Only use this broad sweep when its full trajectory clears every card.
  // Dense layouts retain an obstacle-safe S through the empty gutters.
  const clear=model.nodes.every(node=>{
   for(let i=1;i<96;i++){
    const t=i/96,u=1-t,q=candidate.points;
    const x=u*u*u*q[0].x+3*u*u*t*q[1].x+3*u*t*t*q[2].x+t*t*t*q[3].x;
    const y=u*u*u*q[0].y+3*u*u*t*q[1].y+3*u*t*t*q[2].y+t*t*t*q[3].y;
    const padding=node.id===a.id||node.id===b.id?0:8;
    if(x>node.x-w-padding&&x<node.x+w+padding&&y>node.y-h-padding&&y<node.y+h+padding)return false;
   }
   return true;
  });
  if(clear)return [candidate];
 }
 // Dense lower bypasses need room beyond the column gutters to round
 // their bottom bends. Extend the curves only once below every obstacle.
 if(below&&edge.type==='dependency'){
  const floor=Math.max(...obstacles.map(n=>n.y+h))+12;
  const bottom=Math.max(laneY,floor+64);
  const left={x:from.x+direction*36,y:floor},right={x:to.x-direction*36,y:floor};
  const radius=Math.min(96,Math.abs(right.x-left.x)/4);
  const entry={x:left.x+direction*radius,y:bottom},exit={x:right.x-direction*radius,y:bottom};
  const vertical=(bottom-floor)*.55,horizontal=direction*radius*.55;
  return [
   cubic(from,{x:left.x,y:from.y},{x:left.x,y:floor-Math.min(64,(floor-from.y)*.4)},left),
   cubic(left,{x:left.x,y:floor+vertical},{x:entry.x-horizontal,y:bottom},entry),
   cubic(entry,{x:entry.x+(exit.x-entry.x)/3,y:bottom},{x:exit.x-(exit.x-entry.x)/3,y:bottom},exit),
   cubic(exit,{x:exit.x+horizontal,y:bottom},{x:right.x,y:floor+vertical},right),
   cubic(right,{x:right.x,y:floor-Math.min(64,(floor-to.y)*.4)},{x:right.x,y:to.y},to)
  ];
 }
 const leave={x:from.x+direction*60,y:laneY},arrive={x:to.x-direction*60,y:laneY};
 // Horizontal tangent joins make continuous S-shaped transitions, with
 // curvature spread across the whole gutter rather than tight elbow turns.
 const handle=direction*24;
 return [
  cubic(from,{x:from.x+handle,y:from.y},{x:leave.x-handle,y:laneY},leave),
  cubic(leave,{x:leave.x+(arrive.x-leave.x)/3,y:laneY},{x:arrive.x-(arrive.x-leave.x)/3,y:laneY},arrive),
  cubic(arrive,{x:arrive.x+handle,y:laneY},{x:to.x-handle,y:to.y},to)
 ];
}
export function dagPath(edge,model){
 const route=dagRoute(edge,model),first=route[0].points[0];
 return 'M'+first.x+','+first.y+route.map(s=>' C'+s.points.slice(1).map(p=>p.x+','+p.y).join(' ')).join('');
}
export function dagRelationText(edge,model){const a=model.byId.get(edge.from)?.title,b=model.byId.get(edge.to)?.title;return edge.type==='dependency'?`${a} is a recorded prerequisite for ${b}${edge.cycle?' — dependency cycle':''}.`:edge.type==='chronology'?`${a} (${model.byId.get(edge.from).recordedDate.label.toLowerCase()}) precedes ${b} (${model.byId.get(edge.to).recordedDate.label.toLowerCase()}) within ${edge.featureName}. Recorded date order only, not a dependency.`:`${a} and ${b} are mapped to ${edge.featureName}. Membership only, not a dependency.`;}
