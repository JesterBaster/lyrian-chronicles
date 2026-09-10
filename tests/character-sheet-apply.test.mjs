/**
 * Shaping an import plan into item data.
 *
 * The interesting decision is which facts come from the compendium and which
 * come from the sheet: the pack owns what the item is, the sheet owns what this
 * character's copy of it looks like.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  importSummary,
  plannedItemData,
  unmatchedNames
} from "../module/rules/character-sheet-apply.mjs";

const PACK = {
  "uuid:fighter": { name: "Fighter", type: "class", system: { tier: 1, abilitiesUnlocked: 1 } },
  "uuid:cleave": { name: "Cleave", type: "ability", system: { timing: "action" } },
  "uuid:angel": { name: "Angelblooded", type: "breakthrough", system: { expCost: 100 } },
  "uuid:sword": {
    name: "Longsword", type: "weapon", system: { burden: 2, value: 150, equipped: false }
  },
  "uuid:potion": {
    name: "Healing Potion", type: "gear", system: { quantity: 1, burden: 0, value: 50 }
  },
  "uuid:rope": {
    name: "Rope", type: "equipment",
    system: { category: "Gear", cost: "10", burden: "1", quantity: 1 }
  },
  "uuid:mod": {
    name: "Keen Edge", type: "equipment",
    system: { category: "Crafting Mods", modSlot: "weapon", craftingPoints: 4 }
  },
  "uuid:human": { name: "Human", type: "race", system: { raceKind: "primary" } }
};

// A fresh copy each time, so a mutation in one test cannot reach another.
const resolve = async (uuid) => (PACK[uuid] ? structuredClone(PACK[uuid]) : null);

const planWith = (items, raceItem = null) => ({ raceItem, items, counts: {} });

test("the sheet says how many and whether worn; the pack says everything else", async () => {
  const { create } = await plannedItemData(planWith({
    inventory: {
      create: [
        {
          name: "Longsword", entry: { uuid: "uuid:sword" },
          source: { quantity: 1, location: "Combat Loadout" }
        },
        {
          name: "Healing Potion", entry: { uuid: "uuid:potion" },
          source: { quantity: 4, location: "Backpack" }
        }
      ]
    }
  }), { resolve });

  const [sword, potion] = create;
  assert.equal(sword.system.equipped, true);
  assert.equal(sword.system.burden, 2, "burden belongs to the item, not the row");
  assert.equal(sword.system.value, 150);
  assert.equal(potion.system.quantity, 4);
  assert.equal(potion.system.equipped, undefined, "gear has no equipped field to set");
});

test("a class arrives at the level the sheet recorded", async () => {
  const { create } = await plannedItemData(planWith({
    classes: { create: [{ name: "Fighter", entry: { uuid: "uuid:fighter" }, source: { level: 5 } }] }
  }), { resolve });

  assert.equal(create[0].system.abilitiesUnlocked, 5);
});

test("a level the rulebook does not have is brought back into range", async () => {
  const { create } = await plannedItemData(planWith({
    classes: { create: [{ entry: { uuid: "uuid:fighter" }, source: { level: 99 } }] }
  }), { resolve });
  assert.equal(create[0].system.abilitiesUnlocked, 8);

  const { create: floored } = await plannedItemData(planWith({
    classes: { create: [{ entry: { uuid: "uuid:fighter" }, source: { level: 0 } }] }
  }), { resolve });
  assert.equal(floored[0].system.abilitiesUnlocked, 1);
});

test("a blank EXP cell is not a free breakthrough", async () => {
  const { create } = await plannedItemData(planWith({
    breakthroughs: { create: [{ entry: { uuid: "uuid:angel" }, source: { expCost: 0 } }] }
  }), { resolve });
  assert.equal(create[0].system.expCost, 100, "the pack's cost stands");

  const { create: discounted } = await plannedItemData(planWith({
    breakthroughs: { create: [{ entry: { uuid: "uuid:angel" }, source: { expCost: 50 } }] }
  }), { resolve });
  assert.equal(discounted[0].system.expCost, 50, "what the table actually charged");
});

test("official equipment becomes a real item, but a Mod stays a Mod", async () => {
  const { create } = await plannedItemData(planWith({
    inventory: {
      create: [
        { entry: { uuid: "uuid:rope" }, source: { quantity: 2, location: "Backpack" } },
        { entry: { uuid: "uuid:mod" }, source: { quantity: 1, location: "Backpack" } }
      ]
    }
  }), { resolve, proficiencies: { assumeProficient: true } });

  const [rope, mod] = create;
  assert.notEqual(rope.type, "equipment", "a reference page cannot be carried or equipped");
  assert.equal(rope.system.quantity, 2);
  // Converting a Mod drops the fields that make it one, so it keeps its type.
  assert.equal(mod.type, "equipment");
  assert.equal(mod.system.modSlot, "weapon");
});

test("the race is created too, and a broken uuid is reported not thrown", async () => {
  const { create, failed } = await plannedItemData({
    raceItem: { name: "Human", uuid: "uuid:human" },
    items: {
      abilities: { create: [{ name: "Ghost", entry: { uuid: "uuid:missing" } }] }
    }
  }, { resolve });

  assert.deepEqual(create.map((item) => item.name), ["Human"]);
  assert.deepEqual(failed, [{ kind: "abilities", name: "Ghost", uuid: "uuid:missing" }]);
});

test("a resolve that throws is a failure, not an aborted import", async () => {
  const { create, failed } = await plannedItemData(planWith({
    abilities: {
      create: [
        { name: "Boom", entry: { uuid: "uuid:explodes" } },
        { name: "Cleave", entry: { uuid: "uuid:cleave" } }
      ]
    }
  }), {
    resolve: async (uuid) => {
      if (uuid === "uuid:explodes") throw new Error("pack is locked");
      return resolve(uuid);
    }
  });

  assert.deepEqual(create.map((item) => item.name), ["Cleave"]);
  assert.deepEqual(failed.map((entry) => entry.name), ["Boom"]);
});

test("the summary counts what a player is about to agree to", () => {
  const plan = {
    raceItem: { name: "Human", uuid: "u" },
    counts: {
      abilities: { create: 3, existing: 1, unmatched: 2 },
      classes: { create: 1, existing: 0, unmatched: 0 }
    },
    warnings: [{ kind: "unknownSkill", label: "Basketry" }],
    items: {
      abilities: { unmatched: [{ name: "Homebrew" }, { name: "Made Up" }] },
      classes: { unmatched: [] }
    }
  };

  assert.deepEqual(importSummary(plan), { create: 5, existing: 1, unmatched: 2, warnings: 1 });
  assert.deepEqual(unmatchedNames(plan), ["Homebrew", "Made Up", "Basketry"]);
  assert.deepEqual(importSummary({}), { create: 0, existing: 0, unmatched: 0, warnings: 0 });
});
