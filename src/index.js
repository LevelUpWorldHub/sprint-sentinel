import Resolver from '@forge/resolver';
import { readConnectionEvent } from './lib/connection.js';
import {
  decideAndApply,
  pendingFor,
  runScan,
  saveSettings,
  setWatch,
  writeDigest,
} from './lib/engine.js';
import {
  normalizeIssueKey,
  normalizeProjectKey,
  projectKeyFromIssueEvent,
  projectKeyFromIssueKey,
} from './lib/ids.js';
import { shouldRescan } from './lib/time.js';
import { createRuntime } from './runtime/deps.js';

const resolver = new Resolver();

function cloudIdFrom(context) {
  return context?.cloudId || context?.extension?.cloudId || null;
}

function projectFromContext(context, payload) {
  return normalizeProjectKey(payload?.projectKey)
    || normalizeProjectKey(payload?.context?.jira?.projectKey)
    || normalizeProjectKey(context?.extension?.project?.key)
    || projectKeyFromIssueKey(payload?.issueKey)
    || projectKeyFromIssueKey(payload?.context?.jira?.issueKey)
    || projectKeyFromIssueKey(context?.extension?.issue?.key);
}

function issueFromContext(context, payload) {
  return normalizeIssueKey(payload?.issueKey)
    || normalizeIssueKey(payload?.context?.jira?.issueKey)
    || normalizeIssueKey(context?.extension?.issue?.key);
}

function actorFrom(context) {
  return context?.accountId || 'user';
}

function riskSummary(risk) {
  return {
    id: risk.id,
    type: risk.type,
    severity: risk.severity,
    issueKey: risk.issueKey || null,
    title: risk.title,
    explanation: risk.explanation || '',
    fixSummary: risk.fixSummary || '',
    fix: risk.suggestedFix || null,
  };
}

function issueSlice(view, issueKey) {
  return {
    ...view,
    issueKey,
    risks: (view.risks || []).filter((risk) => risk.issueKey === issueKey || (risk.evidence?.issueKeys || []).includes(issueKey)),
    proposals: pendingFor(view.proposals, issueKey),
  };
}

async function buildProjectView(projectKey) {
  const runtime = await createRuntime();
  const config = await runtime.store.getConfig();
  const status = await runtime.store.getStatus();
  const snapshot = projectKey ? await runtime.store.getSnapshot(projectKey) : null;
  const proposals = projectKey ? await runtime.store.listProposals(projectKey) : [];
  const audit = projectKey ? await runtime.store.listAudit(projectKey) : [];
  return {
    projectKey,
    watched: Boolean(projectKey && (config.projects || []).includes(projectKey)),
    config: {
      spaceKey: config.spaceKey || '',
      thresholds: config.thresholds || {},
      projects: config.projects || [],
    },
    status,
    sprint: snapshot?.sprint || null,
    scannedAt: snapshot?.scannedAt || null,
    source: snapshot?.source || status?.grok?.lastSource || null,
    risks: snapshot?.risks || [],
    proposals: (proposals || []).filter((proposal) => proposal.status === 'pending' || proposal.status === 'failed'),
    audit: (audit || []).slice(0, 20),
    graph: snapshot?.graph || status?.graph || null,
  };
}

resolver.define('getProjectView', async ({ payload, context }) => {
  const projectKey = projectFromContext(context, payload);
  if (!projectKey) throw new Error('Open Sprint Sentinel from a Jira project.');
  return buildProjectView(projectKey);
});

resolver.define('getIssueView', async ({ payload, context }) => {
  const projectKey = projectFromContext(context, payload);
  const issueKey = issueFromContext(context, payload);
  if (!projectKey || !issueKey) throw new Error('Open an issue to see its delivery risks.');
  return issueSlice(await buildProjectView(projectKey), issueKey);
});

resolver.define('getConfluenceView', async () => {
  const runtime = await createRuntime();
  const config = await runtime.store.getConfig();
  const status = await runtime.store.getStatus();
  const projects = [];
  for (const projectKey of config.projects || []) {
    const snapshot = await runtime.store.getSnapshot(projectKey);
    projects.push({
      projectKey,
      scannedAt: snapshot?.scannedAt || null,
      openRisks: (snapshot?.risks || []).length,
    });
  }
  return {
    config: { spaceKey: config.spaceKey || '', projects: config.projects || [] },
    status,
    projects,
  };
});

