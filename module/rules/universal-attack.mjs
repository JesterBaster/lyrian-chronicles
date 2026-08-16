/**
 * Resolve the shared attack numbers for a weaponless Unarmed attack.
 * Character actors without Unarmed proficiency retain the normal flat-1 rule.
 */
export function universalAttackProfile({
  attackType,
  attackTypes,
  power = 0,
  focus = 0,
  standardAccuracy = 0,
  preciseAccuracy = 0,
  unarmedProficient = true
} = {}) {
  const profile = attackTypes?.[attackType];
  if (!profile) return null;

  const accuracyBonus = profile.accuracy === "doubleFocus"
    ? Number(preciseAccuracy) || 0
    : Number(standardAccuracy) || 0;
  const pinpoint = profile.pinpoint ? Number(focus) || 0 : 0;

  if (!unarmedProficient) {
    return { ap: profile.ap, accuracyBonus, damageFormula: "1", pinpoint };
  }

  const flat = (Number(power) || 0) * (Number(profile.powerMultiplier) || 0);
  const damageFormula = flat ? `${profile.damage} + ${flat}` : profile.damage;
  return { ap: profile.ap, accuracyBonus, damageFormula, pinpoint };
}

/** Build the weaponless actions exposed to HUD integrations. */
export function availableUniversalAttacks({
  actorType,
  hasEquippedWeapon = false,
  attackTypes = {},
  apTotal = 0
} = {}) {
  if (actorType !== "character" || hasEquippedWeapon) return [];
  return Object.entries(attackTypes).map(([type, profile]) => ({
    type,
    sourceKind: "universal",
    sourceProfile: "unarmed",
    apCost: profile.ap,
    affordable: apTotal >= profile.ap
  }));
}
