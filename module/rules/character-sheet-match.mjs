/**
 * Turning the names on a character sheet into documents and schema keys.
 *
 * The spreadsheet stores everything as the words a player typed, so importing
 * is mostly a matching problem: "Common Knowledge" has to find the
 * `commonKnowledge` skill, and "Cleave" has to find an Ability in the packs.
 *
 * Nothing here writes anything. It produces a plan, which is what the preview
 * shows and what the caller applies — so a player sees exactly what an import
 * would do before it does it, and the whole decision is testable without a
 * world open.
 */

import { LYRIAN } from "../config.mjs";
import { sameLabel } from "./character-sheet-export.mjs";

/** How a name was found, worst to best, for reporting. */
export const MATCH_KINDS = Object.freeze(["exact", "caseless", "normalised"]);

/**
 * Find one name in an index.
 *
 * Three passes rather than one: an exact hit must win outright, or a sheet
 * holding both "Iron Will" and "iron will" resolves them to whichever the
 * looser rule reached first. `normalised` is the same comparison the export
 * uses on the sheet's own labels, so punctuation and spacing differences are
 * forgiven last of all.
 *
 * @param {string} name
 * @param {Array<{name: string}>} index
 * @returns {{entry: object, how: string}|null}
 */
export function matchName(name, index = []) {
  const wanted = String(name ?? "").trim();
  if (!wanted) return null;

  const lower = wanted.toLowerCase();
  const tiers = [
    ["exact", (entry) => entry.name === wanted],
    ["caseless", (entry) => String(entry.name ?? "").trim().toLowerCase() === lower],
    ["normalised", (entry) => sameLabel(entry.name, wanted)]
  ];

  for (const [how, test] of tiers) {
    const found = index.filter(test);
    // `count` is how many entries the winning rule matched, not how many exist:
    // 40 of the shipped abilities share a name with a class's key ability of
    // the same name, and the sheet carries nothing to tell them apart. The
    // first is taken — as the spreadsheet's own lookup does — but the caller
    // is told, so a player can correct it rather than discover it later.
    if (found.length) return { entry: found[0], how, count: found.length };
  }
  return null;
}

/**
 * Match a list of names, keeping what was asked for alongside what was found.
 *
 * @returns {{matched: Array<{name: string, entry: object, how: string, source: object}>,
 *           unmatched: object[]}}
 */
export function matchNames(entries = [], index = []) {
  const matched = [];
  const unmatched = [];
  const ambiguous = [];
  for (const source of entries) {
    const name = typeof source === "string" ? source : source?.name;
    const found = matchName(name, index);
    if (!found) {
      unmatched.push(typeof source === "string" ? { name } : source);
      continue;
    }
    matched.push({ name, entry: found.entry, how: found.how, count: found.count, source });
    if (found.count > 1) ambiguous.push({ name, count: found.count });
  }
  return { matched, unmatched, ambiguous };
}

/* -------------------------------------------- */

/**
 * A label-to-key map for one of the config tables.
 *
 * Built through the localiser, because the sheet is labelled in English words
 * and the config stores i18n keys — the same contract the export relies on,
 * read the other way.
 */
export function labelIndex(table, localize) {
  return Object.entries(table ?? {}).map(([key, value]) => ({
    key,
    name: localize(typeof value === "string" ? value : value?.label)
  }));
}

/** The key a label belongs to, or null. */
function keyFor(label, index) {
  return matchName(label, index)?.entry.key ?? null;
}

/* -------------------------------------------- */

/** The item types each group of the plan can produce. */
export const ITEM_TYPES = Object.freeze({
  classes: ["class"],
  abilities: ["ability"],
  breakthroughs: ["breakthrough"],
  inventory: ["weapon", "armor", "gear", "equipment"],
  race: ["race"]
});

