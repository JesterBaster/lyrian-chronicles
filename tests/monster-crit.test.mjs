/**
 * Monsters on their official statblock crit like everything else.
 *
 * Reported: "monsters using the official stat block don't have crit handling".
 * They did not — the statblock attack rolled plain damage and told the card
 * nothing, so a natural 20 dealt rolled damage, gained no half-pierce, and
 * gave Block nothing to turn.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { boundedDamage, legitimateAttackProfile } from "../module/rules/attack-verification.mjs";

const source = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
const statblockAttack = source.slice(
  source.indexOf("async _rollMonsterAttack("),
  source.indexOf("async _rollMonsterAttack(") + 2600
);

test("a statblock attack checks its natural roll for a crit", () => {
  assert.match(statblockAttack, /isCriticalHit\(natural\)/);
  assert.match(statblockAttack, /evaluate\(\{ maximize: isCrit \}\)/,
    "a crit deals maximum damage instead of rolling");
  // The card is what the defence buttons read: without these it could not
  // grant half-pierce or re-roll the damage when the target blocks.
  assert.match(statblockAttack, /isCrit,\s*\n\s*halfPierce: isCrit,/);
});

function monster() {
  const actor = {
    uuid: "Actor.wolf",
    type: "monster",
    system: {
      stats: { power: { total: 3 }, focus: { total: 2 } },
      official: { enabled: true, lightAttack: "+2 Accuracy, 2d4+3", heavyAttack: "+2 Accuracy, 4d6+6" }
    },
    getRollData: () => ({})
  };
  return { actor, resolveUuid: async (uuid) => (uuid === actor.uuid ? actor : null) };
}

class MaxRoll {
  constructor(formula) { this.formula = formula; this.total = 0; }
  async evaluate({ maximize } = {}) {
    assert.equal(maximize, true);
    this.total = this.formula.replace(/\s/g, "") === "4d6+6" ? 30 : -1;
    return this;
  }
}

test("a monster's crit passes the damage check and keeps its half-pierce", async () => {
  const { actor, resolveUuid } = monster();
  const profile = await legitimateAttackProfile({
    attack: {
      actorUuid: actor.uuid,
      sourceUuid: actor.uuid,
      sourceKind: "monsterProfile",
      attackType: "heavy",
      accuracy: { isCrit: true },
      damage: { total: 30, maximised: true }
    },
    resolveUuid,
    RollClass: MaxRoll
  });

  assert.equal(profile.ceiling, 30, "4d6+6 at its maximum");
  assert.deepEqual(boundedDamage({ claimed: 30, ceiling: profile.ceiling }),
    { amount: 30, clamped: false }, "a maximised crit is exactly the ceiling, not a forgery");
  assert.equal(profile.pierce.halfPierce, true, "a crit gains half-pierce");
  assert.equal(profile.formula.replace(/\s/g, ""), "4d6+6",
    "and Block re-rolls the real formula when it turns the crit");
});

test("an ordinary monster hit gains nothing", async () => {
  const { actor, resolveUuid } = monster();
  const profile = await legitimateAttackProfile({
    attack: {
      actorUuid: actor.uuid,
      sourceUuid: actor.uuid,
      sourceKind: "monsterProfile",
      attackType: "heavy",
      accuracy: { isCrit: false },
      damage: { total: 17, maximised: false }
    },
    resolveUuid,
    RollClass: MaxRoll
  });
  assert.equal(profile.pierce.halfPierce, false);
});
