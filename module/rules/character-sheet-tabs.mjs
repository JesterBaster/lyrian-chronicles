/**
 * The character sheet's other three tabs: Abilities, Breakthrough, Inventory.
 *
 * These are much simpler than the Core tab, because the template does the work.
 * Type an ability's name in column A and the cost, keywords, range, requirement
 * and description all arrive by lookup from its reference tabs. So the export
 * writes names and quantities and nothing else — which also means a name that
 * does not match the sheet's own list silently yields six blank columns.
 *
 * That is worth catching, so each mapper checks its names against the reference
 * the template actually consults, using the same matching rule the formula
 * uses. The two rules genuinely differ, and the comments say which is which.
 */

import { sameLabel } from "./character-sheet-export.mjs";

/** The labels that head each block, read from the sheet rather than assumed. */
export const TAB_HEADERS = Object.freeze({
  activeAbilities: "Active Ability Name",
  passiveAbilities: "Passive Ability Name",
  breakthrough: "Breakthrough",
  inventory: "Expedition Inventory"
});

/** Where the Inventory tab's "Where is it?" dropdown will accept an answer. */
export const INVENTORY_LOCATIONS = Object.freeze({
  carried: "Backpack",
  equipped: "Combat Loadout"
});

/**
 * Cell text for a description written as HTML.
 *
 * Tags become a space, because `a<br>b` is two words. That then leaves a gap in
 * front of the punctuation that followed the tag — `<i>blade</i>.` reads as
 * "blade ." — so the spacing is tidied afterwards rather than by trying to
 * decide, tag by tag, which ones separate words.
 */
export function plainText(value, limit = 500) {
  const text = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?%)\]}])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/**
 * The Abilities tab's rule: `MATCH(name, 'All Abilities'!B:B, 0)`.
 *
 * An exact match, case-insensitively — which is what MATCH does with text.
 * Anything else and the six lookup columns beside it come back blank.
 */
export function matchesExactly(name, references) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return false;
  for (const reference of references ?? []) {
    if (String(reference ?? "").trim().toLowerCase() === wanted) return true;
  }
  return false;
}

/**
 * The Breakthrough tab's rule: `ISNUMBER(SEARCH(Breakthroughs!A:A, name))`.
 *
 * Backwards from the other one — the *reference* has to appear inside what was
 * typed, not the other way round. That is how "Angelblooded (Human)" resolves
 * for a player who wrote "Angelblooded (Human) — taken at level 3".
 */
export function matchesBySearch(name, references) {
  const haystack = String(name ?? "").trim().toLowerCase();
  if (!haystack) return false;
  for (const reference of references ?? []) {
    const needle = String(reference ?? "").trim().toLowerCase();
    if (needle && haystack.includes(needle)) return true;
  }
  return false;
}

/** The row a label heads, or null. */
function headerRow(cells, label) {
  for (const [row, cell] of cells ?? []) {
    if (sameLabel(cell.value, label)) return row;
  }
  return null;
}

/**
 * The run of rows a block occupies, bounded by the sheet's own lookup formulas.
 *
 * A row the template will look something up for is exactly a row worth writing
 * to, and the run stops at the next header — whose lookup column holds a title,
 * not a formula. Counting rows instead would put a 58th ability into the
 * "Passive Ability Name" heading.
 */
function formulaRun(cells, from) {
  if (from === null) return [];
  const rows = [];
  for (let row = from; cells?.get(row)?.formula; row += 1) rows.push(row);
  return rows;
}

/* -------------------------------------------- */
/*  Abilities                                    */
/* -------------------------------------------- */

/**
 * @param {(column: string) => Map<number, object>} columns
 * @returns {{active: number[], passive: number[]}}
 */
export function discoverAbilityLayout(columns) {
  const names = columns("A");
  const lookups = columns("B");
  const after = (label) => {
    const row = headerRow(names, label);
    return row === null ? null : row + 1;
  };
  return {
    active: formulaRun(lookups, after(TAB_HEADERS.activeAbilities)),
    passive: formulaRun(lookups, after(TAB_HEADERS.passiveAbilities))
  };
}

