import { plural, truncate } from './text.js';

const KIND_LABEL = {
  reassign: 'Reassign',
  split: 'Split',
  rescope: 'Re-scope',
  unblock: 'Unblock',
  comment: 'Comment',
};

export function fixSummary(fix, risk) {
  if (!fix) return 'Review this with the team before changing the sprint.';
  if (fix.kind === 'reassign') {
    return `Reassign ${fix.issueKey} to ${fix.assigneeName || fix.accountId}. ${fix.rationale || ''}`.trim();
  }
  if (fix.kind === 'split') {
    return `Split ${fix.splitPoints || 'the extra'} points out of ${fix.issueKey} into a subtask.`;
  }
  if (fix.kind === 'rescope' && fix.removeFromSprint) {
    return `Move ${fix.issueKey} to the backlog.`;
  }
  if (fix.kind === 'rescope' && Number.isFinite(Number(fix.storyPoints))) {
    return `Set ${fix.issueKey} back to ${fix.storyPoints} story points.`;
  }
  if (fix.kind === 'unblock') {
    return `Post an unblock note on ${fix.issueKey} and ${(fix.blockerKeys || []).join(', ') || 'its blocker'}.`;
  }
  return truncate(fix.rationale || risk?.title || 'Leave a checkpoint comment.', 240);
}

function explanationFor(risk) {
  const evidence = risk.evidence || {};
  if (risk.type === 'stalled') {
    return `${risk.issueKey} is ${evidence.status || 'open'} and last changed ${evidence.updatedDays ?? 'several'} days ago. ${risk.suggestedFix?.rationale || ''}`.trim();
  }
  if (risk.type === 'blocked') {
    const blockers = (evidence.blockers || []).map((blocker) => `${blocker.key} (${blocker.status || 'open'})`).join(', ');
    return `${risk.issueKey} cannot finish while ${blockers || 'a linked issue'} is still open.`;
  }
  if (risk.type === 'scope_creep' && evidence.delta != null) {
    return `${risk.issueKey} picked up ${evidence.delta} story points since the last check (${evidence.before} to ${evidence.after}).`;
  }
  if (risk.type === 'scope_creep') {
    return `${risk.issueKey} entered the sprint after planning. That is scope the goal did not account for.`;
  }
  if (risk.type === 'overloaded') {
    const graph = evidence.graphAssignedCount;
    const local = evidence.openIssues != null
      ? `${evidence.assigneeName || risk.assigneeName || 'This person'} has ${plural(evidence.openIssues, 'open issue')} and ${evidence.storyPoints ?? 0} points in this project.`
      : `${risk.assigneeName || 'This person'} is carrying work beyond this sprint.`;
    return graph ? `${local} Teamwork Graph also shows ${plural(graph, 'assigned item')}.` : local;
  }
  if (risk.type === 'sprint_goal') {
    const goal = evidence.goal ? ` Goal: ${evidence.goal}` : '';
    return `${evidence.sprintName || 'The sprint'} has used ${Math.round((evidence.elapsed || 0) * 100)}% of its time and completed ${evidence.done ?? 0} of ${evidence.total ?? 0} ${evidence.unit || 'items'}.${goal}`;
  }
  return risk.title;
}

export function fallbackExplanation(risk) {
  const fix = risk.suggestedFix || { kind: 'comment', issueKey: risk.issueKey, rationale: risk.title };
  return {
    riskId: risk.id,
    explanation: truncate(explanationFor(risk), 600),
    fixSummary: truncate(fixSummary(fix, risk), 300),
    fix,
    source: 'fallback',
    label: KIND_LABEL[fix.kind] || 'Review',
  };
}