/** Decide what to do about the sheet's race, given what the actor already has. */
function planRace(name, index, heldRaces, warnings) {
  const wanted = String(name ?? "").trim();
  if (!wanted) return null;

  const found = matchName(wanted, index ?? []);
  if (!found) {
    warnings.push({ kind: "unknownRace", label: wanted });
    return null;
  }

  const base = { name: found.entry.name, uuid: found.entry.uuid, how: found.how };
  if (!heldRaces?.size) return { ...base, status: "create" };
  if (heldRaces.has(wanted.toLowerCase()) || heldRaces.has(found.entry.name.trim().toLowerCase())) {
    return { ...base, status: "existing" };
  }

  warnings.push({ kind: "raceConflict", label: wanted });
  return { ...base, status: "conflict" };
}

/**
 * Everything an import would change, as data.
 *
 * @param {object} character   From `readCharacterSheet`.
 * @param {object} packs       `{abilities, breakthroughs, classes, races, inventory}` indexes.
 * @param {object} options
 * @param {(key: string) => string} options.localize
 * @param {Array<{name: string, type: string}>} [options.existing]  The actor's items.
 * @returns {object} The plan the preview renders and the caller applies.
 */
export function buildImportPlan(character = {}, packs = {}, { localize = (key) => key, existing = [] } = {}) {
  const mainIndex = labelIndex(LYRIAN.mainStats, localize);
  const subIndex = labelIndex(LYRIAN.subStats, localize);
  const skillIndex = labelIndex(LYRIAN.skills, localize);
  const artisanIndex = labelIndex(LYRIAN.artisanSkills, localize);
  const gatheringIndex = labelIndex(LYRIAN.gatheringSkills, localize);

  const warnings = [];

  const statBlock = (list, index, scope) => {
    const out = {};
    for (const stat of list ?? []) {
      const key = keyFor(stat.label, index);
      if (!key) {
        warnings.push({ kind: "unknownStat", label: stat.label, scope });
        continue;
      }
      out[key] = { value: Number(stat.value) || 0, bonus: Number(stat.bonus) || 0 };
    }
    return out;
  };

  const skills = {};
  for (const skill of character.skills ?? []) {
    const key = keyFor(skill.label, skillIndex);
    if (!key) {
      warnings.push({ kind: "unknownSkill", label: skill.label });
      continue;
    }
    skills[key] = { rank: Number(skill.rank) || 0, expertise: String(skill.expertise ?? "").trim() };
  }

  // The sheet keeps artisan and gathering in one block, so each row is offered
  // to both tables and lands wherever it belongs.
  const artisan = {};
  const gathering = {};
  for (const skill of character.craftingSkills ?? []) {
    const rank = Number(skill.rank) || 0;
    const artisanKey = keyFor(skill.label, artisanIndex);
    if (artisanKey) { artisan[artisanKey] = { rank }; continue; }
    const gatheringKey = keyFor(skill.label, gatheringIndex);
    if (gatheringKey) { gathering[gatheringKey] = { rank }; continue; }
    warnings.push({ kind: "unknownCraftingSkill", label: skill.label });
  }

  // An item the actor already has is left alone rather than added twice; the
  // sheet carries no identity beyond the name, so the name is all there is.
  //
  // Held names are counted per item type, not in one pile. A character with a
  // weapon called "Cleave" would otherwise never be able to import the ability
  // of that name, and names do collide across types in the rulebook.
  const heldByType = new Map();
  for (const item of existing ?? []) {
    const name = String(item?.name ?? "").trim().toLowerCase();
    if (!name) continue;
    const type = String(item?.type ?? "");
    if (!heldByType.has(type)) heldByType.set(type, new Set());
    heldByType.get(type).add(name);
  }
  const holds = (types, name) => types.some((type) =>
    heldByType.get(type)?.has(String(name ?? "").trim().toLowerCase()));

  const split = (entries, index, types) => {
    const wanted = (entries ?? []).filter((entry) => String(entry?.name ?? "").trim());
    const alreadyHeld = wanted.filter((entry) => holds(types, entry.name));
    const fresh = wanted.filter((entry) => !holds(types, entry.name));
    const { matched, unmatched, ambiguous } = matchNames(fresh, index);
    for (const entry of ambiguous) {
      warnings.push({ kind: "ambiguousName", label: entry.name, count: entry.count });
    }
    return { create: matched, existing: alreadyHeld, unmatched };
  };

  const items = {
    classes: split(character.classes, packs.classes, ITEM_TYPES.classes),
    abilities: split(character.abilities, packs.abilities, ITEM_TYPES.abilities),
    breakthroughs: split(character.breakthroughs, packs.breakthroughs, ITEM_TYPES.breakthroughs),
    inventory: split(character.inventory, packs.inventory, ITEM_TYPES.inventory)
  };

  // A race is never stacked. Every race Item on an actor adds its stat bonuses,
  // so a second one silently doubles them — which is what re-importing the same
  // sheet used to do. A race that differs from the one already held is reported
  // and left alone, because swapping it means removing the old one and this
  // never removes anything.
  const raceItem = planRace(
    character.race, packs.races, heldByType.get(ITEM_TYPES.race[0]), warnings
  );

  return {
    raceItem,
    details: {
      name: character.name ?? "",
      race: character.race ?? "",
      subrace: character.subRace ?? "",
      gender: character.identity?.gender ?? "",
      age: character.identity?.age ?? "",
      height: character.identity?.height ?? "",
      weight: character.identity?.weight ?? "",
      worship: character.identity?.worships ?? ""
    },
    stats: statBlock(character.mainStats, mainIndex, "main"),
    subStats: statBlock(character.subStats, subIndex, "sub"),
    skills,
    artisan,
    gathering,
    items,
    warnings,
    counts: Object.fromEntries(Object.entries(items).map(([kind, group]) => [kind, {
      create: group.create.length,
      existing: group.existing.length,
      unmatched: group.unmatched.length
    }]))
  };
}

