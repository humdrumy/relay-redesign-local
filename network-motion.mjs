// Presentation-only camera and springs. No API calls or domain records are changed.
export const NETWORK_ZOOM = {min: .15, max: 6};
export const NETWORK_NODE_RADII = {project:31,feature:19,file:9,task:19};
export const NETWORK_REPULSION_REACH = 42;
const PROJECT_REST_GAP = 24;
const motionClamp = (n, a, b) => Math.max(a, Math.min(b, n));
const motionKey = n => `${n.type}:${n.id}`;

function taskSpringProfile(key, x, y) {
  // Stable identity gives each tether its own response, not a shared translation.
  // The two positive spring axes restore the same rest position. A softer lateral
  // axis lets a spoke sway on direction changes; damping removes all idle motion.
  let seed=2166136261;
  for(const c of key)seed=Math.imul(seed^c.charCodeAt(0),16777619);
  seed=Math.imul(seed^(seed>>>16),2246822507);seed=(seed^(seed>>>13))>>>0;
  const weight=(seed&65535)/65535, sway=(seed>>>16)/65535;
  const angle=Math.atan2(y,x)+(sway-.5)*.7, radial=44+weight*16, lateral=26+sway*10;
  return {ux:Math.cos(angle),uy:Math.sin(angle),radial,lateral,
    radialDamping:1.1*Math.sqrt(radial),lateralDamping:1.05*Math.sqrt(lateral)};
}

// SVG uses xMidYMid meet: account for BOTH dimensions and letterboxing.
export function clientToNetworkSvg(point, rect, box) {
  const scale = Math.max(.000001, Math.min(Math.max(1, rect.width) / box.width, Math.max(1, rect.height) / box.height));
  return {x: box.minX + (point.x - (rect.left || 0) - (rect.width - box.width * scale) / 2) / scale,
    y: box.minY + (point.y - (rect.top || 0) - (rect.height - box.height * scale) / 2) / scale};
}
export function networkWorldPoint(point, camera) {
  return {x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale};
}
export function zoomNetworkCamera(camera, factor, anchor) {
  if (!Number.isFinite(factor) || factor <= 0) return {...camera};
  const scale = motionClamp(camera.scale * factor, NETWORK_ZOOM.min, NETWORK_ZOOM.max), ratio = scale / camera.scale;
  return {x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio, scale};
}
export function networkWheelFactor(delta, mode = 0, height = 600) {
  if (!Number.isFinite(delta)) return 1;
  return Math.exp(-motionClamp(delta * (mode === 1 ? 16 : mode === 2 ? height : 1), -240, 240) * .0025);
}
export function fitNetworkCamera(nodes, box) {
  if (!nodes.length) return {x: 0, y: 0, scale: 1};
  let left=Infinity, right=-Infinity, top=Infinity, bottom=-Infinity;
  for (const n of nodes) {left=Math.min(left,n.x-120);right=Math.max(right,n.x+120);top=Math.min(top,n.y-60);bottom=Math.max(bottom,n.y+115);}
  const scale = motionClamp(Math.min(box.width / (right-left+80), box.height / (bottom-top+80), 1.6), NETWORK_ZOOM.min, NETWORK_ZOOM.max);
  return {scale, x: box.minX + box.width/2 - (left+right)/2*scale, y: box.minY + box.height/2 - (top+bottom)/2*scale};
}

