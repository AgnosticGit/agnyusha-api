/** Parse display weight label (e.g. "0,8 кг.") into grams. Fallback 800. */
export function estimateWeightGrams(weight: string): number {
  const normalized = weight.replace(',', '.').toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 800;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 800;
  if (/г(?!\w)|g\b/.test(normalized) && !/кг|kg/.test(normalized)) {
    return Math.max(100, Math.round(value));
  }
  return Math.max(100, Math.round(value * 1000));
}

/** Prefer explicit grams; fall back to parsing the display label. */
export function resolveWeightGrams(
  weightGrams: number | null | undefined,
  weightLabel: string,
): number {
  if (
    typeof weightGrams === 'number' &&
    Number.isFinite(weightGrams) &&
    weightGrams > 0
  ) {
    return Math.max(1, Math.round(weightGrams));
  }
  return estimateWeightGrams(weightLabel);
}
