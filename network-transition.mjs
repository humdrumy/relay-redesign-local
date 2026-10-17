import {renderNetwork,networkEdgePath} from './network-view.mjs';

const sceneKey=n=>`${n.type}:${n.id}`;
const mix=(a,b,t)=>a+(b-a)*t;
const rectOf=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:Math.max(1,r.width),height:Math.max(1,r.height)};};
function screenCamera(box,camera,r){
 const base=Math.min(r.width/box.width,r.height/box.height);
 return {scale:base*camera.scale,x:r.left+(r.width-box.width*base)/2+base*(camera.x-box.minX),y:r.top+(r.height-box.height*base)/2+base*(camera.y-box.minY)};
}

// Retain the actual outgoing SVG while the next page is prepared. Scene geometry
// and camera share world coordinates; only the viewport bridge uses CSS pixels.
export function retainNetworkScene(surface,motion,camera){
 const doc=surface.ownerDocument,win=doc.defaultView,svg=surface.querySelector('svg');
 const layer=doc.createElement('div');layer.className='network-scene-bridge';layer.setAttribute('aria-hidden','true');
 let rectangle=rectOf(svg),screen=screenCamera(motion.box,camera,rectangle),model=structuredClone(motion);
 let frame=null,serial=0,destination=null,done=null,active=true;
 const media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
 const world=svg.querySelector('.network-world'),grid=svg.querySelector('#network-grid'),background=svg.querySelector('.network-background');
 const unique=`scene-${Math.random().toString(36).slice(2)}`;
 grid.id=unique+'-grid';svg.querySelector('#network-arrow').id=unique+'-arrow';background.setAttribute('fill',`url(#${grid.id})`);
 for(const path of svg.querySelectorAll('[marker-end]'))path.setAttribute('marker-end',`url(#${unique}-arrow)`);
 const nodes=new Map([...svg.querySelectorAll('.network-node')].map(el=>[`${el.dataset.type}:${el.dataset.id}`,el]));
 const edges=new Map([...svg.querySelectorAll('.network-link')].map(el=>[el.dataset.id,el]));
 model.nodes.forEach(n=>n.sceneOpacity=1);model.edges=model.edges.map(e=>({...e,sceneOpacity:1}));
 layer.append(svg);doc.body.append(layer);
 svg.setAttribute('preserveAspectRatio','none');svg.style.minHeight='0';
 function paint(){
  Object.assign(layer.style,{left:rectangle.left+'px',top:rectangle.top+'px',width:rectangle.width+'px',height:rectangle.height+'px'});
  svg.setAttribute('viewBox',`0 0 ${rectangle.width} ${rectangle.height}`);
  const transform=`translate(${screen.x-rectangle.left} ${screen.y-rectangle.top}) scale(${screen.scale})`;
  world.setAttribute('transform',transform);grid.setAttribute('patternTransform',transform);
  for(const [name,value]of Object.entries({x:0,y:0,width:rectangle.width,height:rectangle.height}))background.setAttribute(name,value);
  for(const n of model.nodes){const el=nodes.get(n.key);if(!el)continue;el.setAttribute('transform',`translate(${n.x} ${n.y})`);el.style.opacity=n.sceneOpacity;el.style.pointerEvents=n.sceneOpacity>.25?'auto':'none';el.setAttribute('tabindex','-1');}
  for(const e of model.edges){const el=edges.get(e.id),a=model.byKey.get(sceneKey(e.from)),b=model.byKey.get(sceneKey(e.to));if(!el||!a||!b)continue;el.style.opacity=e.sceneOpacity;el.style.pointerEvents=e.sceneOpacity>.25?'auto':'none';el.setAttribute('tabindex','-1');const path=networkEdgePath(a,b,e);for(const p of el.querySelectorAll('path'))p.setAttribute('d',path);}
 }
 paint();
 function freeze(){serial++;if(frame!==null)win.cancelAnimationFrame?.(frame);frame=null;}
 function anchorFor(node,source,target,seen=new Set()){
  if(!node||seen.has(node.key))return null;seen.add(node.key);
  const candidates=[node.parentKey,...(node.featureIds||[]).map(id=>`feature:${id}`),`project:${node.projectId}`].filter(Boolean);
  for(const id of candidates){if(source.byKey.has(id))return source.byKey.get(id);const parent=target.byKey.get(id);if(parent){const found=anchorFor(parent,source,target,seen);if(found)return found;}}
  return null;
 }
 function finish(){if(!active)return;freeze();if(destination)destination.svg.style.visibility='';active=false;layer.remove();win.removeEventListener('resize',relocate);win.removeEventListener('scroll',relocate,true);doc.removeEventListener('visibilitychange',visibility);media?.removeEventListener?.('change',reduce);const callback=done;done=null;callback?.();}
 function to({surface:nextSurface,motion:target,camera:targetCamera,pivot=null,onFinish,duration=320}){
  if(!active)return;freeze();done=onFinish;
  const targetSvg=nextSurface.querySelector('svg');targetSvg.style.visibility='hidden';
  destination={surface:nextSurface,motion:target,camera:targetCamera,pivot,svg:targetSvg};
  const startRect={...rectangle},endRect=rectOf(targetSvg),startScreen={...screen},endScreen=screenCamera(target.box,targetCamera,endRect);
  const source=model,union=[],plans=new Map(),edgePlans=new Map();
  for(const n of source.nodes){const end=target.byKey.get(n.key),collapse=!end&&n.type==='file'?anchorFor(n,target,source):null;const final=end||collapse||n;const copy={...n};union.push(copy);plans.set(n.key,{x:n.x,y:n.y,toX:final.x,toY:final.y,opacity:n.sceneOpacity??1,toOpacity:end?1:0});}
  for(const n of target.nodes)if(!source.byKey.has(n.key)){
   const parent=anchorFor(n,source,target)||source.byKey.get(pivot)||{x:(startRect.left+startRect.width/2-startScreen.x)/startScreen.scale,y:(startRect.top+startRect.height/2-startScreen.y)/startScreen.scale};
   const copy={...n,x:parent.x,y:parent.y,sceneOpacity:0};union.push(copy);plans.set(n.key,{x:parent.x,y:parent.y,toX:n.x,toY:n.y,opacity:0,toOpacity:1});
  }
  const unionEdges=new Map(source.edges.map(e=>[e.id,{...e}]));
  for(const e of target.edges)if(!unionEdges.has(e.id))unionEdges.set(e.id,{...e,sceneOpacity:0});
  const targetEdges=new Set(target.edges.map(e=>e.id));
  for(const e of unionEdges.values())edgePlans.set(e.id,{opacity:e.sceneOpacity??1,toOpacity:targetEdges.has(e.id)?1:0});
  model={...target,nodes:union,byKey:new Map(union.map(n=>[n.key,n])),edges:[...unionEdges.values()]};
  // Add only new keyed elements. Shared dots, labels, edges and the background
  // are retained, so there is no crossfade between duplicate common scenes.
  const staging=doc.createElement('div');staging.innerHTML=renderNetwork({}, {model});
  for(const el of staging.querySelectorAll('.network-link'))if(!edges.has(el.dataset.id)){for(const path of el.querySelectorAll('[marker-end]'))path.setAttribute('marker-end',`url(#${unique}-arrow)`);edges.set(el.dataset.id,el);world.insertBefore(el,world.querySelector('.network-node'));}
  for(const el of staging.querySelectorAll('.network-node')){const key=`${el.dataset.type}:${el.dataset.id}`;if(!nodes.has(key)){nodes.set(key,el);world.append(el);}}
  const anchorKey=pivot&&source.byKey.has(pivot)&&target.byKey.has(pivot)?pivot:target.nodes.find(n=>source.byKey.has(n.key))?.key;
  const anchor=anchorKey&&plans.get(anchorKey);
  const anchorStart=anchor?{x:anchor.x*startScreen.scale+startScreen.x,y:anchor.y*startScreen.scale+startScreen.y}:null;
  const anchorEnd=anchor?{x:anchor.toX*endScreen.scale+endScreen.x,y:anchor.toY*endScreen.scale+endScreen.y}:null;
  function draw(t){
   const eased=t*t*(3-2*t);
   for(const n of model.nodes){const p=plans.get(n.key);n.x=mix(p.x,p.toX,eased);n.y=mix(p.y,p.toY,eased);n.sceneOpacity=mix(p.opacity,p.toOpacity,eased);}
   for(const e of model.edges){const p=edgePlans.get(e.id);e.sceneOpacity=mix(p.opacity,p.toOpacity,eased);}
   rectangle=Object.fromEntries(Object.keys(startRect).map(k=>[k,mix(startRect[k],endRect[k],eased)]));
   const scale=Math.exp(mix(Math.log(startScreen.scale),Math.log(endScreen.scale),eased));
   const node=anchorKey&&model.byKey.get(anchorKey);
   screen={scale,x:node?mix(anchorStart.x,anchorEnd.x,eased)-node.x*scale:mix(startScreen.x,endScreen.x,eased),y:node?mix(anchorStart.y,anchorEnd.y,eased)-node.y*scale:mix(startScreen.y,endScreen.y,eased)};
   paint();
  }
  draw(0);
  if(media?.matches||!win.requestAnimationFrame||doc.visibilityState==='hidden'){draw(1);finish();return;}
  const token=serial,start=win.performance.now();
  const tick=time=>{if(token!==serial||!active)return;const t=Math.min(1,(time-start)/duration);draw(t);if(t<1)frame=win.requestAnimationFrame(tick);else{frame=null;finish();}};
  frame=win.requestAnimationFrame(tick);
 }
 function relocate(){if(active&&destination)to({...destination,onFinish:done,duration:160});}
 function visibility(){if(doc.visibilityState==='hidden'&&destination)to({...destination,onFinish:done,duration:0});}
 function reduce(e){if(e.matches&&destination)to({...destination,onFinish:done,duration:0});}
 win.addEventListener('resize',relocate);win.addEventListener('scroll',relocate,true);doc.addEventListener('visibilitychange',visibility);media?.addEventListener?.('change',reduce);
 return {to,freeze,finish,get model(){return model;}};
}

export function alignNetworkScope(motion,source,pivot){
 const from=source?.byKey.get(pivot),to=motion.byKey.get(pivot);if(!from||!to)return;
 const dx=from.x-to.x,dy=from.y-to.y;
 for(const node of motion.nodes){for(const field of ['x','originX','anchorX'])node[field]+=dx;for(const field of ['y','originY','anchorY'])node[field]+=dy;}
 motion.box.minX+=dx;motion.box.minY+=dy;motion.bounds.left+=dx;motion.bounds.right+=dx;motion.bounds.top+=dy;motion.bounds.bottom+=dy;
}
