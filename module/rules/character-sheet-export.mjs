/**
 * Filling the Angel's Sword character sheet from an actor.
 *
 * The sheet is a calculator, not a form: of its Core tab, the stats, HP,
 * evasion, guard, damage and class costs are all formulas. So this writes only
 * what a player would type — the creation array, skill points, class rows —
 * and lets the workbook do its own arithmetic. That is also what makes the
 * result worth having: the sheet's numbers become an independent check on the
 * system's rather than a copy of them.
 *
 * Rows are found by reading the template's own labels rather than hardcoded,
 * because a hardcoded row silently writes a character's Stealth points into
 * their Deception the day someone inserts a line.
 */

/** Compare two sheet labels the way a reader would. */
export function sameLabel(a, b) {
  // Punctuation goes before whitespace collapses, not after: dropping the "&"
  // from "EXP & Transactions" leaves two spaces behind, and a collapse that has
  // already run will not tidy them.
  const clean = (value) => String(value ?? "")
    .replace(/[^a-z0-9\s]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return clean(a) === clean(b) && clean(a) !== "";
}

/**
 * Find the rows a block occupies by scanning one column for its labels.
 *
 * @param {(ref: string) => string} read   Reads a cell's displayed value.
 * @param {object} options
 * @returns {Map<string, number>}  label → row
 */
export function locateRows(read, { column, from, to, labels }) {
  const found = new Map();
  const wanted = [...labels];
  for (let row = from; row <= to; row += 1) {
    const value = read(`${column}${row}`);
    if (!value) continue;
    const match = wanted.find((label) => sameLabel(label, value));
    if (match && !found.has(match)) found.set(match, row);
  }
  return found;
}

/**
 * The rows a free list occupies.
 *
 * A plain range, and not "the blank ones in the range" as this once was.
 * Blankness is a property of an empty template, not of the block: on a sheet
 * that already holds three crafting skills it names rows four to six, so
 * re-exporting the same character appends a second copy below the first. It
 * also makes the block unfindable when reading a filled sheet back, which is
 * the same bug wearing a different hat.
 */
export function rowRange(from, to) {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
}

/**
 * Assign each stat to a slot in the creation array.
 *
 * The sheet derives every stat from which stat was given which number, so this
 * has to run backwards: the array is fixed (5, 4, 4, 3) and the character's
 * base values say who took what. `value` is the array pick and `bonus` is
 * everything added since, which the schema already keeps apart — no guessing.
 *
 * A character whose values do not form the array at all (hand-edited, or built
 * before a rule changed) is reported rather than forced: writing a wrong pick
 * would change their stats on arrival.
 *
 * @param {object[]} stats   `{ key, label, value }`, one per stat.
 * @param {number[]} array   The slot values, in sheet order.
 * @returns {{picks: string[], unmatched: object[]}}
 */
export function assignStatArray(stats = [], array = []) {
  const remaining = stats.map((stat) => ({ ...stat }));
  const picks = [];
  const unmatched = [];

  for (const slot of array) {
    const index = remaining.findIndex((stat) => Number(stat.value) === Number(slot));
    if (index === -1) {
      picks.push("");
      continue;
    }
    picks.push(remaining[index].label);
    remaining.splice(index, 1);
  }

  // Anything left over never found a slot, which means the character's spread
  // is not the one this sheet is built around.
  for (const stat of remaining) unmatched.push({ key: stat.key, value: stat.value });
  return { picks, unmatched };
}

/**
 * The skills the Core tab lists, in the sheet's own words.
 *
 * Held here only so the scan knows what to look for; where each one sits is
 * read from the template, never assumed.
 */
export const CORE_SKILL_LABELS = Object.freeze([
  "Athletics", "Riding", "Stealth", "Deception", "Roguecraft", "Medicine",
  "Common Knowledge", "Linguistics", "Magic", "Religion", "Appraise", "History",
  "Flight", "Artifice", "Perception", "Insight", "Survival", "Animal Husbandry",
  "Art", "Negotiation", "Intimidation"
]);

/**
 * Work out where everything lives by reading the template.
 *
 * @param {(ref: string) => string} read  Reads a cell's displayed value.
 * @returns {object} The layout `coreSheetCells` expects.
 */
export function discoverCoreLayout(read) {
  const number = (ref) => {
    const value = Number(read(ref));
    return Number.isFinite(value) ? value : null;
  };
  const arrayFrom = (column, rows) => rows.map((row) => number(`${column}${row}`))
    .filter((value) => value !== null);

  return {
    mainStatArray: arrayFrom("A", [45, 46, 47, 48]),
    subStatArray: arrayFrom("C", [45, 46, 47, 48, 49]),
    mainBonusRows: new Map([45, 46, 47, 48]
      .map((row) => [row, read(`E${row}`)]).filter(([, label]) => label)),
    subBonusRows: new Map([45, 46, 47, 48, 49]
      .map((row) => [row, read(`G${row}`)]).filter(([, label]) => label)),
    skillRows: locateRows(read, {
      column: "E", from: 9, to: 35, labels: CORE_SKILL_LABELS
    }),
    craftingRows: rowRange(9, 14),
    classRows: rowRange(15, 35)
  };
}

/**
 * The cells that carry a character onto the Core tab.
 *
 * @param {object} character  A plain view of the actor — see the tests for its shape.
 * @param {object} layout     Row positions discovered from the template.
 * @returns {{cells: Array<[string, string|number]>, warnings: object[]}}
 */
export function coreSheetCells(character = {}, layout = {}) {
  const cells = [];
  const warnings = [];
  const put = (ref, value) => {
    if (ref && value !== undefined && value !== null && value !== "") cells.push([ref, value]);
  };

  const identity = character.identity ?? {};
  put("B2", character.name);
  put("B3", identity.gender);
  put("B4", identity.age);
  put("B5", identity.height);
  put("B6", identity.weight);
  put("B7", identity.worships);
  put("D2", character.race);
  put("D3", character.subRace);

  // Stats, as creation-array picks rather than totals.
  const mainArray = layout.mainStatArray ?? [];
  const main = assignStatArray(character.mainStats ?? [], mainArray);
  main.picks.forEach((label, index) => put(`B${45 + index}`, label));
  if (main.unmatched.length) {
    warnings.push({ kind: "statArray", scope: "main", stats: main.unmatched });
  }

  const subArray = layout.subStatArray ?? [];
  const sub = assignStatArray(character.subStats ?? [], subArray);
  sub.picks.forEach((label, index) => put(`D${45 + index}`, label));
  if (sub.unmatched.length) {
    warnings.push({ kind: "statArray", scope: "sub", stats: sub.unmatched });
  }

  // Bonuses sit against a fixed list of stat labels, so they are written by
  // label rather than by array position.
  for (const [row, stat] of (layout.mainBonusRows ?? new Map())) {
    const entry = (character.mainStats ?? []).find((s) => sameLabel(s.label, stat));
    if (entry?.bonus) put(`F${row}`, entry.bonus);
  }
  for (const [row, stat] of (layout.subBonusRows ?? new Map())) {
    const entry = (character.subStats ?? []).find((s) => sameLabel(s.label, stat));
    if (entry?.bonus) put(`H${row}`, entry.bonus);
  }

  // Skills: points and the best expertise, by the sheet's own row for each.
  for (const skill of character.skills ?? []) {
    const row = layout.skillRows?.get(skill.label);
    if (row === undefined) {
      if (skill.rank || skill.expertise) warnings.push({ kind: "skillRow", label: skill.label });
      continue;
    }
    if (skill.rank) put(`H${row}`, skill.rank);
    if (skill.expertise) put(`I${row}`, skill.expertise);
  }

  // Artisan and gathering skills share the sheet's Crafting Skill block, which
  // is a free list rather than a fixed one.
  const craftRows = layout.craftingRows ?? [];
  (character.craftingSkills ?? []).forEach((skill, index) => {
    const row = craftRows[index];
    if (row === undefined) {
      warnings.push({ kind: "craftingOverflow", label: skill.label });
      return;
    }
    put(`N${row}`, skill.label);
    if (skill.rank) put(`P${row}`, skill.rank);
  });

  // Classes, in the order they were taken.
  const classRows = layout.classRows ?? [];
  (character.classes ?? []).forEach((entry, index) => {
    const row = classRows[index];
    if (row === undefined) {
      warnings.push({ kind: "classOverflow", label: entry.name });
      return;
    }
    put(`A${row}`, entry.name);
    if (entry.level) put(`C${row}`, entry.level);
  });

  return { cells, warnings };
}
