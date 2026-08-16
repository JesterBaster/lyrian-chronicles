import assert from "node:assert/strict";
import test from "node:test";

import { armorValues, equippedArmorContribution } from "../module/rules/armor.mjs";
import { abilityWeaponAttackContext } from "../module/rules/ability-attack.mjs";
import { derivedGuardValues, guardForDamage } from "../module/rules/damage.mjs";

test("Half Pierce follows the official reaction rule", () => {
  assert.equal(guardForDamage({ guard: 7, halfPierce: true, defence: "none" }), 0);
  assert.equal(guardForDamage({ guard: 7, halfPierce: true, defence: "dodge" }), 7);
  assert.equal(guardForDamage({ blockGuard: 11, halfPierce: true, defence: "block" }), 11);
  assert.equal(guardForDamage({ blockGuard: 11, fullPierce: true, defence: "block" }), 0);
  assert.equal(guardForDamage({ guard: 7, defence: "none", pinpoint: 3 }), 4);
});

test("Guard-only effects do not increase Block", () => {
  assert.deepEqual(derivedGuardValues({
    toughness: 4,
    equipmentGuard: 2,
    equipmentBlockValue: 3,
    guardBonus: 5,
    blockBonus: 1
  }), { guard: 11, blockGuard: 12 });
});

test("shield Guard and Block bonuses use the shared armour calculation", () => {
  const system = { category: "greatshield", guardBonus: 2, blockBonus: 3, proficient: true };
  const values = armorValues(system);
  assert.equal(values.isShield, true);
  assert.equal(values.guard, (values.category.guard ?? 0) + 2);
  assert.equal(values.blockValue, (values.category.block ?? 0) + 3);
  assert.deepEqual(equippedArmorContribution(system), values);
});

test("weapon-driven abilities inherit weapon accuracy, Keen, group, and range", () => {
  const weapon = { system: {
    accuracyBonus: 2, effectiveCrit: 19, group: "katana", isRanged: false
  } };
  assert.deepEqual(abilityWeaponAttackContext({
    ability: { usesWeapon: true, damageFormula: "2d4" },
    weapon,
    profile: { accuracy: "standard" },
    accuracy: { standard: 5, precise: 8 }
  }), {
    weapon, accuracyBonus: 7, critThreshold: 19, weaponGroup: "katana", ranged: false
  });
});

test("non-weapon abilities keep a neutral weapon context", () => {
  assert.deepEqual(abilityWeaponAttackContext({
    ability: { usesWeapon: false, damageFormula: "2d6 + @focus" },
    weapon: { system: { accuracyBonus: 4, effectiveCrit: 18, group: "katana" } },
    profile: { accuracy: "doubleFocus" },
    accuracy: { standard: 5, precise: 8 }
  }), {
    weapon: null, accuracyBonus: 8, critThreshold: 20, weaponGroup: null, ranged: null
  });
});
