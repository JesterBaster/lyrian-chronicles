import assert from "node:assert/strict";
import test from "node:test";

import {
  availableUniversalAttacks,
  universalAttackProfile
} from "../module/rules/universal-attack.mjs";

const attackTypes = {
  light: { ap: 1, accuracy: "focus", damage: "2d4", powerMultiplier: 1 },
  heavy: { ap: 2, accuracy: "focus", damage: "4d6", powerMultiplier: 2 },
  precise: {
    ap: 2,
    accuracy: "doubleFocus",
    damage: "2d4",
    powerMultiplier: 1,
    pinpoint: true
  }
};

test("universal Light, Heavy, and Precise attacks use the shared profiles", () => {
  const common = {
    attackTypes,
    power: 3,
    focus: 4,
    standardAccuracy: 7,
    preciseAccuracy: 11,
    unarmedProficient: true
  };

  assert.deepEqual(universalAttackProfile({ ...common, attackType: "light" }), {
    ap: 1,
    accuracyBonus: 7,
    damageFormula: "2d4 + 3",
    pinpoint: 0
  });
  assert.deepEqual(universalAttackProfile({ ...common, attackType: "heavy" }), {
    ap: 2,
    accuracyBonus: 7,
    damageFormula: "4d6 + 6",
    pinpoint: 0
  });
  assert.deepEqual(universalAttackProfile({ ...common, attackType: "precise" }), {
    ap: 2,
    accuracyBonus: 11,
    damageFormula: "2d4 + 3",
    pinpoint: 4
  });
});

test("a universal attack without Unarmed proficiency deals flat 1 damage", () => {
  const profile = universalAttackProfile({
    attackType: "heavy",
    attackTypes,
    power: 9,
    standardAccuracy: 6,
    unarmedProficient: false
  });

  assert.equal(profile.damageFormula, "1");
  assert.equal(profile.ap, 2);
  assert.equal(profile.accuracyBonus, 6);
});

test("unknown universal attack types are rejected", () => {
  assert.equal(universalAttackProfile({ attackType: "other", attackTypes }), null);
});

test("HUD universal actions exist for every character", () => {
  const actions = availableUniversalAttacks({
    actorType: "character",
    attackTypes,
    apTotal: 1
  });
  assert.deepEqual(actions.map((action) => action.type), ["light", "heavy", "precise"]);
  assert.equal(actions[0].affordable, true);
  assert.equal(actions[1].affordable, false);
  assert.equal(actions[0].sourceProfile, "unarmed");

  // Holding a weapon does not take unarmed strikes away — abilities call for
  // them while armed, and there is no other way to roll one.
  assert.deepEqual(
    availableUniversalAttacks({ actorType: "character", attackTypes, apTotal: 4 })
      .map((action) => action.type),
    ["light", "heavy", "precise"]
  );

  // Monsters roll their own stat-block attacks instead.
  assert.deepEqual(availableUniversalAttacks({
    actorType: "monster",
    attackTypes,
    apTotal: 4
  }), []);
});
