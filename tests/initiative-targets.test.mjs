import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { initiativeTargets } from "../module/rules/initiative.mjs";

const combatant = (id, actorId, tokenId) => ({ id, actorId, tokenId });

test("a sheet roll finds the actor's combatant in the encounter", () => {
  const combatants = [combatant("c1", "hero", "t1"), combatant("c2", "goblin", "t2")];
  assert.deepEqual(
    initiativeTargets({ combatants, actorId: "hero" }).map((c) => c.id),
    ["c1"]
  );
});

test("an actor not in the encounter yields nothing to write", () => {
  const combatants = [combatant("c1", "goblin", "t1")];
  assert.deepEqual(initiativeTargets({ combatants, actorId: "hero" }), []);
  assert.deepEqual(initiativeTargets({ combatants, actorId: "" }), []);
  assert.deepEqual(initiativeTargets({}), []);
});

test("with duplicates, the controlled token wins", () => {
  // Several tokens can share one actor. The one the player has selected is
  // the one they are rolling for.
  const combatants = [
    combatant("c1", "goblin", "t1"),
    combatant("c2", "goblin", "t2"),
    combatant("c3", "goblin", "t3")
  ];
  assert.deepEqual(
    initiativeTargets({ combatants, actorId: "goblin", controlledTokenIds: ["t2"] })
      .map((c) => c.id),
    ["c2"]
  );
});

test("with duplicates and nothing selected, every copy is set", () => {
  const combatants = [combatant("c1", "goblin", "t1"), combatant("c2", "goblin", "t2")];
  assert.deepEqual(
    initiativeTargets({ combatants, actorId: "goblin", controlledTokenIds: [] }).map((c) => c.id),
    ["c1", "c2"]
  );
});

test("a selection that matches no combatant falls back to all copies", () => {
  const combatants = [combatant("c1", "goblin", "t1"), combatant("c2", "goblin", "t2")];
  assert.deepEqual(
    initiativeTargets({ combatants, actorId: "goblin", controlledTokenIds: ["elsewhere"] })
      .map((c) => c.id),
    ["c1", "c2"]
  );
});

test("the sheet roll writes its result to the tracker", () => {
  const source = readFileSync("module/documents/actor.mjs", "utf8");
  // Previously this only posted a chat card, so a player who rolled from the
  // sheet still showed as unrolled and the GM rolled for them again.
  assert.match(source, /initiativeTargets\(\{/);
  assert.match(source, /updateEmbeddedDocuments\(\s*\n?\s*"Combatant"/);
  // Only combatants this user may actually modify, with a warning otherwise.
  assert.match(source, /filter\(\(combatant\) => combatant\.isOwner\)/);
  assert.match(source, /LYRIAN\.Warn\.InitiativeNotOwned/);
});
