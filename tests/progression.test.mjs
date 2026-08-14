import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  CLASS_FEATURE_LEVELS,
  classFeatureGrants,
  normalizeClassLevel,
  raceAmbitionExp,
  raceAttributeBonuses,
  selectedRaceBonuses
} from "../module/rules/progression.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

test("class progression unlocks its five features through level 8", () => {
  const system = {
    relationships: {
      key_ability: "key",
      abilities: ["one", "two", "three"],
      ultimate_ability: "ultimate"
    }
  };

  assert.deepEqual(CLASS_FEATURE_LEVELS, [1, 2, 4, 6, 8]);
  assert.deepEqual(classFeatureGrants(system, 1).map((grant) => grant.stableId), ["key"]);
  assert.deepEqual(classFeatureGrants(system, 2).map((grant) => grant.stableId), ["key", "one"]);
  assert.deepEqual(classFeatureGrants(system, 4).map((grant) => grant.stableId), ["key", "one", "two"]);
  assert.deepEqual(classFeatureGrants(system, 6).map((grant) => grant.stableId), ["key", "one", "two", "three"]);
  assert.deepEqual(classFeatureGrants(system, 8).map((grant) => grant.stableId), ["key", "one", "two", "three", "ultimate"]);
  assert.equal(normalizeClassLevel(0), 1);
  assert.equal(normalizeClassLevel(9), 8);
});

test("race automation parses fixed and player-selected attribute bonuses", () => {
  assert.deepEqual(raceAttributeBonuses("Gain +1 in Toughness and +1 in Awareness."), {
    main: { toughness: 1 }, sub: { awareness: 1 }, chooseMain: 0, chooseSub: 0
  });

  const human = raceAttributeBonuses(
    "Gain +1 in the main stat of your choice and +1 in the substat of your choice."
  );
  assert.deepEqual(selectedRaceBonuses({
    attributeBonuses: human,
    selectedMainStat: "focus",
    selectedSubStat: "reason"
  }), { main: { focus: 1 }, sub: { reason: 1 } });
});

test("Human ambition adds 100 EXP to the available budget and Spirit Core", () => {
  assert.equal(
    raceAmbitionExp("You start with an additional 100 EXP that is also added to your Spirit Core."),
    100
  );
});

test("compiled primary races and classes carry complete sheet automation", async () => {
  const races = JSON.parse(await readFile(path.join(ROOT, "content", "races-01.json"), "utf8"));
  const classFiles = ["classes-01.json", "classes-02.json"];
  const classes = (await Promise.all(classFiles.map(async (file) =>
    JSON.parse(await readFile(path.join(ROOT, "content", file), "utf8"))
  ))).flat();

  const human = races.find((race) => race.system.stableId === "primary-race--human");
  assert.equal(human.system.ambitionExp, 100);
  assert.equal(human.system.attributeBonuses.chooseMain, 1);
  assert.equal(human.system.attributeBonuses.chooseSub, 1);
  assert.equal(human.system.relationships.abilities.length, 2);

  const demon = races.find((race) => race.system.stableId === "primary-race--demon");
  assert.ok(demon.system.variants.length >= 8);
  assert.ok(demon.system.variants.every((variant) => variant.abilityStableId));

  for (const classItem of classes) {
    assert.equal(classItem.system.abilitiesUnlocked, 1, classItem.name);
    assert.equal(classFeatureGrants(classItem.system, 8).length, 5, classItem.name);
  }
});
