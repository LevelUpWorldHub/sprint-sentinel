import { baselinesFromSnapshot, normalizeProject } from './normalize.js';
import { applyGraphSignals, detectRisks } from './risks.js';
import { explainRisks } from './grok.js';
import { approveProposal, dismissProposal, syncProposals } from './proposals.js';
import { buildOperations } from './plans.js';
import { renderDigest } from './digest.js';
import { sanitizeThresholds } from './thresholds.js';
import { normalizeProjectKey, normalizeSpaceKey, requireProjectKey } from './ids.js';
import { shouldRescan } from './time.js';

function allowedAccountIds(snapshot, risks) {
  const ids = new Set();
  for (const issue of snapshot?.issues || []) {
    if (issue.assigneeAccountId) ids.add(issue.assigneeAccountId);
  }
  for (const risk of risks) {
    if (risk.suggestedFix?.accountId) ids.add(risk.suggestedFix.accountId);
    if (risk.assigneeAccountId) ids.add(risk.assigneeAccountId);
  }
  return [...ids];
}

export async function runScan({ projectKey, deps, now = new Date().toISOString(), force = false }) {
  const key = requireProjectKey(projectKey);
  const started = Date.now();
  const config = await deps.store.getConfig();
  const thresholds = sanitizeThresholds({ ...config.thresholds, ...deps.thresholds });
  const previous = await deps.store.getSnapshot(key);
  if (!force && previous?.scannedAt && !shouldRescan(previous.scannedAt, now, deps.debounceMs)) {
    return { ok: true, skipped: true, reason: 'debounced', snapshot: previous };
  }
  try {
    const raw = await deps.jira.loadProject(key);
    if (raw?.storyPointFieldId && raw.storyPointFieldId !== config.storyPointFieldId) {
      config.storyPointFieldId = raw.storyPointFieldId;
      await deps.store.saveConfig(config);
    }
    const snapshot = normalizeProject(raw);
    const baselines = await deps.store.getBaselines(key);
    let risks = detectRisks(snapshot, { now, thresholds, baselines });
    let graph = { ok: false, skipped: true, reason: 'Teamwork Graph was not called' };
    if (deps.graph?.enrich) {
      try {
        graph = await deps.graph.enrich(snapshot, { overloadCount: thresholds.graphOverloadCount });
        risks = applyGraphSignals(risks, snapshot, graph);
      } catch (error) {
        graph = { ok: false, error: error.message, assignees: {}, delivery: [] };
      }
    }
    const explained = await explainRisks({
      risks,
      context: {
        projectKey: key,
        sprint: snapshot.sprint,
        allowedAccountIds: allowedAccountIds(snapshot, risks),
      },
      env: deps.env || {},
      fetchImpl: deps.fetchImpl,
      now,
      timeoutMs: deps.grokTimeoutMs,
      retries: deps.grokRetries,
    });
    const proposals = syncProposals(
      await deps.store.listProposals(key),
      risks,
      explained.explanations,
      now,
    );
    const byRisk = new Map(explained.explanations.map((item) => [item.riskId, item]));
    const storedRisks = risks.map((risk) => ({
      ...risk,
      explanation: byRisk.get(risk.id)?.explanation || '',
      fixSummary: byRisk.get(risk.id)?.fixSummary || '',
    }));
    await deps.store.saveProposals(key, proposals);
    await deps.store.saveBaselines(key, baselinesFromSnapshot(snapshot));
    const record = {
      projectKey: key,
      scannedAt: now,
      source: explained.source,
      model: explained.model,
      sprint: snapshot.sprint,
      risks: storedRisks,
      graph: { ok: graph.ok, error: graph.error || null, errors: graph.errors || [] },
    };
    await deps.store.saveSnapshot(key, record);
    const status = await deps.store.mergeStatus({
      lastScanAt: now,
      lastScanOk: true,
      lastError: null,
      lastDurationMs: Date.now() - started,
      lastProjectKey: key,
      grok: {
        configured: Boolean(deps.env?.XAI_API_KEY),
        lastSource: explained.source,
        lastModel: explained.model,
        lastError: explained.error || null,
      },
      graph: { lastOk: Boolean(graph.ok), lastError: graph.error || graph.errors?.[0] || null },
      openRisks: risks.length,
      pendingApprovals: proposals.filter((proposal) => proposal.status === 'pending').length,
    });
    await deps.store.appendAudit(key, {
      at: now,
      actor: 'sentinel',
      action: 'scan',
      outcome: 'ok',
      detail: `${risks.length} risks via ${explained.source}`,
    });
    return { ok: true, risks: storedRisks, proposals, explained, graph, snapshot, status };
  } catch (error) {
    await deps.store.mergeStatus({
      lastScanAt: now,
      lastScanOk: false,
      lastError: error.message,
      lastDurationMs: Date.now() - started,
      lastProjectKey: key,
    });
    await deps.store.appendAudit(key, {
      at: now,
      actor: 'sentinel',
      action: 'scan',
      outcome: 'error',
      detail: error.message,
    });
    return { ok: false, error: error.message };
  }
}

