/**
 * The dual wield follow-up attack.
 *
 * Rulebook: "If you use a One-Handed weapon in each hand, you can make dual
 * wield attacks. Once on your turn when making a basic light attack with a
 * One-Handed weapon, you may immediately make another light attack with the
 * second weapon for 0 AP."
 *
 * Three words carry all the weight:
 *
 *   "once on your turn"  — one free attack per turn, reset by refreshTurn.
 *   "another ... with the second weapon" — the follow-up has to come from the
 *       other hand. Swinging the same weapon twice is two paid attacks.
 *   "immediately" — anything else in between ends the window, so a light,
 *       heavy, light sequence does not smuggle the free attack out of order.
 *
 * The state is two fields on the actor rather than a listener on the attack
 * flow, so a reload mid-turn cannot hand the free attack back.
 */

/**
 * Decide whether this attack is the free one, and what the turn state becomes.
 *
 * @param {object}  [state]
 * @param {string}  [state.attackType]    "light" | "heavy" | "precise"
 * @param {string}  [state.weaponId]      The weapon being swung.
 * @param {string}  [state.mainHandId]    Held weapon, main hand.
 * @param {string}  [state.offHandId]     Held weapon, off hand.
 * @param {boolean} [state.dualWielding]  Both hands hold a pairable weapon.
 * @param {string}  [state.openerId]      Weapon that opened the window this turn.
 * @param {boolean} [state.used]          The free attack is already spent this turn.
 * @returns {{free: boolean, openerId: string, used: boolean}}
 *          `free` is whether to skip the AP cost; the other two are the turn
 *          state to store, whether or not anything changed.
 */
export function dualWieldFollowUp({
  attackType = "light",
  weaponId = "",
  mainHandId = "",
  offHandId = "",
  dualWielding = false,
  openerId = "",
  used = false
} = {}) {
  const held = weaponId && (weaponId === mainHandId || weaponId === offHandId);

  // Not dual wielding, or swinging something that is not in either hand: the
  // window is not open and nothing about it changes.
  if (!dualWielding || !held) return { free: false, openerId, used };

  // A heavy or precise attack is not the free follow-up and does not set one
  // up. It also breaks "immediately", so any window standing is closed.
  if (attackType !== "light") return { free: false, openerId: "", used };

  const partnerId = weaponId === mainHandId ? offHandId : mainHandId;

  // The free attack: a light attack with the other hand, straight after the
  // one that opened the window, and only if it has not been spent this turn.
  if (!used && openerId && openerId === partnerId) {
    return { free: true, openerId: "", used: true };
  }

  // Any other light attack opens a fresh window — including the second swing
  // of the same weapon, which is simply the start of a new pair.
  return { free: false, openerId: used ? "" : weaponId, used };
}

/**
 * The weapon whose light attack would currently be free, if any.
 *
 * The sheet uses this to label the button, so a player can see the free attack
 * before spending AP to find out it was there.
 */
export function pendingDualWieldWeaponId({
  mainHandId = "",
  offHandId = "",
  dualWielding = false,
  openerId = "",
  used = false
} = {}) {
  if (!dualWielding || used || !openerId) return "";
  if (openerId === mainHandId) return offHandId;
  if (openerId === offHandId) return mainHandId;
  return "";
}