resolver.define('scanNow', async ({ payload, context }) => {
  const projectKey = projectFromContext(context, payload);
  if (!projectKey) throw new Error('Choose a project before running a check.');
  const runtime = await createRuntime({ preferUser: true, cloudId: cloudIdFrom(context) });
  await setWatch({ store: runtime.store, projectKey, watch: true });
  const result = await runScan({ projectKey, deps: runtime, force: true });
  const view = await buildProjectView(projectKey);
  const issueKey = issueFromContext(context, payload);
  const body = issueKey ? issueSlice(view, issueKey) : view;
  return { ...body, scanError: result.ok ? null : result.error };
});

resolver.define('setWatch', async ({ payload, context }) => {
  const projectKey = projectFromContext(context, payload);
  if (!projectKey) throw new Error('Choose a project to watch.');
  const runtime = await createRuntime();
  await setWatch({ store: runtime.store, projectKey, watch: Boolean(payload?.watch) });
  return buildProjectView(projectKey);
});

resolver.define('saveSettings', async ({ payload, context }) => {
  const runtime = await createRuntime();
  await saveSettings({
    store: runtime.store,
    spaceKey: payload?.spaceKey,
    thresholds: {
      stalledInProgressDays: payload?.stalledInProgressDays,
      overloadIssueCount: payload?.overloadIssueCount,
    },
  });
  const projectKey = projectFromContext(context, payload);
  if (!projectKey) return { saved: true };
  return buildProjectView(projectKey);
});

resolver.define('decide', async ({ payload, context }) => {
  const projectKey = projectFromContext(context, payload);
  if (!projectKey || !payload?.proposalId) throw new Error('Choose a proposal to approve or dismiss.');
  const runtime = await createRuntime({ preferUser: true, cloudId: cloudIdFrom(context) });
  const result = await decideAndApply({
    projectKey,
    proposalId: payload.proposalId,
    decision: payload.decision,
    actor: actorFrom(context),
    deps: runtime,
  });
  const view = await buildProjectView(projectKey);
  const issueKey = issueFromContext(context, payload);
  const body = issueKey ? issueSlice(view, issueKey) : view;
  return { ...body, actionError: result.ok ? null : result.error };
});

resolver.define('writeDigest', async ({ payload, context }) => {
  const runtime = await createRuntime({ preferUser: true, cloudId: cloudIdFrom(context) });
  if (payload?.spaceKey) {
    await saveSettings({ store: runtime.store, spaceKey: payload.spaceKey });
  }
  const projectKey = projectFromContext(context, payload);
  const result = await writeDigest({
    deps: runtime,
    projectKeys: projectKey ? [projectKey] : undefined,
  });
  if (projectKey) {
    const view = await buildProjectView(projectKey);
    return { ...view, digestError: result.ok ? null : result.error };
  }
  const status = await runtime.store.getStatus();
  const config = await runtime.store.getConfig();
  return {
    status,
    config: { spaceKey: config.spaceKey || '', projects: config.projects || [] },
    projects: (config.projects || []).map((key) => ({ projectKey: key })),
    digestError: result.ok ? null : result.error,
  };
});

export const handler = resolver.getDefinitions();

export async function scheduledScan() {
  try {
    const runtime = await createRuntime();
    const config = await runtime.store.getConfig();
    if (!(config.projects || []).length) {
      await runtime.store.mergeStatus({
        lastScanAt: new Date().toISOString(),
        lastScanOk: true,
        lastError: null,
        idleReason: 'No projects are watched',
      });
      return;
    }
    for (const projectKey of config.projects) {
      await runScan({ projectKey, deps: runtime, force: true });
    }
  } catch (error) {
    console.error('scheduledScan failed', error);
  }
}

export async function scheduledDigest() {
  try {
    const runtime = await createRuntime();
    await writeDigest({ deps: runtime });
  } catch (error) {
    console.error('scheduledDigest failed', error);
  }
}