export async function decideAndApply({ projectKey, proposalId, decision, actor = 'user', deps, now = new Date().toISOString() }) {
  const key = requireProjectKey(projectKey);
  const proposals = await deps.store.listProposals(key);
  const current = proposals.find((proposal) => proposal.id === proposalId);
  if (!current) return { ok: false, error: 'That proposal is not on this project.' };
  try {
    if (decision === 'dismiss') {
      const updated = dismissProposal(current, actor, now);
      await deps.store.putProposal(key, updated);
      await deps.store.appendAudit(key, {
        at: now, actor, action: 'dismiss', outcome: 'ok', proposalId, issueKey: updated.issueKey, detail: updated.title,
      });
      return { ok: true, proposal: updated };
    }
    if (decision !== 'approve') return { ok: false, error: 'Choose approve or dismiss.' };
    const approved = approveProposal(current, actor, now);
    const operations = buildOperations(approved);
    const results = [];
    for (const operation of operations) {
      results.push(await deps.jira.execute(operation));
    }
    const applied = { ...approved, status: 'applied', appliedAt: now, results };
    await deps.store.putProposal(key, applied);
    await deps.store.appendAudit(key, {
      at: now,
      actor,
      action: 'apply',
      outcome: 'ok',
      proposalId,
      issueKey: applied.issueKey,
      detail: `${applied.fix?.kind || 'fix'} on ${applied.issueKey}`,
    });
    return { ok: true, proposal: applied, results };
  } catch (error) {
    const alreadyDecided = current && (current.status === 'applied' || current.status === 'dismissed');
    if (decision !== 'approve' || alreadyDecided) {
      await deps.store.appendAudit(key, {
        at: now, actor, action: decision === 'dismiss' ? 'dismiss' : 'apply', outcome: 'error', proposalId, detail: error.message,
      });
      return { ok: false, error: error.message };
    }
    const failed = { ...current, status: 'failed', lastError: error.message, updatedAt: now };
    await deps.store.putProposal(key, failed);
    await deps.store.appendAudit(key, {
      at: now, actor, action: 'apply', outcome: 'error', proposalId, detail: error.message,
    });
    return { ok: false, error: error.message, proposal: failed };
  }
}

export async function writeDigest({ deps, now = new Date().toISOString(), projectKeys }) {
  const config = await deps.store.getConfig();
  const keys = (projectKeys && projectKeys.length ? projectKeys : config.projects).map(normalizeProjectKey).filter(Boolean);
  if (!config.spaceKey) {
    const status = await deps.store.mergeStatus({
      digest: { lastAt: now, lastError: 'Set a Confluence space key before writing the digest.', lastPageId: null },
    });
    return { ok: false, error: status.digest.lastError, status };
  }
  const projects = [];
  for (const projectKey of keys) {
    const snapshot = await deps.store.getSnapshot(projectKey);
    projects.push({
      projectKey,
      sprint: snapshot?.sprint || null,
      risks: snapshot?.risks || [],
    });
  }
  const status = await deps.store.getStatus();
  const rendered = renderDigest({ projects, now, status });
  try {
    const page = await deps.confluence.upsertDailyPage({
      spaceKey: config.spaceKey,
      title: rendered.title,
      storage: rendered.storage,
    });
    let graphIngest = { ok: false, skipped: true };
    if (deps.graph?.ingest && page?.url) {
      try {
        graphIngest = await deps.graph.ingest({
          id: `sprint-sentinel-${rendered.title.slice(-10)}`,
          title: rendered.title,
          text: rendered.text,
          url: page.url,
          now,
        });
      } catch (error) {
        graphIngest = { ok: false, error: error.message };
      }
    }
    const next = await deps.store.mergeStatus({
      digest: {
        lastAt: now,
        lastError: graphIngest.error || null,
        lastPageId: page.id,
        title: rendered.title,
        url: page.url,
        graphIngest,
      },
    });
    for (const projectKey of keys) {
      await deps.store.appendAudit(projectKey, {
        at: now,
        actor: 'sentinel',
        action: 'digest',
        outcome: 'ok',
        detail: page.url || rendered.title,
      });
    }
    return { ok: true, page, graphIngest, status: next, rendered };
  } catch (error) {
    const next = await deps.store.mergeStatus({
      digest: { lastAt: now, lastError: error.message },
    });
    return { ok: false, error: error.message, status: next };
  }
}

export async function setWatch({ store, projectKey, watch }) {
  const key = requireProjectKey(projectKey);
  const config = await store.getConfig();
  const projects = new Set(config.projects || []);
  if (watch) projects.add(key);
  else projects.delete(key);
  return store.saveConfig({ ...config, projects: [...projects] });
}

export async function saveSettings({ store, spaceKey, thresholds, siteUrl }) {
  const config = await store.getConfig();
  return store.saveConfig({
    ...config,
    spaceKey: normalizeSpaceKey(spaceKey ?? config.spaceKey),
    thresholds: sanitizeThresholds({ ...config.thresholds, ...(thresholds || {}) }),
    siteUrl: siteUrl || config.siteUrl || '',
  });
}

export function pendingFor(proposals, issueKey) {
  return (proposals || []).filter((proposal) => {
    if (proposal.status !== 'pending' && proposal.status !== 'failed') return false;
    if (!issueKey) return true;
    return proposal.issueKey === issueKey || (proposal.fix?.blockerKeys || []).includes(issueKey);
  });
}
