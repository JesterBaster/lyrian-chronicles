import assert from "node:assert/strict";
import test from "node:test";

import {
  skillCapForSpiritCore,
  skillCapViolations
} from "../module/rules/skill-caps.mjs";

const caps = {
  base: 15,
  skyboundBonus: 5,
  skyboundThreshold: 5000,
  uncappedThreshold: 10000,
  artisan: 10,
  gathering: 15
};

function system(overrides = {}) {
  return {
    spiritCore: 0,
    ambitionExp: 0,
    exp: { spent: 0 },
    skills: {
      deception: { rank: 0, expertises: [{ name: "Disguise", rank: 0 }] }
    },
    artisan: {
      alchemist: { rank: 0, expertises: [{ name: "Potions", rank: 0 }] }
    },
    gathering: { mining: { rank: 0 } },
    ...overrides
  };
}

test("Spirit Core produces the official 15, 20, and uncapped main-skill limits", () => {
  assert.equal(skillCapForSpiritCore(0, caps), 15);
  assert.equal(skillCapForSpiritCore(4999, caps), 15);
  assert.equal(skillCapForSpiritCore(5000, caps), 20);
  assert.equal(skillCapForSpiritCore(9999, caps), 20);
  assert.equal(skillCapForSpiritCore(10000, caps), Infinity);
});

test("main skill and expertise updates above the current cap are rejected", () => {
  assert.deepEqual(skillCapViolations(system(), {
    "system.skills.deception.rank": 16
  }, caps).map((entry) => entry.path), ["system.skills.deception.rank"]);

  assert.deepEqual(skillCapViolations(system(), {
    system: { skills: { deception: { expertises: [{ name: "Disguise", rank: 16 }] } } }
  }, caps).map((entry) => entry.path), ["system.skills.deception.expertises.0.rank"]);

  assert.deepEqual(skillCapViolations(system(), {
    "system.skills.deception.expertises.0.rank": 16
  }, caps).map((entry) => entry.path), ["system.skills.deception.expertises.0.rank"]);
});

test("Skybound and 10k Spirit Core thresholds are applied to the same update", () => {
  assert.equal(skillCapViolations(system(), {
    "system.exp.spent": 5000,
    "system.skills.deception.rank": 20
  }, caps).length, 0);
  assert.equal(skillCapViolations(system(), {
    "system.exp.spent": 10000,
    "system.skills.deception.rank": 999
  }, caps).length, 0);
});

test("artisan and gathering caps remain fixed", () => {
  const violations = skillCapViolations(system(), {
    "system.artisan.alchemist.rank": 11,
    "system.artisan.alchemist.expertises": [{ name: "Potions", rank: 11 }],
    "system.gathering.mining.rank": 16
  }, caps);
  assert.deepEqual(violations.map((entry) => entry.path), [
    "system.artisan.alchemist.rank",
    "system.artisan.alchemist.expertises.0.rank",
    "system.gathering.mining.rank"
  ]);
});

test("unrelated updates do not reject existing over-cap data", () => {
  const actor = system({
    skills: { deception: { rank: 16, expertises: [{ name: "Disguise", rank: 16 }] } }
  });
  assert.equal(skillCapViolations(actor, { name: "Renamed" }, caps).length, 0);
});

test("lowering Spirit Core reports ranks invalidated by the lower cap", () => {
  const actor = system({
    spiritCore: 5000,
    exp: { spent: 5000 },
    skills: { deception: { rank: 20, expertises: [{ name: "Disguise", rank: 20 }] } }
  });
  assert.deepEqual(skillCapViolations(actor, { "system.exp.spent": 4999 }, caps)
    .map((entry) => entry.path), [
      "system.skills.deception.rank",
      "system.skills.deception.expertises.0.rank"
    ]);
});
