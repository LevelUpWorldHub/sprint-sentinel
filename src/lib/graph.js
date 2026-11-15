import { issueAri, userAri } from './ids.js';

export function assignedWorkQuery() {
  return `query sprintSentinelAssigned($userId: ID!) {
    atlassianUserAssignedJiraWorkItems(userId: $userId, first: 25) {
      edges { node { ... on JiraWorkItem { id title status { name } } } }
    }
  }`;
}

export function deliveryQuery() {
  return `query sprintSentinelDelivery($id: ID!) {
    pullRequests: jiraWorkItemLinkedExternalPullRequests(id: $id, first: 10) {
      edges { node { id } }
    }
    deployments: jiraWorkItemLinkedExternalDeployments(id: $id, first: 5) {
      edges { node { id } }
    }
  }`;
}

export function readAssignedWork(json) {
  if (json?.errors?.length && !json?.data) {
    throw new Error(json.errors.map((error) => error.message).join('; '));
  }
  const edges = json?.data?.atlassianUserAssignedJiraWorkItems?.edges || [];
  return {
    assignedCount: edges.length,
    titles: edges.map((edge) => edge?.node?.title).filter(Boolean).slice(0, 8),
  };
}

export function readDelivery(json) {
  if (json?.errors?.length && !json?.data) {
    throw new Error(json.errors.map((error) => error.message).join('; '));
  }
  return {
    pullRequests: (json?.data?.pullRequests?.edges || []).length,
    deployments: (json?.data?.deployments?.edges || []).length,
  };
}

export async function enrichSnapshot(snapshot, request, { cloudId, overloadCount = 12 } = {}) {
  const open = (snapshot?.issues || []).filter((issue) => issue.statusCategory !== 'done');
  const accountIds = [...new Set(open.map((issue) => issue.assigneeAccountId).filter(Boolean))].slice(0, 5);
  const assignees = {};
  const errors = [];
  for (const accountId of accountIds) {
    try {
      const json = await request(assignedWorkQuery(), { userId: userAri(accountId) });
      assignees[accountId] = readAssignedWork(json);
    } catch (error) {
      errors.push(`${accountId}: ${error.message}`);
    }
  }
  const delivery = [];
  if (cloudId) {
    for (const issue of open.filter((item) => item.id).slice(0, 3)) {
      try {
        const json = await request(deliveryQuery(), { id: issueAri(cloudId, issue.id) });
        delivery.push({ issueKey: issue.key, ...readDelivery(json) });
      } catch (error) {
        errors.push(`${issue.key}: ${error.message}`);
      }
    }
  }
  const ok = accountIds.length > 0 && Object.keys(assignees).length > 0;
  return {
    ok,
    assignees,
    delivery,
    errors,
    overloadCount,
    skipped: accountIds.length === 0,
  };
}
