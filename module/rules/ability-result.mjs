/**
 * Stable result shape returned by ability and monster-ability actions.
 * Existing attack consumers can keep reading attackRoll, damageRoll, and isCrit.
 */
export function abilityRefused(reason) {
  return {
    ok: false,
    reason,
    attackRoll: null,
    damageRoll: null,
    isCrit: false,
    message: null,
    attacks: []
  };
}

export function abilitySucceeded({
  attackRoll = null,
  damageRoll = null,
  isCrit = false,
  message = null,
  attacks = []
} = {}) {
  return {
    ok: true,
    reason: null,
    attackRoll,
    damageRoll,
    isCrit: Boolean(isCrit),
    message,
    // Every strike, for an ability that makes several. The fields above are
    // the first strike's, so a consumer reading only them sees what it always
    // did; this is added beside them, never in place of them.
    attacks: Array.isArray(attacks) ? attacks : []
  };
}
