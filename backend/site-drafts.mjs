import { RelayError } from './core.mjs';

const fail = (code, message, status = 400) => { throw new RelayError(code, message, status); };
const MAX_PREVIEW_BYTES = 48 * 1024;
const ALLOWED_ARTIFACT_PATHS = new Set(['index.html']);

const samples = {
  'landing-page': {
    title: 'Launchpad landing page',
    digest: '56c87792cda54b3d236873c3beb4e23e71086e3a3fbfa694c14d1bc2be00229e',
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Launchpad — Landing page demo</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f7f8fc;color:#182137;font-family:Arial,sans-serif;font-size:16px;line-height:1.6}a{color:inherit;text-decoration:none}.wrap{max-width:1000px;margin:auto;padding:0 28px}.header{background:white;border-bottom:1px solid #e2e6ef}.nav{display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:76px}.brand{font-size:22px;font-weight:bold;color:#4255d4}.links{display:flex;gap:24px;font-size:14px}.hero{padding:80px 28px;text-align:center;background:#eef1ff;border-bottom:1px solid #dde2f7}.eyebrow{color:#5260b3;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase}h1{max-width:650px;margin:16px auto;font-size:48px;line-height:1.15;letter-spacing:-1.5px}.hero p{max-width:550px;margin:0 auto 28px;color:#606b80}.button{display:inline-block;padding:12px 22px;border-radius:7px;background:#4255d4;color:white;font-size:14px;font-weight:bold}.secondary{margin-left:10px;background:white;color:#4255d4;border:1px solid #cbd2f1}.features{padding-top:62px;padding-bottom:62px}h2{font-size:28px;line-height:1.2;margin:0 0 12px}.intro{color:#69758a;margin:0 0 28px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{padding:25px;background:white;border:1px solid #dfe4ee;border-radius:10px}.card h3{font-size:18px;margin:16px 0 8px}.card p{font-size:14px;color:#68758b;margin:0}.number{display:inline-block;padding:5px 10px;background:#eef1ff;color:#4255d4;border-radius:6px;font-weight:bold}.cta{padding:36px;background:#182137;border-radius:12px;color:white;display:flex;justify-content:space-between;align-items:center;gap:25px;margin-bottom:60px}.cta p{color:#b7c1d6;margin:0}.footer{border-top:1px solid #e0e5ef;padding:24px 0;color:#778297;font-size:12px}.footer .wrap{display:flex;justify-content:space-between;gap:20px}@media(max-width:650px){h1{font-size:35px}.hero{padding:55px 22px}.cards{grid-template-columns:1fr}.cta{flex-direction:column;align-items:flex-start}.links{gap:12px}.wrap{padding-left:20px;padding-right:20px}.cta{margin-left:20px;margin-right:20px}.secondary{margin:10px 0 0}.footer .wrap{flex-direction:column}}
</style></head><body>
<header class="header" id="top"><nav class="nav wrap" aria-label="Main navigation"><a class="brand" href="#top">Launchpad</a><div class="links"><a href="#features">Features</a><a href="#start">Get started</a></div></nav></header>
<main><section class="hero"><span class="eyebrow">A simple landing page</span><h1>A little less busywork.<br>A little more progress.</h1><p>Launchpad helps your team keep ideas, tasks, and next steps in one place. Start simple and make it your own.</p><div class="hero-actions"><a class="button" href="#start">Get started</a><a class="button secondary" href="#features">Explore features</a></div></section>
<section class="features wrap" id="features"><h2>Everything you need to get going.</h2><p class="intro">Three simple ways to keep your work moving.</p><div class="cards"><article class="card"><span class="number">01</span><h3>Capture your ideas</h3><p>Keep your notes and inspiration together, ready for the next step.</p></article><article class="card"><span class="number">02</span><h3>Make a clear plan</h3><p>Break big goals into small tasks so everyone knows what comes next.</p></article><article class="card"><span class="number">03</span><h3>Share your progress</h3><p>Give your team one place to see what is happening and what is done.</p></article></div></section>
<section class="cta wrap" id="start"><div><h2>Ready to make something?</h2><p>This is a demo. Select any section in the editor to try a change.</p></div><a class="button" href="#top">Back to the top</a></section></main>
<footer class="footer"><div class="wrap"><span>Launchpad · Demo landing page</span><span>Built for testing the Sites editor</span></div></footer></body></html>`,
  },
  'workspace-brief': {
    title: 'Workspace brief',
    digest: 'faf764b6194c1bff3e365008696b28766656431abcabb667db1dedc80d625cb1',
    html: `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"><style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#171614;color:#efece5;font:14px ui-sans-serif,system-ui,sans-serif}main{max-width:760px;margin:auto;padding:52px 34px}small{color:#aea69a;letter-spacing:.08em;text-transform:uppercase}h1{max-width:520px;margin:12px 0 12px;font-size:43px;line-height:1.02;letter-spacing:-.06em}p{max-width:590px;color:#c6beb3;line-height:1.65}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:32px}.card{min-height:116px;padding:14px;border:1px solid #494238;border-radius:7px;background:#201e1a}.card b{display:block;margin-bottom:8px;color:#e4c47f}@media(max-width:580px){main{padding:32px 20px}.grid{grid-template-columns:1fr}h1{font-size:34px}}</style><main><small>Local sample revision</small><h1>Make project decisions easier to follow.</h1><p>This inert preview represents a local planning artifact. It contains no project data, scripts, forms, network requests, or publishing path.</p><section class="grid"><article class="card"><b>Plan</b>Capture the decision before build work begins.</article><article class="card"><b>Review</b>Keep the human gate visible.</article><article class="card"><b>Trace</b>Link approved work back to the project.</article></section></main>`,
  },
  'review-ready': {
    title: 'Review-ready brief',
    digest: 'a954434d05ede4cbb7c62b8ce2f9d6a39052f768d480a9b71002f930f97d88e7',
    html: `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"><style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#171614;color:#efece5;font:14px ui-sans-serif,system-ui,sans-serif}main{max-width:780px;margin:auto;padding:48px 34px}small{color:#aea69a;letter-spacing:.08em;text-transform:uppercase}h1{max-width:570px;margin:12px 0 13px;font-size:42px;line-height:1.04;letter-spacing:-.06em}p{max-width:620px;color:#c6beb3;line-height:1.65}.review{display:grid;grid-template-columns:1.35fr 1fr;gap:10px;margin-top:30px}.card{padding:15px;border:1px solid #494238;border-radius:7px;background:#201e1a}.card b{display:block;margin-bottom:8px;color:#e4c47f}.state{display:inline-block;margin-top:10px;padding:4px 6px;border-radius:4px;background:#3d3020;color:#e7c986;font-size:11px}@media(max-width:580px){main{padding:32px 20px}.review{grid-template-columns:1fr}h1{font-size:34px}}</style><main><small>Local sample revision</small><h1>Review the work without losing the project context.</h1><p>This preview is an inert local sample for the publication-review flow. A review may be recorded here, but no publisher, URL, or external deployment exists.</p><section class="review"><article class="card"><b>Artifact review</b>Check the exact manifest and revision before approving a local-only record.<span class="state">Awaiting human review</span></article><article class="card"><b>Private by default</b>Audience and destination are explicit review fields, not inferred from a hidden URL.</article></section></main>`,
  },
};

