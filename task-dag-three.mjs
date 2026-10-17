import * as THREE from 'three';
import {DAG_CARD,DAG_CARD_TYPE,DAG_ARROW,DAG_STAGES,DAG_TEXT_SCALE_MAX,dagArrowReveal,dagEscape as esc,dagRoute} from './task-dag-model.mjs';

const clamp=n=>Math.max(0,Math.min(1,n));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const rectCopy=r=>({left:r.left,top:r.top,width:r.width,height:r.height});
function cardElement(doc,node){
 const element=doc.createElement('button');
 element.className='dag-node-card dag-crisp-card';element.innerHTML=`<h3>${esc(node.title)}</h3><div class="dag-card-status">${esc(DAG_STAGES[node.stage]||node.stage)}</div>`;
 element.type='button';element.dataset.dagOpen=node.id;element.setAttribute('aria-label',`Open ${node.title}, ${DAG_STAGES[node.stage]||node.stage}`);element.title=node.title;
 element.style.setProperty('border-color',node.cycle?'#ff9b9b':node.selected?'#f6d89c':'#476783','important');element.classList.toggle('dag-selected',node.selected);
 element.setAttribute('aria-pressed',String(node.selected));
 return element;
}
export function createThreeTaskDag(options){let release;try{return buildThreeTaskDag(options,cleanup=>{release=cleanup;});}catch(error){release?.();throw error;}}
function buildThreeTaskDag({stage,model,camera:initialCamera,origins,animate,onOpen,onReady,onFallback},own){
 const doc=stage.ownerDocument,win=doc.defaultView,dialog=stage.closest('dialog');
 let renderer;
 try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch(error){throw error;}
 own(()=>{renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();});
 renderer.setClearColor(0x000000,0);renderer.setPixelRatio(Math.min(win.devicePixelRatio||1,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;
 const scene=new THREE.Scene(),perspective=new THREE.PerspectiveCamera(45,1,.1,10000),graph=new THREE.Group();scene.add(graph);
 renderer.domElement.className='dag-webgl-canvas';
 renderer.domElement.setAttribute('aria-hidden','true');
 const layer=doc.createElement('div');layer.className='dag-flight-layer';layer.setAttribute('aria-hidden','true');
 const cardLayer=doc.createElement('div');cardLayer.className='dag-crisp-card-layer';cardLayer.setAttribute('aria-label','Task graph cards');
 const media=win.matchMedia('(prefers-reduced-motion: reduce)'),resources=new Set(),listeners=[],flights=[],edges=[],hiddenSources=new Map();
 let alive=true,intro=!!animate&&!media.matches,docked=false,frame=null,start=null,edgeStart=0,finishedEdges=!intro,viewCamera={...initialCamera},size={width:1,height:1},ready=false;
 own(dispose);
 const listen=(target,type,handler,options)=>{target.addEventListener(type,handler,options);listeners.push(()=>target.removeEventListener(type,handler,options));};
 const remember=value=>{resources.add(value);return value;};
 function restoreSources(){for(const [element,visibility]of hiddenSources){element.style.visibility=visibility;}hiddenSources.clear();}
 function measure(){const r=intro?{width:win.innerWidth,height:win.innerHeight}:stage.getBoundingClientRect();size={width:Math.max(1,r.width),height:Math.max(1,r.height)};renderer.setSize(size.width,size.height);perspective.aspect=size.width/size.height;perspective.position.set(0,0,size.height/(2*Math.tan(THREE.MathUtils.degToRad(45/2))));perspective.updateProjectionMatrix();}
 function positionGraph(){const r=intro?stage.getBoundingClientRect():{left:0,top:0},left=r.left+(intro?stage.clientLeft:0),top=r.top+(intro?stage.clientTop:0);graph.position.set(left+viewCamera.x-size.width/2,size.height/2-top-viewCamera.y,0);graph.scale.set(viewCamera.scale,viewCamera.scale,1);}
 function placeCardBox(f,x,y,width,height,scale){
  const textScale=Math.min(scale,DAG_TEXT_SCALE_MAX),ratio=win.devicePixelRatio||1,px=value=>`${Math.round(value*ratio)/ratio}px`;
  f.element.style.left=px(x);f.element.style.top=px(y);f.element.style.width=px(width);f.element.style.height=px(height);
  // Animate native positions and sizes, never a transformed raster of the text.
  f.element.style.setProperty('--dag-card-padding',px(DAG_CARD_TYPE.padding*textScale));f.element.style.setProperty('--dag-card-radius',px(9*textScale));f.element.style.setProperty('--dag-card-border-width',px(Math.max(1/ratio,1.5*textScale)));f.element.style.setProperty('--dag-card-selected-border-width',px(Math.max(1/ratio,2*textScale)));f.element.style.setProperty('--dag-card-focus-offset',px(2*textScale));f.element.style.setProperty('--dag-card-title-size',px(DAG_CARD_TYPE.title*textScale));f.element.style.setProperty('--dag-card-status-padding',px(DAG_CARD_TYPE.padding*textScale));f.element.style.setProperty('--dag-card-status-size',px(DAG_CARD_TYPE.stage*textScale));
 }
 function placeCard(f){
  const scale=Math.max(Number.EPSILON,viewCamera.scale),width=DAG_CARD.width*scale,height=DAG_CARD.height*scale;
  placeCardBox(f,viewCamera.x+f.node.x*scale-width/2,viewCamera.y+f.node.y*scale-height/2,width,height,scale);
 }
 function placeCards(){if(docked)for(const f of flights)placeCard(f);}
 function render(){if(alive)renderer.render(scene,perspective);}
 const ordered=[...model.nodes].sort((a,b)=>(b.id===model.selectedId)-(a.id===model.selectedId));
 for(const [index,node]of ordered.entries()){
  const origin=origins.get(node.id),element=cardElement(doc,node);
  const initial=origin||{left:Math.max(20,Math.min(win.innerWidth-250,win.innerWidth*.4+(index%4)*48)),top:win.innerHeight+70+(index%3)*45,width:DAG_CARD.width,height:DAG_CARD.height};
  const flight={node,element,origin:initial,sourceScale:initial.width/DAG_CARD.width,delay:index===0?0:Math.min(280,65+(index-1)*35),duration:index===0?640:610,progress:intro?0:1};flights.push(flight);cardLayer.append(element);
  if(intro){element.tabIndex=-1;if(origin?.source?.isConnected&&origin.source.closest('.board')){hiddenSources.set(origin.source,origin.source.style.visibility);origin.source.style.visibility='hidden';}}
 }
 const arrowGeometry=remember(new THREE.BufferGeometry()),radial=6;
 arrowGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-DAG_ARROW.halfWidth,-DAG_ARROW.length,0,DAG_ARROW.halfWidth,-DAG_ARROW.length,0,0,0,0],3));
 for(const [index,edge]of model.edges.entries()){
  const curve=new THREE.CurvePath();
  for(const segment of dagRoute(edge,model)){
   const points=segment.points.map(p=>new THREE.Vector3(p.x,-p.y,0));
   curve.add(new THREE.CubicBezierCurve3(...points));
  }
  curve.arcLengthDivisions=2048;
  const color=edge.cycle?0xff9b9b:edge.type==='dependency'?0x81baff:0xbca4e8;
  const length=curve.getLength(),segments=Math.max(80,Math.min(2048,Math.ceil(length/3)));
  let line,tip=null;
  if(edge.type==='dependency'){
   const geometry=remember(new THREE.TubeGeometry(curve,segments,2,radial,false)),material=remember(new THREE.MeshBasicMaterial({color,transparent:true,opacity:.92,depthTest:false,side:THREE.DoubleSide}));line=new THREE.Mesh(geometry,material);
   tip=new THREE.Mesh(arrowGeometry,remember(new THREE.MeshBasicMaterial({color,depthTest:false,side:THREE.DoubleSide})));tip.renderOrder=1;graph.add(tip);
  }else{
   const geometry=remember(new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(segments))),material=remember(new THREE.LineDashedMaterial({color,dashSize:6,gapSize:7,transparent:true,opacity:.65,depthTest:false}));line=new THREE.Line(geometry,material);line.computeLineDistances();
  }
  graph.add(line);edges.push({edge,line,tip,curve,index,length,segments});
 }
 function drawEdge(e,progress){
  const {progress:p,headScale,shaftSegments}=dagArrowReveal(e.length,progress,e.segments),count=e.tip?shaftSegments*radial*6:Math.max(0,Math.floor(p*e.segments)+1);
  e.line.geometry.setDrawRange(0,count);e.line.visible=count>0&&p>0;
  if(e.tip){
   e.tip.visible=p>0;
   const point=e.curve.getPointAt(p),shaftEnd=e.curve.getPointAt(shaftSegments/e.segments),direction=point.clone().sub(shaftEnd);
   // Match the actual last visible tube ring, including during curved reveals.
   const headLength=direction.length()+DAG_ARROW.overlap*headScale;
   e.tip.position.copy(point);e.tip.scale.set(headScale,headLength/DAG_ARROW.length,1);
   e.tip.rotation.set(0,0,Math.atan2(direction.y,direction.x)-Math.PI/2);
  }
 }
 function drawEdges(progress){for(const e of edges)drawEdge(e,progress);}
 function drawGrowingEdges(elapsed){
  for(const e of edges)drawEdge(e,smooth(clamp((elapsed-Math.min(200,e.index*18))/460)));
 }
 function compact(f,progress){const lift=Math.sin(progress*Math.PI);f.element.style.boxShadow=progress===1?'none':`0 ${mix(2,24,lift)}px ${mix(8,48,lift)}px #02070c70`;}
 function placeFlight(f,elapsed){
  const t=clamp((elapsed-f.delay)/f.duration),u=smooth(t),r=stage.getBoundingClientRect(),target={x:r.left+stage.clientLeft+viewCamera.x+f.node.x*viewCamera.scale,y:r.top+stage.clientTop+viewCamera.y+f.node.y*viewCamera.scale},from={x:f.origin.left+f.origin.width/2,y:f.origin.top+f.origin.height/2};
  const lift=Math.sin(Math.PI*t),settle=t>.82?Math.sin((t-.82)/.18*Math.PI*2)*(1-t)*16:0;
  const x=mix(from.x,target.x,u),y=mix(from.y,target.y,u)-lift*48+settle,width=mix(f.origin.width,DAG_CARD.width*viewCamera.scale,u),height=mix(DAG_CARD.height*f.sourceScale,DAG_CARD.height*viewCamera.scale,u);
  placeCardBox(f,x-width/2,y-height/2,width,height,mix(f.sourceScale,viewCamera.scale,u));f.progress=t;compact(f,t);
 }
 function dock(){
  if(docked)return;intro=false;docked=true;restoreSources();
  // Keep the same DOM nodes and typography on both sides of the landing.
  stage.append(renderer.domElement,cardLayer);layer.remove();
  for(const f of flights){f.progress=1;f.element.tabIndex=0;compact(f,1);}
  measure();positionGraph();placeCards();
 }
 function reportReady(){if(!ready){ready=true;onReady();}}
 function tick(time){
  frame=null;if(!alive)return;try{
   start??=time;const elapsed=time-start;
   if(intro){positionGraph();for(const f of flights)placeFlight(f,elapsed);if(flights.every(f=>f.progress===1)){dock();edgeStart=time+65;}}
   if(!intro&&!finishedEdges){drawGrowingEdges(time-edgeStart);if(time-edgeStart>=680)finishedEdges=true;}
   render();reportReady();if(intro||!finishedEdges)frame=win.requestAnimationFrame(tick);
  }catch{fallback();}
 }
 function finishIntro(){if(!alive)return;if(frame!==null)win.cancelAnimationFrame(frame);frame=null;dock();finishedEdges=true;drawEdges(1);positionGraph();render();reportReady();}
 function resize(){if(!alive)return;finishIntro();measure();positionGraph();placeCards();render();}
 function capture(){const map=new Map();for(const f of flights){const r=f.element.getBoundingClientRect();if(r.width&&r.height&&r.bottom>0&&r.top<win.innerHeight)map.set(f.node.id,{...rectCopy(r),scale:r.width/(parseFloat(f.element.style.width)||DAG_CARD.width),element:f.element.cloneNode(true),source:f.element,background:'#172838',color:'#eef5fc',border:f.element.style.borderColor});}return map;}
 function select(id){
  if(!alive)return;
  for(const f of flights){
   const selected=f.node.id===id;f.node.selected=selected;
   f.element.classList.toggle('dag-selected',selected);f.element.setAttribute('aria-pressed',String(selected));
   f.element.style.setProperty('border-color',f.node.cycle?'#ff9b9b':selected?'#f6d89c':'#476783','important');
   f.element.setAttribute('aria-label',`Open ${f.node.title}, ${DAG_STAGES[f.node.stage]||f.node.stage}`);f.element.title=f.node.title;
   const title=f.element.querySelector('h3');if(title)title.textContent=f.node.title;
   f.element.querySelector('.dag-card-status').textContent=DAG_STAGES[f.node.stage]||f.node.stage;
  }
 }
 function dispose(){if(!alive)return;alive=false;if(frame!==null)win.cancelAnimationFrame(frame);frame=null;restoreSources();for(const remove of listeners)remove();for(const resource of resources)resource.dispose();for(const f of flights)f.element.remove();scene.clear();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();cardLayer.remove();layer.remove();stage.classList.remove('dag-webgl-active');stage.querySelector('svg')?.removeAttribute('aria-hidden');stage.querySelectorAll('[data-dag-node]').forEach(el=>el.setAttribute('tabindex','0'));}
 function fallback(){if(!alive)return;dispose();onFallback();}
 listen(renderer.domElement,'webglcontextlost',e=>{e.preventDefault();fallback();});
 listen(doc,'visibilitychange',()=>{if(doc.visibilityState==='hidden')finishIntro();});
 listen(win,'scroll',()=>{if(intro)finishIntro();},true);
 if(intro){layer.append(renderer.domElement,cardLayer);(dialog||doc.body).append(layer);}else stage.append(renderer.domElement,cardLayer);
 measure();positionGraph();drawEdges(intro?0:1);stage.classList.add('dag-webgl-active');stage.querySelector('svg').setAttribute('aria-hidden','true');stage.querySelectorAll('[data-dag-node]').forEach(el=>el.setAttribute('tabindex','-1'));
 try{if(intro){for(const f of flights)placeFlight(f,0);render();reportReady();frame=win.requestAnimationFrame(tick);}else{dock();for(const f of flights)compact(f,1);render();reportReady();}}catch{fallback();}
 return {setCamera(next){if(!alive)return;viewCamera={...next};positionGraph();placeCards();render();},select,finishIntro,resize,capture,dispose};
}
