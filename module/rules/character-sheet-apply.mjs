/**
 * Turning an import plan into the documents it asks for.
 *
 * Kept apart from the matching so the shaping can be tested without a world:
 * the caller passes a `resolve` that fetches a compendium document, and
 * everything else here is arithmetic on plain objects.
 *
 * Nothing is deleted. An import adds what the sheet has and the actor does not,
 * and updates the numbers — it never removes an item because a row is missing.
 * A spreadsheet is a copy of a character, not the authority on one, and a
 * player who has been playing in Foundry since they last exported would
 * otherwise lose everything they gained.
 */

import { convertOfficialEquipment } from "./equipment-import.mjs";
import { isCraftingMod } from "./mod-installation.mjs";
import { normalizeClassLevel } from "./progression.mjs";
import { INVENTORY_LOCATIONS } from "./character-sheet-tabs.mjs";

/**
 * What the sheet knows about an item that the compendium does not.
 *
 * The split is between facts about the item and facts about this character's
 * copy of it. Burden, price and rules text belong to the item and come from the
 * pack; how many there are, whether they are worn and what a class costs the
 * character are the sheet's to say.
 */
function applySheetFacts(data, kind, source = {}) {
  const system = data.system ?? (data.system = {});

  if (kind === "classes") {
    system.abilitiesUnlocked = normalizeClassLevel(source.level);
  } else if (kind === "breakthroughs") {
    // Only when the player recorded something: a blank cell is not a free
    // breakthrough, it is a cell they did not fill in.
    if (Number(source.expCost) > 0) system.expCost = Number(source.expCost);
  } else if (kind === "inventory") {
    if ("quantity" in system) system.quantity = Math.max(1, Number(source.quantity) || 1);
    if ("equipped" in system) system.equipped = source.location === INVENTORY_LOCATIONS.equipped;
  }
  return data;
}

/**
 * The item data a plan would create.
 *
 * @param {object} plan                        From `buildImportPlan`.
 * @param {object} options
 * @param {(uuid: string) => Promise<object|null>} options.resolve  Fetches pack data.
 * @param {object} [options.proficiencies]     Passed through to equipment conversion.
 * @returns {Promise<{create: object[], failed: object[]}>}
 */
export async function plannedItemData(plan = {}, { resolve, proficiencies = {} } = {}) {
  const create = [];
  const failed = [];

  const entries = [];
  // Only when the plan actually asked for one: a race the actor already holds,
  // or one that conflicts with it, is reported rather than stacked.
  if (plan.raceItem?.status === "create") {
    entries.push({ kind: "races", uuid: plan.raceItem.uuid, name: plan.raceItem.name, source: {} });
  }
  for (const [kind, group] of Object.entries(plan.items ?? {})) {
    for (const match of group.create ?? []) {
      entries.push({ kind, uuid: match.entry?.uuid, source: match.source ?? {}, name: match.name });
    }
  }

  for (const entry of entries) {
    let data = null;
    try {
      data = entry.uuid ? await resolve(entry.uuid) : null;
    } catch (error) {
      data = null;
    }
    if (!data) {
      failed.push({ kind: entry.kind, name: entry.name, uuid: entry.uuid });
      continue;
    }

    // A compendium's official equipment is a reference page, not a thing that
    // can be equipped, so it becomes a real weapon, armor or gear item — the
    // same conversion a drag-and-drop does. Crafting Mods keep their own type,
    // or they stop being recognisable as Mods at all.
    if (data.type === "equipment" && !isCraftingMod(data)) {
      const converted = convertOfficialEquipment(data, proficiencies);
      if (converted) data = converted;
    }

    create.push(applySheetFacts(data, entry.kind, entry.source));
  }

  return { create, failed };
}

/** A one-line summary of a plan, for the preview and the chat notice. */
export function importSummary(plan = {}) {
  const counts = plan.counts ?? {};
  const total = (field) => Object.values(counts).reduce((sum, group) => sum + (group[field] ?? 0), 0);
  const race = plan.raceItem?.status;
  return {
    create: total("create") + (race === "create" ? 1 : 0),
    existing: total("existing") + (race === "existing" ? 1 : 0),
    unmatched: total("unmatched"),
    warnings: (plan.warnings ?? []).length
  };
}

/**
 * Every name an import could not place, for the preview's list.
 *
 * A name that matched more than one document is not one of these — it will be
 * imported, just possibly as the wrong one of the two. That belongs in its own
 * line, or a player reads "not found" about something that was.
 */
export function unmatchedNames(plan = {}) {
  const names = [];
  for (const group of Object.values(plan.items ?? {})) {
    for (const entry of group.unmatched ?? []) names.push(entry.name);
  }
  for (const warning of plan.warnings ?? []) {
    if (warning.kind !== "ambiguousName") names.push(warning.label);
  }
  return names;
}

/** Names the compendiums carry more than one of, which the player must settle. */
export function ambiguousNames(plan = {}) {
  return (plan.warnings ?? [])
    .filter((warning) => warning.kind === "ambiguousName")
    .map((warning) => warning.label);
}
