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
    dc: "15",
    materials: [{ itemId: "iron", quantity: "2" }],
    attempts: "3"
  }), {
    name: "Greaves",
    skill: "blacksmith",
    dc: 15,
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
    dc: 15,
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
    dc: 15,
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

test("Actor craft pipeline consumes before rolling and persists the whole project array", () => {
  const source = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async _attemptCraft(projectIndex)");
  const end = source.indexOf("/** Resist an effect", start);
  const pipeline = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(pipeline.indexOf("updateEmbeddedDocuments") < pipeline.indexOf("rollArtisan"));
  assert.match(pipeline, /if \(success\) \{[\s\S]*createEmbeddedDocuments/);
  assert.match(pipeline, /system\.crafting\.projects/);
  assert.match(pipeline, /Hooks\.callAll\("lyrianCraft"/);
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
