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
