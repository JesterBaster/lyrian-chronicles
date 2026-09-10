/**
 * Turning an actor into a filled copy of the Angel's Sword character sheet.
 *
 * Two steps that are deliberately kept apart: reading the actor into a plain
 * view, and pushing that view through the workbook. The first is where every
 * system-specific decision lives and is the part worth testing; the second is
 * archive plumbing over `zip-archive` and `xlsx-cells`.
 *
 * The player supplies their own copy of the template. Nothing is bundled and
 * nothing is fetched — the sheet is Angel's Sword's to distribute, and a copy
 * shipped inside a fan system would go stale the first time they revise it.
 */

import { LYRIAN } from "../config.mjs";
import { readArchive, writeArchive } from "./zip-archive.mjs";
import {
  readCell,
  readColumn,
  readSharedStrings,
  sheetPathsByName,
  writeCells
} from "./xlsx-cells.mjs";
import { coreSheetCells, discoverCoreLayout } from "./character-sheet-export.mjs";
import {
  readAbilitySheet,
  readBreakthroughSheet,
  readCoreSheet,
  readInventorySheet
} from "./character-sheet-import.mjs";
import {
  abilitySheetCells,
  breakthroughSheetCells,
  discoverAbilityLayout,
  discoverBreakthroughLayout,
  discoverInventoryLayout,
  INVENTORY_LOCATIONS,
  inventorySheetCells,
  plainText
} from "./character-sheet-tabs.mjs";

/** The template's tabs that this fills, and the two it reads names from. */
export const SHEET_NAMES = Object.freeze({
  core: "Core",
  abilities: "Abilities",
  breakthrough: "Breakthrough",
  inventory: "Inventory",
  allAbilities: "All Abilities",
  allBreakthroughs: "Breakthroughs"
});

/** Kept for callers written against the first release of this module. */
export const CORE_SHEET_NAME = SHEET_NAMES.core;

/** Item types that belong on the Inventory tab. */
const INVENTORY_TYPES = Object.freeze(["weapon", "armor", "gear", "equipment"]);

/**
 * The number at the front of a field that may not be one.
 *
 * Equipment stores cost and burden as free text, because the rulebook writes
 * things like "1,200 Clim" and "1 (2 while worn)". The sheet wants a number,
 * and the leading one is the only part that is reliably meant.
 */
function leadingNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = /-?\d+(?:\.\d+)?/.exec(String(value ?? "").replaceAll(",", ""));
  return match ? Number(match[0]) : 0;
}

/** One row of the Inventory tab. */
function inventoryLine(item) {
  const sys = item?.system ?? {};
  const quantity = Number(sys.quantity) > 0 ? Number(sys.quantity) : 1;
  const each = leadingNumber(sys.burden);
  return {
    name: item?.name ?? "",
    // Column B is a fixed dropdown that rejects anything not on it, and
    // equipped versus carried is the only part of it the system models.
    location: sys.equipped ? INVENTORY_LOCATIONS.equipped : INVENTORY_LOCATIONS.carried,
    quantity,
    // Gear works out its own total, which is not always the obvious product:
    // a non-combat item that is not a kit carries no burden at all.
    burden: typeof sys.totalBurden === "number" ? sys.totalBurden : each * quantity,
    value: leadingNumber(sys.value ?? sys.cost),
    description: plainText(sys.description)
  };
}

