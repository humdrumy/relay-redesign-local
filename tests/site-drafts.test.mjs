import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openSqlite } from '../backend/sqlite-local.mjs';
import { applyMigrations } from '../backend/migrations-local.mjs';
import { ControlStore, controlPrincipal, controlProjection } from '../backend/control.mjs';
import { createHandler } from '../backend/http.mjs';
import { normalizeSiteArtifactPath, siteSampleArtifact } from '../backend/site-drafts.mjs';

const human = { kind: 'human', subject: 'owner' };
const identity = actor => actor === 'human' ? human : { kind: 'agent', actor, subject: `fixture:${actor}` };
const rejected = (promise, code) => assert.rejects(promise, error => error.code === code);

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-site-drafts-'));
  const db = openSqlite(join(dir, 'relay.sqlite'));
  await applyMigrations(db);
  let now = 1900000000000;
  const store = new ControlStore(db, { now: () => now });
  await store.bootstrap(human);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const run = async (actor, command) => {
    const state = await store.read();
    const draft = state.siteDrafts.find(item => item.id === command.draftId);
    const project = state.projects.find(item => item.id === (command.projectId || draft?.projectId));
    return store.command(identity(actor), {
      command: { ...command, ...(project ? { projectFence: project.ownershipFence } : {}) },
      operationId: crypto.randomUUID(),
      epoch: state.meta.epoch,
      ...(['claim_project', 'reassign_project', 'complete_project', 'reopen_project'].includes(command.type) ? { expectedProjectVersion: project?.version } : {}),
    });
  };
  return { store, run, db, now: () => now, advance: ms => { now += ms; } };
}

test('site draft editor records only allowlisted local samples and a bounded adapter request', async t => {
  const f = await fixture(t);
  await f.run('forge', { type: 'claim_project', projectId: 'relay' });
  const created = await f.run('human', { type: 'create_site_draft', projectId: 'relay', title: 'Workspace site', references: [{ type: 'project', id: 'relay' }] });
  let state = await f.store.read();
  let draft = state.siteDrafts.find(item => item.id === created.result.siteDraftId);
  assert.equal(draft.artifact.mode, 'local-inert-sample');
  assert.equal(draft.artifact.manifest.files[0].path, 'index.html');
  assert.equal(draft.artifact.previewHtml.includes('<script'), false);
  const agentView = controlProjection(state, controlPrincipal(state, identity('forge')), f.now(), ['forge']);
  assert.equal(agentView.siteDrafts[0].artifact.previewHtml, undefined);
  await rejected(f.run('forge', { type: 'request_site_edit', draftId: draft.id, request: 'Try to change it', artifactRevision: draft.artifact.revision, artifactDigest: draft.artifact.digest }), 'FORBIDDEN');
  const request = await f.run('human', { type: 'request_site_edit', draftId: draft.id, request: 'Make the review state easier to scan.', artifactRevision: draft.artifact.revision, artifactDigest: draft.artifact.digest });
  state = await f.store.read();
  const job = state.jobs.find(item => item.id === request.result.jobId);
  assert.equal(job.type, 'site_edit_request');
  assert.equal(job.input.authority, 'site-revision');
  assert.equal(job.input.artifact.digest, draft.artifact.digest);
  assert.equal(job.input.siteHtml, draft.artifact.previewHtml);
  assert.equal(state.messages.at(-1).kind, 'site_edit_request');
});

test('publication review is human-only, revision-bound, and cannot publish', async t => {
  const f = await fixture(t);
  const created = await f.run('human', { type: 'create_site_draft', projectId: 'relay', title: 'Review record', references: [{ type: 'project', id: 'relay' }] });
  let state = await f.store.read();
  let draft = state.siteDrafts.find(item => item.id === created.result.siteDraftId);
  const firstArtifact = structuredClone(draft.artifact);
  const proposalResult = await f.run('human', { type: 'request_site_publish_review', draftId: draft.id, artifactRevision: firstArtifact.revision, artifactDigest: firstArtifact.digest });
  state = await f.store.read(); draft = state.siteDrafts.find(item => item.id === created.result.siteDraftId);
  const proposal = structuredClone(draft.publishProposal);
  await rejected(f.run('forge', { type: 'approve_site_publish_review', draftId: draft.id, proposalId: proposal.id, artifactRevision: firstArtifact.revision, artifactDigest: firstArtifact.digest }), 'FORBIDDEN');
  await f.run('human', { type: 'apply_site_sample_revision', draftId: draft.id, sampleId: 'review-ready', artifactRevision: firstArtifact.revision, artifactDigest: firstArtifact.digest });
  await rejected(f.run('human', { type: 'approve_site_publish_review', draftId: draft.id, proposalId: proposal.id, artifactRevision: firstArtifact.revision, artifactDigest: firstArtifact.digest }), 'STALE_ARTIFACT');
  state = await f.store.read(); draft = state.siteDrafts.find(item => item.id === created.result.siteDraftId);
  const refreshed = await f.run('human', { type: 'request_site_publish_review', draftId: draft.id, artifactRevision: draft.artifact.revision, artifactDigest: draft.artifact.digest });
  state = await f.store.read(); draft = state.siteDrafts.find(item => item.id === created.result.siteDraftId);
  await f.run('human', { type: 'approve_site_publish_review', draftId: draft.id, proposalId: refreshed.result.proposalId, artifactRevision: draft.artifact.revision, artifactDigest: draft.artifact.digest });
  state = await f.store.read(); draft = state.siteDrafts.find(item => item.id === created.result.siteDraftId);
  assert.equal(draft.publishProposal.status, 'approved_local_only');
  assert.equal(draft.publishProposal.publisher.outboundCalls, 0);
  assert.equal(draft.publishProposal.publisher.publicUrl, null);
  assert.equal(draft.status, 'draft');
});

