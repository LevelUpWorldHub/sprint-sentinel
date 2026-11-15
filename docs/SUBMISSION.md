# Devpost submission

Paste these answers into the Codegeist 2026 form. Replace the bracketed lines after a person has deployed the app. The same submission can win one category prize and one bonus prize. The app is eligible to be considered for every bonus. Enter **Apps for Software Teams** as the category.

Deadline: 22 December 2026, 12:00 PM Pacific Time.

## Project

- Name: Sprint Sentinel
- Tagline: An autonomous sprint agent that notices delivery risk and waits for a person before it changes Jira.
- Owner: Mark Yukhimets, Level Up Inc
- Category: Apps for Software Teams
- Built with: Atlassian Forge, Jira, Confluence, Rovo, Atlassian MCP, Teamwork Graph, Grok / xAI

## Links to add after deploy

- Installation link: [create this with Start sharing your app](https://developer.atlassian.com/platform/forge/distribute-your-apps/#start-sharing-your-app)
- YouTube demo, public, under 5 minutes: [upload using docs/DEMO_SCRIPT.md]
- Marketplace listing or review ticket: [optional, see docs/MARKETPLACE.md]

## Explanation

Sprint Sentinel is a Forge app installed on Jira and Confluence. A scheduled trigger and issue triggers watch a project. The app detects stalled issues, blocked dependencies, scope creep, overloaded assignees, and a sprint goal that is behind schedule. When `XAI_API_KEY` is set, Forge calls the xAI Chat Completions API at `api.x.ai` with the `grok-4.7` model and asks for an explanation and a concrete fix. The manifest allow-lists that host and marks the call as carrying end-user data. With no key, or when the call fails, deterministic rules produce the same kinds of fixes.

Every change is a proposal. A person approves it in a Jira issue panel or on the project page before the app reassigns, splits, re-scopes, moves an issue to the backlog, or comments. A daily job writes a Confluence risk digest. The Rovo agent can scan and explain by itself. Its apply and publish actions refuse to run until `confirm` is true. The same read and propose actions are exposed with `rovo:mcp` for Atlassian MCP. Teamwork Graph curated queries add cross-project assignment load and linked pull requests and deployments. An admin can also connect the app's Teamwork Graph connector, which ingests each digest as a document. Retries, timeouts, a health panel, and an audit log cover failed calls without hiding them.

## Bonus notes

### Best Agents

The manifest includes `rovo:agent` key `sprint-sentinel-agent` and nine `action` modules. The agent prompt is stored at `resource/agent/prompts/agent-prompt.txt`. Show the chat in the video, including a refusal to apply a fix the user did not approve.

### Best app with Atlassian MCP

The manifest includes one `rovo:mcp` module, `sprint-sentinel-mcp`, exposing `scan-project`, `explain-issue`, `list-pending-fixes`, `project-health`, `graph-context`, and `propose-fix`. `skill/SKILL.md` is the open instructions file for a third-party agent. Show the tool list in the video. The public MCP URL is displayed by Atlassian after install.

### Best Teamwork Graph integration

The app calls curated queries `atlassianUserAssignedJiraWorkItems`, `jiraWorkItemLinkedExternalPullRequests`, and `jiraWorkItemLinkedExternalDeployments` through `api.asUser().requestTeamworkGraph`. The `graph:connector` module ingests the digest with `setObjects` after an admin connects it. Scopes are the per-object `read:graph:*` scopes plus `read:object:jira`, `write:object:jira`, and `delete:object:jira`. Show either a graph-backed overload or the connected datasource in the video. Say clearly if the connector was not connected.

### Best Marketplace published app

This bonus needs a listing link or a Marketplace review ticket. The app is structured for that submission, and licensing is currently off for the hackathon install. A person still has to submit it. Do not claim the bonus until that link exists.

## Testing instructions for judges

1. Install the shared app on a Jira and Confluence site. An organization admin must grant the Teamwork Graph scopes.
2. Open a scrum project that has an active sprint. Choose the Sprint Sentinel tab, then **Watch and check**.
3. Open an issue that was flagged and approve or dismiss the fix. Confirm the Jira comment, assignee, estimate, or backlog matches the proposal.
4. On the Settings tab, save a Confluence space key and choose **Write digest**. Open the page titled `Sprint Sentinel digest — YYYY-MM-DD`.
5. In Rovo chat, ask Sprint Sentinel what is at risk. It should use its tools and should not edit Jira until you explicitly approve a proposal id.
6. Optional: connect Sprint Sentinel under the app's Teamwork Graph connections. The next digest is ingested as a document visible across the site. Do this only if that visibility is acceptable. The connector does not copy Jira permissions.

No xAI key is required. With a key, set `forge variables set --encrypt XAI_API_KEY` and `forge variables set XAI_MODEL grok-4.7`, then `forge deploy` again. The health message names Grok or the rules.
