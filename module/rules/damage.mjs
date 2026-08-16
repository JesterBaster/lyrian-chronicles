export function derivedGuardValues({
  toughness = 0,
  equipmentGuard = 0,
  equipmentBlockValue = 0,
  guardBonus = 0,
  blockBonus = 0
} = {}) {
  return {
    guard: Math.max(0, equipmentGuard + toughness + guardBonus),
    blockGuard: Math.max(0, 2 * toughness + equipmentBlockValue + blockBonus)
  };
}

/**
 * Half Pierce ignores Guard unless the defender Dodges or Blocks.
 * Despite its name, the official keyword does not numerically halve Guard.
 */
export function guardForDamage({
  defence = "none",
  guard = 0,
  blockGuard = 0,
  fullPierce = false,
  halfPierce = false,
  pinpoint = 0
} = {}) {
  if (fullPierce || (halfPierce && defence === "none")) return 0;
  const baseGuard = defence === "block" ? blockGuard : guard;
  return Math.max(0, baseGuard - Math.max(0, pinpoint));
}
