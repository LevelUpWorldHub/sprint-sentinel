import { dateStamp } from './time.js';
import { escapeHtml, truncate } from './text.js';

const TYPE_LABEL = {
  stalled: 'Stalled',
  blocked: 'Blocked',
  scope_creep: 'Scope creep',
  overloaded: 'Overloaded',
  sprint_goal: 'Sprint goal',
};

export function digestTitle(now) {
  return `Sprint Sentinel digest — ${dateStamp(now)}`;
}

export function renderDigest({ projects = [], now, status }) {
  const title = digestTitle(now);
  const sections = projects.map((project) => {
    const risks = project.risks || [];
    const rows = risks.length
      ? risks.map((risk) => `<li><strong>${escapeHtml(TYPE_LABEL[risk.type] || risk.type)}</strong> (${escapeHtml(risk.severity)}): ${escapeHtml(risk.title)}. ${escapeHtml(truncate(risk.explanation || risk.fixSummary || '', 280))}</li>`).join('')
      : '<li>No open delivery risks on the last check.</li>';
    const sprint = project.sprint?.name
      ? `<p>Sprint: ${escapeHtml(project.sprint.name)}${project.sprint.goal ? ` — ${escapeHtml(truncate(project.sprint.goal, 180))}` : ''}</p>`
      : '<p>No active sprint was found. Open work was still checked.</p>';
    return `<h2>${escapeHtml(project.projectKey)}</h2>${sprint}<ul>${rows}</ul>`;
  }).join('');
  const health = status?.lastError
    ? `<p>Last error: ${escapeHtml(status.lastError)}</p>`
    : '<p>The watcher is healthy.</p>';
  const source = status?.grok?.lastSource === 'grok'
    ? `Explanations came from Grok (${escapeHtml(status.grok.lastModel || 'grok')}).`
    : 'Explanations used the deterministic rules because Grok was not configured or the call failed.';
  const storage = [
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>Sprint Sentinel watched the projects below and is waiting for a person to approve every change. ${escapeHtml(source)}</p>`,
    health,
    sections || '<p>No projects are being watched yet.</p>',
    '<p>Fixes stay as proposals until someone approves them in the Jira issue panel or project page.</p>',
  ].join('');
  const text = projects.map((project) => {
    const lines = (project.risks || []).map((risk) => `- ${TYPE_LABEL[risk.type] || risk.type}: ${risk.title}`);
    return `${project.projectKey}\n${lines.join('\n') || '- No open risks'}`;
  }).join('\n\n');
  return { title, storage, text: text || 'No projects are being watched yet.' };
}
