import assert from 'node:assert/strict';
import test from 'node:test';
import { detectRisks } from '../src/lib/risks.js';

const NOW = '2026-11-13T18:00:00.000Z';

function issue(overrides) {
  return {
    id: overrides.key,
    key: overrides.key,
    summary: overrides.summary || overrides.key,
    statusName: overrides.statusName || 'In Progress',
    statusCategory: overrides.statusCategory || 'indeterminate',
    assigneeAccountId: overrides.assigneeAccountId || 'alice',
    assigneeName: overrides.assigneeName || 'Alice',
    updated: overrides.updated || NOW,
    created: overrides.created || '2026-11-03T09:00:00.000Z',
    storyPoints: overrides.storyPoints ?? 3,
    priority: overrides.priority || 'Medium',
    blockedBy: overrides.blockedBy || [],
  };
}

const sprint = {
  id: 7,
  name: 'Sprint 12',
  goal: 'Ship the billing export',
  state: 'active',
  startDate: '2026-11-03T09:00:00.000Z',
  endDate: '2026-11-17T09:00:00.000Z',
};

test('flags a stalled in-progress issue and suggests a lighter assignee', () => {
  const risks = detectRisks({
    projectKey: 'PROJ',
    sprint,
    issues: [
      issue({ key: 'PROJ-1', updated: '2026-11-08T18:00:00.000Z', storyPoints: 5, assigneeAccountId: 'alice', assigneeName: 'Alice' }),
      issue({ key: 'PROJ-2', storyPoints: 8, assigneeAccountId: 'alice', assigneeName: 'Alice' }),
      issue({ key: 'PROJ-3', storyPoints: 8, assigneeAccountId: 'alice', assigneeName: 'Alice' }),
      issue({ key: 'PROJ-4', storyPoints: 2, assigneeAccountId: 'bob', assigneeName: 'Bob' }),
      issue({ key: 'PROJ-5', statusCategory: 'done', statusName: 'Done', storyPoints: 2, assigneeAccountId: 'bob', assigneeName: 'Bob' }),
    ],
  }, { now: NOW });
  const stalled = risks.find((risk) => risk.id === 'stalled:PROJ-1');
  assert.ok(stalled);
  assert.equal(stalled.suggestedFix.kind, 'reassign');
  assert.equal(stalled.suggestedFix.accountId, 'bob');
  assert.equal(risks.some((risk) => risk.id === 'stalled:PROJ-2'), false);
});

test('ignores a blocker that is already done and flags an open one', () => {
  const risks = detectRisks({
    projectKey: 'PROJ',
    sprint,
    issues: [
      issue({
        key: 'PROJ-3',
        statusCategory: 'new',
        statusName: 'To Do',
        updated: NOW,
        blockedBy: [{ key: 'PROJ-9', statusName: 'In Progress', statusCategory: 'indeterminate', summary: 'API' }],
      }),
      issue({
        key: 'PROJ-6',
        blockedBy: [{ key: 'PROJ-8', statusName: 'Done', statusCategory: 'done', summary: 'Old' }],
      }),
    ],
  }, { now: NOW });
  const blocked = risks.filter((risk) => risk.type === 'blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].id, 'blocked:PROJ-3');
  assert.deepEqual(blocked[0].suggestedFix.blockerKeys, ['PROJ-9']);
});

test('flags point growth against the previous baseline and a mid-sprint add', () => {
  const risks = detectRisks({
    projectKey: 'PROJ',
    sprint,
    issues: [
      issue({ key: 'PROJ-2', storyPoints: 8, assigneeAccountId: 'bob', assigneeName: 'Bob' }),
      issue({
        key: 'PROJ-4',
        statusCategory: 'new',
        statusName: 'To Do',
        created: '2026-11-10T12:00:00.000Z',
        storyPoints: 5,
        priority: 'Low',
        assigneeAccountId: 'bob',
        assigneeName: 'Bob',
      }),
    ],
  }, { now: NOW, baselines: { 'PROJ-2': { storyPoints: 3 } } });
  const growth = risks.find((risk) => risk.id === 'scope_creep:PROJ-2');
  assert.equal(growth.suggestedFix.kind, 'split');
  assert.equal(growth.suggestedFix.splitPoints, 5);
  assert.ok(risks.some((risk) => risk.id === 'scope_creep:added:PROJ-4'));
});

test('does not call the first observation scope creep', () => {
  const risks = detectRisks({
    projectKey: 'PROJ',
    sprint,
    issues: [issue({ key: 'PROJ-2', storyPoints: 13, created: '2026-11-03T09:00:00.000Z' })],
  }, { now: NOW, baselines: {} });
  assert.equal(risks.some((risk) => risk.type === 'scope_creep'), false);
});

test('flags an overloaded assignee by points and a sprint goal that is behind', () => {
  const issues = [
    issue({ key: 'PROJ-1', storyPoints: 8, updated: '2026-11-08T18:00:00.000Z' }),
    issue({ key: 'PROJ-2', storyPoints: 8 }),
    issue({ key: 'PROJ-3', storyPoints: 8 }),
    issue({ key: 'PROJ-4', statusCategory: 'new', statusName: 'To Do', priority: 'Lowest', storyPoints: 5, updated: '2026-11-04T18:00:00.000Z', assigneeAccountId: 'bob', assigneeName: 'Bob' }),
    issue({ key: 'PROJ-5', statusCategory: 'done', statusName: 'Done', storyPoints: 1 }),
  ];
  const risks = detectRisks({ projectKey: 'PROJ', sprint, issues }, { now: NOW });
  const load = risks.find((risk) => risk.type === 'overloaded');
  assert.ok(load);
  assert.equal(load.evidence.storyPoints, 24);
  const goal = risks.find((risk) => risk.type === 'sprint_goal');
  assert.ok(goal);
  assert.equal(goal.severity, 'critical');
  assert.equal(goal.suggestedFix.issueKey, 'PROJ-4');
  assert.equal(goal.suggestedFix.removeFromSprint, true);
});

test('leaves a healthy early sprint alone', () => {
  const early = { ...sprint, startDate: '2026-11-12T18:00:00.000Z', endDate: '2026-11-26T18:00:00.000Z' };
  const risks = detectRisks({
    projectKey: 'PROJ',
    sprint: early,
    issues: [
      issue({ key: 'PROJ-1', storyPoints: 3, assigneeAccountId: 'alice', assigneeName: 'Alice' }),
      issue({ key: 'PROJ-2', storyPoints: 3, assigneeAccountId: 'bob', assigneeName: 'Bob' }),
      issue({ key: 'PROJ-3', statusCategory: 'done', statusName: 'Done', storyPoints: 3, assigneeAccountId: 'alice', assigneeName: 'Alice' }),
    ],
  }, { now: NOW, baselines: { 'PROJ-1': { storyPoints: 3 }, 'PROJ-2': { storyPoints: 3 } } });
  assert.deepEqual(risks, []);
});
