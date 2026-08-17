import assert from "node:assert/strict";
import test from "node:test";

import { runMigration } from "../migrations/0.6.25.mjs";
import { runMigration as runCustomOutputMigration } from "../migrations/0.6.26.mjs";

const actor = (id, type, schemaVersion, crafting) => ({
  id,
  uuid: `Actor.${id}`,
  type,
  system: { schemaVersion },
  _source: { system: crafting === undefined ? {} : { crafting } },
  updates: [],
  async update(changes) {
    this.updates.push(changes);
  }
});

test("0.6.25 backfills projects only on characters and advances every Actor schema", async () => {
  const missing = actor("missing", "character", 1);
  const existing = actor("existing", "character", 1, { projects: [{ name: "Keep" }] });
  const npc = actor("npc", "npc", 1);

  const originalGame = globalThis.game;
  globalThis.game = {
    actors: [missing, existing, npc],
    items: [],
    scenes: [],
    packs: []
  };

  try {
    await runMigration();
    assert.deepEqual(missing.updates, [{
      "system.schemaVersion": 2,
      "system.crafting.projects": []
    }]);
    assert.deepEqual(existing.updates, [{ "system.schemaVersion": 2 }]);
    assert.deepEqual(npc.updates, [{ "system.schemaVersion": 2 }]);
  } finally {
    globalThis.game = originalGame;
  }
});

test("0.6.26 backfills custom output keys on stored projects, leaving current ones alone", async () => {
  const stale = actor("stale", "character", 2, {
    projects: [{ name: "Greaves", skill: "blacksmith", dc: 15 }]
  });
  const current = actor("current", "character", 2, {
    projects: [{ name: "Blade", customType: "weapon", customName: "", mods: [] }]
  });
  const empty = actor("empty", "character", 2, { projects: [] });
  const npc = actor("npc", "npc", 2);

  const originalGame = globalThis.game;
  globalThis.game = { actors: [stale, current, empty, npc], items: [], scenes: [], packs: [] };

  try {
    await runCustomOutputMigration();

    assert.equal(stale.updates.length, 1);
    const [project] = stale.updates[0]["system.crafting.projects"];
    assert.equal(project.customType, "");
    assert.equal(project.customName, "");
    assert.deepEqual(project.mods, []);
    assert.equal(project.name, "Greaves", "existing values are preserved");

    assert.deepEqual(current.updates, [], "a project already carrying the keys is untouched");
    assert.deepEqual(empty.updates, []);
    assert.deepEqual(npc.updates, [], "non-characters have no projects to backfill");
  } finally {
    globalThis.game = originalGame;
  }
});
