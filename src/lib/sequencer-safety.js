export const MIN_BPM = 40;
export const MAX_BPM = 300;
export const DEFAULT_BPM = 120;

function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampBpm(value) {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)));
}

export function normalizeBpm(value, fallback = DEFAULT_BPM) {
  const parsed = toFiniteNumber(value);
  if (parsed !== null) return clampBpm(parsed);

  const parsedFallback = toFiniteNumber(fallback);
  return clampBpm(parsedFallback === null ? DEFAULT_BPM : parsedFallback);
}

export function getSixteenthNoteDurationSeconds(value) {
  return 60 / normalizeBpm(value) / 4;
}
