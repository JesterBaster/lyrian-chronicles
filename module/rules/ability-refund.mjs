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
 * When a use happened: the combat, round and turn it was made in.
 *
 * Each allowance a use spends resets on its own clock — dual wield and
 * once-per-round at the actor's next turn, a Secret Art at the next encounter.
 * A refund made later can therefore no longer tell whether the mark it would
 * clear is still this use's or a newer one's: use a Secret Art, start a new
 * encounter, use another, then refund the first card, and the second encounter
 * gets a third. So a use records its moment, and only a refund made in that
 * same moment may touch the allowances.
 *
 * @param {Combat|null} combat
 * @returns {{combat: string|null, round: number|null, turn: number|null}}
 */
export function refundWindow(combat) {
  if (!combat?.id) return { combat: null, round: null, turn: null };
  return {
    combat: combat.id,
    round: Number.isFinite(Number(combat.round)) ? Number(combat.round) : null,
    turn: Number.isFinite(Number(combat.turn)) ? Number(combat.turn) : null
  };
}

/**
 * Whether now is still the moment a use was made in.
 *
 * Out of combat both sides are empty and match: there are no turns for an
 * allowance to have reset in. A record with no window — written before windows
 * existed — is never the same moment, so it can only ever be a GM's refund.
 */
export function sameWindow(then, now) {
  if (!then || !now) return false;
  return then.combat === now.combat && then.round === now.round && then.turn === now.turn;
}

/**
 * Who may refund a card, now.
 *
 * The actor's owner, in the turn the use was made. A GM at any time — a GM
 * ruling a use never happened is the case a refund exists for — but outside
 * that turn only the resources come back, never an allowance.
 */
export function refundPermission({ isGM = false, isOwner = false, inWindow = false } = {}) {
  if (isGM) return { allowed: true, resetsAllowances: Boolean(inWindow) };
  if (isOwner && inWindow) return { allowed: true, resetsAllowances: true };
  return { allowed: false, resetsAllowances: false };
}

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
  markedDualWield = false,
  window = null
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
  return { actorUuid, itemUuid, itemName, pools, marks, window, refunded: false };
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
 * @param {{resetsAllowances?: boolean}} [options]  From refundPermission.
 * @returns {{actor: object, item: object, restored: object, resetAllowances: boolean}}
 */
export function refundUpdates(record, actorSystem = {}, { resetsAllowances = true } = {}) {
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

  // Outside the use's own turn an allowance may belong to a newer use, so it
  // is left as it is; only within that turn is it certainly this use's.
  const marks = resetsAllowances ? (record?.marks ?? {}) : {};
  if (marks.secretArt) actor["system.encounter.secretArtUsed"] = false;
  if (marks.dualWield) actor["system.turn.dualWieldUsed"] = false;
  if (marks.usedThisRound) item["system.usedThisRound"] = false;

  return { actor, item, restored, resetAllowances: Boolean(resetsAllowances) };
}

/** "2 AP, 1 Mana" — what a refund gave back, for the chat note. */
export function refundSummary(restored = {}, labels = { ap: "AP", rp: "RP", mana: "Mana" }) {
  return POOLS.filter((key) => restored[key]).map((key) => `${restored[key]} ${labels[key]}`).join(", ");
}
