const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,19}$/;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-\d+$/;

export function normalizeProjectKey(value) {
  const key = String(value || '').trim().toUpperCase();
  return PROJECT_KEY.test(key) ? key : null;
}

export function requireProjectKey(value) {
  const key = normalizeProjectKey(value);
  if (!key) throw new Error('Enter a project key such as PROJ.');
  return key;
}

export function normalizeIssueKey(value) {
  const key = String(value || '').trim().toUpperCase();
  return ISSUE_KEY.test(key) ? key : null;
}

export function projectKeyFromIssueKey(value) {
  const key = normalizeIssueKey(value);
  return key ? key.split('-')[0] : null;
}

export function normalizeSpaceKey(value) {
  const key = String(value || '').trim().toUpperCase();
  if (!key) return '';
  if (!PROJECT_KEY.test(key)) throw new Error('Enter a Confluence space key such as TEAM.');
  return key;
}

export function userAri(accountId) {
  const id = String(accountId || '');
  if (id.startsWith('ari:')) return id;
  return `ari:cloud:identity::user/${id}`;
}

export function issueAri(cloudId, issueId) {
  if (!cloudId || !issueId) return null;
  return `ari:cloud:jira:${cloudId}:issue/${issueId}`;
}

export function projectKeyFromIssueEvent(event) {
  const issue = event?.issue || event?.payload?.issue;
  return normalizeProjectKey(issue?.fields?.project?.key)
    || projectKeyFromIssueKey(issue?.key);
}