export function normalizeSiteArtifactPath(path) {
  if (typeof path !== 'string' || path.length < 1 || path.length > 120) fail('INVALID_ARTIFACT_PATH', 'Artifact path must be a short relative allowlisted path.');
  if (path.includes('\\') || path.startsWith('/') || path.includes('\0') || path.split('/').includes('..') || !ALLOWED_ARTIFACT_PATHS.has(path)) fail('INVALID_ARTIFACT_PATH', 'Artifact path is outside the local draft allowlist.');
  return path;
}

export function siteSampleArtifact(sampleId = 'workspace-brief', revision = 1) {
  const sample = samples[sampleId];
  if (!sample) fail('UNKNOWN_SITE_SAMPLE', 'Choose a supported local sample revision.');
  if (!Number.isSafeInteger(revision) || revision < 1) fail('INVALID_ARTIFACT_REVISION', 'Artifact revision is invalid.');
  const path = normalizeSiteArtifactPath('index.html');
  const byteLength = new TextEncoder().encode(sample.html).byteLength;
  if (byteLength > MAX_PREVIEW_BYTES) fail('ARTIFACT_TOO_LARGE', 'Local preview artifact exceeds its size limit.', 413);
  return {
    mode: 'local-inert-sample',
    revision,
    sourceRevision: `local-sample/${sampleId}`,
    digest: sample.digest,
    manifest: { format: 'local-site-manifest/v1', files: [{ path, byteLength, sha256: sample.digest }] },
    previewHtml: sample.html,
    previewPolicy: 'sandboxed opaque-origin; CSP denies scripts, network, forms and external base URLs',
    label: sample.title,
  };
}

export function siteArtifactView(artifact, { includePreview = false } = {}) {
  if (!artifact) return null;
  return {
    mode: artifact.mode,
    revision: artifact.revision,
    sourceRevision: artifact.sourceRevision,
    digest: artifact.digest,
    manifest: structuredClone(artifact.manifest),
    previewPolicy: artifact.previewPolicy,
    label: artifact.label,
    ...(includePreview ? { previewHtml: artifact.previewHtml } : {}),
  };
}

