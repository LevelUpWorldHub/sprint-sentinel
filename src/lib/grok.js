import { fallbackExplanation } from './fallback.js';
import { redactSecrets, truncate } from './text.js';
import { withRetry } from './selfheal.js';

export const DEFAULT_MODEL = 'grok-4.7';
export const XAI_CHAT_COMPLETIONS_URL = 'https://api.x.ai/v1/chat/completions';
const ALLOWED_KINDS = new Set(['reassign', 'split', 'rescope', 'unblock', 'comment']);

const SYSTEM_PROMPT = [
  'You are Sprint Sentinel, a delivery risk analyst.',
  'Explain each risk in plain language and propose one concrete fix.',
  'Return only JSON: {"risks":[{"id":"","explanation":"","fixSummary":"","fix":{"kind":"reassign|split|rescope|unblock|comment","issueKey":"","accountId":"","assigneeName":"","storyPoints":0,"splitPoints":0,"removeFromSprint":false,"blockerKeys":[],"rationale":""}}]}',
  'Use only account ids from allowedAccountIds. Do not invent people, issue keys, or permissions.',
  'Never claim a fix was applied. A human must approve it.',
].join(' ');

function compactRisk(risk) {
  return {
    id: risk.id,
    type: risk.type,
    severity: risk.severity,
    issueKey: risk.issueKey || null,
    title: truncate(risk.title, 180),
    evidence: risk.evidence,
    suggestedFix: risk.suggestedFix,
  };
}

export function parseModelJson(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Grok returned no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

export function mergeModelExplanations(risks, fallbacks, parsed, context = {}) {
  const byId = new Map((parsed?.risks || []).map((item) => [item.id, item]));
  const allowed = new Set(context.allowedAccountIds || []);
  return risks.map((risk, index) => {
    const base = fallbacks[index];
    const model = byId.get(risk.id);
    if (!model || typeof model.explanation !== 'string' || !model.explanation.trim()) return base;
    const fix = sanitizeFix(model.fix, risk, allowed) || base.fix;
    return {
      riskId: risk.id,
      explanation: truncate(model.explanation, 600),
      fixSummary: truncate(model.fixSummary || base.fixSummary, 300),
      fix,
      source: 'grok',
      label: base.label,
    };
  });
}

function sanitizeFix(fix, risk, allowedAccountIds) {
  if (!fix || !ALLOWED_KINDS.has(fix.kind)) return null;
  const issueKey = fix.issueKey || risk.issueKey;
  if (risk.issueKey && issueKey && issueKey !== risk.issueKey) return null;
  if (fix.kind === 'reassign') {
    if (!fix.accountId || (allowedAccountIds.size && !allowedAccountIds.has(fix.accountId))) return null;
  }
  const next = {
    kind: fix.kind,
    issueKey,
    rationale: truncate(fix.rationale || '', 300),
  };
  if (fix.accountId) next.accountId = fix.accountId;
  if (fix.assigneeName) next.assigneeName = truncate(fix.assigneeName, 80);
  if (Number.isFinite(Number(fix.storyPoints)) && Number(fix.storyPoints) >= 0) next.storyPoints = Number(fix.storyPoints);
  if (Number.isFinite(Number(fix.splitPoints)) && Number(fix.splitPoints) > 0) next.splitPoints = Number(fix.splitPoints);
  if (fix.removeFromSprint === true) next.removeFromSprint = true;
  if (Array.isArray(fix.blockerKeys)) {
    next.blockerKeys = fix.blockerKeys.filter((key) => typeof key === 'string').slice(0, 8);
  }
  if (fix.kind === 'split') next.projectKey = risk.projectKey;
  if (fix.kind === 'split' && !next.summary) next.summary = risk.suggestedFix?.summary;
  return next;
}

async function completeJson({ apiKey, model, risks, context, fetchImpl }) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    const error = new Error('No fetch implementation is available for xAI');
    error.retryable = false;
    throw error;
  }
  const response = await fetchFn(XAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      reasoning_effort: 'low',
      max_completion_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            projectKey: context.projectKey,
            sprint: context.sprint ? { name: context.sprint.name, goal: truncate(context.sprint.goal, 180) } : null,
            allowedAccountIds: context.allowedAccountIds || [],
            risks: risks.map(compactRisk),
          }),
        },
      ],
    }),
  });
  if (!response.ok) {
    const body = typeof response.text === 'function' ? await response.text() : '';
    const error = new Error(`xAI responded ${response.status}: ${String(body).slice(0, 300)}`);
    error.status = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error('xAI returned an empty completion');
    error.retryable = true;
    throw error;
  }
  return content;
}

export async function explainRisks({ risks, context = {}, env = {}, fetchImpl, sleep, timeoutMs = 20000, retries = 2 }) {
  const explanations = risks.map((risk) => fallbackExplanation(risk));
  const apiKey = env.XAI_API_KEY || '';
  const model = env.XAI_MODEL || DEFAULT_MODEL;
  if (!apiKey) {
    return {
      source: 'fallback',
      model: null,
      error: null,
      reason: 'XAI_API_KEY is not set',
      explanations,
    };
  }
  if (!risks.length) {
    return { source: 'fallback', model, error: null, reason: 'no risks', explanations: [] };
  }
  const allowedAccountIds = context.allowedAccountIds || uniqueAccountIds(risks);
  try {
    const content = await withRetry(
      () => completeJson({
        apiKey,
        model,
        risks,
        context: { ...context, allowedAccountIds },
        fetchImpl,
      }),
      { retries, timeoutMs, sleep, label: 'xAI chat completion' },
    );
    const parsed = parseModelJson(content);
    return {
      source: 'grok',
      model,
      error: null,
      explanations: mergeModelExplanations(risks, explanations, parsed, { allowedAccountIds }),
    };
  } catch (error) {
    return {
      source: 'fallback',
      model,
      error: redactSecrets(error.message, [apiKey]),
      explanations,
    };
  }
}

function uniqueAccountIds(risks) {
  const ids = new Set();
  for (const risk of risks) {
    if (risk.suggestedFix?.accountId) ids.add(risk.suggestedFix.accountId);
    if (risk.assigneeAccountId) ids.add(risk.assigneeAccountId);
  }
  return [...ids];
}
