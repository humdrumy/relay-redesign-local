import { hierarchyInventory } from './hierarchy.mjs';
// Stable references contain identifiers only. All descriptive context is resolved
// against current records and the current principal at read time.
const lookup=(s,type,id,inventory)=>(type==='project'?s.projects:type==='task'?s.tasks:type==='feature'?(inventory||hierarchyInventory(s)).features:type==='file'?(inventory||hierarchyInventory(s)).files:[]).find(x=>x.id===id);
const projectId=(s,ref,inventory)=>ref.type==='project'?ref.id:lookup(s,ref.type,ref.id,inventory)?.projectId;
const allowed=(s,p,ref,inventory)=>{const value=lookup(s,ref.type,ref.id,inventory),project=s.projects.find(x=>x.id===projectId(s,ref,inventory));return !!value&&!!project&&(!p.agent||(project.owner===p.actor&&!project.recoveryRequired));};
const nodeId=ref=>`${ref.type}:${ref.id}`;
export function relationshipId(type,from,to){return `${type}:${encodeURIComponent(from)}:${encodeURIComponent(to)}`;}
export function networkRelationships(s,inventory=hierarchyInventory(s)){
 const records=s.relationships||[],out=[],byId=new Map(records.map(r=>[r.id,r]));
 const add=(type,from,to)=>{const id=relationshipId(type,nodeId(from),nodeId(to)),saved=byId.get(id);out.push({id,type,from,to,name:saved?.name||'',rationale:saved?.rationale||'',impact:saved?.impact||'',version:saved?.version||0,updatedAt:saved?.updatedAt||null});};
 for(const t of s.tasks){if(lookup(s,'project',t.projectId))add('membership',{type:'project',id:t.projectId},{type:'task',id:t.id});for(const id of t.dependencies||[])if(lookup(s,'task',id))add('dependency',{type:'task',id},{type:'task',id:t.id});if(t.featureId&&lookup(s,'task',t.featureId))add('feature',{type:'task',id:t.featureId},{type:'task',id:t.id});}
 for(const f of inventory.features){add('project_feature',{type:'project',id:f.projectId},{type:'feature',id:f.id});for(const id of f.fileIds)add('feature_file',{type:'feature',id:f.id},{type:'file',id});}
 const taskFeatures=new Map();for(const f of inventory.features)for(const id of f.taskIds){if(!taskFeatures.has(id))taskFeatures.set(id,[]);taskFeatures.get(id).push(f.id);}
 const projected=new Map();
 for(const t of s.tasks)for(const prerequisite of t.dependencies||[])for(const fromId of taskFeatures.get(prerequisite)||[])for(const toId of taskFeatures.get(t.id)||[]){
  if(fromId===toId)continue;const from={type:'feature',id:fromId},to={type:'feature',id:toId},id=relationshipId('mapped_dependency',nodeId(from),nodeId(to));
  if(!projected.has(id)){add('mapped_dependency',from,to);const relation=out.at(-1);relation.sourceTaskLinks=[];projected.set(id,relation);}
  projected.get(id).sourceTaskLinks.push({prerequisiteTaskId:prerequisite,dependentTaskId:t.id});
 }
 for(const r of records)if(r.type==='shared'&&!r.deletedAt&&lookup(s,r.from.type,r.from.id,inventory)&&lookup(s,r.to.type,r.to.id,inventory))out.push({...r});
 return out;
}
export function describeRelationship(s,r,inventory=hierarchyInventory(s)){
 const name=ref=>{const v=lookup(s,ref.type,ref.id,inventory);return v?.title||v?.name||'Unavailable';},from=name(r.from),to=name(r.to);
 const summary=r.type==='dependency'?`${from} is a prerequisite for ${to}.`:r.type==='mapped_dependency'?`A task linked to ${to} depends on a task linked to ${from}.`:r.type==='membership'?`${to} belongs to ${from}.`:r.type==='feature'?`${to} is part of the ${from} feature.`:r.type==='project_feature'?`${to} is an aspect of ${from}.`:r.type==='feature_file'?`${to} is a recorded file mapping for ${from}.`:`${from} and ${to} share ${r.name||'a component'}.`;
 const structuralImpact=r.type==='mapped_dependency'?'Projection of recorded task prerequisites. Only those specific tasks carry execution gates; the feature mapping itself grants no approval.':r.type==='dependency'?`Building ${to} requires current final approval of ${from}. Changes to that prerequisite revoke dependent approvals.`:r.type==='membership'?`The owner of ${from} manages ${to} through its approval stages.`:r.type==='feature'?'This records feature membership; build prerequisites are separate dependency links.':r.type==='project_feature'?'Planning hierarchy only. Linked tasks retain their own approval and dependency rules.':r.type==='feature_file'?'A path recorded in a feature mapping or linked task plan. This does not verify file existence, contents, imports, or runtime dependencies.':'This records shared work; it does not create a build prerequisite.';
 return {...r,from:{...r.from,label:from},to:{...r.to,label:to},summary,structuralImpact,rationaleRecorded:!!r.rationale};
}
export function networkGraph(s,p){
 const inventory=hierarchyInventory(s);
 const nodes=[...inventory.features.map(v=>({type:'feature',id:v.id,label:v.name,status:v.status,projectId:v.projectId,parentKey:`project:${v.projectId}`,synthetic:!!v.synthetic})),...inventory.files.map(v=>({type:'file',id:v.id,label:v.name,path:v.path,status:v.status,projectId:v.projectId,featureIds:v.featureIds,parentKey:`feature:${v.featureIds[0]}`,synthetic:!!v.synthetic})),...s.projects.map(v=>({type:'project',id:v.id,label:v.name,status:v.status,projectId:v.id,synthetic:false})),...s.tasks.map(v=>({type:'task',id:v.id,label:v.title,status:v.stage,projectId:v.projectId,synthetic:!!v.synthetic}))].filter(ref=>allowed(s,p,ref,inventory));
 const edges=networkRelationships(s,inventory).filter(r=>allowed(s,p,r.from,inventory)&&allowed(s,p,r.to,inventory)).map(r=>describeRelationship(s,r,inventory));
 return {schema:'relay-network-v2',nodes,edges,features:inventory.features.filter(f=>allowed(s,p,{type:'feature',id:f.id},inventory)),files:inventory.files.filter(f=>allowed(s,p,{type:'file',id:f.id},inventory))};
}
export function normalizeReferences(value=[]){
 if(!Array.isArray(value)||value.length>8)throw new Error('Use at most eight references.');
 const out=[];for(const ref of value){if(!ref||!['project','task','feature','file','relationship'].includes(ref.type)||typeof ref.id!=='string'||!ref.id||ref.id.length>8192)throw new Error('Use a reference type and stable ID.');if(!out.some(x=>x.type===ref.type&&x.id===ref.id))out.push({type:ref.type,id:ref.id});}return out;
}
const clip=(v,max=6000)=>typeof v==='string'?v.slice(0,max):'';
export function resolveReferences(s,p,references=[]){
 const inventory=hierarchyInventory(s);
 return references.map(ref=>{
  const missing={type:ref.type,id:ref.id,status:'unavailable',label:'Unavailable reference',reason:'Deleted, removed, or not accessible with your current permissions.'};
  if(ref.type==='relationship'){const r=networkRelationships(s,inventory).find(r=>r.id===ref.id);if(!r||!allowed(s,p,r.from,inventory)||!allowed(s,p,r.to,inventory))return missing;const current=describeRelationship(s,r,inventory);return {...ref,status:'available',label:r.name||`${current.from.label} → ${current.to.label}`,entity:current};}
  if(!allowed(s,p,ref,inventory))return missing;const v=lookup(s,ref.type,ref.id,inventory),project=lookup(s,'project',projectId(s,ref,inventory));
  if(ref.type==='project')return {...ref,status:'available',label:v.name,entity:{id:v.id,name:v.name,description:v.description,status:v.status,owner:v.owner,version:v.version,taskIds:s.tasks.filter(t=>t.projectId===v.id).map(t=>t.id)}};
  if(ref.type==='feature'||ref.type==='file')return {...ref,status:'available',label:ref.type==='file'?v.path:v.name,entity:{...v,project:{id:project.id,name:project.name},contextNote:ref.type==='file'?'Recorded path only. Repository contents have not been fetched or verified.':'Planning feature. Linked tasks preserve their own execution and approval state.'}};
  return {...ref,status:'available',label:v.title,entity:{id:v.id,title:v.title,description:clip(v.description),project:{id:project.id,name:project.name},status:v.stage,owner:project.owner,version:v.version,blocker:v.blocker,synthetic:!!v.synthetic,plan:v.plan?{revision:v.planRevision,research:clip(v.plan.research),steps:clip(v.plan.steps),acceptance:clip(v.plan.acceptance),files:v.plan.files?.slice(0,20),approved:!!v.planApproval}:null,evidence:v.evidence?{revision:v.buildRevision,sourceRevision:v.evidence.revision,summary:clip(v.evidence.summary),tests:{passed:v.evidence.tests.passed,failed:v.evidence.tests.failed},artifacts:v.evidence.artifacts?.slice(0,20)}:null,contextNote:'Long fields may be truncated to 6000 characters; files and artifacts to 20. Read the authorized task for full records.'}};
 });
}
