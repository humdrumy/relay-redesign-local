import { RelayError } from './core.mjs';
import { fetchLive } from './live.mjs';

const SOURCE = 'brain_dump';
const ID = /^[A-Za-z0-9]{15,18}$/;
const text = (value, max) => String(value ?? '').trim().slice(0, max);
const stamp = now => new Date(now).toISOString();

function cardsFromBoard(data) {
  if (!data || !Array.isArray(data.columns) || data.error) throw new RelayError('BRAIN_DUMP_UNAVAILABLE', 'SF Tooling did not return a Brain Dump board.', 502);
  const cards = data.columns.flatMap(column => Array.isArray(column.cards) ? column.cards : []);
  const unique = new Map();
  for (const card of cards) {
    if (!ID.test(String(card?.id || ''))) continue;
    unique.set(card.id, card);
  }
  return [...unique.values()];
}

function source(card, fetchedAt) {
  return { system: SOURCE, id: card.id, title: text(card.title, 160), description: text(card.descriptionFull || card.description, 12000),
    type: text(card.type, 80), status: text(card.status, 80), priority: text(card.priority, 80), cluster: text(card.cluster, 120),
    systemArea: text(card.systemArea, 120), owner: text(card.owner, 120), codePointers: Array.isArray(card.codePointers) ? card.codePointers.slice(0, 30) : [],
    latestEvidence: text(card.latestEvidence, 2000), fetchedAt };
}

function projectFor(card, projectByCluster) {
  const cluster = text(card.cluster, 120);
  if (cluster && projectByCluster.has(cluster)) return `brain-project:${projectByCluster.get(cluster).id}`;
  if (card.type === 'Project') return `brain-project:${card.id}`;
  return cluster ? `brain-cluster:${cluster.toLowerCase()}` : 'brain-inbox';
}

export function importBrainDump(state, cards, now = Date.now(), allCards = cards) {
  const next = structuredClone(state), at = stamp(now), byCluster = new Map();
  for (const card of allCards) if (card.type === 'Project' && card.cluster && !byCluster.has(card.cluster)) byCluster.set(card.cluster, card);
  const existing = new Map(next.tasks.filter(task => task.source?.system === SOURCE).map(task => [task.source.id, task]));
  const projects = new Map(next.projects.map(project => [project.id, project]));
  let created = 0, refreshed = 0, sourceChanged = 0, projectsCreated = 0;
  for (const card of cards) {
    const snapshot = source(card, at), projectId = projectFor(card, byCluster);
    if (!projects.has(projectId)) {
      const projectCard = projectId.startsWith('brain-project:') ? allCards.find(item => `brain-project:${item.id}` === projectId) : null;
      const name = projectCard?.title || (projectId === 'brain-inbox' ? 'Brain Dump inbox' : card.cluster);
      const project = { id: projectId, name: text(name, 160), description: text(projectCard?.descriptionFull || (projectId === 'brain-inbox' ? 'Requests without a cluster.' : `Brain Dump cluster: ${card.cluster}`), 5000),
        owner: null, ownershipFence: 0, ownershipVersion: 1, recoveryRequired: false, status: 'active', version: 1, createdAt: at,
        source: projectCard ? source(projectCard, at) : { system: SOURCE, cluster: text(card.cluster, 120), fetchedAt: at } };
      next.projects.push(project); projects.set(projectId, project); projectsCreated++;
    }
    const task = existing.get(card.id);
    if (task) {
      const prior = { ...task.source, fetchedAt: null }, incoming = { ...snapshot, fetchedAt: null };
      if (JSON.stringify(prior) !== JSON.stringify(incoming)) { task.sourceChanged = true; sourceChanged++; }
      task.source = snapshot;
      refreshed++;
      continue;
    }
    const project = projects.get(projectId);
    const item = { id: `RLY-BD-${card.id}`, title: snapshot.title || `Brain Dump ${card.id}`, description: snapshot.description,
      component: snapshot.systemArea || snapshot.cluster || 'Brain Dump', environment: 'Development', priority: ['Urgent','High','Normal','Low'].includes(snapshot.priority) ? snapshot.priority : 'Normal',
      projectId, type: card.type === 'Bug' ? 'Bug' : card.type === 'Question' ? 'Question' : card.type === 'Project' || card.type === 'Idea' || card.type === 'Spec' ? 'Feature' : 'Task',
      dependencies: [], featureId: null, featureGroup: snapshot.cluster, layer: '', stage: 'intake', version: 1, scopeRevision: 1, planRevision: 0, buildRevision: 0,
      plan: null, planApproval: null, evidence: null, review: null, finalApproval: null, owner: project.owner, builder: null, fence: 0, lease: null, blocker: null,
      readReceipts: [], createdAt: at, updatedAt: at, synthetic: false, source: snapshot, sourceChanged: false };
    next.tasks.push(item); existing.set(card.id, item); created++;
  }
  next.events.push({ id: crypto.randomUUID(), actor: 'human', kind: 'brain_dump_sync', summary: `Brain Dump sync: ${created} tasks imported, ${refreshed} refreshed, ${projectsCreated} projects added.`, at });
  next.meta.revision++;
  return { state: next, result: { created, refreshed, sourceChanged, projectsCreated, total: cards.length, fetchedAt: at } };
}

