---
name: sprint-sentinel
description: Use Sprint Sentinel's Atlassian MCP tools to inspect Jira sprint risk and propose a fix. Approval stays with a person.
---

# Sprint Sentinel

Sprint Sentinel watches a Jira project for stalled issues, blocked dependencies, scope creep, overloaded assignees, and a sprint goal that is behind. Use its MCP tools to read that picture. Do not change Jira or Confluence from this skill. The approve, dismiss, and publish actions are intentionally not MCP tools.

After the app is installed, Atlassian shows the MCP server URL for the site. It is served from `mcp.atlassian.com` for the Forge app. Connect that URL in the client that supports Atlassian MCP.

## Tools

- `scan-project` — check a project key such as `PROJ`. Returns risks and does not edit issues.
- `explain-issue` — explain one issue key such as `PROJ-123`.
- `list-pending-fixes` — list proposal ids that are waiting.
- `project-health` — report the last check, Grok configuration, and digest errors.
- `graph-context` — return Teamwork Graph evidence stored with the last check.
- `propose-fix` — point at a proposal for a risk id. This still does not edit Jira.

## Rules

1. Call `scan-project` or `explain-issue` before you advise.
2. Quote the issue key, the severity, and the proposed fix.
3. Tell the person the proposal id and ask them to approve it in the Sprint Sentinel Jira panel, or in Rovo with an explicit yes.
4. If a tool errors, say which check failed. The rules engine still covers the five risk types when Grok is not configured.
5. Never invent an account id or claim a fix was applied because a scan mentioned it.
