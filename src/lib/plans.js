import { truncate } from './text.js';

export function buildOperations(proposal) {
  if (!proposal || proposal.status !== 'approved') {
    throw new Error(`Proposal ${proposal?.id || ''} must be approved before it can change Jira`);
  }
  const fix = proposal.fix || {};
  const issueKey = fix.issueKey || proposal.issueKey;
  const rationale = truncate(fix.rationale || proposal.fixSummary || proposal.explanation || 'Approved in Sprint Sentinel.', 500);
  if (!issueKey) throw new Error('This proposal does not name a Jira issue.');
  const comment = (text) => ({ op: 'comment', issueKey, text });

  if (fix.kind === 'reassign') {
    if (!fix.accountId) throw new Error('Reassign needs an Atlassian account id.');
    return [
      { op: 'assign', issueKey, accountId: fix.accountId },
      comment(`Sprint Sentinel reassigned this issue after approval. ${rationale}`),
    ];
  }
  if (fix.kind === 'split') {
    return [
      {
        op: 'create-subtask',
        projectKey: fix.projectKey || issueKey.split('-')[0],
        parentKey: issueKey,
        summary: fix.summary || `Split from ${issueKey}`,
        description: rationale,
        storyPoints: Number.isFinite(Number(fix.splitPoints)) ? Number(fix.splitPoints) : null,
      },
      comment(`Sprint Sentinel opened a subtask for the extra scope after approval. ${rationale}`),
    ];
  }
  if (fix.kind === 'rescope') {
    const operations = [];
    if (Number.isFinite(Number(fix.storyPoints))) {
      operations.push({ op: 'estimate', issueKey, value: Number(fix.storyPoints) });
    }
    if (fix.removeFromSprint) operations.push({ op: 'backlog', issueKey });
    if (!operations.length) throw new Error('Re-scope needs a point estimate or a move to the backlog.');
    operations.push(comment(`Sprint Sentinel rescoped this issue after approval. ${rationale}`));
    return operations;
  }
  if (fix.kind === 'unblock') {
    const operations = [comment(`Sprint Sentinel unblock plan, approved by a person: ${rationale}`)];
    for (const blockerKey of fix.blockerKeys || []) {
      operations.push({
        op: 'comment',
        issueKey: blockerKey,
        text: `${issueKey} is waiting on this issue. ${rationale}`,
      });
    }
    return operations;
  }
  if (fix.kind === 'comment') {
    return [comment(fix.text || rationale)];
  }
  throw new Error(`Unsupported fix kind ${fix.kind || 'unknown'}`);
}
