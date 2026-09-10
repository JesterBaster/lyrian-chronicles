/**
 * Matching sheet names onto keys and documents, and the plan that results.
 *
 * The plan is the whole point: nothing is written until a player has seen what
 * would be, so everything interesting about an import is decidable here with no
 * world open.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LYRIAN } from "../module/config.mjs";
import { ambiguousNames, unmatchedNames } from "../module/rules/character-sheet-apply.mjs";
import {
  buildImportPlan,
  labelIndex,
  matchName,
  matchNames,
  plannedActorUpdate
} from "../module/rules/character-sheet-match.mjs";

const EN = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const localize = (key) => EN[key] ?? key;

const PACKS = {
  abilities: [
    { name: "Cleave", uuid: "Compendium.x.abilities.1" },
    { name: "Iron Will", uuid: "Compendium.x.abilities.2" },
    { name: "iron will", uuid: "Compendium.x.abilities.3" }
  ],
  breakthroughs: [{ name: "Angelblooded (Human)", uuid: "Compendium.x.bt.1" }],
  classes: [{ name: "Fighter", uuid: "Compendium.x.classes.1" }],
  races: [{ name: "Human", uuid: "Compendium.x.races.1" }],
  inventory: [{ name: "Longsword", uuid: "Compendium.x.weapons.1" }]
};

/* -------------------------------------------- */

test("an exact hit wins outright, however many looser ones exist", () => {
  // Both spellings are in the pack. Without the exact pass first, whichever
  // the caseless rule reached first would answer for both.
  assert.equal(matchName("iron will", PACKS.abilities).entry.uuid, "Compendium.x.abilities.3");
  assert.equal(matchName("Iron Will", PACKS.abilities).entry.uuid, "Compendium.x.abilities.2");
});

test("a stray space in a compendium name still finds its document", () => {
  // Four entries in the shipped content carry a trailing space — "Onmyoji ",
  // "Magitechnician ", "Flash Star Blade Style ", "Five Harmonies " — where the
  // spreadsheet has none. Without the trim, those four classes and that ability
  // would be unimportable for everyone.
  const index = [{ name: "Onmyoji ", uuid: "u1" }, { name: " Five Harmonies", uuid: "u2" }];
  assert.equal(matchName("Onmyoji", index).entry.uuid, "u1");
  assert.equal(matchName("Five Harmonies", index).entry.uuid, "u2");
});

test("case and punctuation are forgiven, in that order", () => {
  const index = [{ name: "Common Knowledge", uuid: "u1" }];
  assert.equal(matchName("common knowledge", index).how, "caseless");
  assert.equal(matchName("Common  Knowledge!", index).how, "normalised");
  assert.equal(matchName("Uncommon Knowledge", index), null);
  assert.equal(matchName("", index), null);
  assert.equal(matchName("Anything", []), null);
});

test("what was asked for is kept beside what was found", () => {
  const { matched, unmatched } = matchNames(
    [{ name: "cleave", passive: false }, { name: "Homebrew", passive: true }],
    PACKS.abilities
  );
  assert.equal(matched[0].entry.uuid, "Compendium.x.abilities.1");
  assert.equal(matched[0].source.passive, false, "the sheet's own row survives the match");
  assert.deepEqual(unmatched, [{ name: "Homebrew", passive: true }]);
});

/* -------------------------------------------- */

test("skill and stat labels resolve back to their schema keys", () => {
  const index = labelIndex(LYRIAN.skills, localize);
  assert.equal(matchName("Common Knowledge", index).entry.key, "commonKnowledge");
  assert.equal(matchName("Animal Husbandry", index).entry.key, "animalHusbandry");
  assert.equal(index.length, Object.keys(LYRIAN.skills).length);

  const stats = labelIndex(LYRIAN.mainStats, localize);
  assert.equal(matchName("Toughness", stats).entry.key, "toughness");
});

