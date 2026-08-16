import { LYRIAN } from "../config.mjs";

export function armorValues(system = {}) {
  const category = LYRIAN.armorCategories[system.category] ?? LYRIAN.armorCategories.clothing;
  return {
    category,
    isShield: !!category.isShield,
    guard: (category.guard ?? 0) + (system.guardBonus ?? 0),
    blockValue: (category.block ?? 0) + (system.blockBonus ?? 0),
    evasion: category.evasion ?? 0,
    initiative: category.initiative ?? 0
  };
}

export function equippedArmorContribution(system = {}) {
  const values = armorValues(system);
  const penalty = system.proficient === false
    ? LYRIAN.nonProficientArmorPenalty
    : { guard: 0, evasion: 0 };
  return {
    ...values,
    guard: values.guard + (penalty.guard ?? 0),
    evasion: values.evasion + (penalty.evasion ?? 0)
  };
}

/**
 * Select the one body-armour and one shield contribution that can apply.
 * Later equipped items remain visible as conflicts instead of disappearing.
 */
export function equippedArmorSlots(items = []) {
  const slots = { armor: null, shield: null, conflicts: [] };
  for (const item of items) {
    if (item?.type !== "armor" || !item.system?.equipped) continue;
    const slot = armorValues(item.system).isShield ? "shield" : "armor";
    if (!slots[slot]) {
      slots[slot] = item;
    } else {
      slots.conflicts.push({ slot, active: slots[slot], item });
    }
  }
  return slots;
}
