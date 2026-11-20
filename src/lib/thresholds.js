export const DEFAULT_THRESHOLDS = {
  stalledInProgressDays: 3,
  stalledTodoDays: 5,
  overloadIssueCount: 8,
  overloadStoryPoints: 21,
  scopePointsIncrease: 3,
  scopePointsRatio: 1.3,
  scopeAddedGraceHours: 24,
  sprintSlippage: 0.15,
  sprintElapsedMin: 0.4,
  graphOverloadCount: 12,
};

const LIMITS = {
  stalledInProgressDays: [1, 30],
  stalledTodoDays: [1, 30],
  overloadIssueCount: [2, 40],
  overloadStoryPoints: [3, 200],
  scopePointsIncrease: [1, 50],
  scopePointsRatio: [1.05, 5],
  scopeAddedGraceHours: [0, 168],
  sprintSlippage: [0.05, 0.8],
  sprintElapsedMin: [0.1, 0.9],
  graphOverloadCount: [5, 50],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** A setting counts only when it is a real number. Blank, null, and non-numeric values mean "use the default". */
function readSetting(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function sanitizeThresholds(input = {}) {
  const next = { ...DEFAULT_THRESHOLDS };
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const value = readSetting(input?.[key]);
    if (value !== null) next[key] = clamp(value, min, max);
  }
  return next;
}
