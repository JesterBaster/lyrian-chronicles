/**
 * Reading a filled character sheet back out of the workbook.
 *
 * The inverse of `character-sheet-export`, and deliberately its mirror image:
 * both find their rows by reading the template's own labels, so a sheet that
 * exported cleanly reads back cleanly, and a revised template moves both at
 * once. The round-trip test is the point — a view that goes out and comes back
 * unchanged is the only real proof the two halves agree.
 *
 * What comes back is the same plain `character` view the export takes, not an
 * actor. Turning names into documents is somebody else's job, because it needs
 * the compendiums and this needs nothing.
 */

import { sameLabel } from "./character-sheet-export.mjs";

/** A cell's number, or 0 — the sheet stores everything as text. */
function number(value) {
  const parsed = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value) {
  return String(value ?? "").trim();
}

/**
 * Read the Core tab.
 *
 * Stats come back the way they went in: column B holds which stat took each
 * slot of the creation array and column A holds the slot's value, so the pick
 * is read from the pair rather than from a total that no longer exists on the
 * sheet. Bonuses sit on their own rows, keyed by the stat's label.
 *
 * @param {(ref: string) => string} read   Reads a cell's displayed value.
 * @param {object} layout                  From `discoverCoreLayout`.
 */
export function readCoreSheet(read, layout = {}) {
  const identity = {
    gender: text(read("B3")),
    age: text(read("B4")),
    height: text(read("B5")),
    weight: text(read("B6")),
    worships: text(read("B7"))
  };

  const stats = (arrayValues, pickColumn, labelRows, bonusColumn) => {
    const found = new Map();
    (arrayValues ?? []).forEach((slot, index) => {
      const row = 45 + index;
      const label = text(read(`${pickColumn}${row}`));
      if (label) found.set(label, { label, value: number(slot), bonus: 0 });
    });
    for (const [row, label] of (labelRows ?? new Map())) {
      const bonus = number(read(`${bonusColumn}${row}`));
      if (!bonus) continue;
      // The bonus rows are the sheet's own list of stats, so a bonus can name a
      // stat that took no array slot — a stat left at zero and raised since.
      const entry = [...found.values()].find((stat) => sameLabel(stat.label, label));
      if (entry) entry.bonus = bonus;
      else found.set(label, { label, value: 0, bonus });
    }
    return [...found.values()];
  };

  const skills = [];
  for (const [label, row] of (layout.skillRows ?? new Map())) {
    const rank = number(read(`H${row}`));
    const expertise = text(read(`I${row}`));
    if (rank || expertise) skills.push({ label, rank, expertise });
  }

  const craftingSkills = [];
  for (const row of (layout.craftingRows ?? [])) {
    const label = text(read(`N${row}`));
    if (label) craftingSkills.push({ label, rank: number(read(`P${row}`)) });
  }

  const classes = [];
  for (const row of (layout.classRows ?? [])) {
    const name = text(read(`A${row}`));
    if (name) classes.push({ name, level: number(read(`C${row}`)) || 1 });
  }

  return {
    name: text(read("B2")),
    race: text(read("D2")),
    subRace: text(read("D3")),
    identity,
    mainStats: stats(layout.mainStatArray, "B", layout.mainBonusRows, "F"),
    subStats: stats(layout.subStatArray, "D", layout.subBonusRows, "H"),
    skills,
    craftingSkills,
    classes
  };
}

/**
 * Read the Abilities tab.
 *
 * @param {(column: string) => Map<number, object>} columns
 * @param {{active: number[], passive: number[]}} layout
 */
export function readAbilitySheet(columns, layout = {}) {
  const names = columns("A");
  const block = (rows, passive) => (rows ?? [])
    .map((row) => text(names.get(row)?.value))
    .filter(Boolean)
    .map((name) => ({ name, passive }));

  return [...block(layout.active, false), ...block(layout.passive, true)];
}

/** Read the Breakthrough tab, names and the EXP the player recorded spending. */
export function readBreakthroughSheet(columns, layout = {}) {
  const names = columns("A");
  const costs = columns("B");
  return (layout.rows ?? [])
    .map((row) => ({ name: text(names.get(row)?.value), expCost: number(costs.get(row)?.value) }))
    .filter((entry) => entry.name);
}

/** Read the Inventory tab. */
export function readInventorySheet(columns, layout = {}) {
  const [names, where, amount, burden, value, description] =
    ["A", "B", "C", "D", "E", "G"].map((column) => columns(column));

  return (layout.rows ?? [])
    .map((row) => ({
      name: text(names.get(row)?.value),
      location: text(where.get(row)?.value),
      quantity: number(amount.get(row)?.value) || 1,
      burden: number(burden.get(row)?.value),
      value: number(value.get(row)?.value),
      description: text(description.get(row)?.value)
    }))
    .filter((entry) => entry.name);
}