export function siteDraftView(draft, { includePreview = false } = {}) {
  const { artifact, publishedArtifact, publishProposal, publishApproval, editRequests = [], ...rest } = draft;
  return {
    ...structuredClone(rest),
    artifact: siteArtifactView(artifact, { includePreview }),
    editRequests: structuredClone(editRequests),
    publishProposal: publishProposal ? structuredClone(publishProposal) : null,
    publishApproval: publishApproval ? structuredClone(publishApproval) : null,
    publisher: { mode: 'static-site', publicUrl: draft.publication ? `/published/${encodeURIComponent(draft.id)}/` : null },
  };
}

export function invalidateSiteReview(draft, now) {
  if (draft.publishProposal && ['awaiting_human_review', 'approved_local_only'].includes(draft.publishProposal.status)) {
    draft.publishProposal.status = 'invalidated';
    draft.publishProposal.invalidatedAt = now;
    draft.publishProposal.invalidatedReason = 'The local artifact revision or digest changed.';
  }
  draft.publishApproval = null;
}

export function makePublishProposal(draft, actor, now) {
  const artifact = draft.artifact;
  if (!artifact) fail('ARTIFACT_REQUIRED', 'Create a local sample revision before requesting review.', 409);
  const proposal = {
    id: crypto.randomUUID(),
    status: 'awaiting_human_review',
    createdAt: now,
    createdBy: actor,
    artifact: { revision: artifact.revision, sourceRevision: artifact.sourceRevision, digest: artifact.digest, manifest: structuredClone(artifact.manifest) },
    destination: { type: 'local-publisher', name: 'Externally disabled' },
    visibility: 'private',
    audience: 'owner-only',
    publisher: { mode: 'externally-disabled', outboundCalls: 0, publicUrl: null },
  };
  draft.publishProposal = proposal;
  draft.publishApproval = null;
  return proposal;
}

export function approvePublishProposal(draft, command, actor, now) {
  const proposal = draft.publishProposal, artifact = draft.artifact;
  if (!proposal || !artifact) fail('PUBLISH_REVIEW_REQUIRED', 'Request a current publication review first.', 409);
  if (command.proposalId !== proposal.id || command.artifactRevision !== artifact.revision || command.artifactDigest !== artifact.digest || proposal.artifact.revision !== artifact.revision || proposal.artifact.digest !== artifact.digest) fail('STALE_ARTIFACT', 'Artifact or review proposal changed. Refresh and review the current manifest.', 409);
  if (proposal.status !== 'awaiting_human_review') fail('PUBLISH_REVIEW_REQUIRED', 'Request a current publication review first.', 409);
  proposal.status = 'approved_local_only';
  proposal.approvedAt = now;
  proposal.approvedBy = actor;
  draft.publishApproval = { proposalId: proposal.id, revision: artifact.revision, digest: artifact.digest, at: now, actor };
  return proposal;
}

export const SITE_EDIT_ADAPTER_CONTRACT = Object.freeze({
  version: 'site-edit-request/v2',
  authority: 'site-revision',
  sourceAccess: 'Current site HTML and revision-bound element references in this job only.',
  output: 'Complete the claimed job with output, model, and optional siteHtml (a complete HTML/CSS document, at most 48 KiB). A new draft revision is saved; publishing remains a human action.',
  transport: 'authenticated adapter queue; static HTML/CSS artifacts, no server execution',
});

export async function generatedSiteArtifact(html,revision,model){
 if(typeof html!=='string'||!html.trim())fail('INVALID_SITE_HTML','Return a complete HTML document.');
 const bytes=new TextEncoder().encode(html);
 if(bytes.length>MAX_PREVIEW_BYTES)fail('ARTIFACT_TOO_LARGE','Site HTML must fit within 48 KiB.',413);
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
 return {mode:'generated-static-site',revision,sourceRevision:`agent/${model}`,digest,manifest:{format:'local-site-manifest/v1',files:[{path:'index.html',byteLength:bytes.length,sha256:digest}]},previewHtml:html,previewPolicy:'Static HTML/CSS; scripts and forms disabled',label:'Agent revision'};
}

export function siteElementReferences(value,artifact){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>8)fail('INVALID_SITE_SELECTION','Select up to eight elements.');
 return value.map(item=>{
  if(!item||item.artifactRevision!==artifact.revision||item.artifactDigest!==artifact.digest)fail('STALE_ARTIFACT','Selected elements belong to an older revision. Select them again.',409);
  const bounded=(v,max)=>typeof v==='string'?v.slice(0,max):'';
  if(typeof item.selector!=='string'||!item.selector.length||item.selector.length>1500)fail('INVALID_SITE_SELECTION','Element selector is missing or too long.');
  return {selector:item.selector,tag:bounded(item.tag,40),text:bounded(item.text,500),html:bounded(item.html,2500),artifactRevision:artifact.revision,artifactDigest:artifact.digest};
 });
}

export function siteDocumentResponse(html,{preview=false,head=false}={}){
 return new Response(head?null:html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`sandbox${preview?' allow-same-origin':''}; default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`}});
}