const SHEET = {
  name: "Kaelen Vos",
  race: "Human",
  subRace: "Skybound",
  identity: { gender: "Female", age: "24", height: "", weight: "130 lb", worships: "Kari" },
  mainStats: [
    { label: "Toughness", value: 5, bonus: 0 },
    { label: "Power", value: 4, bonus: 1 }
  ],
  subStats: [{ label: "Fitness", value: 5, bonus: 2 }],
  skills: [
    { label: "Athletics", rank: 3, expertise: "Climbing, Swimming" },
    { label: "Common Knowledge", rank: 2, expertise: "" },
    { label: "Basketry", rank: 4, expertise: "" }
  ],
  craftingSkills: [
    { label: "Blacksmithing", rank: 4 },
    { label: "Mining", rank: 3 },
    { label: "Thatching", rank: 1 }
  ],
  classes: [{ name: "Fighter", level: 3 }],
  abilities: [{ name: "Cleave", passive: false }, { name: "Homebrew Smash", passive: false }],
  breakthroughs: [{ name: "Angelblooded (Human)", expCost: 100 }],
  inventory: [{ name: "Longsword", quantity: 1, location: "Combat Loadout" }]
};

test("a plan says what an import would do, before it does it", () => {
  const plan = buildImportPlan(SHEET, PACKS, { localize });

  assert.equal(plan.details.subrace, "Skybound");
  assert.equal(plan.raceItem.uuid, "Compendium.x.races.1");
  assert.deepEqual(plan.stats.power, { value: 4, bonus: 1 });
  assert.deepEqual(plan.subStats.fitness, { value: 5, bonus: 2 });
  assert.equal(plan.skills.commonKnowledge.rank, 2);

  // One block on the sheet, two tables in the system.
  assert.deepEqual(plan.artisan, { blacksmith: { rank: 4 } });
  assert.deepEqual(plan.gathering, { mining: { rank: 3 } });

  assert.deepEqual(plan.counts.abilities, { create: 1, existing: 0, unmatched: 1 });
  assert.equal(plan.items.abilities.create[0].entry.uuid, "Compendium.x.abilities.1");
  assert.equal(plan.items.abilities.unmatched[0].name, "Homebrew Smash");
  assert.equal(plan.items.classes.create[0].source.level, 3, "the level rides along");
});

test("names the system has no home for are reported, not guessed at", () => {
  const plan = buildImportPlan(SHEET, PACKS, { localize });
  assert.deepEqual(plan.warnings, [
    { kind: "unknownSkill", label: "Basketry" },
    { kind: "unknownCraftingSkill", label: "Thatching" }
  ]);
});

test("an item the actor already holds is not added a second time", () => {
  const plan = buildImportPlan(SHEET, PACKS, {
    localize,
    existing: [{ name: "cleave", type: "ability" }, { name: "Longsword", type: "weapon" }]
  });

  assert.deepEqual(plan.counts.abilities, { create: 0, existing: 1, unmatched: 1 });
  assert.deepEqual(plan.counts.inventory, { create: 0, existing: 1, unmatched: 0 });
  assert.equal(plan.items.classes.create.length, 1, "and one it does not hold still arrives");
});

/* -------------------------------------------- */

test("the update writes flat keys, so untouched fields stay untouched", () => {
  const update = plannedActorUpdate(buildImportPlan(SHEET, PACKS, { localize }));

  assert.equal(update["system.stats.power.value"], 4);
  assert.equal(update["system.stats.power.bonus"], 1);
  assert.equal(update["system.skills.athletics.rank"], 3);
  assert.equal(update["system.artisan.blacksmith.rank"], 4);
  assert.equal(update["system.gathering.mining.rank"], 3);
  assert.equal(update["system.details.worship"], "Kari");

  // A blank cell is not an instruction to erase what Foundry holds.
  assert.equal("system.details.height" in update, false);
  // The name is the document's, not a system field, so it is not smuggled in.
  assert.equal("system.details.name" in update, false);
  assert.equal(Object.keys(update).some((key) => !key.startsWith("system.")), false);
});

test("one expertise cell becomes however many the player wrote", () => {
  const update = plannedActorUpdate(buildImportPlan(SHEET, PACKS, { localize }));
  assert.deepEqual(update["system.skills.athletics.expertises"], [
    { name: "Climbing", rank: 0 },
    { name: "Swimming", rank: 0 }
  ]);
  assert.equal("system.skills.commonKnowledge.expertises" in update, false,
    "an empty cell leaves the expertise list alone rather than emptying it");
});

