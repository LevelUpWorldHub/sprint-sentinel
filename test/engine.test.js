import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validate } from '@forge/manifest';
import { buildDigestDocument } from '../src/lib/documents.js';
import { renderDigest } from '../src/lib/digest.js';
import { decideAndApply, runScan, writeDigest } from '../src/lib/engine.js';
import { readConnectionEvent } from '../src/lib/connection.js';
import { blockersFromLinks, normalizeProject } from '../src/lib/normalize.js';
import { buildOperations } from '../src/lib/plans.js';
import { approveProposal } from '../src/lib/proposals.js';
import { createMemoryStore } from '../src/lib/store.js';
import { readAssignedWork } from '../src/lib/graph.js';

const NOW = '2026-11-13T18:00:00.000Z';

function restIssue(overrides) {
  return {
    id: overrides.id || '100',
    key: overrides.key,
    fields: {
      summary: overrides.summary || overrides.key,
      status: { name: overrides.statusName || 'In Progress', statusCategory: { key: overrides.statusCategory || 'indeterminate' } },
      assignee: { accountId: overrides.assigneeAccountId || 'alice', displayName: overrides.assigneeName || 'Alice' },
      updated: overrides.updated || NOW,
      created: overrides.created || '2026-11-03T09:00:00.000Z',
      issuetype: { name: 'Story' },
      priority: { name: overrides.priority || 'Medium' },
      labels: [],
      issuelinks: overrides.links || [],
      customfield_10016: overrides.storyPoints ?? 3,
    },
  };
}

function runtime(overrides = {}) {
  const executed = [];
  const store = createMemoryStore(overrides.store);
  return {
    executed,
    deps: {
      store,
      env: overrides.env || {},
      fetchImpl: overrides.fetchImpl,
      jira: {
        async loadProject(projectKey) {
          if (overrides.loadError) throw new Error(overrides.loadError);
          return {
            projectKey,
            storyPointFieldId: 'customfield_10016',
            sprint: overrides.sprint || null,
            issues: overrides.issues || [],
          };
        },
        async execute(operation) {
          executed.push(operation);
          if (operation.op === 'create-subtask') return { ...operation, issueKey: 'PROJ-99', ok: true };
          return { ...operation, ok: true };
        },
      },
      graph: {
        async enrich() {
          if (overrides.graphError) throw new Error(overrides.graphError);
          return overrides.graph || { ok: false, skipped: true, assignees: {}, delivery: [] };
        },
      },
      confluence: {
        async upsertDailyPage({ title }) {
          return { id: '55', url: `https://levelup.atlassian.net/wiki/spaces/TEAM/pages/55/${title}` };
        },
      },
    },
  };
}

test('reads blockers from a Jira is-blocked-by link', () => {
  const blockers = blockersFromLinks([{
    type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
    inwardIssue: { key: 'PROJ-9', fields: { summary: 'API', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } } },
  }]);
  assert.equal(blockers[0].key, 'PROJ-9');
  const project = normalizeProject({
    projectKey: 'PROJ',
    storyPointFieldId: 'customfield_10016',
    issues: [restIssue({ key: 'PROJ-1', links: [{
      type: { name: 'Blocks', inward: 'is blocked by' },
      inwardIssue: { key: 'PROJ-9', fields: { summary: 'API', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } } },
    }] })],
  });
  assert.equal(project.issues[0].blockedBy[0].key, 'PROJ-9');
  assert.equal(project.issues[0].storyPoints, 3);
});

test('a failed Teamwork Graph call still returns Jira risks', async () => {
  const { deps } = runtime({
    graphError: 'Teamwork Graph is unavailable',
    issues: [restIssue({ key: 'PROJ-1', updated: '2026-11-01T00:00:00.000Z' })],
  });
  const result = await runScan({ projectKey: 'proj', deps, now: NOW, force: true });
  assert.equal(result.ok, true);
  assert.equal(result.explained.source, 'fallback');
  assert.equal(result.graph.error, 'Teamwork Graph is unavailable');
  assert.ok(result.risks.some((risk) => risk.type === 'stalled'));
  const status = await deps.store.getStatus();
  assert.equal(status.lastScanOk, true);
  assert.equal(status.graph.lastOk, false);
});

test('records a failed scan and keeps the error in the audit log', async () => {
  const { deps } = runtime({ loadError: 'Jira timed out' });
  const result = await runScan({ projectKey: 'PROJ', deps, now: NOW, force: true });
  assert.equal(result.ok, false);
  const audit = await deps.store.listAudit('PROJ');
  assert.equal(audit[0].outcome, 'error');
  assert.match(audit[0].detail, /timed out/);
});

