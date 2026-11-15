import { sanitizeThresholds } from './thresholds.js';
import { daysBetween, sprintElapsed } from './time.js';
import { truncate } from './text.js';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_RANK = { highest: 1, high: 2, medium: 3, low: 4, lowest: 5 };

function round1(value) {
  return Math.round(value * 10) / 10;
}

function priorityRank(name) {
  return PRIORITY_RANK[String(name || '').toLowerCase()] || 3;
}

function isDone(issue) {
  return issue?.statusCategory === 'done';
}

function completion(issues) {
  const list = issues || [];
  const withPoints = list.filter((issue) => Number(issue.storyPoints) > 0).length;
  const usePoints = list.length > 0 && withPoints >= Math.ceil(list.length / 2);
  if (usePoints) {
    const total = list.reduce((sum, issue) => sum + (Number(issue.storyPoints) || 0), 0);
    const done = list.filter(isDone).reduce((sum, issue) => sum + (Number(issue.storyPoints) || 0), 0);
    return { total, done, ratio: total ? done / total : 1, unit: 'points' };
  }
  const total = list.length;
  const done = list.filter(isDone).length;
  return { total, done, ratio: total ? done / total : 1, unit: 'issues' };
}

function leastLoaded(loads, overloadedIds) {
  let best = null;
  for (const load of loads.values()) {
    if (overloadedIds.has(load.accountId)) continue;
    if (!best || load.points < best.points || (load.points === best.points && load.count < best.count)) {
      best = load;
    }
  }
  return best;
}

function heaviestIssue(issues) {
  return [...issues].sort((a, b) => {
    const points = (Number(b.storyPoints) || 0) - (Number(a.storyPoints) || 0);
    if (points) return points;
    return String(a.updated || '').localeCompare(String(b.updated || ''));
  })[0];
}

