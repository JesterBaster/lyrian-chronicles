/**
 * Giving back what one use of an ability cost.
 *
 * Asked for by players: a mistaken click — the wrong ability, the wrong
 * target, a GM ruling it did not happen — meant opening the sheet and putting
 * AP, RP and mana back by hand, and remembering to clear "used this round".
 *
 * A use records exactly what it did on its own chat card, and a refund is the
 * inverse of that record. Nothing here guesses: a pool gets back the points
 * that use took from it, temporary points go back as temporary, and a mark is
 * cleared only if this use is the one that set it. Damage and healing already
 * applied are not touched — those went through their own buttons, and undoing
 * them is a GM's call, not a resource refund.
 */

export const REFUND_FLAG = "refund";
const POOLS = ["ap", "rp", "mana"];

/**
 * What one use did, as a record a chat card can carry.
 *
 * @param {object} use
 * @param {object|null} use.spent  From spendResources: `{pool: {temp, value}}`, or null if free.
 * @param {boolean} use.markedUsedThisRound
 * @param {boolean} use.markedSecretArt
 * @param {boolean} use.markedDualWield
 * @returns {object|null}  null when the use cost and marked nothing.
 */
export function refundRecord({
  actorUuid = "",
  itemUuid = "",
  itemName = "",
  spent = null,
  markedUsedThisRound = false,
  markedSecretArt = false,
  markedDualWield = false
} = {}) {
  const pools = {};
  for (const key of POOLS) {
    const temp = Math.max(0, Number(spent?.[key]?.temp) || 0);
    const value = Math.max(0, Number(spent?.[key]?.value) || 0);
    if (temp || value) pools[key] = { temp, value };
  }
  const marks = {
    usedThisRound: Boolean(markedUsedThisRound),
    secretArt: Boolean(markedSecretArt),
    dualWield: Boolean(markedDualWield)
  };
  if (!Object.keys(pools).length && !Object.values(marks).some(Boolean)) return null;
  return { actorUuid, itemUuid, itemName, pools, marks, refunded: false };
}

/** True when a card's record still has something to give back. */
export function isRefundable(record) {
  return Boolean(record && !record.refunded
    && (Object.keys(record.pools ?? {}).length || Object.values(record.marks ?? {}).some(Boolean)));
}

/**
 * The updates a refund makes, against the actor as it is now.
 *
 * A pool's regular points are capped at its maximum: if a rest or a new turn
 * has refilled it since, the refund cannot push it past full. Temporary points
 * come back exactly — they were the use's to spend and have no maximum.
 *
 * @param {object} record          From refundRecord.
 * @param {object} actorSystem     The actor's current `system`.
 * @returns {{actor: object, item: object, restored: object}}
 */
export function refundUpdates(record, actorSystem = {}) {
  const actor = {};
  const item = {};
  const restored = {};

  for (const [key, back] of Object.entries(record?.pools ?? {})) {
    const pool = actorSystem?.[key] ?? {};
    const value = Number(pool.value) || 0;
    const max = Number.isFinite(Number(pool.max)) ? Number(pool.max) : Infinity;
    const nextValue = Math.min(max, value + back.value);
    const nextTemp = (Number(pool.temp) || 0) + back.temp;
    if (back.value) actor[`system.${key}.value`] = nextValue;
    if (back.temp) actor[`system.${key}.temp`] = nextTemp;
    const given = (nextValue - value) + back.temp;
    if (given) restored[key] = given;
  }

  if (record?.marks?.secretArt) actor["system.encounter.secretArtUsed"] = false;
  if (record?.marks?.dualWield) actor["system.turn.dualWieldUsed"] = false;
  if (record?.marks?.usedThisRound) item["system.usedThisRound"] = false;

  return { actor, item, restored };
}

/** "2 AP, 1 Mana" — what a refund gave back, for the chat note. */
export function refundSummary(restored = {}, labels = { ap: "AP", rp: "RP", mana: "Mana" }) {
  return POOLS.filter((key) => restored[key]).map((key) => `${restored[key]} ${labels[key]}`).join(", ");
}