export async function onIssueEvent(event) {
  try {
    const projectKey = projectKeyFromIssueEvent(event);
    if (!projectKey) return;
    const runtime = await createRuntime({ cloudId: event?.context?.cloudId || event?.cloudId });
    const config = await runtime.store.getConfig();
    if (!(config.projects || []).includes(projectKey)) return;
    const snapshot = await runtime.store.getSnapshot(projectKey);
    const now = new Date().toISOString();
    if (snapshot?.scannedAt && !shouldRescan(snapshot.scannedAt, now)) {
      await runtime.store.appendAudit(projectKey, {
        at: now,
        actor: 'sentinel',
        action: 'scan',
        outcome: 'skipped',
        detail: 'Debounced after a recent check',
      });
      return;
    }
    await runScan({ projectKey, deps: runtime, force: true });
  } catch (error) {
    console.error('onIssueEvent failed', error);
  }
}

function requireConfirm(payload) {
  return payload?.confirm === true || payload?.confirm === 'true';
}

export async function actionScanProject(payload, context) {
  const projectKey = projectFromContext(context, payload);
  if (!projectKey) return { error: 'Provide a project key such as PROJ.' };
  const runtime = await createRuntime({ preferUser: true, cloudId: cloudIdFrom(context) });
  const result = await runScan({ projectKey, deps: runtime, force: true });
  if (!result.ok) return { error: result.error, projectKey };
  return {
    projectKey,
    source: result.explained?.source || 'fallback',
    model: result.explained?.model || null,
    risks: (result.risks || []).map(riskSummary),
    note: 'Nothing was changed. Ask the user to approve a proposal before calling approve-fix.',
  };
}

export async function actionExplainIssue(payload, context) {
  const issueKey = issueFromContext(context, payload);
  const projectKey = projectFromContext(context, payload) || projectKeyFromIssueKey(issueKey);
  if (!projectKey || !issueKey) return { error: 'Provide an issue key such as PROJ-1.' };
  const runtime = await createRuntime({ preferUser: true, cloudId: cloudIdFrom(context) });
  let snapshot = await runtime.store.getSnapshot(projectKey);
  if (!snapshot?.scannedAt || shouldRescan(snapshot.scannedAt, new Date().toISOString())) {
    const result = await runScan({ projectKey, deps: runtime, force: true });
    if (!result.ok) return { error: result.error };
    snapshot = await runtime.store.getSnapshot(projectKey);
  }
  const risks = (snapshot?.risks || []).filter((risk) => risk.issueKey === issueKey || (risk.evidence?.issueKeys || []).includes(issueKey));
  return {
    issueKey,
    source: snapshot?.source || 'fallback',
    risks: risks.map(riskSummary),
    clear: risks.length === 0,
  };
}

export async function actionListPending(payload, context) {
  const projectKey = projectFromContext(context, payload);
  if (!projectKey) return { error: 'Provide a project key such as PROJ.' };
  const runtime = await createRuntime();
  const proposals = await runtime.store.listProposals(projectKey);
  return {
    projectKey,
    proposals: pendingFor(proposals).map((proposal) => ({
      id: proposal.id,
      status: proposal.status,
      severity: proposal.severity,
      issueKey: proposal.issueKey,
      title: proposal.title,
      fixSummary: proposal.fixSummary,
      kind: proposal.fix?.kind,
    })),
  };
}

export async function actionProjectHealth(payload, context) {
  const projectKey = projectFromContext(context, payload);
  const runtime = await createRuntime();
  const status = await runtime.store.getStatus();
  const config = await runtime.store.getConfig();
  return {
    projectKey,
    watched: config.projects || [],
    spaceKey: config.spaceKey || '',
    grokConfigured: Boolean(process.env.XAI_API_KEY),
    model: process.env.XAI_MODEL || 'grok-4.7',
    status,
  };
}

export async function actionGraphContext(payload, context) {
  const projectKey = projectFromContext(context, payload);
  if (!projectKey) return { error: 'Provide a project key such as PROJ.' };
  const runtime = await createRuntime({ preferUser: true, cloudId: cloudIdFrom(context) });
  const snapshot = await runtime.store.getSnapshot(projectKey);
  if (!snapshot) return { projectKey, graph: null, note: 'Run a check before asking for Teamwork Graph context.' };
  return { projectKey, graph: snapshot.graph || null, source: snapshot.source };
}