test("an empty sheet plans nothing", () => {
  const plan = buildImportPlan({}, {}, { localize });
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.raceItem, null);
  assert.deepEqual(plannedActorUpdate(plan), {});
  assert.deepEqual(plan.counts.abilities, { create: 0, existing: 0, unmatched: 0 });
});

/* -------------------------------------------- */
/*  Not stacking what must not stack             */
/* -------------------------------------------- */

test("a race already held is reported, never added a second time", () => {
  // Every race Item on an actor adds its stat bonuses, so importing the same
  // sheet twice used to double them.
  const plan = buildImportPlan({ race: "Human" }, PACKS, {
    localize, existing: [{ name: "Human", type: "race" }]
  });

  assert.equal(plan.raceItem.status, "existing");
  assert.deepEqual(plan.warnings, []);
});

test("a race that differs from the one held is left to the player", () => {
  const plan = buildImportPlan({ race: "Human" }, PACKS, {
    localize, existing: [{ name: "Fae", type: "race" }]
  });

  assert.equal(plan.raceItem.status, "conflict");
  assert.deepEqual(plan.warnings, [{ kind: "raceConflict", label: "Human" }]);
});

test("a race on a character with none is created", () => {
  const plan = buildImportPlan({ race: "Human" }, PACKS, { localize });
  assert.equal(plan.raceItem.status, "create");
  assert.equal(plan.raceItem.uuid, "Compendium.x.races.1");
});

test("a race the packs do not carry is reported rather than ignored", () => {
  const plan = buildImportPlan({ race: "Tribble" }, PACKS, { localize });
  assert.equal(plan.raceItem, null);
  assert.deepEqual(plan.warnings, [{ kind: "unknownRace", label: "Tribble" }]);
});

test("holding a weapon does not block importing an ability of that name", () => {
  // Names collide across types in the rulebook, and the sheet's own tabs keep
  // them apart, so the check has to as well.
  const packs = {
    ...PACKS,
    abilities: [{ name: "Cleave", uuid: "ability" }],
    inventory: [{ name: "Cleave", uuid: "weapon" }]
  };
  const plan = buildImportPlan(
    { abilities: [{ name: "Cleave" }], inventory: [{ name: "Cleave" }] },
    packs,
    { localize, existing: [{ name: "Cleave", type: "weapon" }] }
  );

  assert.deepEqual(plan.counts.abilities, { create: 1, existing: 0, unmatched: 0 });
  assert.equal(plan.items.abilities.create[0].entry.uuid, "ability");
  assert.deepEqual(plan.counts.inventory, { create: 0, existing: 1, unmatched: 0 });
});

/* -------------------------------------------- */

test("a name the compendiums carry twice is flagged, not silently guessed", () => {
  // 40 of the shipped abilities share a name with a class's key ability. The
  // spreadsheet's own lookup takes the first too, so the import matches its
  // behaviour — and says so.
  const packs = {
    ...PACKS,
    abilities: [
      { name: "Advanced Artificing", uuid: "ability" },
      { name: "Advanced Artificing", uuid: "key-ability" }
    ]
  };
  const plan = buildImportPlan({ abilities: [{ name: "Advanced Artificing" }] }, packs, { localize });

  assert.equal(plan.items.abilities.create[0].entry.uuid, "ability", "the first is taken");
  assert.deepEqual(plan.warnings,
    [{ kind: "ambiguousName", label: "Advanced Artificing", count: 2 }]);

  // It is imported, so it does not belong on the "not found" line.
  assert.deepEqual(unmatchedNames(plan), []);
  assert.deepEqual(ambiguousNames(plan), ["Advanced Artificing"]);
});

test("a name matched once carries no ambiguity", () => {
  const plan = buildImportPlan({ abilities: [{ name: "Cleave" }] }, PACKS, { localize });
  assert.deepEqual(plan.warnings, []);
  assert.equal(matchName("Cleave", PACKS.abilities).count, 1);
});
