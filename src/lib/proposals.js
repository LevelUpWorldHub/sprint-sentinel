export function syncProposals(existing, risks, explanations, now) {
  const prior = new Map((existing || []).map((proposal) => [proposal.id, proposal]));
  const byRisk = new Map((explanations || []).map((item) => [item.riskId, item]));
  const next = [];
  for (const risk of risks) {
    const id = `proposal:${risk.id}`;
    const previous = prior.get(id);
    prior.delete(id);
    if (previous && (previous.status === 'dismissed' || previous.status === 'applied')) {
      next.push(previous);
      continue;
    }
    const explanation = byRisk.get(risk.id);
    next.push({
      id,
      riskId: risk.id,
      projectKey: risk.projectKey,
      type: risk.type,
      severity: risk.severity,
      issueKey: risk.issueKey || null,
      title: risk.title,
      status: 'pending',
      fix: explanation?.fix || risk.suggestedFix,
      explanation: explanation?.explanation || previous?.explanation || risk.title,
      fixSummary: explanation?.fixSummary || previous?.fixSummary || '',
      source: explanation?.source || 'fallback',
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      lastError: null,
    });
  }
  for (const leftover of prior.values()) {
    if (leftover.status === 'applied' || leftover.status === 'dismissed' || leftover.status === 'failed') {
      next.push(leftover);
    }
  }
  return next.slice(0, 100);
}

export function approveProposal(proposal, actor, now) {
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'pending' && proposal.status !== 'failed') {
    throw new Error(`Proposal ${proposal.id} is ${proposal.status} and cannot be approved`);
  }
  return { ...proposal, status: 'approved', decidedBy: actor, decidedAt: now, lastError: null };
}

export function dismissProposal(proposal, actor, now) {
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'pending' && proposal.status !== 'failed') {
    throw new Error(`Proposal ${proposal.id} is ${proposal.status} and cannot be dismissed`);
  }
  return { ...proposal, status: 'dismissed', decidedBy: actor, decidedAt: now };
}
