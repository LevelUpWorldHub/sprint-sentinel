import { runScan, writeDigest } from '../src/lib/engine.js';
import { createMemoryStore } from '../src/lib/store.js';

const now = '2026-11-13T18:00:00.000Z';
const sprint = {
  id: 12,
  name: 'Sprint 12',
  goal: 'Ship the billing export',
  state: 'active',
  startDate: '2026-11-03T09:00:00.000Z',
  endDate: '2026-11-17T09:00:00.000Z',
};

function issue(key, fields) {
  return {
    id: key,
    key,
    fields: {
      summary: fields.summary,
      status: { name: fields.statusName, statusCategory: { key: fields.statusCategory } },
      assignee: { accountId: fields.accountId, displayName: fields.name },
      updated: fields.updated,
      created: fields.created || '2026-11-03T09:00:00.000Z',
      issuetype: { name: 'Story' },
      priority: { name: fields.priority || 'Medium' },
      labels: [],
      issuelinks: fields.links || [],
      customfield_10016: fields.points,
    },
  };
}

const issues = [
  issue('PROJ-1', { summary: 'Billing export', statusName: 'In Progress', statusCategory: 'indeterminate', accountId: 'alice', name: 'Alice', updated: '2026-11-08T18:00:00.000Z', points: 8 }),
  issue('PROJ-2', { summary: 'Tax lines', statusName: 'In Progress', statusCategory: 'indeterminate', accountId: 'alice', name: 'Alice', updated: now, points: 8 }),
  issue('PROJ-3', { summary: 'PDF layout', statusName: 'In Progress', statusCategory: 'indeterminate', accountId: 'alice', name: 'Alice', updated: now, points: 8 }),
  issue('PROJ-4', {
    summary: 'Nice-to-have chart',
    statusName: 'To Do',
    statusCategory: 'new',
    accountId: 'bob',
    name: 'Bob',
    updated: '2026-11-04T18:00:00.000Z',
    created: '2026-11-10T12:00:00.000Z',
    points: 5,
    priority: 'Low',
    links: [{
      type: { name: 'Blocks', inward: 'is blocked by' },
      inwardIssue: { key: 'PROJ-9', fields: { summary: 'Rates API', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } } },
    }],
  }),
  issue('PROJ-5', { summary: 'Spike notes', statusName: 'Done', statusCategory: 'done', accountId: 'bob', name: 'Bob', updated: now, points: 2 }),
];

const store = createMemoryStore({ config: { projects: ['PROJ'], spaceKey: 'TEAM', thresholds: {} } });
const deps = {
  store,
  env: {},
  jira: {
    async loadProject() {
      return { projectKey: 'PROJ', sprint, issues, storyPointFieldId: 'customfield_10016' };
    },
    async execute(operation) {
      return { ...operation, ok: true };
    },
  },
  graph: {
    async enrich() {
      return {
        ok: true,
        assignees: { alice: { assignedCount: 16, titles: ['Billing export', 'Platform migration'] } },
        delivery: [{ issueKey: 'PROJ-1', pullRequests: 0, deployments: 0 }],
        errors: [],
      };
    },
  },
  confluence: {
    async upsertDailyPage({ title }) {
      return { id: '100', url: `https://example.atlassian.net/wiki/${encodeURIComponent(title)}` };
    },
  },
};

const scan = await runScan({ projectKey: 'PROJ', deps, now, force: true });
const digest = await writeDigest({ deps, now, projectKeys: ['PROJ'] });
const lines = scan.risks.map((risk) => `${risk.severity.padEnd(8)} ${risk.type.padEnd(12)} ${risk.title}`);
console.log('Sprint Sentinel local simulation');
console.log(`Source: ${scan.explained.source}`);
console.log(lines.join('\n'));
console.log('');
console.log(digest.rendered.text);
if (!scan.ok || !digest.ok || scan.risks.length < 4) {
  console.error('Simulation did not produce the expected risks.');
  process.exit(1);
}