/**
 * @param {{abilities?: Array<{name: string, passive?: boolean}>}} character
 * @param {{active: number[], passive: number[]}} layout
 * @param {{known?: Iterable<string>}} [reference]
 */
export function abilitySheetCells(character = {}, layout = {}, { known } = {}) {
  const cells = [];
  const warnings = [];
  const abilities = character.abilities ?? [];

  const place = (list, rows, section) => list.forEach((ability, index) => {
    const row = (rows ?? [])[index];
    if (row === undefined) {
      warnings.push({ kind: "abilityOverflow", label: ability.name, section });
      return;
    }
    if (!ability.name) return;
    cells.push([`A${row}`, ability.name]);
    if (known && !matchesExactly(ability.name, known)) {
      warnings.push({ kind: "unknownAbility", label: ability.name });
    }
  });

  place(abilities.filter((ability) => !ability.passive), layout.active, "active");
  place(abilities.filter((ability) => ability.passive), layout.passive, "passive");

  return { cells, warnings };
}

/* -------------------------------------------- */
/*  Breakthrough                                 */
/* -------------------------------------------- */

/** Bounded by column C, which is this tab's first lookup — column B is typed. */
export function discoverBreakthroughLayout(columns) {
  const row = headerRow(columns("A"), TAB_HEADERS.breakthrough);
  return { rows: formulaRun(columns("C"), row === null ? null : row + 1) };
}

export function breakthroughSheetCells(character = {}, layout = {}, { known } = {}) {
  const cells = [];
  const warnings = [];

  (character.breakthroughs ?? []).forEach((entry, index) => {
    const row = (layout.rows ?? [])[index];
    if (row === undefined) {
      warnings.push({ kind: "breakthroughOverflow", label: entry.name });
      return;
    }
    if (!entry.name) return;
    cells.push([`A${row}`, entry.name]);
    // The EXP column is typed, not looked up: a table that discounted one is
    // recording what was actually spent, and the sheet has no way to know.
    if (entry.expCost) cells.push([`B${row}`, entry.expCost]);
    if (known && !matchesBySearch(entry.name, known)) {
      warnings.push({ kind: "unknownBreakthrough", label: entry.name });
    }
  });

  return { cells, warnings };
}

/* -------------------------------------------- */
/*  Inventory                                    */
/* -------------------------------------------- */

/**
 * The Inventory tab declares its own extent in its burden total.
 *
 * `SUM(D2:D137)` is the sheet saying where its item rows stop, which beats
 * hardcoding 137 and beats guessing from blanks — the rows are blank by design
 * and nothing else distinguishes the last one from the first one past the end.
 */
export function discoverInventoryLayout(columns) {
  const start = headerRow(columns("A"), TAB_HEADERS.inventory);
  if (start === null) return { rows: [] };

  for (const [, cell] of columns("H")) {
    const range = /SUM\(\s*D(\d+)\s*:\s*D(\d+)\s*\)/i.exec(cell.formula ?? "");
    if (!range) continue;
    const [from, to] = [Number(range[1]), Number(range[2])];
    if (to < from) continue;
    return { rows: Array.from({ length: to - from + 1 }, (_, index) => from + index) };
  }
  return { rows: [] };
}

export function inventorySheetCells(character = {}, layout = {}) {
  const cells = [];
  const warnings = [];

  (character.inventory ?? []).forEach((item, index) => {
    const row = (layout.rows ?? [])[index];
    if (row === undefined) {
      warnings.push({ kind: "inventoryOverflow", label: item.name });
      return;
    }
    if (!item.name) return;

    cells.push([`A${row}`, item.name]);
    // Column B is a four-option dropdown that rejects anything else, so this
    // only ever writes one of the two the system can actually tell apart.
    if (item.location) cells.push([`B${row}`, item.location]);
    if (item.quantity) cells.push([`C${row}`, item.quantity]);
    // The sheet sums column D as it stands and multiplies only the price by the
    // amount, so burden goes in already totalled for the stack.
    if (item.burden) cells.push([`D${row}`, item.burden]);
    if (item.value) cells.push([`E${row}`, item.value]);
    if (item.description) cells.push([`G${row}`, item.description]);
  });

  return { cells, warnings };
}
