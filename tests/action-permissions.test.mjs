import assert from "node:assert/strict";
import test from "node:test";

import {
  canPerformActorAction,
  requireActorActionPermission
} from "../module/rules/action-permissions.mjs";

test("owners and GMs can act while other players cannot", () => {
  const actor = { name: "Hero", isOwner: false };
  assert.equal(canPerformActorAction(actor, { id: "player", isGM: false }), false);
  actor.isOwner = true;
  assert.equal(canPerformActorAction(actor, { id: "player", isGM: false }), true);
  actor.isOwner = false;
  assert.equal(canPerformActorAction(actor, { id: "gm", isGM: true }), true);
});

test("an already-open sheet action observes ownership revocation", () => {
  const actor = { name: "Hero", isOwner: true };
  const player = { id: "player", isGM: false };
  assert.equal(canPerformActorAction(actor, player), true);
  actor.isOwner = false;
  assert.equal(canPerformActorAction(actor, player), false);
});

test("rejected actions warn without requiring a document update", () => {
  const warnings = [];
  globalThis.game = {
    user: { id: "player", isGM: false },
    i18n: { format: (key, data) => `${key}:${data.name}` }
  };
  globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };

  assert.equal(requireActorActionPermission({ name: "Hero", isOwner: false }), false);
  assert.deepEqual(warnings, ["LYRIAN.Warn.NotOwner:Hero"]);

  delete globalThis.game;
  delete globalThis.ui;
});

test("unowned compendium Items without an Actor may still post descriptions", () => {
  assert.equal(canPerformActorAction(null, { id: "player", isGM: false }), true);
});
