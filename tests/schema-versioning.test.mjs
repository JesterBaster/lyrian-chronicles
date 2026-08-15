import assert from "node:assert/strict";
import test from "node:test";

import { forEachDocument } from "../migrations/migrate.mjs";
import { runMigration as runBaselineSchemaMigration } from "../migrations/0.6.14.mjs";
import {
  currentDocumentSchemaVersion,
  normalizeSchemaVersion,
  planDocumentSchemaMigration,
  schemaVersionForCreation,
  stampDocumentSourceSchema
} from "../module/rules/schema-versioning.mjs";

test("document schema versions are normalized and independent", () => {
  assert.equal(currentDocumentSchemaVersion("Actor"), 1);
  assert.equal(currentDocumentSchemaVersion("Item"), 1);
  assert.equal(normalizeSchemaVersion(undefined), 0);
  assert.equal(normalizeSchemaVersion(-1), 0);
  assert.equal(normalizeSchemaVersion(1.5), 0);
});

test("schema migration plans are monotonic", () => {
  assert.deepEqual(planDocumentSchemaMigration("Actor", 0), {
    status: "pending",
    current: 0,
    target: 1,
    update: { "system.schemaVersion": 1 }
  });
  assert.deepEqual(planDocumentSchemaMigration("Item", 1), {
    status: "current", current: 1, target: 1, update: null
  });
  assert.deepEqual(planDocumentSchemaMigration("Item", 2), {
    status: "future", current: 2, target: 1, update: null
  });
});

test("new documents start current without downgrading future imports", () => {
  assert.equal(schemaVersionForCreation("Actor", 0), 1);
  assert.equal(schemaVersionForCreation("Item", undefined), 1);
  assert.equal(schemaVersionForCreation("Item", 2), 2);
  assert.deepEqual(stampDocumentSourceSchema("Item", {
    name: "Sword",
    system: { burden: 1 }
  }), {
    name: "Sword",
    system: { burden: 1, schemaVersion: 1 }
  });
});

test("migration traversal includes synthetic-token and compendium embedded Items", async () => {
  const item = (id) => ({ id });
  const actor = (id, items = []) => ({ id, items });
  const worldActor = actor("world-actor", [item("world-embedded")]);
  const syntheticActor = actor("synthetic-actor", [item("synthetic-embedded")]);
  const packedActor = actor("packed-actor", [item("packed-embedded")]);
  const worldItem = item("world-item");
  const packedItem = item("packed-item");
  const systemLockedItem = item("system-locked-item");
  const ignoredItem = item("third-party-locked-item");
  const lockTransitions = [];

  const originalGame = globalThis.game;
  globalThis.game = {
    actors: [worldActor],
    items: [worldItem],
    scenes: [{ tokens: [
      { actorLink: false, actor: syntheticActor },
      { actorLink: true, actor: worldActor }
    ] }],
    packs: [
      { documentName: "Actor", locked: false, collection: "world.actors", getDocuments: async () => [packedActor] },
      { documentName: "Item", locked: false, collection: "world.items", getDocuments: async () => [packedItem] },
      {
        documentName: "Item",
        locked: true,
        collection: "lyrian-chronicles.keywords",
        getDocuments: async () => [systemLockedItem],
        configure: async ({ locked }) => lockTransitions.push(locked)
      },
      {
        documentName: "Item",
        locked: true,
        collection: "other-system.items",
        getDocuments: async () => [ignoredItem]
      }
    ]
  };

  try {
    const actors = [];
    const actorCount = await forEachDocument("Actor", async (document) => actors.push(document.id));
    assert.equal(actorCount, 3);
    assert.deepEqual(actors, ["world-actor", "synthetic-actor", "packed-actor"]);

    const defaultItems = [];
    const defaultItemCount = await forEachDocument(
      "Item",
      async (document) => defaultItems.push(document.id)
    );
    assert.equal(defaultItemCount, 5);
    assert.equal(defaultItems.includes("system-locked-item"), false);

    const items = [];
    const itemCount = await forEachDocument(
      "Item",
      async (document) => items.push(document.id),
      { includeLockedSystemPacks: true }
    );
    assert.equal(itemCount, 6);
    assert.deepEqual(items, [
      "world-item", "world-embedded", "synthetic-embedded", "packed-embedded", "packed-item",
      "system-locked-item"
    ]);
    assert.deepEqual(lockTransitions, [false, true]);
  } finally {
    globalThis.game = originalGame;
  }
});

test("the baseline migration stamps old documents without downgrading future ones", async () => {
  const document = (id, schemaVersion) => ({
    id,
    uuid: id,
    system: { schemaVersion },
    updates: [],
    async update(changes) {
      this.updates.push(changes);
      this.system.schemaVersion = changes["system.schemaVersion"];
    }
  });
  const actor = document("Actor.old", 0);
  actor.items = [document("Item.old", 0), document("Item.future", 2)];

  const originalGame = globalThis.game;
  const originalWarn = console.warn;
  globalThis.game = {
    actors: [actor],
    items: [],
    scenes: [],
    packs: []
  };

  try {
    console.warn = () => {};
    await runBaselineSchemaMigration();
    assert.deepEqual(actor.updates, [{ "system.schemaVersion": 1 }]);
    assert.deepEqual(actor.items[0].updates, [{ "system.schemaVersion": 1 }]);
    assert.deepEqual(actor.items[1].updates, []);
    assert.equal(actor.items[1].system.schemaVersion, 2);
  } finally {
    console.warn = originalWarn;
    globalThis.game = originalGame;
  }
});
