// A feature is a planning entity, separate from executable task records.
// Legacy tasks explicitly typed Feature are read-only adapters, never rewritten.
export function hierarchyInventory(s) {
 const projects=new Set(s.projects.map(p=>p.id)),tasks=new Map(s.tasks.map(t=>[t.id,t]));
 const features=(s.features||[]).filter(f=>projects.has(f.projectId)).map(f=>({...f,taskIds:(f.taskIds||[]).filter(id=>tasks.get(id)?.projectId===f.projectId),origin:'feature_mapping'}));
 const mapped=new Set(features.flatMap(f=>f.taskIds));
 for(const t of s.tasks)if(t.type==='Feature'&&!mapped.has(t.id))features.push({id:`task-feature:${t.id}`,projectId:t.projectId,name:t.title,description:t.description,version:t.version,origin:'feature_task',sourceTaskId:t.id,taskIds:[t.id,...s.tasks.filter(x=>x.featureId===t.id&&x.projectId===t.projectId).map(x=>x.id)],files:[],synthetic:!!t.synthetic});
 const files=new Map();
 for(const feature of features){
  const linked=feature.taskIds.map(id=>tasks.get(id));
  feature.status=linked.length?linked.every(t=>t.stage==='ready')?'ready':linked.some(t=>['build','human_review'].includes(t.stage))?'build':'planned':feature.status||'planned';
  feature.fileIds=[];
  const add=(mapping,source)=>{
   const path=typeof mapping?.path==='string'?mapping.path.trim():'';if(!path)return;
   const id=`file:${JSON.stringify([feature.projectId,path])}`;
   if(!files.has(id))files.set(id,{id,projectId:feature.projectId,path,name:path.split(/[\\/]/).at(-1)||path,status:'mapped',featureIds:[],sources:[],synthetic:!!feature.synthetic,contentAvailable:false});
   const file=files.get(id);if(!file.featureIds.includes(feature.id))file.featureIds.push(feature.id);
   file.sources.push({...source,featureId:feature.id,reason:mapping.reason||''});
   if(!feature.fileIds.includes(id))feature.fileIds.push(id);
  };
  for(const f of feature.files||[])add(f,{kind:'feature_mapping',version:feature.version});
  for(const t of linked)for(const f of t.plan?.files||[])add(f,{kind:'task_plan',taskId:t.id,planRevision:t.planRevision});
 }
 return {features,files:[...files.values()]};
}
