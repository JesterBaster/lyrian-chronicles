import assert from "node:assert/strict";
import test from "node:test";

import { runMigration } from "../migrations/0.6.25.mjs";

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
