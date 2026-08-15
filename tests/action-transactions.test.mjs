import assert from "node:assert/strict";
import test from "node:test";

import {
  queueActorTransaction,
  runExclusiveActorAction
} from "../module/rules/action-transactions.mjs";

test("an actor cannot start two overlapping actions on one client", async () => {
  const actor = {};
  let finishFirst;
  const first = runExclusiveActorAction(actor, () => new Promise((resolve) => {
    finishFirst = resolve;
  }));

  const duplicate = await runExclusiveActorAction(actor, async () => "duplicate");
  assert.equal(duplicate.started, false);

  finishFirst("first");
  assert.deepEqual(await first, { started: true, value: "first" });
  assert.deepEqual(
    await runExclusiveActorAction(actor, async () => "next"),
    { started: true, value: "next" }
  );
});

test("the action lock is released when an action fails", async () => {
  const actor = {};
  await assert.rejects(
    runExclusiveActorAction(actor, async () => { throw new Error("roll failed"); }),
    /roll failed/
  );
  assert.equal((await runExclusiveActorAction(actor, async () => true)).started, true);
});

test("actor resource transactions run in order and see current state", async () => {
  const actor = { ap: 2 };
  const spend = () => queueActorTransaction(actor, async () => {
    const available = actor.ap;
    await Promise.resolve();
    if (available < 1) return false;
    actor.ap = available - 1;
    return true;
  });

  assert.deepEqual(await Promise.all([spend(), spend(), spend()]), [true, true, false]);
  assert.equal(actor.ap, 0);
});
