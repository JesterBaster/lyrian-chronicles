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
    message: null
  };
}

export function abilitySucceeded({
  attackRoll = null,
  damageRoll = null,
  isCrit = false,
  message = null
} = {}) {
  return {
    ok: true,
    reason: null,
    attackRoll,
    damageRoll,
    isCrit: Boolean(isCrit),
    message
  };
}
