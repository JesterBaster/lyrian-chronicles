import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCraftPayload,
  normalizeCraftProject,
  planCraftMaterials,
  planCraftMods,
  resolveCraftOutput
} from "../module/rules/crafting.mjs";

const gear = (id, name, quantity) => ({
  id,
  name,
  type: "gear",
  system: { quantity }
});

test("crafting projects normalize nested schema values", () => {
  assert.deepEqual(normalizeCraftProject({
    name: "Greaves",
    skill: "blacksmith",
    requiredPoints: "40",
    craftingDice: "5",
    materials: [{ itemId: "iron", quantity: "2" }],
    attempts: "3"
  }), {
    name: "Greaves",
    skill: "blacksmith",
    requiredPoints: 40,
    craftingDice: 5,
    points: 0,
    diceSpent: 0,
    usedActions: [],
    installedMods: [],
    finished: false,
    materials: [{ itemId: "iron", quantity: 2 }],
    mods: [],
    outputUuid: "",
    outputName: "",
    customType: "",
    customName: "",
    attempts: 3,
    completed: false
  });
});

test("a project written before the rework keeps its DC as the target", () => {
  // The craft used to be one roll against a DC. Reading that as the crafting
  // HP is the closest honest reading of what a GM who typed 15 intended, and
  // it beats resetting a planned project to the default.
  const migrated = normalizeCraftProject({ name: "Old", dc: 15 });
  assert.equal(migrated.requiredPoints, 15);
  assert.equal("dc" in migrated, false, "the DC does not survive alongside it");

  // An explicit target always wins over a leftover DC.
  assert.equal(normalizeCraftProject({ dc: 15, requiredPoints: 60 }).requiredPoints, 60);
  assert.equal(normalizeCraftProject({}).requiredPoints, 30, "and a fresh project has a default");
});

test("session state survives a round trip through the normalizer", () => {
  // The sheet rewrites the whole array on every edit, so anything it drops is
  // lost mid-craft.
  const live = normalizeCraftProject({
    points: 32, diceSpent: 3, usedActions: ["steadyCraft"],
    installedMods: [{ itemId: "m", name: "Recurve", cost: 20 }], finished: false
  });
  assert.equal(live.points, 32);
  assert.equal(live.diceSpent, 3);
  assert.deepEqual(live.usedActions, ["steadyCraft"]);
  assert.deepEqual(live.installedMods, [{ itemId: "m", name: "Recurve", cost: 20 }]);
  assert.deepEqual(normalizeCraftProject(live), live, "and again, unchanged");
});

test("an unsupported custom output type is discarded", () => {
  assert.equal(normalizeCraftProject({ customType: "weapon" }).customType, "weapon");
  assert.equal(normalizeCraftProject({ customType: "class" }).customType, "");
  assert.equal(normalizeCraftProject({ customType: "ability" }).customType, "");
});