export async function actionProposeFix(payload, context) {
  const projectKey = projectFromContext(context, payload);
  const riskId = payload?.riskId;
  if (!projectKey || !riskId) return { error: 'Provide a project key and a risk id from scan-project.' };
  const runtime = await createRuntime();
  const snapshot = await runtime.store.getSnapshot(projectKey);
  const risk = (snapshot?.risks || []).find((item) => item.id === riskId);
  if (!risk) return { error: `No current risk ${riskId}. Run scan-project again.` };
  const proposals = await runtime.store.listProposals(projectKey);
  const existing = proposals.find((proposal) => proposal.riskId === riskId && (proposal.status === 'pending' || proposal.status === 'failed'));
  return {
    proposed: true,
    applied: false,
    proposalId: existing?.id || `proposal:${risk.id}`,
    title: risk.title,
    fixSummary: risk.fixSummary,
    note: 'This did not change Jira. The user must approve it in the Sprint Sentinel panel or explicitly confirm approve-fix.',
  };
}

export async function actionApproveFix(payload, context) {
  if (!requireConfirm(payload)) {
    return { applied: false, error: 'Refused. Ask the user to approve this exact proposal, then call again with confirm true.' };
  }
  const projectKey = projectFromContext(context, payload);
  if (!projectKey || !payload?.proposalId) return { applied: false, error: 'Provide the project key and proposal id.' };
  const runtime = await createRuntime({ preferUser: true, cloudId: cloudIdFrom(context) });
  const result = await decideAndApply({
    projectKey,
    proposalId: payload.proposalId,
    decision: 'approve',
    actor: actorFrom(context),
    deps: runtime,
  });
  return {
    applied: Boolean(result.ok),
    error: result.error || null,
    proposal: result.proposal ? { id: result.proposal.id, status: result.proposal.status, issueKey: result.proposal.issueKey } : null,
  };
}

export async function actionDismissFix(payload, context) {
  if (!requireConfirm(payload)) {
    return { dismissed: false, error: 'Refused. Ask the user to dismiss this proposal, then call again with confirm true.' };
  }
  const projectKey = projectFromContext(context, payload);
  if (!projectKey || !payload?.proposalId) return { dismissed: false, error: 'Provide the project key and proposal id.' };
  const runtime = await createRuntime({ preferUser: true, cloudId: cloudIdFrom(context) });
  const result = await decideAndApply({
    projectKey,
    proposalId: payload.proposalId,
    decision: 'dismiss',
    actor: actorFrom(context),
    deps: runtime,
  });
  return { dismissed: Boolean(result.ok), error: result.error || null };
}

export async function actionWriteDigest(payload, context) {
  if (!requireConfirm(payload)) {
    return { written: false, error: 'Refused. Ask the user before publishing a Confluence page, then call again with confirm true.' };
  }
  const runtime = await createRuntime({ preferUser: true, cloudId: cloudIdFrom(context) });
  if (payload?.spaceKey) await saveSettings({ store: runtime.store, spaceKey: payload.spaceKey });
  const projectKey = projectFromContext(context, payload);
  const result = await writeDigest({ deps: runtime, projectKeys: projectKey ? [projectKey] : undefined });
  return { written: Boolean(result.ok), error: result.error || null, page: result.page || null };
}

export async function onConnectionChange(event) {
  const change = readConnectionEvent(event);
  const runtime = await createRuntime();
  if (change.action === 'DELETED') {
    await runtime.store.saveConnection(null);
    return { ok: true };
  }
  if (!change.connectionId) return { ok: true };
  await runtime.store.saveConnection({
    connectionId: change.connectionId,
    name: change.name,
    at: new Date().toISOString(),
  });
  try {
    const status = await runtime.store.getStatus();
    if (status?.digest?.url) {
      const connected = await createRuntime();
      await connected.graph.ingest({
        id: `sprint-sentinel-${String(status.digest.title || 'digest').slice(-10)}`,
        title: status.digest.title || 'Sprint Sentinel digest',
        text: status.digest.title || 'Sprint Sentinel is connected.',
        url: status.digest.url,
        now: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Teamwork Graph ingest failed', error);
  }
  return { ok: true };
}