test('artifact paths are strict and sample digests match their inert contents', async () => {
  assert.equal(normalizeSiteArtifactPath('index.html'), 'index.html');
  for (const unsafe of ['../.env', '/index.html', 'assets/app.js', 'index.html.map', 'dir\\index.html']) assert.throws(() => normalizeSiteArtifactPath(unsafe), error => error.code === 'INVALID_ARTIFACT_PATH');
  for (const id of ['workspace-brief', 'review-ready', 'landing-page']) {
    const artifact = siteSampleArtifact(id);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(artifact.previewHtml));
    const digest = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    assert.equal(digest, artifact.digest);
    assert.ok(artifact.manifest.files[0].byteLength <= 48 * 1024);
  }
});


test('site edits retain element context, save revisions, isolate chat and publish an explicit snapshot',async t=>{
 const f=await fixture(t);
 await f.run('forge',{type:'claim_project',projectId:'relay'});
 const created=await f.run('human',{type:'create_site_draft',projectId:'relay',title:'My site',references:[{type:"project",id:"relay"}]});
 let draft=(await f.store.read()).siteDrafts.find(d=>d.id===created.result.siteDraftId);
 const original=draft.artifact;
 const element={selector:'body > main',tag:'main',text:'Heading',html:'<main>Heading</main>',artifactRevision:original.revision,artifactDigest:original.digest};
 await rejected(f.run('human',{type:'request_site_edit',draftId:draft.id,request:'Update',artifactRevision:original.revision,artifactDigest:original.digest,elements:[{...element,artifactDigest:'old'}]}),'STALE_ARTIFACT');
 const queued=await f.run('human',{type:'request_site_edit',draftId:draft.id,request:'Update this section',artifactRevision:original.revision,artifactDigest:original.digest,elements:[element]});
 const jobId=queued.result.jobId;
 assert.deepEqual((await f.store.read()).jobs.find(j=>j.id===jobId).input.elements,[element]);
 const claimed=await f.run('forge',{type:'claim_ai',jobId,projectId:'relay'});
 await f.run('forge',{type:'complete_ai',jobId,projectId:'relay',fence:claimed.result.fence,output:'Updated the section.',model:'fixture',siteHtml:'<!doctype html><main><h1>Updated heading</h1></main>'});
 let state=await f.store.read();draft=state.siteDrafts.find(d=>d.id===draft.id);
 assert.equal(draft.artifact.revision,2);assert.equal(draft.publication,undefined);
 assert.equal(state.messages.at(-1).siteDraftId,draft.id);
 const handle=createHandler({authenticate:()=>null});
 const url=`https://relay.test/published/${draft.id}/`;
 assert.equal((await handle(new Request(url),{DB:f.db})).status,404);
 await rejected(f.run('forge',{type:'publish_site',draftId:draft.id,artifactRevision:2,artifactDigest:draft.artifact.digest}),'FORBIDDEN');
 await rejected(f.run('human',{type:'publish_site',draftId:draft.id,artifactRevision:1,artifactDigest:original.digest}),'STALE_ARTIFACT');
 await f.run('human',{type:'publish_site',draftId:draft.id,artifactRevision:2,artifactDigest:draft.artifact.digest});
 let response=await handle(new Request(url),{DB:f.db});assert.equal(response.status,200);assert.match(await response.text(),/Updated heading/);assert.match(response.headers.get('content-security-policy'),/script-src 'none'/);
 await f.run('human',{type:'apply_site_sample_revision',draftId:draft.id,sampleId:'review-ready',artifactRevision:2,artifactDigest:draft.artifact.digest});
 response=await handle(new Request(url),{DB:f.db});assert.match(await response.text(),/Updated heading/);
 const authenticated=createHandler({authenticate:()=> 'owner'});
 response=await authenticated(new Request(`https://relay.test/api/control/site-preview?id=${draft.id}`),{DB:f.db});assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/sandbox allow-same-origin/);assert.match(await response.text(),/Review the work/);
 await f.run('human',{type:'unpublish_site',draftId:draft.id});assert.equal((await handle(new Request(url),{DB:f.db})).status,404);
});

test('agent completion cannot overwrite a newer site revision',async t=>{
 const f=await fixture(t);await f.run('forge',{type:'claim_project',projectId:'relay'});
 const created=await f.run('human',{type:'create_site_draft',projectId:'relay',title:'Race',references:[{type:"project",id:"relay"}]});
 const d=(await f.store.read()).siteDrafts.find(d=>d.id===created.result.siteDraftId),version={artifactRevision:d.artifact.revision,artifactDigest:d.artifact.digest};
 const queued=await f.run('human',{type:'request_site_edit',draftId:d.id,request:'Change heading',...version});
 const claimed=await f.run('forge',{type:'claim_ai',projectId:'relay',jobId:queued.result.jobId});
 await f.run('human',{type:'apply_site_sample_revision',draftId:d.id,sampleId:'review-ready',...version});
 await rejected(f.run('forge',{type:'complete_ai',projectId:'relay',jobId:queued.result.jobId,fence:claimed.result.fence,output:'Done',model:'fixture',siteHtml:'<h1>Stale</h1>'}),'STALE_ARTIFACT');
 assert.equal((await f.store.read()).siteDrafts.find(x=>x.id===d.id).artifact.revision,2);
});
