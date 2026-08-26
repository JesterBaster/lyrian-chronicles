/**
 * What a finished craft is worth, by the source spreadsheet's Book Price rule.
 *
 * "When pricing crafts there are three factors. (Book Price)
 *  - Base Item Cost
 *  - Mod Cost (250c per 10cp, or 25c per 1cp)
 *  - Material Cost"
 *
 * Checked against the second worked example, which prices exactly:
 *
 *   Set of Missiles (500c) + Dark Iron Ingot (550c)
 *   + Alloying Dark Iron 15cp (375c) + Featherflight 35cp (875c)
 *   + Momentum 25cp (625c)                                       = 2925c
 *
 * The examples also write "Iron Ingot (Ignored)" against the baseline metal a
 * recipe already includes in the item's own price. Nothing in the data marks
 * which material that is — Iron and Tamahagane are both plain rows in the
 * metals table — so every material a project lists is priced here and the
 * breakdown is reported line by line. A GM who wants the baseline ingot free
 * can see which line to drop; guessing it would silently misprice the craft.
 */

/** Clim per crafting point, from the sheet's "25c per 1cp". */
export const CLIM_PER_CRAFTING_POINT = 25;

/**
 * Read a Clim figure out of the strings the compendium ships.
 *
 * Costs arrive as "1,050 Clim", "300c", "Original Weapon + 3000" or plain
 * numbers. Only the first number is taken: "Original Weapon + 3000" prices the
 * artifice conversion, not the weapon under it, and inventing a total for the
 * weapon is not this function's call.
 */
export function parseClim(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

/** The Clim a Mod adds to the price, from its crafting-point cost. */
export function modClim(craftingPoints) {
  const points = Math.max(0, Math.trunc(Number(craftingPoints) || 0));
  return points * CLIM_PER_CRAFTING_POINT;
}

/**
 * Price a craft.
 *
 * @param {object}   [options]
 * @param {object}   [options.base]       The item data a success creates.
 * @param {object[]} [options.mods]       Mods installed, each with a crafting-point cost.
 * @param {object[]} [options.materials]  Material lines spent: name, quantity, cost, unitCost.
 * @returns {{base: number, mods: number, materials: number, total: number, lines: object[]}}
 */
export function craftValue({ base = null, mods = [], materials = [] } = {}) {
  const lines = [];

  const baseClim = parseClim(base?.system?.cost);
  if (base) {
    lines.push({ kind: "base", name: base.name ?? "", clim: baseClim });
  }

  let modsClim = 0;
  for (const mod of mods ?? []) {
    const points = Number(mod?.cost ?? mod?.system?.craftingPoints ?? 0);
    const clim = modClim(points);
    modsClim += clim;
    lines.push({ kind: "mod", name: mod?.name ?? "", points: Math.max(0, Math.trunc(points) || 0), clim });
  }

  let materialsClim = 0;
  for (const line of materials ?? []) {
    // The sheet prices a material by the lot it is sold in — "Tamahagane
    // 1050c / 2000u" means 1050 Clim buys the 2000-unit lot a craft draws an
    // ingot from — while a project row spends units off a stack. Pricing per
    // unit reconciles the two: 2000 units of Tamahagane costs 1050c, which is
    // what the worked example pays for its one ingot.
    //
    // A material sold by the piece ("1 Core", "1 Hide") has no unit count, so
    // the lot is one and the row's quantity multiplies the listed cost.
    const each = parseClim(line?.cost);
    const perLot = Math.max(1, parseClim(line?.unitCost) || 1);
    const quantity = Math.max(0, Math.trunc(Number(line?.quantity ?? 1) || 0));
    const clim = Math.round((each * quantity) / perLot);
    materialsClim += clim;
    lines.push({ kind: "material", name: line?.name ?? "", quantity, clim });
  }

  return {
    base: baseClim,
    mods: modsClim,
    materials: materialsClim,
    total: baseClim + modsClim + materialsClim,
    lines
  };
}