/** Named expertises as the sheet writes them: one cell, comma separated. */
function expertiseLabel(entry) {
  return (entry?.expertises ?? [])
    .map((expertise) => String(expertise?.name ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Read an actor into the plain shape `coreSheetCells` maps.
 *
 * Labels come from the localiser rather than from the config keys, because the
 * template is labelled in English words and the system stores i18n keys. That
 * makes the shipped `lang/en.json` part of the contract with the sheet, which
 * is why the tests localise through the real file.
 *
 * @param {Actor} actor
 * @param {{localize?: (key: string) => string}} [options]
 * @returns {object}
 */
export function characterExportView(actor, { localize = (key) => key } = {}) {
  const system = actor?.system ?? {};
  const details = system.details ?? {};
  const items = [...(actor?.items ?? [])];

  const statList = (table, stored) => Object.entries(table ?? {}).map(([key, label]) => ({
    key,
    label: localize(label),
    // `value` is the creation-array pick and `bonus` is everything since; the
    // sheet wants them in those two columns, never added together.
    value: Number(stored?.[key]?.value) || 0,
    bonus: Number(stored?.[key]?.bonus) || 0
  }));

  const skills = Object.entries(LYRIAN.skills).map(([key, config]) => ({
    key,
    label: localize(config.label),
    rank: Number(system.skills?.[key]?.rank) || 0,
    expertise: expertiseLabel(system.skills?.[key])
  }));

  // The sheet's Crafting Skill block is a short free list, so only skills the
  // character has actually put points into are worth one of its rows.
  const craftingSkills = [
    ...Object.entries(LYRIAN.artisanSkills).map(([key, label]) => ({
      key, label: localize(label), rank: Number(system.artisan?.[key]?.rank) || 0
    })),
    ...Object.entries(LYRIAN.gatheringSkills).map(([key, label]) => ({
      key, label: localize(label), rank: Number(system.gathering?.[key]?.rank) || 0
    }))
  ].filter((skill) => skill.rank > 0);

  const classes = items
    .filter((item) => item.type === "class")
    .map((item) => ({
      name: item.name,
      level: Number(item.system?.abilitiesUnlocked) || 1
    }));

  // The sheet splits abilities into an active block and a passive one. Every
  // timing the system has except `passive` is something the character does on
  // their turn or in reaction, so they all belong above the divide.
  const abilities = items
    .filter((item) => item.type === "ability")
    .map((item) => ({ name: item.name, passive: item.system?.timing === "passive" }));

  const breakthroughs = items
    .filter((item) => item.type === "breakthrough")
    .map((item) => ({ name: item.name, expCost: Number(item.system?.expCost) || 0 }));

  const inventory = items
    .filter((item) => INVENTORY_TYPES.includes(item.type))
    .map(inventoryLine);

  return {
    name: actor?.name ?? "",
    race: details.race ?? "",
    subRace: details.subrace ?? "",
    identity: {
      gender: details.gender ?? "",
      age: details.age ?? "",
      height: details.height ?? "",
      weight: details.weight ?? "",
      worships: details.worship ?? ""
    },
    mainStats: statList(LYRIAN.mainStats, system.stats),
    subStats: statList(LYRIAN.subStats, system.subStats),
    skills,
    craftingSkills,
    classes,
    abilities,
    breakthroughs,
    inventory
  };
}

/**
 * Fill a copy of the template with a character.
 *
 * The workbook is patched in place rather than rebuilt: every part it does not
 * touch comes back byte for byte, which is what keeps the 17 drawings, the
 * validations and the 12,678 formulas that make the sheet worth exporting to.
 *
 * Cell references come back qualified with their tab — `Core!B45` — because
 * four tabs share a coordinate space and an unqualified `A2` says nothing.
 *
 * A tab the template does not have is skipped rather than fatal. Only the Core
 * tab is required, since a file without one is not this spreadsheet at all.
 *
 * @param {Uint8Array} template   The player's own .xlsx.
 * @param {object} character      From `characterExportView`.
 * @param {{sheetNames?: object}} [options]
 * @returns {Promise<{bytes: Uint8Array, warnings: object[], written: string[],
 *                    refused: object[], tabs: object[]}>}
 */
export async function fillCharacterSheet(template, character, { sheetNames = {} } = {}) {
  const names = { ...SHEET_NAMES, ...sheetNames };
  const entries = await readArchive(template);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const text = (path) => (entries.has(path) ? decoder.decode(entries.get(path)) : "");

  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("NotAWorkbook");

  const paths = sheetPathsByName(workbook, text("xl/_rels/workbook.xml.rels"));
  const shared = readSharedStrings(text("xl/sharedStrings.xml"));
  const sheetXml = (name) => {
    const path = paths.get(name);
    return path && entries.has(path) ? decoder.decode(entries.get(path)) : null;
  };

  /** Every name on one column of a reference tab, or undefined if it is absent. */
  const referenceNames = (name, column) => {
    const xml = sheetXml(name);
    if (xml === null) return undefined;
    return [...readColumn(xml, column, shared).values()]
      .map((cell) => cell.value).filter(Boolean);
  };

  const warnings = [];
  const written = [];
  const refused = [];
  const tabs = [];

  /** Map one tab, write it back, and record what happened under its own name. */
  const applyTab = (name, build) => {
    const xml = sheetXml(name);
    if (xml === null) {
      if (name === names.core) throw new Error("MissingSheet");
      tabs.push({ tab: name, present: false, written: [], refused: [], warnings: [] });
      return;
    }

    const result = build(xml);
    const output = writeCells(xml, result.cells);
    entries.set(paths.get(name), encoder.encode(output.xml));

    const qualify = (ref) => `${name}!${ref}`;
    const tabWritten = output.written.map(qualify);
    const tabRefused = output.refused.map((entry) => ({ ...entry, ref: qualify(entry.ref) }));
    const tabWarnings = result.warnings.map((entry) => ({ ...entry, tab: name }));

    written.push(...tabWritten);
    refused.push(...tabRefused);
    warnings.push(...tabWarnings);
    tabs.push({
      tab: name, present: true,
      written: tabWritten, refused: tabRefused, warnings: tabWarnings
    });
  };

  applyTab(names.core, (xml) =>
    coreSheetCells(character, discoverCoreLayout((ref) => readCell(xml, ref, shared).value)));

  // Both of these are looked up by name against a reference tab, so the names
  // are checked against the same list the formula consults. Where the template
  // has no such tab, the check is skipped rather than failing every name.
  const knownAbilities = referenceNames(names.allAbilities, "B");
  applyTab(names.abilities, (xml) => {
    const columns = (column) => readColumn(xml, column, shared);
    return abilitySheetCells(character, discoverAbilityLayout(columns), { known: knownAbilities });
  });

  const knownBreakthroughs = referenceNames(names.allBreakthroughs, "A");
  applyTab(names.breakthrough, (xml) => {
    const columns = (column) => readColumn(xml, column, shared);
    return breakthroughSheetCells(
      character, discoverBreakthroughLayout(columns), { known: knownBreakthroughs }
    );
  });

  applyTab(names.inventory, (xml) => {
    const columns = (column) => readColumn(xml, column, shared);
    return inventorySheetCells(character, discoverInventoryLayout(columns));
  });

  return { bytes: await writeArchive(entries), warnings, written, refused, tabs };
}

/**
 * Read a filled sheet back into the same view the export writes.
 *
 * Deliberately the same entry shape as `characterExportView`, so a workbook can
 * be exported, imported and compared field for field. Nothing here touches an
 * actor or a compendium: names come back as names.
 *
 * @param {Uint8Array} workbook   A filled copy of the template.
 * @param {{sheetNames?: object}} [options]
 * @returns {Promise<{character: object, tabs: string[]}>}
 */
export async function readCharacterSheet(workbook, { sheetNames = {} } = {}) {
  const names = { ...SHEET_NAMES, ...sheetNames };
  const entries = await readArchive(workbook);
  const decoder = new TextDecoder();
  const text = (path) => (entries.has(path) ? decoder.decode(entries.get(path)) : "");

  const book = text("xl/workbook.xml");
  if (!book) throw new Error("NotAWorkbook");

  const paths = sheetPathsByName(book, text("xl/_rels/workbook.xml.rels"));
  const shared = readSharedStrings(text("xl/sharedStrings.xml"));
  const sheetXml = (name) => {
    const path = paths.get(name);
    return path && entries.has(path) ? decoder.decode(entries.get(path)) : null;
  };

  const core = sheetXml(names.core);
  if (core === null) throw new Error("MissingSheet");

  const read = (ref) => readCell(core, ref, shared).value;
  const character = readCoreSheet(read, discoverCoreLayout(read));
  const present = [names.core];

  const abilities = sheetXml(names.abilities);
  if (abilities !== null) {
    const columns = (column) => readColumn(abilities, column, shared);
    character.abilities = readAbilitySheet(columns, discoverAbilityLayout(columns));
    present.push(names.abilities);
  } else character.abilities = [];

  const breakthrough = sheetXml(names.breakthrough);
  if (breakthrough !== null) {
    const columns = (column) => readColumn(breakthrough, column, shared);
    character.breakthroughs = readBreakthroughSheet(columns, discoverBreakthroughLayout(columns));
    present.push(names.breakthrough);
  } else character.breakthroughs = [];

  const inventory = sheetXml(names.inventory);
  if (inventory !== null) {
    const columns = (column) => readColumn(inventory, column, shared);
    character.inventory = readInventorySheet(columns, discoverInventoryLayout(columns));
    present.push(names.inventory);
  } else character.inventory = [];

  return { character, tabs: present };
}

/**
 * Turn an export result into the warnings a player can act on.
 *
 * Returned as keys and data rather than formatted text so this stays testable
 * without a localiser, and so a translation can reorder the sentence.
 *
 * @param {{warnings?: object[], refused?: object[]}} result
 * @returns {Array<{key: string, data: object}>}
 */
export function exportWarningMessages({ warnings = [], refused = [] } = {}) {
  const messages = [];
  const overflowed = [];
  const unmatched = [];

  for (const warning of warnings) {
    if (warning.kind === "statArray") {
      messages.push({
        key: "LYRIAN.Warn.ExportStatArray",
        data: { stats: (warning.stats ?? []).map((stat) => stat.label).join(", ") }
      });
    } else if (warning.kind === "skillRow") {
      messages.push({ key: "LYRIAN.Warn.ExportSkillRow", data: { label: warning.label } });
    } else if (warning.kind === "unknownAbility" || warning.kind === "unknownBreakthrough") {
      unmatched.push(warning.label);
    } else if (warning.kind.endsWith("Overflow")) {
      overflowed.push(warning.label);
    }
  }

  // Overflow and unmatched names come in runs — a character with nine classes
  // too many would otherwise raise nine identical notifications.
  if (overflowed.length) {
    messages.push({
      key: "LYRIAN.Warn.ExportOverflow",
      data: { labels: overflowed.join(", "), count: overflowed.length }
    });
  }
  if (unmatched.length) {
    messages.push({
      key: "LYRIAN.Warn.ExportUnknownName",
      data: { labels: unmatched.join(", "), count: unmatched.length }
    });
  }

  // A refused cell means the template has moved under us — one message for the
  // lot, because thirty of them would say the same thing thirty times.
  const formulas = refused.filter((entry) => entry.reason === "formula");
  if (formulas.length) {
    messages.push({
      key: "LYRIAN.Warn.ExportFormulaCell",
      data: { refs: formulas.map((entry) => entry.ref).join(", ") }
    });
  }
  const missing = refused.filter((entry) => entry.reason !== "formula");
  if (missing.length) {
    messages.push({ key: "LYRIAN.Warn.ExportMissingCells", data: { count: missing.length } });
  }

  return messages;
}

/** A filename a player will recognise a week later. */
export function exportFileName(actorName) {
  const clean = String(actorName ?? "").replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "character";
  return `${clean.replace(/\s+/g, "-")}-lyrian-sheet.xlsx`;
}