test("material planning aggregates repeated stack rows", () => {
  const result = planCraftMaterials({
    materials: [
      { itemId: "iron", quantity: 2 },
      { itemId: "iron", quantity: 3 }
    ],
    items: [gear("iron", "Iron", 7)]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.updates, [{ _id: "iron", "system.quantity": 2 }]);
  assert.deepEqual(result.spent, [{ itemId: "iron", name: "Iron", quantity: 5 }]);
});

test("material planning reports shortages without partial updates", () => {
  const result = planCraftMaterials({
    materials: [
      { itemId: "iron", quantity: 3 },
      { itemId: "wood", quantity: 2 }
    ],
    items: [gear("iron", "Iron", 2), gear("wood", "Wood", 5)]
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.shortages, [{
    itemId: "iron", name: "Iron", required: 3, available: 2
  }]);
  assert.deepEqual(result.updates, [{ _id: "wood", "system.quantity": 3 }]);
});

test("disabled consumption bypasses inventory validation", () => {
  assert.deepEqual(planCraftMaterials({
    materials: [{ itemId: "missing", quantity: 99 }],
    items: [],
    consume: false
  }), { ok: true, shortages: [], updates: [], spent: [] });
});

test("craft payload contains stable public result data", () => {
  const project = {
    name: "Greaves",
    skill: "blacksmith",
    requiredPoints: 40,
    points: 44,
    outputUuid: "Compendium.items.sword",
    outputName: "Longsword",
    attempts: 2
  };
  assert.deepEqual(buildCraftPayload({
    actorUuid: "Actor.crafter",
    projectIndex: 0,
    project,
    skillLabel: "Blacksmith",
    roll: { total: 18, formula: "1d10 + 10" },
    success: true,
    materials: [{ itemId: "iron", name: "Iron", quantity: 2 }],
    consumed: true,
    mods: [{ id: "mod1", name: "Keen Edge" }],
    custom: true,
    outputType: "weapon"
  }), {
    actorUuid: "Actor.crafter",
    projectIndex: 0,
    projectName: "Greaves",
    skill: "blacksmith",
    skillLabel: "Blacksmith",
    requiredPoints: 40,
    points: 44,
    status: null,
    roll: { total: 18, formula: "1d10 + 10" },
    success: true,
    materials: [{ itemId: "iron", name: "Iron", quantity: 2 }],
    consumed: true,
    outputUuid: "Compendium.items.sword",
    outputName: "Longsword",
    custom: true,
    outputType: "weapon",
    mods: [{ itemId: "mod1", name: "Keen Edge" }],
    attempts: 2
  });
});

test("materials are spent as the craft opens, before any dice are rolled", () => {
  const source = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async _craftAction(projectIndex, actionKey)");
  const action = source.slice(start, source.indexOf("\n  /**", start));
  assert.ok(start >= 0, "the craft action is missing");

  // Spent once, when the craft begins rather than per action — otherwise a
  // five-action craft would eat five times the materials.
  assert.match(action, /if \(!project\.diceSpent\) \{/);
  assert.ok(
    action.indexOf("updateEmbeddedDocuments") < action.indexOf("new Roll("),
    "the cost is paid before the dice decide anything"
  );
  assert.match(action, /system\.crafting\.projects/);
});

test("the item is built only when the points reached the target", () => {
  const source = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async _resolveCraft(projectIndex)");
  const resolve = source.slice(start, source.indexOf("\n  /** Post the result", start));
  assert.ok(start >= 0, "the resolve step is missing");

  assert.match(resolve, /if \(status\.succeeds\) \{[\s\S]*createEmbeddedDocuments/);
  assert.match(resolve, /system\.crafting\.projects/);
  assert.match(resolve, /Hooks\.callAll\("lyrianCraft"/);
  // A failed craft still ends: the project must not stay open forever.
  assert.match(resolve, /finished: true/);
});

test("artisan project rolls pass DC through the existing check helper", () => {
  const source = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async rollArtisan");
  const end = source.indexOf("/**\n   * Work out", start);
  const method = source.slice(start, end);

  assert.match(method, /dc: options\.dc/);
  assert.match(method, /createMessage: options\.createMessage/);
});

/* -------------------------------------------- */
/*  Custom output and mod installation           */
/* -------------------------------------------- */

const baseItem = (name) => ({
  name,
  toObject: () => ({ _id: "base1", name, type: "weapon", system: { damage: "2d4" } })
});

test("a linked base is copied without its source id", () => {
  const result = resolveCraftOutput({ project: normalizeCraftProject(), base: baseItem("Longsword") });

  assert.equal(result.ok, true);
  assert.equal(result.fromBase, true);
  assert.equal(result.custom, false);
  assert.equal(result.data.name, "Longsword");
  assert.equal(result.data._id, undefined);
});

test("a custom name renames the linked base and marks the result custom", () => {
  const project = normalizeCraftProject({ customName: "Dawnsplitter" });
  const result = resolveCraftOutput({ project, base: baseItem("Longsword") });

  assert.equal(result.custom, true);
  assert.equal(result.data.name, "Dawnsplitter");
  assert.equal(result.data.system.damage, "2d4", "base stats survive the rename");
});

test("a custom type forges a bare item when no base is linked", () => {
  const project = normalizeCraftProject({ customType: "armor", customName: "Ashplate" });
  const result = resolveCraftOutput({ project, base: null });

  assert.equal(result.ok, true);
  assert.equal(result.fromBase, false);
  assert.equal(result.custom, true);
  assert.deepEqual(result.data, { name: "Ashplate", type: "armor", system: {} });
});

test("a forged item falls back to the project name, then the supplied default", () => {
  const named = resolveCraftOutput({
    project: normalizeCraftProject({ customType: "gear", name: "Rope" }),
    fallbackName: "Crafted Item"
  });
  assert.equal(named.data.name, "Rope");

  const unnamed = resolveCraftOutput({
    project: normalizeCraftProject({ customType: "gear" }),
    fallbackName: "Crafted Item"
  });
  assert.equal(unnamed.data.name, "Crafted Item");
});

test("a project with neither a base nor a custom type produces nothing", () => {
  const result = resolveCraftOutput({ project: normalizeCraftProject(), base: null });

  assert.equal(result.ok, false);
  assert.equal(result.data, null);
});

test("mod planning resolves owned stacks and reports missing ones", () => {
  const items = [{ id: "mod1", name: "Keen Edge" }, { id: "mod2", name: "Weighted Core" }];

  const ok = planCraftMods({ mods: [{ itemId: "mod1" }, { itemId: "mod2" }], items });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.mods.map((mod) => mod.name), ["Keen Edge", "Weighted Core"]);

  const missing = planCraftMods({ mods: [{ itemId: "mod1" }, { itemId: "gone" }], items });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, [{ itemId: "gone", name: "gone" }]);
});

test("blank mod rows are ignored rather than reported missing", () => {
  const result = planCraftMods({ mods: [{ itemId: "" }], items: [] });

  assert.equal(result.ok, true);
  assert.equal(result.mods.length, 0);
});