/**
 * The actor update a plan implies.
 *
 * Flat keys, so nothing that is not on the sheet is disturbed — writing whole
 * objects would reset every sibling field the spreadsheet has no column for.
 * Blank identity fields are skipped for the same reason: a sheet with no
 * height should not erase the height in Foundry.
 */
export function plannedActorUpdate(plan = {}) {
  const update = {};
  for (const [field, value] of Object.entries(plan.details ?? {})) {
    if (field === "name") continue;
    if (String(value ?? "").trim()) update[`system.details.${field}`] = value;
  }

  for (const [key, stat] of Object.entries(plan.stats ?? {})) {
    update[`system.stats.${key}.value`] = stat.value;
    update[`system.stats.${key}.bonus`] = stat.bonus;
  }
  for (const [key, stat] of Object.entries(plan.subStats ?? {})) {
    update[`system.subStats.${key}.value`] = stat.value;
    update[`system.subStats.${key}.bonus`] = stat.bonus;
  }

  for (const [key, skill] of Object.entries(plan.skills ?? {})) {
    update[`system.skills.${key}.rank`] = skill.rank;
    // One cell holds however many expertises a player wrote, comma separated.
    // Ranks are not on the sheet at all, so they come back at zero rather than
    // invented — the rank box beside each is the player's to set again.
    if (skill.expertise) {
      update[`system.skills.${key}.expertises`] = skill.expertise
        .split(",").map((name) => name.trim()).filter(Boolean)
        .map((name) => ({ name, rank: 0 }));
    }
  }
  for (const [key, skill] of Object.entries(plan.artisan ?? {})) {
    update[`system.artisan.${key}.rank`] = skill.rank;
  }
  for (const [key, skill] of Object.entries(plan.gathering ?? {})) {
    update[`system.gathering.${key}.rank`] = skill.rank;
  }

  return update;
}
