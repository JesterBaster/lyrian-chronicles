/**
 * Which equipped weapons a character is actually holding.
 *
 * Hands are the constraint, not a count of equipped items. Per the rulebook a
 * One-Handed weapon "can be used at the same time as a shield or another
 * One-Handed weapon", a Two-Handed weapon needs both hands to attack with, and
 * unarmed strikes "cannot be used to make dual wield attacks".
 *
 * Weapons that cannot be held are reported as conflicts rather than dropped,
 * the same way a second suit of armour is, so the sheet can say why one is
 * inactive instead of appearing to ignore it.
 */

function isOneHanded(weapon) {
  return weapon?.system?.hands === "one";
}

function isUnarmed(weapon) {
  // The derived flag when the item is prepared; the group when it is raw data.
  return weapon?.system?.isUnarmed ?? weapon?.system?.group === "unarmed";
}

/**
 * @param {object[]} items                 Every owned item.
 * @param {object}  [options]
 * @param {boolean} [options.shieldEquipped]  A shield already occupies a hand.
 * @param {(weapon: object) => boolean} [options.proficientWith]
 *        Dual wielding is offered only for weapons the character can use.
 * @returns {{mainHand, offHand, conflicts, dualWielding, held}}
 */
export function equippedWeaponSlots(items = [], {
  shieldEquipped = false,
  proficientWith = () => true
} = {}) {
  const slots = { mainHand: null, offHand: null, conflicts: [], dualWielding: false, held: [] };

  for (const weapon of items) {
    if (weapon?.type !== "weapon" || !weapon.system?.equipped) continue;

    if (!slots.mainHand) {
      slots.mainHand = weapon;
      continue;
    }

    const pairable = !slots.offHand
      && !shieldEquipped
      && isOneHanded(slots.mainHand)
      && isOneHanded(weapon)
      && !isUnarmed(slots.mainHand)
      && !isUnarmed(weapon)
      && proficientWith(slots.mainHand)
      && proficientWith(weapon);

    if (pairable) {
      slots.offHand = weapon;
      slots.dualWielding = true;
      continue;
    }
    slots.conflicts.push(weapon);
  }

  slots.held = [slots.mainHand, slots.offHand].filter(Boolean);
  return slots;
}

/**
 * Which weapons to unequip so a newly equipped one can be held.
 *
 * Equipping is a switch rather than an accumulation: picking up a weapon puts
 * down whatever no longer fits, so the overview shows what the character is
 * holding instead of everything they have ever equipped.
 */
export function weaponsDisplacedBy(weapon, items = [], options = {}) {
  if (weapon?.type !== "weapon") return [];

  const others = Array.from(items).filter((item) =>
    item?.type === "weapon" && item.system?.equipped && item.id !== weapon.id);

  // Ask the slot rules what would be held with the new weapon in hand first.
  const slots = equippedWeaponSlots([{ ...weapon, system: { ...weapon.system, equipped: true } },
    ...others], options);
  const held = new Set(slots.held.map((item) => item.id));
  return others.filter((item) => !held.has(item.id));
}
