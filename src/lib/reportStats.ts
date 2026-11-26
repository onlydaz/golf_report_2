/** Reference capability from sample deviation and current configuration limits. */
export function referenceCpk(count: number, mean: number | null | undefined, deviation: number | null | undefined, limits?: [number, number] | null): number | null {
  if (count < 2 || mean == null || deviation == null || !Number.isFinite(mean) || !Number.isFinite(deviation) || deviation <= 0 ||
      !limits || !limits.every(Number.isFinite) || limits[0] >= limits[1]) return null;
  const value = Math.min(limits[1] - mean, mean - limits[0]) / (3 * deviation);
  return Number.isFinite(value) ? value : null;
}