export async function syncBrainDump(store, env, fetcher = fetch) {
  const board = await fetchLive(env, 'board', null, new URLSearchParams({ view: 'recent', limit: '500' }), fetcher);
  if (board.data?.meta?.truncated) throw new RelayError('BRAIN_DUMP_TRUNCATED', 'Brain Dump has more than 500 requests; sync needs pagination before it can claim completeness.', 409);
  const cards = cardsFromBoard(board.data);
  const total = { created: 0, refreshed: 0, sourceChanged: 0, projectsCreated: 0, total: cards.length, fetchedAt: null };
  for (let offset = 0; offset < cards.length; offset += 75) {
    let saved = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await store.read(), { state, result } = importBrainDump(before, cards.slice(offset, offset + 75), Date.now(), cards);
      if (await store.save(before, state)) {
        for (const key of ['created', 'refreshed', 'sourceChanged', 'projectsCreated']) total[key] += result[key];
        total.fetchedAt = result.fetchedAt;
        saved = true;
        break;
      }
    }
    if (!saved) throw new RelayError('BUSY', 'Brain Dump sync was interrupted. Retry to complete it without duplicates.', 409);
  }
  return total;
}

// The UI may have several tabs open. Keep automatic imports at most once per
// interval for the workspace, with a short lease while Salesforce is fetched.
export async function refreshBrainDumpIfStale(store, env, fetcher = fetch, {now = () => Date.now(), sync = syncBrainDump} = {}) {
  const token = crypto.randomUUID(), started = now();
  const acquired = await store.mutate(next => {
    const settings = next.settings[0];
    if (started - (settings.brainDumpSyncedAt || 0) < 10 * 60_000) return null;
    if ((settings.brainDumpSyncUntil || 0) > started || (settings.brainDumpRetryAfter || 0) > started) return null;
    settings.brainDumpSyncToken = token;
    settings.brainDumpSyncUntil = started + 5 * 60_000;
    return true;
  });
  if (!acquired) return {skipped: true};
  try {
    const result = await sync(store, env, fetcher);
    await store.mutate(next => {
      const settings = next.settings[0];
      if (settings.brainDumpSyncToken !== token) return null;
      settings.brainDumpSyncedAt = now();
      settings.brainDumpSyncUntil = 0;
      settings.brainDumpSyncToken = null;
      settings.brainDumpRetryAfter = 0;
      return true;
    });
    return result;
  } catch (error) {
    await store.mutate(next => {
      const settings = next.settings[0];
      if (settings.brainDumpSyncToken !== token) return null;
      settings.brainDumpSyncUntil = 0;
      settings.brainDumpSyncToken = null;
      settings.brainDumpRetryAfter = now() + 60_000;
      return true;
    });
    throw error;
  }
}
