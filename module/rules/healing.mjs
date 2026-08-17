/**
 * Clamp a rolled or card-supplied healing amount to a whole, non-negative number.
 *
 * Applied to the value read back off a chat card as well as the freshly rolled
 * one: the card's flags travel through the client, so the amount is treated as
 * untrusted input on the way back in.
 */
export function normalizeHealingAmount(value) {
  const amount = Math.floor(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/** Build the stable payload stored on healing chat messages and emitted by the hook. */
export function buildHealingPayload({ actorUuid, itemUuid, itemName, roll }) {
  return {
    actorUuid: String(actorUuid ?? ""),
    itemUuid: String(itemUuid ?? ""),
    itemName: String(itemName ?? ""),
    total: normalizeHealingAmount(roll?.total),
    formula: String(roll?.formula ?? "")
  };
}
