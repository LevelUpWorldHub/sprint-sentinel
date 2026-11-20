import assert from 'node:assert/strict';
import test from 'node:test';
import { decideAndApply, runScan, saveSettings } from '../src/lib/engine.js';
import { blockersFromLinks, normalizeIssue, readStoryPoints } from '../src/lib/normalize.js';
import { createMemoryStore } from '../src/lib/store.js';
import { DEFAULT_THRESHOLDS, sanitizeThresholds } from '../src/lib/thresholds.js';

const NOW = '2026-11-13T18:00:00.000Z';

function issue(key, extra = {}) {
  return {
    id: '100',
    key,
    fields: {
      summary: key,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { accountId: 'alice', displayName: 'Alice' },
      updated: '2026-11-01T00:00:00.000Z',
      created: '2026-11-03T09:00:00.000Z',
      issuetype: { name: 'Story' },
      priority: { name: 'Medium' },
      labels: [],
      issuelinks: [],
      customfield_10016: 3,
      ...extra,
    },
  };
}

function harness({ delayMs = 15, failOn = null } = {}) {
  const executed = [];
  let failures = failOn ? 1 : 0;
  const store = createMemoryStore();
  const deps = {
    store,
    env: {},
    jira: {
      async loadProject(projectKey) {
        return { projectKey, storyPointFieldId: 'customfield_10016', sprint: null, issues: [issue('PROJ-1')] };
      },
      async execute(operation) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (failures > 0 && operation.op === failOn) {
          failures -= 1;
          throw new Error(`Jira refused ${operation.op}`);
        }
        executed.push(operation);
        return { ...operation, ok: true };
      },
      async publishDigest() { return { id: 'page-1' }; },
    },
  };
  return { deps, executed, store };
}

async function pendingProposal(deps) {
  const scanned = await runScan({ projectKey: 'PROJ', deps, now: NOW, force: true });
  const proposal = scanned.proposals.find((item) => item.issueKey === 'PROJ-1' && item.status === 'pending');
  assert.ok(proposal, 'scan should propose a fix for PROJ-1');
  return proposal;
}

test('five concurrent approvals write to Jira exactly once', async () => {
  const { deps, executed } = harness();
  const proposal = await pendingProposal(deps);
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      decideAndApply({ projectKey: 'PROJ', proposalId: proposal.id, decision: 'approve', actor: 'u', deps, now: NOW }),
    ),
  );
  const applied = results.filter((result) => result.ok);
  assert.equal(applied.length, 1);
  assert.equal(results.filter((result) => result.busy).length, 4);
  const opsPerApply = applied[0].results.length;
  assert.equal(executed.length, opsPerApply);
  const again = await decideAndApply({ projectKey: 'PROJ', proposalId: proposal.id, decision: 'approve', actor: 'u', deps, now: NOW });
  assert.equal(again.ok, false);
  assert.equal(executed.length, opsPerApply);
  const stored = await deps.store.listProposals('PROJ');
  assert.equal(stored.find((item) => item.id === proposal.id).status, 'applied');
});

test('approve racing dismiss leaves one decision', async () => {
  const { deps, executed } = harness();
  const proposal = await pendingProposal(deps);
  const [approve, dismiss] = await Promise.all([
    decideAndApply({ projectKey: 'PROJ', proposalId: proposal.id, decision: 'approve', actor: 'u', deps, now: NOW }),
    decideAndApply({ projectKey: 'PROJ', proposalId: proposal.id, decision: 'dismiss', actor: 'u', deps, now: NOW }),
  ]);
  assert.equal(approve.ok, true);
  assert.equal(dismiss.busy, true);
  assert.ok(executed.length > 0);
});

test('the lock is released after a decision and after a failure', async () => {
  const { deps } = harness({ failOn: 'comment' });
  const proposal = await pendingProposal(deps);
  const first = await decideAndApply({ projectKey: 'PROJ', proposalId: proposal.id, decision: 'approve', actor: 'u', deps, now: NOW });
  assert.equal(first.ok, false);
  assert.equal(first.proposal.status, 'failed');
  const retry = await decideAndApply({ projectKey: 'PROJ', proposalId: proposal.id, decision: 'approve', actor: 'u', deps, now: NOW });
  assert.equal(retry.busy, undefined);
  assert.equal(retry.ok, true);
});