export function createNetworkMotion(layout, previous = null) {
  const byKey = new Map(), hubs = new Map(layout.nodes.map(n=>[motionKey(n),n]));
  const topology = layout.nodes.map(n=>`${motionKey(n)}:${n.projectId}:${n.parentKey||''}`).sort().join('|');
  const sameTopology = previous?.topology === topology;
  const nodes = layout.nodes.map(n => {
    const old = previous?.byKey.get(motionKey(n)), hub = hubs.get(n.parentKey||(n.type==='task'?`project:${n.projectId}`:''));
    const keep = old && old.projectId === n.projectId;
    const copy = {...n, key:motionKey(n), x:keep?old.x:n.x, y:keep?old.y:n.y, vx:keep?old.vx:0, vy:keep?old.vy:0,
      originX:keep&&sameTopology?old.originX:n.x, originY:keep&&sameTopology?old.originY:n.y, anchorX:keep?old.anchorX:n.x, anchorY:keep?old.anchorY:n.y,
      offsetX:keep&&sameTopology?old.offsetX:n.x-(hub?.x||0), offsetY:keep&&sameTopology?old.offsetY:n.y-(hub?.y||0)};
    if(copy.type!=='project')copy.spring=taskSpringProfile(copy.key,copy.offsetX,copy.offsetY);
    byKey.set(motionKey(n),copy);return copy;
  });
  return {nodes, byKey, topology, edges:layout.edges, box:previous?.box?{...previous.box}:{minX:layout.minX,minY:layout.minY,width:layout.width,height:layout.height}, held:null,quietFor:0,resting:!!previous?.resting,
    bounds:previous?.bounds?{...previous.bounds}:{left:layout.minX-layout.width*3,right:layout.minX+layout.width*4,top:layout.minY-layout.height*3,bottom:layout.minY+layout.height*4}};
}

