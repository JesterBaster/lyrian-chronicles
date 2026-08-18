/**
 * Planning for a multi-attack action.
 *
 * A multi-attack is several basic attacks resolved from one activation, mixing
 * Light, Heavy and Precise freely. The whole cost is charged once up front
 * rather than per swing, so a sequence can never spend for two attacks and
 * then fail to afford the third, leaving the actor paid-up for nothing.
 */

/**
 * Ceiling on how many of one type a single action may contain.
 *
 * AP normally bounds this far below the cap. The cap exists for free attacks,
 * which skip payment entirely, so a mistyped count cannot fire hundreds of
 * rolls into chat.
 */
export const MAX_PER_TYPE = 20;

/** Turn a form's per-type counts into an ordered, validated plan. */
export function normalizeAttackCounts(counts = {}, attackTypes = {}) {
  const plan = [];
  for (const type of Object.keys(attackTypes)) {
    const raw = Math.floor(Number(counts?.[type]));
    if (!Number.isFinite(raw) || raw <= 0) continue;
    plan.push({ type, count: Math.min(raw, MAX_PER_TYPE) });
  }
  return plan;
}

/** Total AP a plan costs. */
export function multiAttackCost(plan = [], attackTypes = {}) {
  return plan.reduce(
    (total, { type, count }) => total + (Number(attackTypes[type]?.ap) || 0) * count,
    0
  );
}

/** How many swings a plan contains. */
export function totalAttacks(plan = []) {
  return plan.reduce((total, { count }) => total + count, 0);
}

/**
 * Flatten a plan into the order the attacks resolve in.
 * Grouped by type rather than interleaved, so a chat log reads as "two Light,
 * then a Heavy" instead of alternating.
 */
export function expandAttackPlan(plan = []) {
  return plan.flatMap(({ type, count }) => Array.from({ length: count }, () => type));
}
