# Sprint Sentinel

Sprint Sentinel is an autonomous Jira and Confluence delivery agent built for [Codegeist 2026](https://codegeist2026.devpost.com/). It watches a software project, notices when the sprint is getting into trouble, explains the risk, and waits for a person to approve the fix.

It looks for five kinds of trouble:

- an issue that has stalled
- an open blocker
- scope that grew or arrived after planning
- an assignee carrying too much
- a sprint goal that is behind the clock

Grok (`grok-4.7` by default, from the [xAI API](https://docs.x.ai/developers/models)) writes the explanation when `XAI_API_KEY` is set. With no key, the same risks and the same concrete fixes come from deterministic rules. Nothing is edited in Jira until someone approves it in the issue panel or project page.

Owner: Mark Yukhimets, Level Up Inc.

Category: Apps for Software Teams. Deadline: 22 December 2026, 12:00 PM PT.

## What you can do in the product

- Open **Sprint Sentinel** on a Jira project and choose **Watch and check**.
- Read each risk, then **Approve fix** or **Dismiss**. Approval reassigns, splits, re-scopes, moves work to the backlog, or posts the unblock note.
- Open the same risks on an issue from the **Sprint Sentinel** issue panel.
- Publish a daily Confluence page. The hourly schedule rechecks watched projects, and the daily schedule writes the digest when a space key is saved.
- Talk to the **Sprint Sentinel** Rovo agent. It can scan and explain on its own. Applying a fix or publishing a page requires an explicit yes.
- Call the same read and propose tools from Atlassian MCP. Approve, dismiss, and publish stay off the MCP tool list.
- Connect the Sprint Sentinel Teamwork Graph connector so each digest is stored as a document. Checks also read assigned work and linked pull requests or deployments from the Teamwork Graph API.

## Run the checks on this machine

These commands do not need Atlassian or xAI.

```bash
npm install
npm test
npm run lint
npm run simulate
```

`npm test` includes the Forge manifest schema check from `@forge/manifest`. `npm run simulate` prints a sample sprint: stalled work, a blocker, scope creep, an overloaded assignee, and a sprint goal that is behind. Explanations use the rules engine.

`npx forge lint` is the CLI equivalent. It asks for `forge login` before it finishes, so a person with an Atlassian account has to run that one. The schema test above covers the manifest without that login.

## Install it on an Atlassian site

A person with an Atlassian account has to do the login, registration, deploy, and install. This repository cannot complete those steps. Use a free [developer site](https://developer.atlassian.com/platform/forge/getting-started/#create-a-developer-site) and the [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/). Node.js 22 or newer is enough for the CLI. The app runtime is `nodejs24.x`.

The manifest ships with a placeholder app id so the schema check has a valid ARI. `forge register` will not claim that id. Delete it first.

```bash
npm install
# Delete the placeholder line `id: ari:cloud:ecosystem::app/00000000-0000-4000-8000-000000000001`
forge login
forge register
forge deploy
```

`forge login` and `forge register` open a browser. Name the app **Sprint Sentinel**. The CLI writes the real `app.id` back into `manifest.yml`. Keep that id.

Set the model and, when you want Grok, the key. Variables are per environment. Encrypt the key. Deploy again after either command or the runtime will not see them.

```bash
forge variables set XAI_MODEL grok-4.7
forge variables set --encrypt XAI_API_KEY "your-xai-key"
forge deploy
```

Install onto both products. Forge allows only one product to be `required: true`. Jira is required. Confluence is declared with `required: false` and still has to be installed for the digest, the Confluence page, and cross-product Rovo access. Teamwork Graph scopes need an organization admin.

```bash
forge install --site your-site.atlassian.net --product jira --environment development
forge install --site your-site.atlassian.net --product confluence --environment development
```

If a later deploy adds scopes or the xAI egress entry, upgrade the installation:

```bash
forge install --upgrade
```

Then, in the site:

1. Open a Jira software project, choose the **Sprint Sentinel** tab, and click **Watch and check**.
2. Save a Confluence space key on the Settings tab if you want the daily digest.
3. In Atlassian Administration, open the app's Teamwork Graph connection and connect **Sprint Sentinel**. The connector stores digest text for the whole site because it does not copy Jira permission schemes. Connect it only if that visibility is acceptable.
4. Confirm the Rovo agent **Sprint Sentinel** is available in Chat, and that the MCP tools appear for the app.

Leave `XAI_API_KEY` unset if you want to demo the rules fallback. Issue summaries are sent to `api.x.ai` only when the key is present. The egress entry is declared with `inScopeEUD: true`. The Forge schema's only egress category today is `analytics`, so the manifest uses that category for the xAI host.

## Share it with judges

Follow [Start sharing your app](https://developer.atlassian.com/platform/forge/distribute-your-apps/#start-sharing-your-app). Distribution is enabled in the developer console by a logged-in developer. Put the installation link in the Devpost submission. Judges need both Jira and Confluence, and an organization admin must grant the Teamwork Graph scopes.

Marketplace listing is a separate human step. The checklist is in [docs/MARKETPLACE.md](docs/MARKETPLACE.md). Codegeist allows one category prize and one bonus prize for the same submission. The app is built so it can be entered for all four bonuses.

## Where the code lives

| Path | Role |
| --- | --- |
| `manifest.yml` | Forge modules, scopes, and the xAI egress host |
| `src/lib` | Risk rules, Grok client, approvals, digest text. No network. |
| `src/runtime` | Jira, Confluence, Teamwork Graph, and storage calls |
| `src/index.js` | Resolvers, schedules, triggers, Rovo actions, connector handler |
| `src/frontend/index.jsx` | UI Kit project page, issue panel, and Confluence page |
| `skill/SKILL.md` | Instructions a third-party agent can load for the MCP tools |
| `docs` | Architecture, demo script, and Devpost answers |

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The video script is [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). Draft Devpost answers are in [docs/SUBMISSION.md](docs/SUBMISSION.md).

## What still needs a person

- `forge login`, `forge register`, `forge deploy`, and `forge install`
- An xAI key, if Grok should run in the installed app
- Organization-admin consent for Teamwork Graph scopes
- Connecting the Teamwork Graph connector in administration
- A public YouTube demo under five minutes
- The Devpost form, the installation link, and a Marketplace submission if you want that bonus