function separationDirection(a,b,dx,dy,distance) {
  if(distance>=.000001)return{x:dx/distance,y:dy/distance};
  let seed=2166136261;for(const c of a.key+'|'+b.key)seed=Math.imul(seed^c.charCodeAt(0),16777619);seed=Math.imul(seed^(seed>>>16),2246822507);
  const angle=(seed>>>0)/4294967296*Math.PI*2;return{x:Math.cos(angle),y:Math.sin(angle)};
}
function driftProjectAnchors(motion,dt) {
  // Move only the resting anchors, never the visible circles. This lets springs
  // ease projects apart without pulling them back into their original overlap.
  const projects=motion.nodes.filter(n=>n.type==='project'),drifts=projects.map(()=>({x:0,y:0}));
  const clearance=NETWORK_NODE_RADII.project*2+PROJECT_REST_GAP;
  for(let i=0;i<projects.length;i++)for(let j=i+1;j<projects.length;j++){
    const a=projects[i],b=projects[j],dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy),shortfall=clearance-distance;
    if(shortfall<=0)continue;
    const direction=separationDirection(a,b,dx,dy,distance),speed=6*shortfall*shortfall/(shortfall+8);
    const heldA=a.key===motion.held?.key,heldB=b.key===motion.held?.key;
    const shareA=heldA?0:heldB?1:.5,shareB=heldB?0:heldA?1:.5;
    drifts[i].x-=direction.x*speed*shareA;drifts[i].y-=direction.y*speed*shareA;
    drifts[j].x+=direction.x*speed*shareB;drifts[j].y+=direction.y*speed*shareB;
  }
  let maximumSpeed=0;
  projects.forEach((n,i)=>{
    const drift=drifts[i],speed=Math.hypot(drift.x,drift.y),gain=Math.min(1,160/Math.max(1,speed));
    const next=boundedMotionPoint(motion,{x:n.anchorX+drift.x*gain*dt,y:n.anchorY+drift.y*gain*dt});
    maximumSpeed=Math.max(maximumSpeed,Math.hypot(next.x-n.anchorX,next.y-n.anchorY)/dt);
    n.anchorX=next.x;n.anchorY=next.y;
  });
  return maximumSpeed;
}
function networkRepulsion(motion) {
  const cell=112,buckets=new Map(),forces=motion.nodes.map(()=>({x:0,y:0}));
  const cellKey=(x,y)=>x+','+y;
  motion.nodes.forEach((node,index)=>{const key=cellKey(Math.floor(node.x/cell),Math.floor(node.y/cell));if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(index);});
  motion.nodes.forEach((a,i)=>{
    const gx=Math.floor(a.x/cell),gy=Math.floor(a.y/cell);
    for(let x=gx-1;x<=gx+1;x++)for(let y=gy-1;y<=gy+1;y++)for(const j of buckets.get(cellKey(x,y))||[]){
      if(j<=i)continue;
      const b=motion.nodes[j],dx=b.x-a.x,dy=b.y-a.y,radii=NETWORK_NODE_RADII[a.type]+NETWORK_NODE_RADII[b.type],reach=radii+NETWORK_REPULSION_REACH,distance=Math.hypot(dx,dy);
      if(distance>=reach)continue;
      const {x:ux,y:uy}=separationDirection(a,b,dx,dy,distance);
      // Zero force and slope at the outer range; stronger but bounded near the
      // center. Task overlap remains allowed; project rest anchors ease apart.
      const proximity=1-distance/reach,strength=32*radii*proximity*proximity;
      forces[i].x-=ux*strength;forces[i].y-=uy*strength;forces[j].x+=ux*strength;forces[j].y+=uy*strength;
    }
  });
  for(const force of forces){const size=Math.hypot(force.x,force.y);if(size>2400){force.x*=2400/size;force.y*=2400/size;}}
  return forces;
}
function springAcceleration(motion,n){
  const target=motionTarget(motion,n),dx=target.x-n.x,dy=target.y-n.y;
  if(n.type==='project'||!n.parentKey&&n.type!=='task')return{x:48*dx-9*n.vx,y:48*dy-9*n.vy};
  const {ux,uy,radial,lateral,radialDamping,lateralDamping}=n.spring;
  const along=dx*ux+dy*uy,across=-dx*uy+dy*ux;
  const radialForce=radial*along-radialDamping*(n.vx*ux+n.vy*uy),lateralForce=lateral*across-lateralDamping*(-n.vx*uy+n.vy*ux);
  return{x:radialForce*ux-lateralForce*uy,y:radialForce*uy+lateralForce*ux};
}
function motionTarget(motion, node) {
  const hub = motion.byKey.get(node.parentKey||(node.type==='task'?`project:${node.projectId}`:''));
  return boundedMotionPoint(motion,hub ? {x:hub.x+node.offsetX,y:hub.y+node.offsetY} : {x:node.anchorX,y:node.anchorY});
}
function boundedMotionPoint(motion, point) {
  return {x:motionClamp(point.x,motion.bounds.left,motion.bounds.right),y:motionClamp(point.y,motion.bounds.top,motion.bounds.bottom)};
}
export function grabNetworkNode(motion, key) {
  const node=motion.byKey.get(key);if(!node||motion.held)return false;
  motion.quietFor=0;motion.held={key,anchorX:node.anchorX,anchorY:node.anchorY};node.vx=0;node.vy=0;return true;
}
export function dragNetworkNode(motion, point, reduced = false) {
  const node=motion.byKey.get(motion.held?.key);if(!node||!Number.isFinite(point.x)||!Number.isFinite(point.y))return;
  let next=boundedMotionPoint(motion,point);
  if(node.type!=='project'&&node.parentKey){
    const target=motionTarget(motion,node),dx=next.x-target.x,dy=next.y-target.y,d=Math.hypot(dx,dy);
    if(d>1000)next={x:target.x+dx/d*1000,y:target.y+dy/d*1000};
  }
  node.x=next.x;node.y=next.y;motion.quietFor=0;
  if(reduced)settleNetworkMotion(motion);
}
export function releaseNetworkNode(motion, velocity={x:0,y:0}, {cancel=false,reduced=false}={}) {
  const held=motion.held,node=motion.byKey.get(held?.key);if(!node)return;
  if(node.type==='project'||!motion.byKey.has(node.parentKey||(node.type==='task'?`project:${node.projectId}`:''))){
    node.anchorX=cancel?held.anchorX:node.x;node.anchorY=cancel?held.anchorY:node.y;
  }
  const valid=Number.isFinite(velocity.x)&&Number.isFinite(velocity.y);
  const speed=valid?Math.hypot(velocity.x,velocity.y):0, gain=cancel||reduced?0:Math.min(.28,260/Math.max(1,speed));
  node.vx=valid?velocity.x*gain:0;node.vy=valid?velocity.y*gain:0;motion.held=null;motion.quietFor=0;
  if(reduced)settleNetworkMotion(motion);
}
export function settleNetworkMotion(motion) {
  // Projects first, so tasks settle against the final hub coordinates.
  for(const type of ['project','feature','task','file'])for(const n of motion.nodes){
    if(n.type!==type||n.key===motion.held?.key)continue;
    const p=motionTarget(motion,n);n.x=p.x;n.y=p.y;n.vx=0;n.vy=0;
  }
  // Reduced-motion/explicit settle uses the same soft forces and project anchor
  // drift. Task tethers retain their offsets and may still overlap softly.
  for(let pass=0;pass<48;pass++){
    driftProjectAnchors(motion,.025);
    const forces=networkRepulsion(motion);
    for(let i=0;i<motion.nodes.length;i++){
      const n=motion.nodes[i];if(n.key===motion.held?.key)continue;
      const spring=springAcceleration(motion,n),next=boundedMotionPoint(motion,{x:n.x+motionClamp((spring.x+forces[i].x)*.0035,-4,4),y:n.y+motionClamp((spring.y+forces[i].y)*.0035,-4,4)});
      n.x=next.x;n.y=next.y;
    }
  }
  motion.quietFor=0;
}
export function resetNetworkMotion(motion) {
  motion.held=null;
  for(const n of motion.nodes){n.x=n.anchorX=n.originX;n.y=n.anchorY=n.originY;n.vx=n.vy=0;}
  for(const n of motion.nodes)if(n.type!=='project'){
    const hub=motion.byKey.get(n.parentKey||(n.type==='task'?`project:${n.projectId}`:''));if(hub){n.offsetX=n.originX-hub.originX;n.offsetY=n.originY-hub.originY;}
    n.spring=taskSpringProfile(n.key,n.offsetX,n.offsetY);
  }
  settleNetworkMotion(motion);
}
export function stepNetworkMotion(motion, seconds) {
  if(!Number.isFinite(seconds)||seconds<=0)return false;
  const elapsed=Math.min(seconds,.05),steps=Math.ceil(elapsed*120),dt=elapsed/steps;
  let maximumForce=0,maximumAnchorSpeed=0;
  for(let step=0;step<steps;step++){
    maximumAnchorSpeed=driftProjectAnchors(motion,dt);
    const forces=networkRepulsion(motion);maximumForce=0;
    for(let i=0;i<motion.nodes.length;i++){
      const n=motion.nodes[i];if(n.key===motion.held?.key)continue;
      const spring=springAcceleration(motion,n),ax=spring.x+forces[i].x,ay=spring.y+forces[i].y;
      n.vx+=ax*dt;n.vy+=ay*dt;
      const speed=Math.hypot(n.vx,n.vy);if(speed>1800){n.vx*=1800/speed;n.vy*=1800/speed;}
      const next=boundedMotionPoint(motion,{x:n.x+n.vx*dt,y:n.y+n.vy*dt});
      const blockedX=next.x===motion.bounds.left||next.x===motion.bounds.right,blockedY=next.y===motion.bounds.top||next.y===motion.bounds.bottom;
      if(blockedX)n.vx=0;if(blockedY)n.vy=0;
      maximumForce=Math.max(maximumForce,Math.hypot(blockedX?0:ax,blockedY?0:ay));n.x=next.x;n.y=next.y;
    }
  }
  // Project anchors retain the extra breathing room. Small circles may overlap
  // at equilibrium; neither type snaps back when the animation becomes idle.
  const moving=maximumAnchorSpeed>.05||maximumForce>.75||motion.nodes.some(n=>n.key!==motion.held?.key&&Math.hypot(n.vx,n.vy)>.15);
  motion.quietFor=moving?0:motion.quietFor+elapsed;
  if(motion.quietFor<.12)return true;
  for(const n of motion.nodes)if(n.key!==motion.held?.key){n.vx=0;n.vy=0;}
  return false;
}
