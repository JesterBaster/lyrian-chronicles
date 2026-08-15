import assert from "node:assert/strict";
import test from "node:test";

class DocumentStub {
  constructor(system = {}) {
    this.system = system;
    this.sourceUpdates = [];
  }

  async _preCreate() {}

  updateSource(changes) {
    this.sourceUpdates.push(changes);
    this.system.schemaVersion = changes["system.schemaVersion"];
  }
}

const originalActor = globalThis.Actor;
const originalItem = globalThis.Item;
globalThis.Actor = DocumentStub;
globalThis.Item = DocumentStub;

const { LyrianActor } = await import("../module/documents/actor.mjs");
const { LyrianItem } = await import("../module/documents/item.mjs");

test.after(() => {
  globalThis.Actor = originalActor;
  globalThis.Item = originalItem;
});

test("new Actors and Items are stamped with their current schema revisions", async () => {
  const actor = new LyrianActor({ schemaVersion: 0 });
  const item = new LyrianItem({ schemaVersion: 0 });

  await actor._preCreate({}, {}, {});
  await item._preCreate({}, {}, {});

  assert.deepEqual(actor.sourceUpdates, [{ "system.schemaVersion": 1 }]);
  assert.deepEqual(item.sourceUpdates, [{ "system.schemaVersion": 1 }]);
});

test("creation does not downgrade documents exported by a future schema", async () => {
  const actor = new LyrianActor({ schemaVersion: 3 });
  const item = new LyrianItem({ schemaVersion: 2 });

  await actor._preCreate({}, {}, {});
  await item._preCreate({}, {}, {});

  assert.equal(actor.system.schemaVersion, 3);
  assert.equal(item.system.schemaVersion, 2);
});
