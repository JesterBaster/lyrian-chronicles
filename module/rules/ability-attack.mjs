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
