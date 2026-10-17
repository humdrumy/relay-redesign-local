import {clientToNetworkSvg,networkWorldPoint,zoomNetworkCamera,networkWheelFactor,fitNetworkCamera,grabNetworkNode,dragNetworkNode,releaseNetworkNode,stepNetworkMotion,settleNetworkMotion,resetNetworkMotion} from './network-motion.mjs';
import {networkGeometryPainter} from './network-view.mjs';

export function mountNetworkInteractions(surface,{motion,camera,onCamera=()=>{}}){
  const svg=surface.querySelector('svg'),doc=surface.ownerDocument,win=doc.defaultView;
  const world=svg.querySelector('.network-world'),grid=svg.querySelector('#network-grid'),background=svg.querySelector('.network-background');
  const paint=networkGeometryPainter(svg,motion),listeners=[],media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let cameraFrame=null,cameraDone=null;
  let reduced=!!media?.matches,gesture=null,frame=null,lastTime=null,suppressClick=false,destroyed=false;
  const clock=()=>win.performance?.now?.()??Date.now();
  const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
  const rect=()=>svg.getBoundingClientRect();
  const svgPoint=e=>clientToNetworkSvg({x:e.clientX,y:e.clientY},rect(),motion.box);
  const center=()=>({x:motion.box.minX+motion.box.width/2,y:motion.box.minY+motion.box.height/2});
  function updateCamera(next=camera){
    Object.assign(camera,next);
    const transform=`translate(${camera.x} ${camera.y}) scale(${camera.scale})`;
    world.setAttribute('transform',transform);grid.setAttribute('patternTransform',transform);
    // Fill the letterboxed visible SVG area too, without a fixed world-sized asset.
    const r=rect(),a=clientToNetworkSvg({x:r.left||0,y:r.top||0},r,motion.box),b=clientToNetworkSvg({x:(r.left||0)+r.width,y:(r.top||0)+r.height},r,motion.box);
    if(r.width&&r.height){for(const [name,value] of Object.entries({x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y}))background.setAttribute(name,value);}
    onCamera(camera);
  }
  function animate(time){
    frame=null;if(destroyed)return;
    const dt=lastTime===null?1/60:(time-lastTime)/1000;lastTime=time;
    const active=stepNetworkMotion(motion,dt);paint();
    if(active)wake();else{lastTime=null;motion.resting=true;}
  }
  function wake(){
    if(destroyed||doc.visibilityState==='hidden')return;
    motion.resting=false;
    if(reduced||!win.requestAnimationFrame){settleNetworkMotion(motion);motion.resting=true;paint();return;}
    if(frame===null&&!destroyed)frame=win.requestAnimationFrame(animate);
  }
  function stop(){if(frame!==null)win.cancelAnimationFrame?.(frame);frame=null;lastTime=null;}
  function capture(id){try{surface.setPointerCapture?.(id);}catch{/* Pointer may already have ended. */}}
  function finish(cancel=false,e=null){
    if(!gesture||(e&&e.pointerId!==undefined&&e.pointerId!==gesture.id))return;
    const g=gesture;gesture=null;
    if(g.moved){
      suppressClick=true;
      if(g.key)releaseNetworkNode(motion,clock()-g.lastMove>90?{x:0,y:0}:g.velocity,{cancel,reduced});
      wake();
    }
    surface.classList.remove('is-dragging');
    try{if(surface.hasPointerCapture?.(g.id))surface.releasePointerCapture(g.id);}catch{/* Already released. */}
  }
  listen(surface,'pointerdown',e=>{
    cancelCamera();
    if(gesture||e.isPrimary===false||(e.button!==undefined&&e.button!==0))return;
    suppressClick=false;
    const node=e.target.closest('.network-node'),edge=e.target.closest('.network-link');
    if(edge)return; // Connections remain inspection targets, never draggable springs.
    const point=svgPoint(e),key=node?`${node.dataset.type}:${node.dataset.id}`:null,n=key&&motion.byKey.get(key),worldPoint=networkWorldPoint(point,camera);
    gesture={id:e.pointerId,key,x:e.clientX,y:e.clientY,point,origin:{...camera},moved:false,
      offset:n?{x:n.x-worldPoint.x,y:n.y-worldPoint.y}:null,lastMove:clock(),lastNode:n?{x:n.x,y:n.y}:null,velocity:{x:0,y:0}};
    // Capture only after the threshold: ordinary taps keep their native click target.
  });
  listen(doc,'pointermove',e=>{
    const g=gesture;if(!g||(e.pointerId!==undefined&&e.pointerId!==g.id))return;
    if(!g.moved){
      if(Math.hypot(e.clientX-g.x,e.clientY-g.y)<5)return;
      g.moved=true;if(g.key&&!grabNetworkNode(motion,g.key)){gesture=null;return;}
      capture(g.id);surface.classList.add('is-dragging');surface.focus?.({preventScroll:true});
    }
    e.preventDefault();const point=svgPoint(e);
    if(g.key){
      const p=networkWorldPoint(point,camera),time=clock(),dt=Math.max(.008,Math.min(.08,(time-g.lastMove)/1000));
      dragNetworkNode(motion,{x:p.x+g.offset.x,y:p.y+g.offset.y},reduced);
      const node=motion.byKey.get(g.key);g.velocity={x:(node.x-g.lastNode.x)/dt,y:(node.y-g.lastNode.y)/dt};g.lastNode={x:node.x,y:node.y};g.lastMove=time;
      paint();wake();
    }else updateCamera({x:Math.max(-1e7,Math.min(1e7,g.origin.x+point.x-g.point.x)),y:Math.max(-1e7,Math.min(1e7,g.origin.y+point.y-g.point.y)),scale:camera.scale});
  },{passive:false});
  listen(doc,'pointerup',e=>finish(false,e));
  listen(doc,'pointercancel',e=>finish(true,e));
  listen(surface,'lostpointercapture',e=>finish(true,e));
  listen(win,'blur',()=>finish(true));
  listen(doc,'visibilitychange',()=>{if(doc.visibilityState==='hidden'){finish(true);stop();settleNetworkMotion(motion);paint();}});
  listen(surface,'click',e=>{if(suppressClick&&e.detail!==0){suppressClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
  listen(surface,'wheel',e=>{
    // Listener is scoped to the canvas, never to the chat or document scroll area.
    cancelCamera();if(gesture)return;e.preventDefault();updateCamera(zoomNetworkCamera(camera,networkWheelFactor(e.deltaY,e.deltaMode,rect().height),svgPoint(e)));
  },{passive:false});
  listen(surface,'keydown',e=>{
    if(e.key==='Escape'&&gesture){e.preventDefault();finish(true);return;}
    if(e.target!==surface)return;
    const delta={ArrowLeft:[80,0],ArrowRight:[-80,0],ArrowUp:[0,80],ArrowDown:[0,-80]}[e.key];
    if(delta){e.preventDefault();updateCamera({x:camera.x+delta[0],y:camera.y+delta[1],scale:camera.scale});}
    if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')fit();else zoom(e.key==='-'?.8:1.25);}
  });
  function cancelCamera(){if(cameraFrame!==null)win.cancelAnimationFrame?.(cameraFrame);cameraFrame=null;if(cameraDone){const done=cameraDone;cameraDone=null;done(false);}}
  function centerOn(ref){
    const node=motion.byKey.get(`${ref.type}:${ref.id}`);if(!node)return Promise.resolve(true);
    finish(true);stop();cancelCamera();const middle=center(),scale=Math.min(4,Math.max(camera.scale*1.5,.7)),target={x:middle.x-node.x*scale,y:middle.y-node.y*scale,scale};
    if(reduced||!win.requestAnimationFrame){updateCamera(target);return Promise.resolve(true);}
    const from={...camera},start=clock();
    return new Promise(resolve=>{cameraDone=resolve;const tick=time=>{if(destroyed){cancelCamera();return;}const t=Math.min(1,(time-start)/260),ease=t*t*(3-2*t);updateCamera({x:from.x+(target.x-from.x)*ease,y:from.y+(target.y-from.y)*ease,scale:from.scale+(target.scale-from.scale)*ease});if(t<1)cameraFrame=win.requestAnimationFrame(tick);else{cameraFrame=null;cameraDone=null;resolve(true);}};cameraFrame=win.requestAnimationFrame(tick);});
  }
  function zoom(factor){cancelCamera();if(!gesture)updateCamera(zoomNetworkCamera(camera,factor,center()));}
  function fit(){cancelCamera();finish(true);stop();settleNetworkMotion(motion);paint();updateCamera(fitNetworkCamera(motion.nodes,motion.box));}
  function reset(){cancelCamera();finish(true);stop();resetNetworkMotion(motion);paint();updateCamera({x:0,y:0,scale:1});}
  function changeMotion(e){reduced=e.matches;if(reduced){stop();settleNetworkMotion(motion);paint();}}
  media?.addEventListener?.('change',changeMotion);
  const observer=win.ResizeObserver?new win.ResizeObserver(()=>updateCamera()):null;observer?.observe(svg);
  listen(win,'resize',()=>updateCamera());
  updateCamera();if(!motion.resting)wake();
  return {zoom,fit,reset,paint,updateCamera,centerOn,isDragging:()=>!!gesture,
    destroy(){cancelCamera();finish(true);destroyed=true;stop();for(const remove of listeners)remove();media?.removeEventListener?.('change',changeMotion);observer?.disconnect();}};
}
