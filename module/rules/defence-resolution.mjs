/**
 * Resolve whether an attack connects after the defender chooses a reaction.
 * This is deliberately free of Foundry globals so the rule can be unit tested.
 */
export function resolveDefence({ defence = "none", attackTotal = null, sureHit = false,
  originalHit = false, untargetable = false, dodgeEvasion = 0 } = {}) {
  if (untargetable) return { hits: false, rpCost: 0, reason: "untargetable" };

  if (defence === "block") {
    return { hits: true, rpCost: 1, reason: "blocked" };
  }

  if (defence === "dodge") {
    const hits = !!sureHit || Number(attackTotal ?? -Infinity) >= Number(dodgeEvasion);
    return { hits, rpCost: 1, reason: hits ? "dodge-failed" : "dodged" };
  }

  return { hits: !!originalHit, rpCost: 0, reason: originalHit ? "hit" : "missed" };
}
