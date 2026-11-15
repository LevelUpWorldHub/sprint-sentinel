import api, { route } from '@forge/api';
import { adfDoc } from '../lib/adf.js';
import { discoverStoryPointField } from '../lib/normalize.js';
import { withRetry } from '../lib/selfheal.js';

async function readBody(response) {
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    const message = json?.errorMessages?.join(' ')
      || (json?.errors && JSON.stringify(json.errors))
      || json?.message
      || text.slice(0, 300)
      || `Jira responded ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  return json || {};
}

export function createJiraClient({ preferUser = false } = {}) {
  async function call(url, options) {
    return withRetry(async () => {
      const principals = preferUser ? ['user', 'app'] : ['app'];
      let lastError;
      for (const principal of principals) {
        try {
          const client = principal === 'user' ? api.asUser() : api.asApp();
          const response = await client.requestJira(url, options);
          if (response.status >= 500 || response.status === 429) {
            const error = new Error(`Jira responded ${response.status}`);
            error.status = response.status;
            error.retryable = true;
            lastError = error;
            continue;
          }
          return await readBody(response);
        } catch (error) {
          if (error.status && error.status < 500 && error.status !== 429) throw error;
          lastError = error;
        }
      }
      throw lastError || new Error('Jira request failed');
    }, { retries: 2, timeoutMs: 20000, label: 'Jira' });
  }

  async function search(jql, fields) {
    const issues = [];
    let nextPageToken;
    while (issues.length < 100) {
      const page = await call(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jql,
          maxResults: 50,
          fields,
          ...(nextPageToken ? { nextPageToken } : {}),
        }),
      });
      issues.push(...(page.issues || []));
      if (page.isLast || !page.nextPageToken) break;
      nextPageToken = page.nextPageToken;
    }
    return issues.slice(0, 100);
  }

  async function sprintIssues(sprintId, fields) {
    const issues = [];
    let startAt = 0;
    while (issues.length < 100) {
      const page = await call(route`/rest/agile/1.0/sprint/${sprintId}/issue?maxResults=50&startAt=${startAt}&fields=${fields.join(',')}`);
      const batch = page.issues || [];
      issues.push(...batch);
      if (!batch.length || issues.length >= (page.total || issues.length)) break;
      startAt += batch.length;
    }
    return issues.slice(0, 100);
  }

  async function subtaskType(projectKey) {
    try {
      const meta = await call(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
      const types = meta.issueTypes || meta.values || [];
      const match = types.find((type) => type.subtask && /sub-?task/i.test(type.name || ''))
        || types.find((type) => type.subtask);
      if (match) return match;
    } catch {
      // Some project types hide createmeta. Fall through to the global list.
    }
    const all = await call(route`/rest/api/3/issuetype`);
    const list = Array.isArray(all) ? all : [];
    return list.find((type) => type.subtask && /sub-?task/i.test(type.name || ''))
      || list.find((type) => type.subtask)
      || { name: 'Sub-task' };
  }

  return {
    async loadProject(projectKey) {
      const fields = await call(route`/rest/api/3/field`);
      const storyPointFieldId = discoverStoryPointField(Array.isArray(fields) ? fields : []);
      const boards = await call(route`/rest/agile/1.0/board?projectKeyOrId=${projectKey}&maxResults=10`);
      const board = (boards.values || []).find((item) => item.type === 'scrum') || (boards.values || [])[0] || null;
      let sprint = null;
      if (board) {
        const sprints = await call(route`/rest/agile/1.0/board/${board.id}/sprint?state=active&maxResults=5`);
        sprint = (sprints.values || [])[0] || null;
      }
      const fieldList = ['summary', 'status', 'assignee', 'updated', 'created', 'issuetype', 'priority', 'labels', 'issuelinks'];
      if (storyPointFieldId) fieldList.push(storyPointFieldId);
      const issues = sprint
        ? await sprintIssues(sprint.id, fieldList)
        : await search(`project = ${projectKey} AND statusCategory != Done ORDER BY updated ASC`, fieldList);
      return { projectKey, sprint, issues, storyPointFieldId };
    },

    async execute(operation) {
      if (operation.op === 'comment') {
        await call(route`/rest/api/3/issue/${operation.issueKey}/comment`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: adfDoc(operation.text) }),
        });
        return { op: operation.op, issueKey: operation.issueKey, ok: true };
      }
      if (operation.op === 'assign') {
        await call(route`/rest/api/3/issue/${operation.issueKey}/assignee`, {
          method: 'PUT',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: operation.accountId }),
        });
        return { op: operation.op, issueKey: operation.issueKey, ok: true };
      }
      if (operation.op === 'estimate') {
        await call(route`/rest/agile/1.0/issue/${operation.issueKey}/estimation`, {
          method: 'PUT',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: String(operation.value) }),
        });
        return { op: operation.op, issueKey: operation.issueKey, ok: true };
      }
      if (operation.op === 'backlog') {
        await call(route`/rest/agile/1.0/backlog/issue`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ issues: [operation.issueKey] }),
        });
        return { op: operation.op, issueKey: operation.issueKey, ok: true };
      }
      if (operation.op === 'create-subtask') {
        const type = await subtaskType(operation.projectKey);
        const created = await call(route`/rest/api/3/issue`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              project: { key: operation.projectKey },
              parent: { key: operation.parentKey },
              summary: operation.summary,
              issuetype: type.id ? { id: String(type.id) } : { name: type.name || 'Sub-task' },
              description: adfDoc(operation.description),
            },
          }),
        });
        if (operation.storyPoints != null && created.key) {
          await call(route`/rest/agile/1.0/issue/${created.key}/estimation`, {
            method: 'PUT',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: String(operation.storyPoints) }),
          });
        }
        return { op: operation.op, issueKey: created.key, ok: true };
      }
      throw new Error(`Unknown Jira operation ${operation.op}`);
    },
  };
}