test('refuses to build Jira operations until a proposal is approved', () => {
  assert.throws(() => buildOperations({ id: 'proposal:stalled:PROJ-1', status: 'pending', fix: { kind: 'comment', issueKey: 'PROJ-1' } }), /approved/);
  const approved = approveProposal({
    id: 'proposal:stalled:PROJ-1',
    status: 'pending',
    issueKey: 'PROJ-1',
    fix: { kind: 'comment', issueKey: 'PROJ-1', rationale: 'Ask for a status.' },
  }, 'user-1', NOW);
  const operations = buildOperations(approved);
  assert.equal(operations[0].op, 'comment');
  assert.match(operations[0].text, /Ask for a status/);
});

test('applies a fix only through the approval gate and records the actor', async () => {
  const { deps, executed } = runtime({
    issues: [restIssue({ key: 'PROJ-1', updated: '2026-11-01T00:00:00.000Z' })],
  });
  const scanned = await runScan({ projectKey: 'PROJ', deps, now: NOW, force: true });
  const proposal = scanned.proposals.find((item) => item.issueKey === 'PROJ-1' && item.status === 'pending');
  const denied = await decideAndApply({
    projectKey: 'PROJ', proposalId: proposal.id, decision: 'approve', actor: 'user-1', deps, now: NOW,
  });
  assert.equal(denied.ok, true);
  assert.equal(executed.length > 0, true);
  assert.equal(denied.proposal.status, 'applied');
  const again = await decideAndApply({
    projectKey: 'PROJ', proposalId: proposal.id, decision: 'approve', actor: 'user-1', deps, now: NOW,
  });
  assert.equal(again.ok, false);
  assert.match(again.error, /cannot be approved/);
  const stored = await deps.store.listProposals('PROJ');
  assert.equal(stored.find((item) => item.id === proposal.id).status, 'applied');
});

test('second check compares story points with the previous baseline', async () => {
  const first = runtime({ issues: [restIssue({ key: 'PROJ-2', storyPoints: 3, updated: NOW })] });
  await runScan({ projectKey: 'PROJ', deps: first.deps, now: '2026-11-12T18:00:00.000Z', force: true });
  first.deps.jira.loadProject = async (projectKey) => ({
    projectKey,
    storyPointFieldId: 'customfield_10016',
    sprint: null,
    issues: [restIssue({ key: 'PROJ-2', storyPoints: 8, updated: NOW })],
  });
  const second = await runScan({ projectKey: 'PROJ', deps: first.deps, now: NOW, force: true });
  assert.ok(second.risks.some((risk) => risk.id === 'scope_creep:PROJ-2'));
});

test('digest escapes issue text and skips publishing without a space', async () => {
  const rendered = renderDigest({
    now: NOW,
    projects: [{ projectKey: 'PROJ', risks: [{ type: 'blocked', severity: 'high', title: '<script>alert(1)</script>', explanation: 'wait' }] }],
    status: {},
  });
  assert.equal(rendered.storage.includes('<script>'), false);
  assert.match(rendered.storage, /&lt;script&gt;/);
  const { deps } = runtime();
  const skipped = await writeDigest({ deps, now: NOW, projectKeys: ['PROJ'] });
  assert.equal(skipped.ok, false);
  await deps.store.saveConfig({ ...(await deps.store.getConfig()), spaceKey: 'TEAM', projects: ['PROJ'] });
  const written = await writeDigest({ deps, now: NOW, projectKeys: ['PROJ'] });
  assert.equal(written.ok, true);
  assert.match(written.page.url, /levelup\.atlassian\.net/);
});

test('connection events and graph documents stay explicit', () => {
  assert.equal(readConnectionEvent({ body: { action: 'CREATED', connectionId: 'conn-1', name: 'Sprint Sentinel' } }).connectionId, 'conn-1');
  assert.throws(() => buildDigestDocument({ id: 'doc', title: 'Digest', text: 'hello', now: NOW }), /URL/);
  const document = buildDigestDocument({
    id: 'doc', title: 'Digest', text: 'hello', url: 'https://levelup.atlassian.net/wiki/pages/1', now: NOW,
  });
  assert.equal(document['atlassian:document'].type.category, 'DOCUMENT');
  assert.equal(document.permissions[0].accessControls[0].principals[0].type, 'ATLASSIAN_WORKSPACE');
  const assigned = readAssignedWork({
    data: { atlassianUserAssignedJiraWorkItems: { edges: [{ node: { title: 'Other project' } }, { node: { title: 'This one' } }] } },
  });
  assert.equal(assigned.assignedCount, 2);
});

test('the manifest passes the Forge schema and declares the bonus modules', async () => {
  const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
  for (const token of ['rovo:agent', 'rovo:mcp', 'graph:connector', 'jira:issuePanel', 'scheduledTrigger', 'api.x.ai']) {
    assert.equal(manifest.includes(token), true, token);
  }
  assert.equal(manifest.includes('XAI_API_KEY'), false);
  const result = await validate(false);
  assert.equal(result.success, true, (result.errors || []).map((error) => error.message).join('\n'));
});
