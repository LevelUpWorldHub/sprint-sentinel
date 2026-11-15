# Demo script

Target length: 4 minutes 30 seconds. Record on a free Atlassian developer site with one scrum project, an active sprint, and a Confluence space. Speak in English. Do not use copyrighted music. Show the product working. Cut any dead air from `forge tunnel` or admin screens you already configured.

Before you hit record:

- Install the app on Jira and Confluence and upgrade if the consent screen is stale.
- Watch the demo project once so the hourly job is not required on camera.
- Either set `XAI_API_KEY` and redeploy, or leave it unset and say the rules fallback out loud. The lozenge must match what you say.
- Have one stalled issue, one blocked issue, one person with too many points, and a sprint that is more than halfway over with little done. `npm run simulate` is the shape to copy.
- Know which proposal you will approve. Approving a comment is the safest on-camera write. Approving a reassign is the clearer story if the assignee is a second demo user.

## 0:00–0:35 Problem

"Software teams do not miss sprint goals because nobody can see Jira. They miss them because the stalled issue, the blocker, and the extra scope show up too late, and an agent that edits the sprint on its own is worse. Sprint Sentinel watches the project, explains the risk, and waits."

Show the sprint board for three seconds, then open the Sprint Sentinel project tab.

## 0:35–1:20 The check

Point at the health message. If it says rules, say the xAI key is unset and the same fixes still appear. If it says Grok, say the explanation was written by grok-4.7 and the fix was still checked against the rules.

Click **Watch and check** if the page is empty. Scroll the risk list. Read one stalled issue, one blocker, and the sprint-goal line, including the issue keys.

## 1:20–2:10 Approval

Open the stalled or overloaded issue. Show the Sprint Sentinel issue panel with the same risk. Click **Approve fix**. Switch to the issue comment, the assignee, or the backlog so the viewer sees Jira change. Open the Activity tab and point at the audit row: actor, action, outcome.

Say: "Dismissed and applied proposals are not raised again on the next check. A failed write stays on the list so it can be retried."

## 2:10–2:40 Health

Open Settings. Show the space key and the stall threshold. Read the note that issue text goes to xAI only when a key is configured. If you can do it without a long cut, show a failed state you prepared, or describe the last-error line the page already renders when Jira or Grok fails. Do not pretend a failure you did not record.

## 2:40–3:25 Rovo

Open Rovo chat and start **Sprint Sentinel** with "What is at risk in this sprint?" Let it call the scan tool. When it offers a proposal id, say "do not apply that" and show that the board did not change. Then say "Approve proposal …" and show the action return applied, or skip the second apply if you already approved one in the panel. One real write is enough.

## 3:25–4:05 Graph, digest, MCP

Open the Confluence **Sprint Sentinel** page and the digest page from today. Point at the risk list and the sentence that fixes are still approved in Jira.

If the connector is connected, show the digest document in Atlassian search or say the connection id and that `setObjects` wrote an `atlassian:document`. If it is not connected, do not claim it is. Say the check also called `atlassianUserAssignedJiraWorkItems` when a user ran it, and show the graph line on an overloaded risk if the evidence includes it.

Open Rovo Studio or the MCP client long enough to show the Sprint Sentinel tools: scan, explain, list, health, graph, propose. Say approve and publish are not in that list.

## 4:05–4:30 Close

"This is a Forge app for software teams: Jira and Confluence, a Rovo agent, Atlassian MCP, and Teamwork Graph. The agent notices the problem. A person decides. Built by Mark Yukhimets at Level Up Inc for Codegeist 2026."

Stop. Upload the video to YouTube as public. Unlisted is not enough. Paste the URL into Devpost.
