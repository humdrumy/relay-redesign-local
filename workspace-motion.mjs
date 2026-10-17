import * as THREE from 'three';

// A purely decorative layer: no text, no hit targets, and no ownership of focus or scrolling.
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let renderer, scene, camera, frame = 0, focusMesh, focusTarget = null;
let width = innerWidth, height = innerHeight, activityUntil = 0;
const clock = () => performance.now();
const select = '.issue-row,.task-card,.editor-tab,.nav,.agent-row,.site-draft-row,.dock-dot';
function updateMotionLabel(text) {document.querySelectorAll('.motion-status').forEach(el=>el.textContent=text);}
function start(){
 if(reduce.matches){updateMotionLabel('Reduced motion');return;}
 try{
  renderer = new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(width,height);
  renderer.setClearColor(0,0);renderer.domElement.className='ide-depth-canvas';renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.setAttribute('role','presentation');document.body.append(renderer.domElement);
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,width/height,1,6000);resize();
  const plane=new THREE.PlaneGeometry(1,1);
  const shader=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,uniforms:{uTime:{value:0},uAlpha:{value:0},uAspect:{value:1},uColor:{value:new THREE.Color('#85b1ff')}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 vUv; uniform float uTime; uniform float uAlpha; uniform float uAspect; uniform vec3 uColor; void main(){float border=1.-smoothstep(0.,.045,min(vUv.y,1.-vUv.y));float beam=exp(-pow((vUv.x-fract(uTime*.32))*5.,2.));float shine=exp(-pow((vUv.x-fract(uTime*.32))*16.,2.))*.11;gl_FragColor=vec4(uColor,(border*beam*.48+shine)*uAlpha);}' });
  focusMesh=new THREE.Mesh(plane,shader);focusMesh.visible=false;scene.add(focusMesh);
  window.addEventListener('resize',resize,{passive:true});
  document.addEventListener('pointermove',event=>{const next=event.target.closest?.(select);if(next!==focusTarget){focusTarget=next;activityUntil=clock()+1100;}if(next)wake();},{passive:true});
  document.addEventListener('focusin',event=>{focusTarget=event.target.closest?.(select);activityUntil=clock()+1300;wake();});
  document.addEventListener('pointerleave',()=>{focusTarget=null;activityUntil=clock()+300;wake();});
  const app=document.querySelector('#app');
  new MutationObserver(syncSurface).observe(app,{childList:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else wake();});
  reduce.addEventListener('change',()=>{renderer.domElement.hidden=reduce.matches;if(reduce.matches){cancelAnimationFrame(frame);frame=0;renderer.clear();updateMotionLabel('Reduced motion');}else syncSurface();});
  syncSurface();
 }catch{document.documentElement.classList.add('webgl-unavailable');renderer?.dispose();renderer?.domElement.remove();updateMotionLabel('Standard motion');}
}
function resize(){if(!renderer)return;width=innerWidth;height=innerHeight;camera.aspect=width/height;camera.position.z=height/(2*Math.tan(THREE.MathUtils.degToRad(38)/2));camera.updateProjectionMatrix();renderer.setSize(width,height);activityUntil=clock()+400;wake();}
function position(object,rect,z=0){object.position.set(rect.left+rect.width/2-width/2,height/2-rect.top-rect.height/2,z);}
function syncSurface(){updateMotionLabel(reduce.matches?'Reduced motion':renderer?'Hover light':'Standard motion');focusTarget=null;if(focusMesh)focusMesh.visible=false;renderer?.clear();}
function wake(){if(!frame&&renderer&&!reduce.matches&&!document.hidden)frame=requestAnimationFrame(draw);}
function draw(now){frame=0;if(!renderer||reduce.matches)return;
 if(focusTarget?.isConnected&&now<activityUntil){const r=focusTarget.getBoundingClientRect();position(focusMesh,r);focusMesh.scale.set(r.width,r.height,1);focusMesh.visible=true;focusMesh.material.uniforms.uAlpha.value=Math.min(.55,(activityUntil-now)/500);focusMesh.material.uniforms.uTime.value=now/1000;}else focusMesh.visible=false;
 renderer.render(scene,camera);if(now<activityUntil)wake();else{renderer.clear();focusMesh.visible=false;}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