export function detectRisks(snapshot, options = {}) {
  const now = options.now || new Date().toISOString();
  const thresholds = sanitizeThresholds(options.thresholds);
  const baselines = options.baselines || {};
  const issues = snapshot?.issues || [];
  const sprint = snapshot?.sprint || null;
  const projectKey = snapshot?.projectKey || null;
  const elapsed = sprintElapsed(sprint, now);
  const risks = [];

  const open = issues.filter((issue) => !isDone(issue));
  const loads = new Map();
  for (const issue of open) {
    if (!issue.assigneeAccountId) continue;
    const current = loads.get(issue.assigneeAccountId) || {
      accountId: issue.assigneeAccountId,
      name: issue.assigneeName || 'Assignee',
      count: 0,
      points: 0,
      issues: [],
    };
    current.count += 1;
    current.points += Number(issue.storyPoints) || 0;
    current.issues.push(issue);
    current.name = issue.assigneeName || current.name;
    loads.set(issue.assigneeAccountId, current);
  }

  const overloadedIds = new Set();
  for (const load of loads.values()) {
    const byCount = load.count >= thresholds.overloadIssueCount;
    const byPoints = load.points >= thresholds.overloadStoryPoints;
    if (!byCount && !byPoints) continue;
    overloadedIds.add(load.accountId);
  }
  const target = leastLoaded(loads, overloadedIds);

  for (const load of loads.values()) {
    if (!overloadedIds.has(load.accountId)) continue;
    const moving = heaviestIssue(load.issues);
    const severe = load.count >= thresholds.overloadIssueCount + 4
      || load.points >= thresholds.overloadStoryPoints * 1.5;
    const fix = target
      ? {
        kind: 'reassign',
        issueKey: moving.key,
        accountId: target.accountId,
        assigneeName: target.name,
        rationale: `Move ${moving.key} from ${load.name} (${load.count} open, ${load.points} points) to ${target.name} (${target.count} open, ${target.points} points).`,
      }
      : {
        kind: 'comment',
        issueKey: moving.key,
        rationale: `${load.name} is over capacity and nobody else in this sprint has room. A person needs to bring work in from outside the sprint or cut scope.`,
      };
    risks.push({
      id: `overloaded:${load.accountId}`,
      type: 'overloaded',
      severity: severe ? 'high' : 'medium',
      projectKey,
      assigneeAccountId: load.accountId,
      assigneeName: load.name,
      issueKey: moving.key,
      title: `${load.name} is carrying ${load.count} open issues (${load.points} points)`,
      evidence: {
        openIssues: load.count,
        storyPoints: load.points,
        issueKeys: load.issues.map((issue) => issue.key).slice(0, 12),
      },
      suggestedFix: fix,
    });
  }

  for (const issue of open) {
    const updatedDays = issue.updated ? daysBetween(now, issue.updated) : 0;
    const inProgress = issue.statusCategory === 'indeterminate';
    const todo = issue.statusCategory === 'new';
    if (inProgress && updatedDays >= thresholds.stalledInProgressDays) {
      const overloaded = overloadedIds.has(issue.assigneeAccountId);
      const fix = overloaded && target
        ? {
          kind: 'reassign',
          issueKey: issue.key,
          accountId: target.accountId,
          assigneeName: target.name,
          rationale: `${issue.key} has not moved in ${Math.floor(updatedDays)} days and ${issue.assigneeName || 'the assignee'} is already over capacity.`,
        }
        : {
          kind: 'comment',
          issueKey: issue.key,
          rationale: `Ask ${issue.assigneeName || 'the assignee'} for the next concrete step. The issue has sat in ${issue.statusName || 'progress'} for ${Math.floor(updatedDays)} days.`,
        };
      risks.push({
        id: `stalled:${issue.key}`,
        type: 'stalled',
        severity: updatedDays >= thresholds.stalledInProgressDays * 2 ? 'high' : 'medium',
        projectKey,
        issueKey: issue.key,
        title: `${issue.key} has not moved in ${Math.floor(updatedDays)} days`,
        evidence: {
          updatedDays: round1(updatedDays),
          status: issue.statusName,
          assigneeName: issue.assigneeName || 'Unassigned',
        },
        suggestedFix: fix,
      });
    } else if (todo && sprint && elapsed >= 0.5 && updatedDays >= thresholds.stalledTodoDays) {
      const lowPriority = priorityRank(issue.priority) >= 4;
      risks.push({
        id: `stalled:${issue.key}`,
        type: 'stalled',
        severity: 'medium',
        projectKey,
        issueKey: issue.key,
        title: `${issue.key} is still to do with the sprint ${Math.round(elapsed * 100)}% elapsed`,
        evidence: {
          updatedDays: round1(updatedDays),
          status: issue.statusName,
          elapsed: round1(elapsed),
          priority: issue.priority || 'Medium',
        },
        suggestedFix: lowPriority
          ? {
            kind: 'rescope',
            issueKey: issue.key,
            removeFromSprint: true,
            rationale: `${issue.key} is ${issue.priority || 'low'} priority and has not started. Move it to the backlog so the sprint goal stays honest.`,
          }
          : {
            kind: 'comment',
            issueKey: issue.key,
            rationale: `${issue.key} has not started and the sprint is ${Math.round(elapsed * 100)}% elapsed. Confirm it still belongs in this sprint.`,
          },
      });
    }

    const blockers = (issue.blockedBy || []).filter((blocker) => blocker.statusCategory !== 'done');
    if (blockers.length) {
      risks.push({
        id: `blocked:${issue.key}`,
        type: 'blocked',
        severity: 'high',
        projectKey,
        issueKey: issue.key,
        title: `${issue.key} is blocked by ${blockers.map((blocker) => blocker.key).join(', ')}`,
        evidence: {
          blockers: blockers.map((blocker) => ({
            key: blocker.key,
            status: blocker.statusName,
            summary: truncate(blocker.summary, 80),
          })),
        },
        suggestedFix: {
          kind: 'unblock',
          issueKey: issue.key,
          blockerKeys: blockers.map((blocker) => blocker.key),
          rationale: `Name the blocker in ${issue.key} and ask the owner of ${blockers.map((blocker) => blocker.key).join(', ')} for a date.`,
        },
      });
    }

    const baseline = baselines[issue.key];
    const points = Number(issue.storyPoints);
    let pointsRisk = false;
    if (baseline && Number.isFinite(points) && Number.isFinite(Number(baseline.storyPoints))) {
      const before = Number(baseline.storyPoints);
      const delta = points - before;
      const ratio = before > 0 ? points / before : Infinity;
      if (delta >= thresholds.scopePointsIncrease || (before > 0 && delta > 0 && ratio >= thresholds.scopePointsRatio)) {
        pointsRisk = true;
        const split = delta >= 5;
        risks.push({
          id: `scope_creep:${issue.key}`,
          type: 'scope_creep',
          severity: delta >= 8 ? 'high' : 'medium',
          projectKey,
          issueKey: issue.key,
          title: `${issue.key} grew from ${before} to ${points} points`,
          evidence: { before, after: points, delta },
          suggestedFix: split
            ? {
              kind: 'split',
              issueKey: issue.key,
              projectKey,
              splitPoints: delta,
              summary: `Split from ${issue.key}: ${truncate(issue.summary, 70)}`,
              rationale: `Keep ${before} points on ${issue.key} and move the extra ${delta} points into a subtask.`,
            }
            : {
              kind: 'rescope',
              issueKey: issue.key,
              storyPoints: before,
              rationale: `Restore ${issue.key} to the ${before} point estimate recorded on the previous check.`,
            },
        });
      }
    }

    if (!pointsRisk && sprint?.startDate && issue.created) {
      const createdAt = Date.parse(issue.created);
      const startedAt = Date.parse(sprint.startDate);
      const graceMs = thresholds.scopeAddedGraceHours * 60 * 60 * 1000;
      if (Number.isFinite(createdAt) && Number.isFinite(startedAt) && createdAt > startedAt + graceMs) {
        risks.push({
          id: `scope_creep:added:${issue.key}`,
          type: 'scope_creep',
          severity: (Number(issue.storyPoints) || 0) >= 5 ? 'medium' : 'low',
          projectKey,
          issueKey: issue.key,
          title: `${issue.key} was added after the sprint started`,
          evidence: {
            created: issue.created,
            sprintStart: sprint.startDate,
            storyPoints: issue.storyPoints,
          },
          suggestedFix: {
            kind: 'rescope',
            issueKey: issue.key,
            removeFromSprint: true,
            rationale: `${issue.key} was created after the planning window. Move it to the backlog unless the sprint goal depends on it.`,
          },
        });
      }
    }
  }

  if (sprint?.state === 'active' && issues.length >= 2) {
    const progress = completion(issues);
    if (elapsed >= thresholds.sprintElapsedMin && progress.ratio + thresholds.sprintSlippage < elapsed) {
      const todos = open.filter((issue) => issue.statusCategory === 'new');
      const candidate = [...todos].sort((a, b) => {
        const rank = priorityRank(b.priority) - priorityRank(a.priority);
        if (rank) return rank;
        return (Number(b.storyPoints) || 0) - (Number(a.storyPoints) || 0);
      })[0];
      const gap = round1(elapsed - progress.ratio);
      risks.push({
        id: `sprint_goal:${sprint.id || sprint.name || projectKey}`,
        type: 'sprint_goal',
        severity: gap >= 0.35 ? 'critical' : 'high',
        projectKey,
        issueKey: candidate?.key || open[0]?.key,
        title: `Sprint goal is behind: ${Math.round(elapsed * 100)}% of time elapsed, ${Math.round(progress.ratio * 100)}% of ${progress.unit} done`,
        evidence: {
          sprintName: sprint.name,
          goal: truncate(sprint.goal, 180),
          elapsed: round1(elapsed),
          completion: round1(progress.ratio),
          done: progress.done,
          total: progress.total,
          unit: progress.unit,
        },
        suggestedFix: candidate
          ? {
            kind: 'rescope',
            issueKey: candidate.key,
            removeFromSprint: true,
            rationale: `The sprint is ${Math.round(gap * 100)} points of progress behind the clock. Move not-started ${candidate.key} (${candidate.priority || 'unprioritized'}) out so the goal matches the remaining time.`,
          }
          : {
            kind: 'comment',
            issueKey: open[0].key,
            rationale: 'Everything left is already in progress. The team needs to cut the goal or accept the miss. This comment records that call.',
          },
      });
    }
  }

  return risks.sort((a, b) => (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || a.id.localeCompare(b.id));
}

export function applyGraphSignals(risks, snapshot, graph) {
  if (!graph?.ok) return risks;
  const next = risks.map((risk) => {
    const copy = { ...risk, evidence: { ...risk.evidence } };
    if (copy.type === 'overloaded' && graph.assignees?.[copy.assigneeAccountId]) {
      const count = graph.assignees[copy.assigneeAccountId].assignedCount;
      copy.evidence.graphAssignedCount = count;
      if (count >= 15 && copy.severity === 'medium') copy.severity = 'high';
    }
    const delivery = (graph.delivery || []).find((item) => item.issueKey === copy.issueKey);
    if (delivery) {
      copy.evidence.pullRequests = delivery.pullRequests;
      copy.evidence.deployments = delivery.deployments;
    }
    return copy;
  });

  const threshold = graph.overloadCount || 12;
  for (const [accountId, info] of Object.entries(graph.assignees || {})) {
    if ((info.assignedCount || 0) < threshold) continue;
    if (next.some((risk) => risk.type === 'overloaded' && risk.assigneeAccountId === accountId)) continue;
    const issue = (snapshot?.issues || []).find((item) => item.assigneeAccountId === accountId && !isDone(item));
    if (!issue) continue;
    next.push({
      id: `overloaded:graph:${accountId}`,
      type: 'overloaded',
      severity: info.assignedCount >= 20 ? 'high' : 'medium',
      projectKey: snapshot?.projectKey || null,
      assigneeAccountId: accountId,
      assigneeName: issue.assigneeName || 'Assignee',
      issueKey: issue.key,
      title: `${issue.assigneeName || 'Assignee'} has ${info.assignedCount} assigned items across the teamwork graph`,
      evidence: {
        graphAssignedCount: info.assignedCount,
        titles: info.titles || [],
        issueKeys: [issue.key],
      },
      suggestedFix: {
        kind: 'comment',
        issueKey: issue.key,
        rationale: `Teamwork Graph shows ${info.assignedCount} items assigned to this person, beyond this sprint. Confirm ${issue.key} is still the right commitment.`,
      },
    });
  }
  return next.sort((a, b) => (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || a.id.localeCompare(b.id));
}
