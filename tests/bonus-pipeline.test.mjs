import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { armorValues, equippedArmorContribution, equippedArmorSlots } from "../module/rules/armor.mjs";
import { derivedGuardValues } from "../module/rules/damage.mjs";
import { selectedRaceBonuses } from "../module/rules/progression.mjs";
import { resolveCraftOutput } from "../module/rules/crafting.mjs";

const actorModel = readFileSync("module/data/actor.mjs", "utf8");
const itemModel = readFileSync("module/data/item.mjs", "utf8");

/* Ordering — a bonus applied after the total is computed does nothing ------ */

test("race stat bonuses are applied before stats are totalled", () => {
  const applied = actorModel.indexOf("stats[key].bonus += Number(value) || 0");
  const totalled = actorModel.indexOf("stat.total = stat.value + stat.bonus");
  assert.ok(applied > 0 && totalled > 0);
  assert.ok(applied < totalled, "a race bonus added after totalling would be ignored");
});

test("race skill bonuses are applied before skills are totalled", () => {
  const applied = actorModel.indexOf("this.skills[key].bonus += value");
  const totalled = actorModel.indexOf("this._prepareSkillTotals()");
  assert.ok(applied > 0 && totalled > 0);
  assert.ok(applied < totalled, "a racial skill grant added after totalling would be ignored");
});

test("equipment is gathered before the defences that consume it", () => {
  const gathered = actorModel.indexOf("const gear = this._prepareEquipment()");
  for (const consumer of ["gear.guard", "gear.evasion", "gear.initiative", "gear.blockValue"]) {
    const used = actorModel.indexOf(consumer);
    assert.ok(used > gathered, `${consumer} is read before equipment is gathered`);
  }
});

test("stat bonuses accumulate rather than overwrite", () => {
  // Two races, or a race plus a GM-entered bonus, must add up.
  assert.match(actorModel, /stats\[key\]\.bonus \+=/);
  assert.match(actorModel, /subStats\[key\]\.bonus \+=/);
  assert.match(actorModel, /this\.skills\[key\]\.bonus \+=/);
});

/* Races ------------------------------------------------------------------- */

test("a race's fixed and chosen attribute bonuses both reach the actor", () => {
  const bonuses = selectedRaceBonuses({
    attributeBonuses: { main: { power: 1 }, sub: { fitness: 1 }, chooseMain: 1 },
    selectedMainStat: "focus"
  });
  assert.equal(bonuses.main.power, 1);
  assert.equal(bonuses.main.focus, 1);
  assert.equal(bonuses.sub.fitness, 1);
});

test("a chosen bonus stacks onto a fixed one for the same stat", () => {
  const bonuses = selectedRaceBonuses({
    attributeBonuses: { main: { power: 1 }, chooseMain: 2 },
    selectedMainStat: "power"
  });
  assert.equal(bonuses.main.power, 3);
});

/* Armour ------------------------------------------------------------------ */

test("armour contributes its category value plus its own bonus", () => {
  const values = armorValues({ category: "heavy", guardBonus: 2, blockBonus: 1 });
  assert.equal(values.guard, (values.category.guard ?? 0) + 2);
  assert.equal(values.blockValue, (values.category.block ?? 0) + 1);
});

test("wearing armour you are not proficient with costs you", () => {
  const trained = equippedArmorContribution({ category: "heavy", proficient: true });
  const untrained = equippedArmorContribution({ category: "heavy", proficient: false });
  assert.ok(untrained.guard < trained.guard || untrained.evasion < trained.evasion,
    "non-proficiency must apply a penalty");
});

test("only one armour and one shield apply, extras are surfaced not silently dropped", () => {
  const body = (id) => ({ id, type: "armor", system: { category: "heavy", equipped: true } });
  const shield = (id) => ({ id, type: "armor", system: { category: "shield", equipped: true } });
  const slots = equippedArmorSlots([body("a"), body("b"), shield("s"), shield("t")]);

  assert.equal(slots.armor.id, "a");
  assert.equal(slots.shield.id, "s");
  assert.equal(slots.conflicts.length, 2, "the extras must be reported, not ignored");
});

test("unequipped armour grants no defence", () => {
  const slots = equippedArmorSlots([
    { id: "a", type: "armor", system: { category: "heavy", equipped: false } }
  ]);
  assert.equal(slots.armor, null);
});

test("guard-only bonuses do not inflate Block", () => {
  const values = derivedGuardValues({
    toughness: 4, equipmentGuard: 2, equipmentBlockValue: 3, guardBonus: 5, blockBonus: 1
  });
  assert.notEqual(values.guard, values.blockGuard);
});

/* Crafted items ----------------------------------------------------------- */

test("a forged item is a real weapon or armour, not a bare object", () => {
  // It goes through the same data model as any other, so it derives its
  // damage, guard and burden exactly like a compendium item does.
  for (const type of ["weapon", "armor", "gear"]) {
    const plan = resolveCraftOutput({ project: { customType: type, customName: "Mine" } });
    assert.equal(plan.ok, true);
    assert.equal(plan.data.type, type);
    assert.equal(plan.data.name, "Mine");
  }
});

test("a crafted copy keeps the base item's numbers", () => {
  const base = {
    toObject: () => ({
      _id: "x", name: "Longsword", type: "weapon",
      system: { group: "longsword", damageBonus: 2, critThreshold: 19 }
    })
  };
  const plan = resolveCraftOutput({ project: { customName: "Oathkeeper" }, base });
  assert.equal(plan.data.name, "Oathkeeper");
  assert.equal(plan.data.system.damageBonus, 2);
  assert.equal(plan.data.system.critThreshold, 19);
  assert.equal("_id" in plan.data, false, "a copy must not carry the source id");
});

test("weapon damage scales with Power and the weapon's own bonus", () => {
  // getDamageFormula lives on the data model, which needs Foundry, so this
  // pins the shape of the formula it builds instead.
  assert.match(itemModel, /const flat = power \* profile\.powerMultiplier \+ this\.damageBonus/);
  assert.match(itemModel, /twoHandedMeleeDamage/);
});

/* Mods -------------------------------------------------------------------- */

test("an installed mod copy contributes nothing to equipment totals", () => {
  // Mods are stored as embedded `equipment` copies flagged to their target.
  // _prepareEquipment counts gear, weapons and armour only — if equipment were
  // ever added there, every installed mod would start double-counting burden.
  const prepare = actorModel.slice(actorModel.indexOf("_prepareEquipment()"));
  const body = prepare.slice(0, prepare.indexOf("\n  }"));
  assert.ok(!/item\.type === "equipment"/.test(body),
    "equipment entering the totals would double-count installed mods");
});

test("mods carry no numeric bonus fields, so nothing is silently half-applied", () => {
  // Their effects live in description text and are adjudicated at the table.
  // If structured bonuses are added later this test should be updated with the
  // code that applies them, not deleted on its own.
  const equipment = itemModel.slice(itemModel.indexOf("export class LyrianEquipment"));
  const schema = equipment.slice(0, equipment.indexOf("\n}"));
  for (const numeric of ["guardBonus", "evasionBonus", "blockBonus", "accuracyBonus", "damageBonus"]) {
    assert.ok(!schema.includes(numeric), `${numeric} exists but nothing applies it`);
  }
});
