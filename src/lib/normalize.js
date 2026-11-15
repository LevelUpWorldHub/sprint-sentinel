function categoryOf(status) {
  return status?.statusCategory?.key || status?.statusCategory?.name?.toLowerCase() || null;
}

function linkIssue(issue) {
  if (!issue?.key) return null;
  return {
    key: issue.key,
    summary: issue.fields?.summary || '',
    statusName: issue.fields?.status?.name || '',
    statusCategory: categoryOf(issue.fields?.status),
  };
}

export function blockersFromLinks(links = []) {
  const blockers = [];
  for (const link of links) {
    const inward = `${link?.type?.inward || ''} ${link?.type?.name || ''}`;
    if (link?.inwardIssue && /block/i.test(inward)) {
      const blocker = linkIssue(link.inwardIssue);
      if (blocker) blockers.push(blocker);
    }
  }
  return blockers;
}

export function readStoryPoints(fields, fieldId) {
  if (!fields) return null;
  const candidates = [fieldId, 'customfield_10016', 'customfield_10028'].filter(Boolean);
  for (const id of candidates) {
    const value = fields[id];
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && Number.isFinite(Number(value.value))) return Number(value.value);
  }
  return null;
}

export function normalizeIssue(issue, { storyPointFieldId, inSprint = true } = {}) {
  const fields = issue?.fields || {};
  const assignee = fields.assignee;
  return {
    id: issue?.id ? String(issue.id) : null,
    key: issue?.key,
    summary: fields.summary || '',
    statusName: fields.status?.name || '',
    statusCategory: categoryOf(fields.status),
    assigneeAccountId: assignee?.accountId || null,
    assigneeName: assignee?.displayName || null,
    updated: fields.updated || null,
    created: fields.created || null,
    storyPoints: readStoryPoints(fields, storyPointFieldId),
    issueType: fields.issuetype?.name || '',
    priority: fields.priority?.name || '',
    labels: fields.labels || [],
    blockedBy: blockersFromLinks(fields.issuelinks),
    inSprint,
  };
}

export function normalizeSprint(sprint) {
  if (!sprint) return null;
  return {
    id: sprint.id,
    name: sprint.name || '',
    goal: sprint.goal || '',
    state: sprint.state || '',
    startDate: sprint.startDate || null,
    endDate: sprint.endDate || null,
  };
}

export function normalizeProject(raw) {
  const storyPointFieldId = raw?.storyPointFieldId || null;
  const issues = (raw?.issues || []).map((issue) => normalizeIssue(issue, { storyPointFieldId }));
  return {
    projectKey: raw?.projectKey,
    sprint: normalizeSprint(raw?.sprint),
    issues: issues.filter((issue) => issue.key),
    storyPointFieldId,
  };
}

export function baselinesFromSnapshot(snapshot) {
  const baselines = {};
  for (const issue of snapshot?.issues || []) {
    if (issue.storyPoints == null) continue;
    baselines[issue.key] = { storyPoints: issue.storyPoints };
  }
  return baselines;
}

export function discoverStoryPointField(fields = []) {
  const match = fields.find((field) => /story point/i.test(field?.name || '') && !/original/i.test(field?.name || ''));
  return match?.id || null;
}
