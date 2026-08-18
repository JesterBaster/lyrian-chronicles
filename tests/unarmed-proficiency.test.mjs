import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BASELINE_WEAPON_PROFICIENCIES,
  UNARMED_PROFICIENCY,
  isUnarmedProficient
} from "../module/rules/proficiencies.mjs";
import { universalAttackProfile } from "../module/rules/universal-attack.mjs";

const attackTypes = { light: { ap: 1, accuracy: "focus", damage: "2d4", powerMultiplier: 1 } };

test("proficiency is read from where the grant is actually stored", () => {
  // Gaining it from a race, a class or the proficiencies tab canonicalizes to
  // the weapon proficiency "Unarmed" — not to the separate boolean.
  assert.equal(isUnarmedProficient({ proficiencies: { weapons: ["Unarmed"] } }), true);
  assert.equal(isUnarmedProficient({ proficiencies: { weapons: new Set(["Unarmed"]) } }), true);
});

test("Unarmed is baseline, so a character carrying no grant still has it", () => {
  // The rulebook's flat-1 unproficient case is deliberately out of reach.
  assert.equal(BASELINE_WEAPON_PROFICIENCIES.includes(UNARMED_PROFICIENCY), true);
  assert.equal(isUnarmedProficient({ proficiencies: { weapons: ["Longsword"] } }), true);
});

test("stored names match regardless of case or spacing", () => {
  assert.equal(isUnarmedProficient({ proficiencies: { weapons: ["unarmed"] } }), true);
  assert.equal(isUnarmedProficient({ proficiencies: { weapons: ["  UNARMED  "] } }), true);
});

test("the legacy boolean still counts, so nobody loses a grant", () => {
  assert.equal(isUnarmedProficient({ proficiencies: { unarmed: true, weapons: [] } }), true);
});

test("an actor with nothing recorded still gets the baseline", () => {
  assert.equal(isUnarmedProficient({}), true);
  assert.equal(isUnarmedProficient(undefined), true);
  assert.equal(isUnarmedProficient({ proficiencies: {} }), true);
});

test("the baseline is a list, not a hardcoded answer", () => {
  // Dropping Unarmed from the list must restore the rulebook rule without
  // needing any other change, so the check has to read the real sources.
  const source = readFileSync("module/rules/proficiencies.mjs", "utf8");
  const body = source.slice(source.indexOf("export function isUnarmedProficient"));
  assert.match(body.slice(0, 400), /BASELINE_WEAPON_PROFICIENCIES/);
  assert.match(body.slice(0, 400), /proficiencies\?\.weapons/);
  assert.ok(!/^\s*return true;/m.test(body.slice(0, 400)), "must not be a constant");
});

test("a proficient character swings for weapon damage, not a flat point", () => {
  const untrained = universalAttackProfile({
    attackType: "light", attackTypes, power: 3, unarmedProficient: false
  });
  // The rulebook: unarmed deals 1 point of damage unless you are proficient.
  assert.equal(untrained.damageFormula, "1");

  const trained = universalAttackProfile({
    attackType: "light", attackTypes, power: 3, unarmedProficient: true
  });
  assert.equal(trained.damageFormula, "2d4 + 3");
});

test("the roll and its verification agree on proficiency", () => {
  // They recompute the same profile: if verification thought the attacker was
  // unproficient it would bound a legitimate 2d4 + Power hit down to 1.
  const roll = readFileSync("module/documents/actor.mjs", "utf8");
  const verify = readFileSync("module/rules/attack-verification.mjs", "utf8");
  for (const source of [roll, verify]) {
    assert.match(source, /unarmedProficient: \w+\.type !== "character" \|\| isUnarmedProficient\(/);
    assert.ok(
      !/!!\w+\.system\??\.?\.?proficiencies\?\.unarmed/.test(source),
      "must not read the boolean that nothing writes"
    );
  }
});