test('a retry after a partial failure does not repeat writes that landed', async () => {
  const { deps, executed } = harness({ failOn: 'comment' });
  // A reassign is two writes: assign, then comment. The comment fails the first time.
  const proposal = {
    id: 'p-reassign',
    status: 'pending',
    issueKey: 'PROJ-1',
    title: 'Reassign PROJ-1',
    fix: { kind: 'reassign', issueKey: 'PROJ-1', accountId: 'bob', rationale: 'Bob has room.' },
  };
  await deps.store.putProposal('PROJ', proposal);
  const first = await decideAndApply({ projectKey: 'PROJ', proposalId: proposal.id, decision: 'approve', actor: 'u', deps, now: NOW });
  assert.equal(first.ok, false);
  const landed = executed.map((operation) => operation.op);
  assert.ok(landed.length >= 1, 'the first attempt should land at least one write before failing');
  const retry = await decideAndApply({ projectKey: 'PROJ', proposalId: proposal.id, decision: 'approve', actor: 'u', deps, now: NOW });
  assert.equal(retry.ok, true);
  const ops = executed.map((operation) => JSON.stringify(operation));
  assert.equal(new Set(ops).size, ops.length, `no Jira write ran twice: ${ops.join(' | ')}`);
  assert.deepEqual(landed, ['assign']);
  assert.deepEqual(executed.map((operation) => operation.op), ['assign', 'comment']);
  assert.equal(retry.proposal.completedOps, undefined);
});

test('an expired lock from a crashed run does not block forever', async () => {
  const store = createMemoryStore();
  assert.equal(await store.acquireLock('x', 120, 0), true);
  assert.equal(await store.acquireLock('x', 120, 1_000), false);
  assert.equal(await store.acquireLock('x', 120, 121_000), true);
});

test('blank settings fall back to defaults instead of the minimum', async () => {
  for (const blank of ['', '   ', null, undefined, 'abc', Number.NaN]) {
    const next = sanitizeThresholds({ stalledInProgressDays: blank, overloadIssueCount: blank });
    assert.equal(next.stalledInProgressDays, DEFAULT_THRESHOLDS.stalledInProgressDays, String(blank));
    assert.equal(next.overloadIssueCount, DEFAULT_THRESHOLDS.overloadIssueCount, String(blank));
  }
  assert.equal(sanitizeThresholds({ stalledInProgressDays: '0' }).stalledInProgressDays, 1);
  assert.equal(sanitizeThresholds({ stalledInProgressDays: ' 7 ' }).stalledInProgressDays, 7);
  assert.equal(sanitizeThresholds({ overloadIssueCount: 99 }).overloadIssueCount, 40);

  const store = createMemoryStore({ config: { thresholds: { stalledInProgressDays: 6, overloadIssueCount: 12 } } });
  const kept = await saveSettings({ store, spaceKey: 'ENG', thresholds: { stalledInProgressDays: undefined, overloadIssueCount: 10 } });
  assert.equal(kept.thresholds.stalledInProgressDays, 6);
  assert.equal(kept.thresholds.overloadIssueCount, 10);
  const reset = await saveSettings({ store, spaceKey: 'ENG', thresholds: { stalledInProgressDays: '', overloadIssueCount: '' } });
  assert.equal(reset.thresholds.stalledInProgressDays, DEFAULT_THRESHOLDS.stalledInProgressDays);
  assert.equal(reset.thresholds.overloadIssueCount, DEFAULT_THRESHOLDS.overloadIssueCount);
});

test('null or malformed issue links do not crash', () => {
  for (const links of [null, undefined, 'x', 5, {}, [null, 5, 'x', { type: null }]]) {
    assert.deepEqual(blockersFromLinks(links), []);
  }
  const normalized = normalizeIssue(issue('PROJ-7', { issuelinks: null }));
  assert.deepEqual(normalized.blockedBy, []);
});

test('story points outside 0 to 1000 are treated as unestimated', () => {
  for (const bad of [-1, -0.5, 1001, 1e9, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.equal(readStoryPoints({ customfield_10016: bad }), null, String(bad));
    assert.equal(readStoryPoints({ customfield_10016: { value: bad } }), null, String(bad));
  }
  assert.equal(readStoryPoints({ customfield_10016: { value: null } }), null);
  assert.equal(readStoryPoints({ customfield_10016: { value: '' } }), null);
  assert.equal(readStoryPoints({ customfield_10016: 0 }), 0);
  assert.equal(readStoryPoints({ customfield_10016: 13 }), 13);
  assert.equal(readStoryPoints({ customfield_10016: 1000 }), 1000);
  assert.equal(readStoryPoints(null), null);
  const title = JSON.stringify(normalizeIssue(issue('PROJ-8', { customfield_10016: 1e308 })));
  assert.doesNotMatch(title, /Infinity|1e\+308/);
});
