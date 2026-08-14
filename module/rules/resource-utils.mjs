/**
 * Adjust a resource pool while preserving the system's temporary-first rule.
 * Negative changes consume temporary points before the normal pool. Positive
 * changes restore only the normal pool; temporary points are granted and
 * cleared explicitly by their source.
 *
 * @param {{ value?: number, temp?: number }} pool
 * @param {number} delta
 * @param {{ floor?: number }} [options]
 * @returns {{ value: number, temp: number }}
 */
export function adjustResourcePool(pool, delta, { floor = 0 } = {}) {
  const value = Number(pool?.value ?? 0);
  const temp = Math.max(0, Number(pool?.temp ?? 0));
  const change = Number(delta);

  if (!Number.isFinite(change) || change === 0) return { value, temp };

  if (change > 0) return { value: value + change, temp };

  let remaining = -change;
  const fromTemp = Math.min(temp, remaining);
  remaining -= fromTemp;

  return {
    value: Math.max(floor, value - remaining),
    temp: temp - fromTemp
  };
}
