import assert from 'node:assert/strict';
import test from 'node:test';
import { explainRisks, mergeModelExplanations, parseModelJson } from '../src/lib/grok.js';
import { fallbackExplanation } from '../src/lib/fallback.js';
import { isRetryable, withRetry } from '../src/lib/selfheal.js';
import { detectRisks } from '../src/lib/risks.js';

const risk = detectRisks({
  projectKey: 'PROJ',
  sprint: null,
  issues: [{
    key: 'PROJ-1',
    summary: 'Export',
    statusName: 'In Progress',
    statusCategory: 'indeterminate',
    assigneeAccountId: 'alice',
    assigneeName: 'Alice',
    updated: '2026-11-01T00:00:00.000Z',
    created: '2026-10-01T00:00:00.000Z',
    storyPoints: 3,
    priority: 'High',
    blockedBy: [],
  }],
}, { now: '2026-11-13T00:00:00.000Z' }).find((item) => item.type === 'stalled');

test('uses deterministic copy when no xAI key is configured', async () => {
  const result = await explainRisks({ risks: [risk], env: {}, fetchImpl: () => { throw new Error('network'); } });
  assert.equal(result.source, 'fallback');
  assert.equal(result.reason, 'XAI_API_KEY is not set');
  assert.match(result.explanations[0].explanation, /PROJ-1/);
  assert.equal(result.explanations[0].fix.issueKey, 'PROJ-1');
});

test('accepts a Grok JSON explanation and drops an invented assignee', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            risks: [{
              id: risk.id,
              explanation: 'Alice has not touched the export.',
              fixSummary: 'Hand PROJ-1 to Bob.',
              fix: { kind: 'reassign', issueKey: 'PROJ-1', accountId: 'stranger', rationale: 'no' },
            }],
          }),
        },
      }],
    }),
  });
  const result = await explainRisks({
    risks: [risk],
    env: { XAI_API_KEY: 'secret-key', XAI_MODEL: 'grok-4.7' },
    context: { allowedAccountIds: ['alice'] },
    fetchImpl,
    retries: 0,
  });
  assert.equal(result.source, 'grok');
  assert.equal(result.model, 'grok-4.7');
  assert.equal(result.explanations[0].explanation, 'Alice has not touched the export.');
  assert.equal(result.explanations[0].fix.kind, 'comment');
  assert.equal(result.error, null);
});

test('falls back when Grok returns a server error and redacts the key', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 503, text: async () => 'secret-key unavailable' };
  };
  const result = await explainRisks({
    risks: [risk],
    env: { XAI_API_KEY: 'secret-key' },
    fetchImpl,
    retries: 1,
    timeoutMs: 1000,
    sleep: async () => {},
  });
  assert.equal(calls, 2);
  assert.equal(result.source, 'fallback');
  assert.equal(result.error.includes('secret-key'), false);
  assert.match(result.error, /\[redacted\]/);
});

test('does not retry a 400 from xAI', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 400, text: async () => 'bad request' };
  };
  const result = await explainRisks({
    risks: [risk],
    env: { XAI_API_KEY: 'secret-key' },
    fetchImpl,
    retries: 3,
    sleep: async () => {},
  });
  assert.equal(calls, 1);
  assert.equal(result.source, 'fallback');
});

test('retries a hung call once and then succeeds', async () => {
  let calls = 0;
  const value = await withRetry(() => {
    calls += 1;
    if (calls === 1) return new Promise(() => {});
    return 'ok';
  }, { retries: 1, timeoutMs: 20, baseDelayMs: 0, sleep: async () => {}, label: 'hung' });
  assert.equal(value, 'ok');
  assert.equal(calls, 2);
});

test('classifies retryable failures', () => {
  assert.equal(isRetryable(Object.assign(new Error('no'), { status: 400, retryable: false })), false);
  assert.equal(isRetryable(Object.assign(new Error('slow'), { status: 429 })), true);
  assert.equal(isRetryable(Object.assign(new Error('down'), { status: 503 })), true);
  assert.equal(isRetryable(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), true);
});

test('parses fenced model JSON and keeps the rule fix when the kind is unknown', () => {
  const parsed = parseModelJson('```json\n{"risks":[{"id":"stalled:PROJ-1","explanation":"Still stuck.","fix":{"kind":"delete"}}]}\n```');
  const merged = mergeModelExplanations([risk], [fallbackExplanation(risk)], parsed, { allowedAccountIds: [] });
  assert.match(merged[0].explanation, /Still stuck/);
  assert.equal(merged[0].fix.kind, 'comment');
});
