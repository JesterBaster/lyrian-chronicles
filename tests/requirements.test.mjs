import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRequirement,
  normalizeRequirement,
  REQUIREMENT_STATUS
} from "../module/rules/requirements.mjs";

const catalog = {
  classes: [
    { name: "Rogue", tier: 1 }, { name: "Culinarian", tier: 1 },
    { name: "Mage", tier: 1 }, { name: "Mage Knight", tier: 2 }, { name: "Thief", tier: 2 }
  ],
  breakthroughs: ["Divine Luck I", "Divine Luck II", "Divine's Chosen"],
  abilities: ["Decipher Magic", "Arcane Barrier"],
  races: ["Human", "Fae", "Spiderfolk"],
  proficiencies: ["Shields", "Light Armor", "Medium Armor", "Katana"],
  weapons: ["Katana", "Polearm"]
};

function context(actor = {}, extra = {}) {
  return {
    catalog,
    actor: {
      classes: [], breakthroughs: [], abilities: [], races: [], proficiencies: [],
      equippedWeapons: [], spiritCore: 0, ...actor
    },
    ...extra
  };
}

test("empty, None, HTML None, and imported dash requirements pass", () => {
  for (const value of ["", "-", "None", "<p>None.</p>", "LQ=="]) {
    assert.equal(evaluateRequirement(value, context()).status, REQUIREMENT_STATUS.PASS, value);
  }
  assert.equal(normalizeRequirement("<p>Mage mastered.</p>"), "Mage mastered.");
});

test("named, alternative, any-class, and tier mastery requirements are evaluated", () => {
  const rogue = { name: "Rogue", tier: 1, level: 8 };
  const thief = { name: "Thief", tier: 2, level: 8 };
  assert.equal(evaluateRequirement("Rogue or Culinarian mastered.", context({ classes: [rogue] })).status,
    REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("Mage mastered.", context({ classes: [rogue] })).status,
    REQUIREMENT_STATUS.FAIL);
  assert.equal(evaluateRequirement("Any class mastered.", context({ classes: [rogue] })).status,
    REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("Any tier 2 class mastered.", context({ classes: [rogue] })).status,
    REQUIREMENT_STATUS.FAIL);
  assert.equal(evaluateRequirement("Rogue mastered, any tier 2 class mastered.",
    context({ classes: [rogue, thief] })).status, REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("Mage Knight mastered.", context({
    classes: [{ name: "Mage Knight", tier: 2, level: 8 }]
  })).status, REQUIREMENT_STATUS.PASS);
});

test("race, breakthrough, ability, proficiency, and Spirit Core checks use actor state", () => {
  const actor = {
    races: ["Human"],
    breakthroughs: ["Divine Luck I"],
    abilities: ["Decipher Magic"],
    proficiencies: ["Shields"],
    spiritCore: 3200
  };
  assert.equal(evaluateRequirement("Must be a Human.", context(actor)).status, REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("Must have purchased Divine Luck I.", context(actor)).status, REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("Possess the Decipher Magic ability.", context(actor)).status, REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("You must be proficient with shields.", context(actor)).status, REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("3000+ Spirit Core", context(actor)).status, REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("Must be a Fae.", context(actor)).status, REQUIREMENT_STATUS.FAIL);
});

test("character-creation restrictions fail later and contextual action rules stay manual", () => {
  assert.equal(evaluateRequirement("Must be taken at character creation.", context()).status,
    REQUIREMENT_STATUS.FAIL);
  assert.equal(evaluateRequirement("Must be taken at character creation.", context({}, { atCharacterCreation: true })).status,
    REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("An ally within range is the target of an attack.", context()).status,
    REQUIREMENT_STATUS.MANUAL);
});

test("simple equipped weapon and shield requirements are enforced", () => {
  assert.equal(evaluateRequirement("Katana only.", context({ equippedWeapons: ["Katana"] })).status,
    REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("Polearm only.", context({ equippedWeapons: ["Katana"] })).status,
    REQUIREMENT_STATUS.FAIL);
  assert.equal(evaluateRequirement("Must be using a shield.", context({ hasShield: true })).status,
    REQUIREMENT_STATUS.PASS);
});

test("mixed OR branches remain manual unless every detected condition is satisfied", () => {
  const rogueOnly = context({
    classes: [{ name: "Rogue", tier: 1, level: 8 }]
  });
  assert.equal(
    evaluateRequirement("Be a Human or have Rogue mastered and possess the Decipher Magic ability.", rogueOnly).status,
    REQUIREMENT_STATUS.MANUAL
  );
  const fullBranch = context({
    classes: [{ name: "Rogue", tier: 1, level: 8 }],
    abilities: ["Decipher Magic"]
  });
  assert.equal(
    evaluateRequirement("Be a Human or have Rogue mastered and possess the Decipher Magic ability.", fullBranch).status,
    REQUIREMENT_STATUS.MANUAL
  );
});

test("official parenthetical and folk naming variants resolve safely", () => {
  const aliasCatalog = {
    ...catalog,
    breakthroughs: ["Angelblooded (Human) (Restricted)", "Blend In (Slimefolk)", "Wide Circuits I"],
    races: ["Lamiafolk", "Red Pandafolk"]
  };
  const aliasContext = {
    catalog: aliasCatalog,
    actor: {
      classes: [], abilities: [], proficiencies: [], equippedWeapons: [], spiritCore: 0,
      breakthroughs: ["Blend In (Slimefolk)", "Wide Circuits I"],
      races: ["Lamiafolk"]
    }
  };
  assert.equal(evaluateRequirement("Must have Blend In.", aliasContext).status, REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("Must have the Wide Circuits breakthrough.", aliasContext).status, REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("Must be a Lamia.", aliasContext).status, REQUIREMENT_STATUS.PASS);
  assert.equal(evaluateRequirement("Must be Red Panda.", aliasContext).status, REQUIREMENT_STATUS.FAIL);
});

test("Thief's official compound alternative is never accepted from Rogue alone", () => {
  const requirement = "Be a rabbitfolk or have Rogue mastered and possess the Decipher Magic ability.";
  assert.equal(evaluateRequirement(requirement, context({
    classes: [{ name: "Rogue", tier: 1, level: 8 }]
  })).status, REQUIREMENT_STATUS.MANUAL);
  assert.equal(evaluateRequirement(requirement, context({ races: ["Human"] })).status,
    REQUIREMENT_STATUS.MANUAL);
});
