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
import { readCell, readSharedStrings, sheetPathsByName, writeCells } from "./xlsx-cells.mjs";
import { coreSheetCells, discoverCoreLayout } from "./character-sheet-export.mjs";

/** The template's tab that this fills. */
export const CORE_SHEET_NAME = "Core";

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
    classes
  };
}

/**
 * Fill a copy of the template with a character.
 *
 * The workbook is patched in place rather than rebuilt: every part it does not
 * touch comes back byte for byte, which is what keeps the 17 drawings, the
 * validations and the 12,678 formulas that make the sheet worth exporting to.
 *
 * @param {Uint8Array} template   The player's own .xlsx.
 * @param {object} character      From `characterExportView`.
 * @param {{sheetName?: string}} [options]
 * @returns {Promise<{bytes: Uint8Array, warnings: object[], written: string[], refused: object[]}>}
 */
export async function fillCharacterSheet(template, character, { sheetName = CORE_SHEET_NAME } = {}) {
  const entries = await readArchive(template);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const text = (path) => (entries.has(path) ? decoder.decode(entries.get(path)) : "");

  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("NotAWorkbook");

  const paths = sheetPathsByName(workbook, text("xl/_rels/workbook.xml.rels"));
  const path = paths.get(sheetName);
  if (!path || !entries.has(path)) throw new Error("MissingSheet");

  const shared = readSharedStrings(text("xl/sharedStrings.xml"));
  const sheet = decoder.decode(entries.get(path));
  const read = (ref) => readCell(sheet, ref, shared).value;

  const layout = discoverCoreLayout(read);
  const { cells, warnings } = coreSheetCells(character, layout);
  const { xml, written, refused } = writeCells(sheet, cells);

  entries.set(path, encoder.encode(xml));
  return { bytes: await writeArchive(entries), warnings, written, refused };
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

  for (const warning of warnings) {
    if (warning.kind === "statArray") {
      messages.push({
        key: "LYRIAN.Warn.ExportStatArray",
        data: { stats: (warning.stats ?? []).map((stat) => stat.label).join(", ") }
      });
    } else if (warning.kind === "skillRow") {
      messages.push({ key: "LYRIAN.Warn.ExportSkillRow", data: { label: warning.label } });
    } else if (warning.kind === "craftingOverflow" || warning.kind === "classOverflow") {
      messages.push({ key: "LYRIAN.Warn.ExportOverflow", data: { label: warning.label } });
    }
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
