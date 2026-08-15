import assert from "node:assert/strict";
import test from "node:test";

import {
  ARMOR_PROFICIENCIES,
  COMMON_WEAPON_PROFICIENCIES,
  SPECIALIZED_WEAPON_PROFICIENCIES,
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
  assert.deepEqual(rogue.choices.map((entry) => entry.options), [[
    "Small Weapons", "Light Swords", "Dueling Weapons", "Set of Missiles"
  ]]);
});

test("Human choices expose one language and one common weapon selection", () => {
  const human = parseProficiencyGrants(
    "You can speak, read and write Common, as well as another Language of your choice. "
    + "You also gain proficiency in one common weapon group."
  );
  assert.deepEqual(human.languages, ["Common"]);
  assert.equal(human.choices.length, 2);
  assert.deepEqual(human.choices[0], {
    key: "language-choice",
    kind: "languages",
    label: "Choose one additional language or subrace dialect.",
    options: ["Common", "Sorthen", "Sylvan", "Kiraran"],
    count: 1,
    allowCustom: true
  });
  assert.deepEqual(human.choices[1].options, [...COMMON_WEAPON_PROFICIENCIES]);
});

test("Adventurer choices enforce both weapon picks and armor-or-shield pick", () => {
  const adventurer = parseProficiencyGrants(
    "You gain proficiency in 1 common weapon group. "
    + "In addition, you gain proficiency in 1 common or specialized weapon groups. "
    + "You gain proficiency in 1 armor category of your choosing. Alternatively, you may pick the shield or greatshield."
  );
  assert.equal(adventurer.choices.length, 3);
  assert.deepEqual(adventurer.choices[0].options, [...COMMON_WEAPON_PROFICIENCIES]);
  assert.deepEqual(adventurer.choices[1].options, [
    ...COMMON_WEAPON_PROFICIENCIES,
    ...SPECIALIZED_WEAPON_PROFICIENCIES
  ]);
  assert.deepEqual(adventurer.choices[2].options, [...ARMOR_PROFICIENCIES]);
});

test("fixed and selectable grants coexist for Mounted Basics", () => {
  const mounted = parseProficiencyGrants(
    "You gain proficiency in Polearms, Lances, Light armor, Shields and one other common weapon group of your choice."
  );
  assert.deepEqual(mounted.weapons, ["Polearm", "Lance"]);
  assert.deepEqual(mounted.armor, ["Light Armor", "Shields"]);
  assert.deepEqual(mounted.choices.map((entry) => entry.options), [[...COMMON_WEAPON_PROFICIENCIES]]);
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
    system: {
      proficiencyChoiceSelections: {},
      proficiencies: { weapons: new Set(["Small Weapon"]), armor: new Set(["light armor"]), languages: new Set(["Common", "Sylvan"]) }
    }
  };
  const result = collectActorProficiencies(actor);
  assert.deepEqual(result.groups.weapons.map((entry) => entry.name), ["Bludgeoning Weapons", "Small Weapons"]);
  assert.deepEqual(result.groups.armor.map((entry) => entry.name), ["Light Armor"]);
  assert.deepEqual(result.groups.languages.map((entry) => entry.name), ["Common", "Sylvan"]);
  assert.ok(result.sources.some((source) => source.name === "Pierrot — Pierrot's Journey"));
});

test("saved source-owned choices become automatic proficiencies", () => {
  const actor = {
    items: [{
      id: "human",
      type: "race",
      name: "Human",
      system: {
        stableId: "human",
        grantedProficiencies: "You can speak, read and write Common, as well as another Language of your choice. You also gain proficiency in one common weapon group.",
        variants: [],
        selectedVariant: ""
      }
    }],
    system: {
      proficiencyChoiceSelections: {
        "human--language-choice": ["Northi"],
        "human--common-weapons": ["Light Swords"]
      },
      proficiencies: { weapons: [], armor: [], languages: [] }
    }
  };
  const result = collectActorProficiencies(actor);
  assert.deepEqual(result.groups.weapons.map((entry) => entry.name), ["Light Swords"]);
  assert.deepEqual(result.groups.languages.map((entry) => entry.name), ["Common", "Northi"]);
  assert.ok(result.groups.weapons.every((entry) => entry.granted));
  assert.equal(result.sources[0].choices[1].slots[0].value, "Light Swords");
});

test("identical ability description and benefits do not duplicate choice slots", () => {
  const text = "You gain proficiency in 1 common weapon group.";
  const actor = {
    items: [{
      id: "adventurer-essentials",
      type: "ability",
      name: "Adventurer Essentials",
      system: { description: text, benefits: text },
      getFlag: () => ({ kind: "class", sourceName: "Adventurer" })
    }],
    system: {
      proficiencyChoiceSelections: {},
      proficiencies: { weapons: [], armor: [], languages: [] }
    }
  };
  assert.equal(collectActorProficiencies(actor).sources[0].choices.length, 1);
});
