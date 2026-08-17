import assert from "node:assert/strict";
import test from "node:test";

import {
  ActorActionLockRegistry,
  actorActionFingerprint,
  initializeActionTransactions,
  queueActorTransaction,
  resetActionTransactions,
  runExclusiveActorAction,
  selectActionAuthority
} from "../module/rules/action-transactions.mjs";

test.afterEach(() => resetActionTransactions());

test("an actor cannot start two overlapping actions on one client", async () => {
  const actor = {};
  let finishFirst;
  const first = runExclusiveActorAction(actor, () => new Promise((resolve) => {
    finishFirst = resolve;
  }));

  const duplicate = await runExclusiveActorAction(actor, async () => "duplicate");
  assert.equal(duplicate.started, false);
  assert.equal(duplicate.reason, "busy");

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

test("the lowest-id active GM is the deterministic action authority", () => {
  const users = [
    { id: "player", active: true, isGM: false },
    { id: "gm-b", active: true, isGM: true },
    { id: "gm-a", active: true, isGM: true },
    { id: "gm-0", active: false, isGM: true }
  ];
  assert.equal(selectActionAuthority(users)?.id, "gm-a");
  assert.equal(selectActionAuthority(users.filter((user) => !user.isGM)), null);
});

test("GM lock tokens prevent duplicate and stale releases", () => {
  const locks = new ActorActionLockRegistry();
  const first = locks.acquire("Actor.hero", "request-1", "player");
  assert.equal(first.granted, true);
  assert.deepEqual(
    locks.acquire("Actor.hero", "request-2", "player"),
    { granted: false, reason: "busy" }
  );
  assert.equal(locks.release("Actor.hero", "request-1", "player", "wrong"), false);
  assert.equal(locks.release("Actor.hero", "request-1", "player", first.token), true);
  assert.equal(locks.acquire("Actor.hero", "request-2", "player").granted, true);
});

test("action fingerprints cover resources, item locks, crafting inventory, and projects", () => {
  const actor = {
    system: {
      ap: { value: 4, temp: 0 }, rp: { value: 3, temp: 1 },
      mana: { value: 6, temp: 0 }, hp: { value: 20, temp: 2 },
      encounter: { secretArtUsed: false },
      crafting: { projects: [{
        skill: "blacksmith",
        dc: 15,
        materials: [{ itemId: "iron", quantity: 2 }],
        outputUuid: "Item.sword",
        attempts: 0,
        completed: false
      }] }
    },
    items: [
      { id: "ability", type: "ability", system: { usedThisRound: false } },
      { id: "iron", type: "gear", system: { quantity: 4 } }
    ],
    flags: { "lyrian-chronicles": { resolvedAttacks: {} } }
  };
  const initial = actorActionFingerprint(actor);
  actor.system.ap.value = 3;
  assert.notEqual(actorActionFingerprint(actor), initial);
  actor.system.ap.value = 4;
  actor.items[0].system.usedThisRound = true;
  assert.notEqual(actorActionFingerprint(actor), initial);
  actor.items[0].system.usedThisRound = false;
  actor.items[1].system.quantity = 3;
  assert.notEqual(actorActionFingerprint(actor), initial);
  actor.items[1].system.quantity = 4;
  actor.system.crafting.projects[0].attempts = 1;
  assert.notEqual(actorActionFingerprint(actor), initial);
  actor.system.crafting.projects[0].attempts = 0;
  actor.flags["lyrian-chronicles"].resolvedAttacks.card = { defence: "dodge" };
  assert.equal(actorActionFingerprint(actor), initial);
});

test("an abandoned GM lease expires and a heartbeat keeps a live action locked", () => {
  let now = 1_000;
  const locks = new ActorActionLockRegistry({ now: () => now, leaseDuration: 100 });
  const first = locks.acquire("Actor.hero", "request-1", "player");
  now = 1_050;
  assert.equal(locks.renew("Actor.hero", "request-1", "player", first.token), true);
  now = 1_120;
  assert.equal(locks.acquire("Actor.hero", "request-2", "player").reason, "busy");
  now = 1_151;
  assert.equal(locks.acquire("Actor.hero", "request-2", "player").granted, true);
});

test("two browser copies of one actor cannot overlap through the GM registry", async () => {
  const authorityLocks = new ActorActionLockRegistry();
  let listener;
  const socket = {
    on: (namespace, callback) => { listener = callback; },
    off: () => {},
    emit: (namespace, message) => {
      if (message.type === "lock-request") {
        const result = authorityLocks.acquire(
          message.actorUuid,
          message.requestId,
          message.userId
        );
        queueMicrotask(() => listener({
          protocol: 2,
          type: "lock-response",
          requestId: message.requestId,
          targetUserId: message.userId,
          actorUuid: message.actorUuid,
          ...result
        }));
      }
      if (message.type === "lock-release") {
        authorityLocks.release(
          message.actorUuid,
          message.requestId,
          message.userId,
          message.token
        );
      }
    }
  };
  const player = { id: "player", active: true, isGM: false };
  const gm = { id: "gm", active: true, isGM: true };
  initializeActionTransactions({ socket, users: [player, gm], user: player });

  const firstActorCopy = { uuid: "Actor.hero" };
  const secondActorCopy = { uuid: "Actor.hero" };
  let finish;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const first = runExclusiveActorAction(firstActorCopy, () => new Promise((resolve) => {
    finish = resolve;
    markStarted();
  }));
  await started;

  const duplicate = await runExclusiveActorAction(secondActorCopy, async () => "duplicate");
  assert.equal(duplicate.started, false);
  assert.equal(duplicate.reason, "busy");

  finish("first");
  assert.deepEqual(await first, { started: true, value: "first" });
  assert.equal(
    (await runExclusiveActorAction(secondActorCopy, async () => "next")).started,
    true
  );
});

test("actions stop safely when no active GM can authorize them", async () => {
  const player = { id: "player", active: true, isGM: false };
  const socket = { on: () => {}, off: () => {}, emit: () => {} };
  initializeActionTransactions({ socket, users: [player], user: player });

  let called = false;
  const result = await runExclusiveActorAction({ uuid: "Actor.hero" }, async () => {
    called = true;
  });
  assert.equal(result.started, false);
  assert.equal(result.reason, "no-authority");
  assert.equal(called, false);
});

test("the GM rejects a request made from a stale actor snapshot", async () => {
  const authorityLocks = new ActorActionLockRegistry();
  const player = { id: "player", active: true, isGM: false };
  const gm = { id: "gm", active: true, isGM: true };
  const makeActor = (ap) => ({
    uuid: "Actor.hero",
    system: {
      ap: { value: ap, temp: 0 }, rp: { value: 3, temp: 0 },
      mana: { value: 6, temp: 0 }, hp: { value: 20, temp: 0 },
      encounter: { secretArtUsed: false }
    },
    items: [], flags: {}
  });
  const authoritativeActor = makeActor(3);
  const stalePlayerActor = makeActor(4);
  let listener;
  const socket = {
    on: (namespace, callback) => { listener = callback; },
    off: () => {},
    emit: (namespace, message) => {
      if (message.type !== "lock-request") return;
      const lock = authorityLocks.acquire(message.actorUuid, message.requestId, message.userId);
      const response = message.state === actorActionFingerprint(authoritativeActor)
        ? lock
        : { granted: false, reason: "stale" };
      if (!response.granted && lock.granted) {
        authorityLocks.release(message.actorUuid, message.requestId, message.userId, lock.token);
      }
      queueMicrotask(() => listener({
        protocol: 2,
        type: "lock-response",
        requestId: message.requestId,
        targetUserId: message.userId,
        actorUuid: message.actorUuid,
        ...response
      }));
    }
  };
  initializeActionTransactions({ socket, users: [player, gm], user: player });

  let called = false;
  const result = await runExclusiveActorAction(stalePlayerActor, async () => { called = true; });
  assert.equal(result.started, false);
  assert.equal(result.reason, "stale");
  assert.equal(called, false);
});

test("the configured GM socket handler grants, holds, and releases a matching lease", async () => {
  const gm = { id: "gm", active: true, isGM: true };
  const player = { id: "player", active: true, isGM: false };
  const actor = {
    uuid: "Actor.hero",
    system: {
      ap: { value: 4, temp: 0 }, rp: { value: 3, temp: 0 },
      mana: { value: 6, temp: 0 }, hp: { value: 20, temp: 0 },
      encounter: { secretArtUsed: false }
    },
    items: [], flags: {},
    testUserPermission: (user, permission) => user.id === "player" && permission === "OWNER"
  };
  let listener;
  const emitted = [];
  const socket = {
    on: (namespace, callback) => { listener = callback; },
    off: () => {},
    emit: (namespace, message) => { emitted.push(message); }
  };
  initializeActionTransactions({
    socket,
    users: [player, gm],
    user: gm,
    resolveUuid: async () => actor
  });

  const request = {
    protocol: 2,
    type: "lock-request",
    actorUuid: actor.uuid,
    requestId: "request-1",
    userId: "player",
    state: actorActionFingerprint(actor)
  };
  await listener(request);
  assert.equal(emitted.at(-1).granted, true);
  const token = emitted.at(-1).token;

  await listener({ ...request, requestId: "request-2" });
  assert.equal(emitted.at(-1).reason, "busy");

  await listener({
    protocol: 2,
    type: "lock-release",
    actorUuid: actor.uuid,
    requestId: request.requestId,
    userId: request.userId,
    token
  });
  await listener({ ...request, requestId: "request-3" });
  assert.equal(emitted.at(-1).granted, true);
});

test("the GM rejects lock requests from users without Actor ownership", async () => {
  const gm = { id: "gm", active: true, isGM: true };
  const player = { id: "player", active: true, isGM: false };
  const actor = {
    uuid: "Actor.hero",
    system: {
      ap: { value: 4, temp: 0 }, rp: { value: 3, temp: 0 },
      mana: { value: 6, temp: 0 }, hp: { value: 20, temp: 0 },
      encounter: { secretArtUsed: false }
    },
    items: [], flags: {},
    testUserPermission: () => false
  };
  let listener;
  const emitted = [];
  const socket = {
    on: (namespace, callback) => { listener = callback; },
    off: () => {},
    emit: (namespace, message) => { emitted.push(message); }
  };
  initializeActionTransactions({
    socket, users: [player, gm], user: gm, resolveUuid: async () => actor
  });
  await listener({
    protocol: 2, type: "lock-request", actorUuid: actor.uuid,
    requestId: "forbidden", userId: player.id, state: actorActionFingerprint(actor)
  });
  assert.equal(emitted.at(-1).granted, false);
  assert.equal(emitted.at(-1).reason, "forbidden");
});

test("a new GM authority waits one lease before granting locks", async () => {
  let now = 1_000;
  const gmA = { id: "gm-a", active: true, isGM: true };
  const gmB = { id: "gm-b", active: true, isGM: true };
  const users = [gmA, gmB];
  const socket = { on: () => {}, off: () => {}, emit: () => {} };
  initializeActionTransactions({ socket, users: () => users, user: () => gmB, now: () => now });
  gmA.active = false;
  const blocked = await runExclusiveActorAction({ uuid: "Actor.hero" }, async () => true);
  assert.equal(blocked.started, false);
  assert.equal(blocked.reason, "failover");
  now += 15_001;
  assert.equal((await runExclusiveActorAction({ uuid: "Actor.hero" }, async () => true)).started, true);
});
