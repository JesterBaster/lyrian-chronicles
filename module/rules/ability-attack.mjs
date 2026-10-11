export function abilityWeaponAttackContext({
  ability = {},
  weapon = null,
  profile = {},
  accuracy = {}
} = {}) {
  const weaponDriven = !!weapon && (ability.usesWeapon || !ability.damageFormula);
  const baseAccuracy = profile.accuracy === "doubleFocus"
    ? (accuracy.precise ?? 0)
    : (accuracy.standard ?? 0);
  return {
    weapon: weaponDriven ? weapon : null,
    accuracyBonus: baseAccuracy + (weaponDriven ? (weapon.system?.accuracyBonus ?? 0) : 0),
    critThreshold: weaponDriven ? (weapon.system?.effectiveCrit ?? 20) : 20,
    weaponGroup: weaponDriven ? (weapon.system?.group ?? null) : null,
    ranged: weaponDriven ? !!weapon.system?.isRanged : null
  };
}

/** Apply one shared natural-roll critical threshold across every attack path. */
export function isCriticalHit(natural, threshold = 20) {
  const roll = Number(natural);
  const target = Number(threshold);
  return Number.isFinite(roll) && Number.isFinite(target) && roll >= target;
}

/** The most strikes one use of an ability makes. Maximum Firerate's 8 is the rulebook's largest. */
export const MAX_ABILITY_ATTACKS = 12;

/**
 * How many times one use of an ability makes its attack.
 *
 * Anything that is not a whole number from 1 up reads as 1, so an ability
 * saved before the field existed, or edited to nonsense, attacks once rather
 * than not at all.
 */
export function abilityAttackCount(value) {
  const count = Math.trunc(Number(value));
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(MAX_ABILITY_ATTACKS, count);
}
