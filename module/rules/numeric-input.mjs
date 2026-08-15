/**
 * Normalize a rules amount that must be a whole number at or above zero.
 * Returns null instead of allowing malformed API or macro input to mutate data.
 */
export function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && Number.isInteger(number) && number >= 0
    ? number
    : null;
}

/** Normalize a rules amount that must be a positive whole number. */
export function positiveInteger(value) {
  const number = nonNegativeInteger(value);
  return number && number > 0 ? number : null;
}

/** Validate and normalize the three spendable action-resource costs. */
export function normalizeResourceCosts({ ap = 0, rp = 0, mana = 0 } = {}) {
  const costs = {
    ap: nonNegativeInteger(ap),
    rp: nonNegativeInteger(rp),
    mana: nonNegativeInteger(mana)
  };
  return Object.values(costs).some((value) => value === null) ? null : costs;
}
