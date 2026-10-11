/**
 * One use of an ability can make several attacks.
 *
 * Reported: "there isn't a way to attach multiple attacks to one character
 * ability". Every multi-attack ability in the rulebook repeats one attack type
 * — Double Punch two Lights, Burst Fire three, Maximum Firerate eight — so the
 * ability's single attack gains a count rather than becoming a list.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { abilityAttackCount, MAX_ABILITY_ATTACKS } from "../module/rules/ability-attack.mjs";
import { abilityRefused, abilitySucceeded } from "../module/rules/ability-result.mjs";

const item = readFileSync(new URL("../module/documents/item.mjs", import.meta.url), "utf8");
const body = readFileSync(new URL("../templates/item/body.hbs", import.meta.url), "utf8");
const schema = readFileSync(new URL("../module/data/item.mjs", import.meta.url), "utf8");

test("the count is a whole number from one up, and nonsense means once", () => {
  assert.equal(abilityAttackCount(3), 3);
  assert.equal(abilityAttackCount("8"), 8);
  assert.equal(abilityAttackCount(2.9), 2, "a strike is not divisible");
  // An ability saved before the field existed, or edited to nothing, still attacks.
  for (const value of [undefined, null, "", 0, -4, "lots", NaN]) {
    assert.equal(abilityAttackCount(value), 1, `${String(value)} must attack once, not zero times`);
  }
  assert.equal(abilityAttackCount(500), MAX_ABILITY_ATTACKS);
  assert.ok(MAX_ABILITY_ATTACKS >= 8, "the rulebook's largest, Maximum Firerate, makes eight");
});

test("the cost is paid once and each strike gets its own card", () => {
  const strike = item.slice(item.indexOf("async _rollAbilityStrike("));
  const strikeBody = strike.slice(0, strike.indexOf("\n  }\n"));
  assert.doesNotMatch(strikeBody, /spendResources/,
    "one use, one cost — paying per strike would charge Double Punch twice");
  assert.match(strikeBody, /renderAttackCard\(/, "each strike can be reacted to on its own");

  assert.match(item, /const count = abilityAttackCount\(sys\.attackCount\);/);
  assert.match(item, /for \(let strike = 0; strike < count; strike \+= 1\)/);
});

test("every strike is returned, and the first keeps its old place", () => {
  const strikes = [
    { attackRoll: "r1", damageRoll: "d1", isCrit: false, message: "m1" },
    { attackRoll: "r2", damageRoll: "d2", isCrit: true, message: "m2" }
  ];
  const result = abilitySucceeded({ ...strikes[0], attacks: strikes });
  assert.equal(result.attackRoll, "r1", "existing readers of the first strike are undisturbed");
  assert.equal(result.attacks.length, 2);
  assert.deepEqual(abilitySucceeded({}).attacks, [], "an ability with no attack has none");
  assert.deepEqual(abilityRefused("busy").attacks, [], "and the shape is the same when refused");
});

test("the count is on the sheet once, shared with monster abilities", () => {
  assert.equal(body.split('name="system.attackCount"').length - 1, 1);
  const shared = body.slice(body.indexOf('{{#*inline "abilityPayload"}}'), body.indexOf("{{/inline}}"));
  assert.ok(shared.includes('name="system.attackCount"'), "monster abilities get it too");
  assert.match(schema, /schema\.attackCount = int\(1, \{ min: 1, max: MAX_ABILITY_ATTACKS \}\)/,
    "an unset count reads as 1, so no migration is needed");
});
