# Architecture

Sprint Sentinel is one Forge app. Jira is the required product. Confluence is installed alongside it. The Forge schema allows only one product to be `required: true`, so Confluence is `required: false` and the install steps still add it. The risk decision is pure JavaScript. Atlassian and xAI calls sit behind that core so the rules can be tested with no network and no credentials.

```mermaid
flowchart TD
  trigger[Issue trigger and hourly schedule] --> scan[runScan]
  panel[Jira panel and project page] --> scan
  scan --> jira[Jira REST: sprint and issues]
  scan --> rules[detectRisks]
  scan --> graph[Teamwork Graph curated queries]
  graph --> rules
  rules --> grok[Grok or the rules fallback]
  grok --> store[Forge KVS: snapshot, proposals, audit, health]
  store --> panel
  panel -->|Approve| apply[Jira comment, assign, estimate, backlog, or subtask]
  schedule[Daily schedule] --> digest[Confluence page]
  digest --> connector[Teamwork Graph document]
  rovo[Rovo agent and MCP tools] --> scan
  rovo -->|confirm true| apply
```

## What notices the risk

`src/lib/risks.js` reads a normalized sprint and returns risks. The inputs are issue status, updated time, story points, blocker links, assignee load, and sprint dates. Thresholds live in `src/lib/thresholds.js` and can be tightened from the project page.

| Risk | Default signal | Fix that approval can apply |
| --- | --- | --- |
| Stalled | In progress with no update for 3 days, or still to do after the sprint is half over | Comment, reassign if that person is also overloaded, or move a low-priority item to the backlog |
| Blocked | An `is blocked by` link whose target is not done | Comment on the issue and on each blocker |
| Scope creep | Story points grew by 3 or by 30% since the previous check, or the issue was created more than 24 hours after the sprint started | Restore the estimate, or split a large increase into a subtask |
| Overloaded | 8 open issues or 21 story points on one person in the project | Reassign the heaviest issue to the lightest person who is under the line |
| Sprint goal | Time elapsed is at least 15 points ahead of completion, after 40% of the sprint | Move the lowest-priority not-started issue to the backlog |

The first check records story points and does not call that observation creep. The next check compares against those points. Teamwork Graph can add a cross-project overload when a person has 12 or more assigned work items, and it attaches linked pull-request and deployment counts to the evidence. If that call fails, the Jira risks are unchanged.

## How Grok is called

`src/lib/grok.js` posts to `https://api.x.ai/v1/chat/completions` with `api.fetch` from `@forge/api`. The host is allow-listed in `permissions.external.fetch.backend`. The key is `process.env.XAI_API_KEY`, set with `forge variables set --encrypt`. The model is `process.env.XAI_MODEL`, default `grok-4.7`.

The request asks for one JSON object, uses `reasoning_effort: low`, and caps the completion at 1200 tokens so a scheduled invocation stays inside its timeout. The model may rewrite the explanation. A suggested fix is kept only when the kind is one of reassign, split, rescope, unblock, or comment, the issue key matches the risk, and any account id was already present on the sprint. Anything else is discarded and the rule fix remains.

Chat Completions is the legacy xAI endpoint. It is still documented and is the right shape for a single stateless JSON reply. The Responses API is the path xAI recommends for new multi-turn agent loops. This app does not need that loop: the conversation state is the proposal stored in KVS.

The Forge egress schema currently allows only the category `analytics`. The manifest uses that category and sets `inScopeEUD: true`, because issue summaries and assignee names leave Atlassian when a key is configured.

## The human checkpoint

`syncProposals` creates one pending proposal per current risk. Dismissed and applied proposals are not reopened on the next scan. `buildOperations` throws unless the proposal status is `approved`. The issue panel's Approve button is the checkpoint for people. The Rovo actions `approve-fix`, `dismiss-fix`, and `write-digest` return without writing unless `confirm` is true, and the agent prompt tells the model to set that only after the user agrees. Those three actions are not exposed on the MCP server. `propose-fix` only points at a proposal that the scan already stored.

Jira writes prefer the current user and fall back to the app user when the invocation has no user, which is the case for the hourly schedule. The audit log records the actor, the action, and the outcome.

## Self-healing

`src/lib/selfheal.js` retries timeouts, network errors, HTTP 429, and HTTP 5xx, with exponential backoff. HTTP 4xx other than 429 is not retried. A failed Grok call, a failed Teamwork Graph query, or a missing API key all fall through to the rules. A failed Jira scan is stored on the health record and in the audit log. The next hourly run tries again. Forge itself does not retry a scheduled function that throws, so the handlers catch errors and return.

The project page shows the last success, the last error, whether Grok or the rules produced the copy, and whether Teamwork Graph responded. Failed proposals can be approved again.

## Teamwork Graph

Consumption uses curated queries, which do not need a saved Cypher query:

- `atlassianUserAssignedJiraWorkItems`
- `jiraWorkItemLinkedExternalPullRequests`
- `jiraWorkItemLinkedExternalDeployments`

`requestTeamworkGraph` exists on `api.asUser()`, so a scheduled scan without a user records that the graph was skipped and still finishes the Jira check. A person running **Watch and check**, or a Rovo action, supplies the user.

The `graph:connector` module ingests the digest as an `atlassian:document` through `@forge/teamwork-graph` `setObjects` after an admin connects it. `replicatesPermissions` is false and the document principal is `ATLASSIAN_WORKSPACE`, which matches that declaration: anyone in the site can find the digest in Teamwork Graph. The Confluence page still follows space permissions. Admins opt in by connecting the datasource.

## Schedules and storage

Watched project keys, thresholds, the story-point field id, proposals, baselines, the latest snapshot, health, the audit log, and the connector id are Forge KVS keys. Snapshots keep the risk list, not full issue descriptions. The audit log keeps the latest 80 entries per project.

The issue trigger listens for `avi:jira:created:issue` and `avi:jira:updated:issue` with `ignoreSelf: true`, and it will not scan the same project more than once every 10 minutes. The hourly trigger scans every watched project. The daily trigger writes the digest when a space key is set.

Function keys use an `fn-` prefix so they do not collide with trigger or action keys. Forge treats every module key as one namespace. UI Kit modules point `resource: main` at `src/frontend/index.jsx`. With `render: native`, that path has to be a file. A directory is rejected.

## Rovo and MCP

The agent key is `sprint-sentinel-agent`. Its prompt is `resource/agent/prompts/agent-prompt.txt`. Actions are normal Forge `action` modules. `rovo:mcp` exposes the read actions plus `propose-fix`. A third-party agent can follow `skill/SKILL.md`. The MCP endpoint itself is issued by Atlassian after install. It is shown in the product UI on `mcp.atlassian.com`. This repo does not hard-code that URL.
