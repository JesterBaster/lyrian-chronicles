import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCraftPayload,
  normalizeCraftProject,
  planCraftMaterials
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
    outputUuid: "",
    outputName: "",
    attempts: 3,
    completed: false
  });
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
    consumed: true
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
  const end = source.indexOf("_resolveExpertise", start);
  const method = source.slice(start, end);

  assert.match(method, /dc: options\.dc/);
  assert.match(method, /createMessage: options\.createMessage/);
});
