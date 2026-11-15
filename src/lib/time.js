export const DAY_MS = 24 * 60 * 60 * 1000;
export const SCAN_DEBOUNCE_MS = 10 * 60 * 1000;

export function parseTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function daysBetween(later, earlier) {
  const end = parseTime(later);
  const start = parseTime(earlier);
  if (end == null || start == null) return 0;
  return (end - start) / DAY_MS;
}

export function sprintElapsed(sprint, now) {
  const start = parseTime(sprint?.startDate);
  const end = parseTime(sprint?.endDate);
  const current = parseTime(now);
  if (start == null || end == null || current == null || end <= start) return 0;
  return Math.min(1, Math.max(0, (current - start) / (end - start)));
}

export function shouldRescan(lastScanAt, now, minIntervalMs = SCAN_DEBOUNCE_MS) {
  if (!lastScanAt) return true;
  const delta = (parseTime(now) ?? 0) - (parseTime(lastScanAt) ?? 0);
  if (!Number.isFinite(delta) || delta < 0) return true;
  return delta >= minIntervalMs;
}

export function dateStamp(now) {
  const time = parseTime(now) ?? Date.now();
  return new Date(time).toISOString().slice(0, 10);
}
