import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalProficiency,
  collectActorProficiencies,
  dedupeProficiencies,
  parseProficiencyGrants
} from "../module/rules/proficiencies.mjs";

test("fixed race languages and class proficiencies are parsed", () => {
  assert.deepEqual(
    parseProficiencyGrants("You can speak, read, write Common and Sorthen."),
    { weapons: [], armor: [], languages: ["Common", "Sorthen"], choices: [] }
  );
  assert.deepEqual(
    parseProficiencyGrants("You gain proficiency in small weapons, bludgeoning weapons and light armor."),
    {
      weapons: ["Bludgeoning Weapons", "Small Weapons"],
      armor: ["Light Armor"],
      languages: [],
      choices: []
    }
  );
});

test("choice grants do not incorrectly grant every listed option", () => {
  const rogue = parseProficiencyGrants(
    "You gain proficiency with light armor and with one of the following weapon groups: Small weapons, Light swords, Dueling weapons and Set of missiles."
  );
  assert.deepEqual(rogue.armor, ["Light Armor"]);
  assert.deepEqual(rogue.weapons, []);
  assert.equal(rogue.choices.length, 1);
});

test("normalization removes spelling, case, and plural duplicates", () => {
  assert.deepEqual(
    dedupeProficiencies(["Pistol", "pistols", " PISTOL ", "Dueling Weapon", "Dueling Weapons"], "weapons"),
    ["Pistol", "Dueling Weapons"]
  );
  assert.deepEqual(canonicalProficiency("normal shields", "armor"), {
    kind: "armor", name: "Shields", key: "shields"
  });
});

test("automatic grants win over duplicate manual selections and retain sources", () => {
  const race = {
    type: "race",
    name: "Human",
    system: {
      grantedProficiencies: "You can speak, read and write Common.",
      variants: [], selectedVariant: ""
    }
  };
  const journey = {
    type: "ability",
    name: "Pierrot's Journey",
    system: {
      description: "You gain proficiency in small weapons, bludgeoning weapons and light armor.",
      benefits: ""
    },
    getFlag: () => ({ kind: "class", sourceName: "Pierrot" })
  };
  const actor = {
    items: [race, journey],
    system: { proficiencies: { weapons: new Set(["Small Weapon"]), armor: new Set(["light armor"]), languages: new Set(["Common", "Sylvan"]) } }
  };
  const result = collectActorProficiencies(actor);
  assert.deepEqual(result.groups.weapons.map((entry) => entry.name), ["Bludgeoning Weapons", "Small Weapons"]);
  assert.deepEqual(result.groups.armor.map((entry) => entry.name), ["Light Armor"]);
  assert.deepEqual(result.groups.languages.map((entry) => entry.name), ["Common", "Sylvan"]);
  assert.ok(result.sources.some((source) => source.name === "Pierrot — Pierrot's Journey"));
});
