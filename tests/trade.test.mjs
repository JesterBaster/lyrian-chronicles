import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TRADEABLE_ITEM_TYPES,
  installedModsFor,
  isEmptyOffer,
  isTradeable,
  normalizeTradeOffer,
  normalizeTradeSide,
  planTrade,
  planTradeSide,
  repointInstalledMod,
  settleClim,
  stackSize,
  tradeableInventory
} from "../module/rules/trade.mjs";

const SYSTEM = "lyrian-chronicles";

function gear(id, quantity = 1, extra = {}) {
  return { id, name: id, type: "gear", system: { quantity }, flags: {}, ...extra };
}
function weapon(id, extra = {}) {
  return { id, name: id, type: "weapon", system: { equipped: false }, flags: {}, ...extra };
}
function mod(id, hostId) {
  return {
    id, name: id, type: "gear",
    system: { quantity: 1 },
    flags: { [SYSTEM]: { installedMod: { targetItemId: hostId, targetName: hostId, slot: "A" } } }
  };
}

/* -------------------------------------------- */
/*  What may be offered                          */
/* -------------------------------------------- */

test("only what lives in a bag can be traded", () => {
  assert.deepEqual(TRADEABLE_ITEM_TYPES, ["weapon", "armor", "gear", "equipment"]);
  for (const type of TRADEABLE_ITEM_TYPES) {
    assert.equal(isTradeable({ type, flags: {} }), true, type);
  }
  // Progression and condition are not property: an ability comes from a class,
  // and an injury is something you have rather than something you own.
  for (const type of ["ability", "class", "race", "breakthrough", "injury", "monsterAbility"]) {
    assert.equal(isTradeable({ type, flags: {} }), false, type);
  }
});

test("an installed Mod is part of its host, not loose property", () => {
  assert.equal(isTradeable(mod("polish", "sword")), false);
  assert.equal(isTradeable(gear("rope")), true);
});

test("only gear keeps a count", () => {
  assert.equal(stackSize(gear("arrows", 12)), 12);
  assert.equal(stackSize(weapon("sword")), 1);
  assert.equal(stackSize(gear("broken", -3)), 0, "a negative stack is not a debt");
  assert.equal(stackSize(gear("odd", 2.7)), 2);
});

test("the picker lists tradeables with their stack, mods and equipped state", () => {
  const items = [
    weapon("sword", { system: { equipped: true } }),
    mod("polish", "sword"),
    gear("arrows", 12),
    { id: "fireball", name: "fireball", type: "ability", flags: {} }
  ];
  const rows = tradeableInventory(items);
  assert.deepEqual(rows.map((row) => row.id), ["arrows", "sword"], "sorted by name, mod excluded");
  const sword = rows.find((row) => row.id === "sword");
  assert.equal(sword.equipped, true);
  assert.equal(sword.mods, 1);
  assert.equal(rows.find((row) => row.id === "arrows").stack, 12);
});

/* -------------------------------------------- */
/*  Offer shape                                  */
/* -------------------------------------------- */

test("a repeated row is one intent, not two", () => {
  // Double-clicking a row must not let someone promise the same stack twice.
  const side = normalizeTradeSide({ items: [
    { itemId: "arrows", quantity: 3 },
    { itemId: "arrows", quantity: 4 }
  ] });
  assert.deepEqual(side.items, [{ itemId: "arrows", quantity: 7 }]);
});

test("nonsense in an offer is discarded rather than trusted", () => {
  const side = normalizeTradeSide({
    items: [
      { itemId: "", quantity: 5 },
      { itemId: "rope", quantity: 0 },
      { itemId: "arrows", quantity: -2 },
      { itemId: "coin", quantity: "3" }
    ],
    clim: -50
  });
  assert.deepEqual(side.items, [{ itemId: "coin", quantity: 3 }]);
  assert.equal(side.clim, 0, "a negative offer is not a demand for payment");
});

test("an offer with nothing in it is recognised", () => {
  assert.equal(isEmptyOffer({}), true);
  assert.equal(isEmptyOffer({ give: { clim: 5 } }), false);
  assert.equal(isEmptyOffer({ take: { items: [{ itemId: "rope", quantity: 1 }] } }), false);
});

/* -------------------------------------------- */
/*  Moving goods                                 */
/* -------------------------------------------- */

test("part of a stack is split, not moved", () => {
  const items = [gear("arrows", 12)];
  const plan = planTradeSide({ side: { items: [{ itemId: "arrows", quantity: 5 }] }, items });

  assert.equal(plan.hosts.length, 1);
  assert.equal(plan.hosts[0].data.system.quantity, 5, "the receiver gets what was promised");
  assert.deepEqual(plan.sourceUpdates, [{ _id: "arrows", "system.quantity": 7 }]);
  assert.deepEqual(plan.sourceDeletes, [], "the giver keeps the rest of the stack");
});

test("the whole stack is moved, leaving no empty husk", () => {
  const plan = planTradeSide({
    side: { items: [{ itemId: "arrows", quantity: 12 }] },
    items: [gear("arrows", 12)]
  });
  assert.equal(plan.hosts[0].data.system.quantity, 12);
  assert.deepEqual(plan.sourceDeletes, ["arrows"]);
  assert.deepEqual(plan.sourceUpdates, [], "a zero-quantity leftover would be worse than nothing");
});

test("asking for more than is offered still only moves what exists", () => {
  // planTrade refuses this outright; the side planner must not invent stock.
  const plan = planTradeSide({
    side: { items: [{ itemId: "arrows", quantity: 99 }] },
    items: [gear("arrows", 3)]
  });
  assert.deepEqual(plan.sourceDeletes, ["arrows"]);
});

test("what arrives is never already equipped", () => {
  const plan = planTradeSide({
    side: { items: [{ itemId: "sword", quantity: 1 }] },
    items: [weapon("sword", { system: { equipped: true } })]
  });
  assert.equal(plan.hosts[0].data.system.equipped, false,
    "a traded sword must not land in the receiver's hand");
});

test("a Mod travels with its host and leaves the giver with it", () => {
  const items = [weapon("sword"), mod("polish", "sword"), mod("grip", "sword"), gear("rope")];
  const plan = planTradeSide({ side: { items: [{ itemId: "sword", quantity: 1 }] }, items });

  assert.deepEqual(plan.hosts[0].mods.map((entry) => entry.name), ["polish", "grip"]);
  // Both the host and its mods leave, or the giver keeps mods pointing at
  // an item that is no longer theirs.
  assert.deepEqual(plan.sourceDeletes.sort(), ["grip", "polish", "sword"]);
});

test("a split stack does not drag mods with it", () => {
  // Half a stack is not the host leaving, so nothing installed goes anywhere.
  const items = [gear("kit", 4), mod("polish", "kit")];
  const plan = planTradeSide({ side: { items: [{ itemId: "kit", quantity: 1 }] }, items });
  assert.deepEqual(plan.hosts[0].mods, []);
  assert.deepEqual(plan.sourceDeletes, []);
});

test("a Mod is re-pointed at the copy of its host", () => {
  const moved = repointInstalledMod(mod("polish", "old-sword"), "new-sword", "Sword");
  assert.equal(moved.flags[SYSTEM].installedMod.targetItemId, "new-sword");
  assert.equal(moved.flags[SYSTEM].installedMod.targetName, "Sword");
  assert.equal(moved.flags[SYSTEM].installedMod.slot, "A", "the rest of the flag survives");

  // Something with no flag is returned untouched rather than given one.
  assert.deepEqual(repointInstalledMod(gear("rope"), "x").flags, {});
});

test("installedModsFor finds only that host's mods", () => {
  const items = [mod("a", "sword"), mod("b", "shield"), gear("rope")];
  assert.deepEqual(installedModsFor("sword", items).map((entry) => entry.id), ["a"]);
  assert.deepEqual(installedModsFor("nothing", items), []);
});

/* -------------------------------------------- */
/*  Both sides together                          */
/* -------------------------------------------- */

const offer = {
  fromUuid: "Actor.a",
  toUuid: "Actor.b",
  give: { items: [{ itemId: "sword", quantity: 1 }], clim: 10 },
  take: { items: [{ itemId: "arrows", quantity: 5 }], clim: 0 }
};
const alice = { items: [weapon("sword")], clim: 100 };
const bob = { items: [gear("arrows", 12)], clim: 0 };

test("a sound trade plans both sides", () => {
  const plan = planTrade({ offer, from: alice, to: bob });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.fromSide.sourceDeletes, ["sword"]);
  assert.deepEqual(plan.toSide.sourceUpdates, [{ _id: "arrows", "system.quantity": 7 }]);
});

test("if either side has fallen short, nothing moves", () => {
  // The gap between offering and accepting is exactly when someone spends the
  // coin they promised, so half a trade must never happen.
  const broke = planTrade({ offer, from: { ...alice, clim: 3 }, to: bob });
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, "short");
  assert.equal(broke.shortages[0].side, "from");
  assert.equal(broke.fromSide, undefined, "a refused trade produces no plan to apply");

  const spent = planTrade({ offer, from: alice, to: { items: [gear("arrows", 2)], clim: 0 } });
  assert.equal(spent.ok, false);
  assert.equal(spent.shortages[0].side, "to");
  assert.equal(spent.shortages[0].available, 2);
});

test("an item sold on since the offer is caught", () => {
  const plan = planTrade({ offer, from: { items: [], clim: 100 }, to: bob });
  assert.equal(plan.ok, false);
  assert.equal(plan.shortages[0].itemId, "sword");
});

test("an offer that cannot be a trade is refused before any lookup", () => {
  assert.equal(planTrade({ offer: {}, from: alice, to: bob }).reason, "empty");
  assert.equal(
    planTrade({ offer: { ...offer, toUuid: "Actor.a" }, from: alice, to: bob }).reason,
    "invalid-parties",
    "an actor cannot trade with itself"
  );
});

test("an installed Mod cannot be offered on its own", () => {
  const sneaky = planTrade({
    offer: { fromUuid: "Actor.a", toUuid: "Actor.b", give: { items: [{ itemId: "polish", quantity: 1 }] } },
    from: { items: [weapon("sword"), mod("polish", "sword")], clim: 0 },
    to: bob
  });
  assert.equal(sneaky.ok, false, "it belongs to the weapon, not the bag");
});

/* -------------------------------------------- */
/*  Coin                                         */
/* -------------------------------------------- */

test("coin nets out in one step", () => {
  const purses = settleClim({ fromClim: 100, toClim: 20, give: 30, take: 5 });
  assert.equal(purses.from, 75);
  assert.equal(purses.to, 45);
});

test("a purse never goes negative", () => {
  assert.equal(settleClim({ fromClim: 5, toClim: 0, give: 50 }).from, 0);
});

test("an actor with no purse is left without one", () => {
  // Rather than being handed a field they do not have.
  const purses = settleClim({ fromClim: 100, toClim: undefined, give: 10 });
  assert.equal(purses.from, 90);
  assert.equal("to" in purses, false);
});

test("an offer normalizes to something a socket can carry", () => {
  const normalized = normalizeTradeOffer({ fromUuid: "Actor.a", note: 5, give: { clim: "7" } });
  assert.equal(typeof normalized.note, "string");
  assert.equal(normalized.give.clim, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), normalized,
    "everything in an offer has to survive a round trip through JSON");
});

/* -------------------------------------------- */
/*  Wiring                                       */
/* -------------------------------------------- */

test("the schema, migration and manifest move together for the NPC purse", () => {
  const schema = readFileSync(new URL("../module/data/actor.mjs", import.meta.url), "utf8");
  const base = schema.slice(0, schema.indexOf("export class LyrianCharacter"));
  assert.match(base, /schema\.clim = int\(0, \{ min: 0 \}\)/,
    "a merchant with no purse cannot take payment");

  const migration = readFileSync(
    new URL("../migrations/0.6.31.mjs", import.meta.url), "utf8");
  // Overwriting an existing value would empty every character's purse.
  assert.match(migration, /if \(typeof source\.clim === "number"\) return/);
  const versions = readFileSync(new URL("../migrations/migrate.mjs", import.meta.url), "utf8");
  assert.match(versions, /"0\.6\.31"/);
});

test("the card is written from what the giver still holds", () => {
  const service = readFileSync(
    new URL("../module/trade/trade-service.mjs", import.meta.url), "utf8");
  const settle = service.slice(service.indexOf("export async function settleTrade"));
  const body = settle.slice(0, settle.indexOf("\n/** Create"));
  // Described after the move, every name would fall back to a raw id, because
  // the giver no longer has the item to look up.
  assert.ok(
    body.indexOf("describeSide(from") < body.indexOf("moveGoods(from"),
    "both sides must be described before anything moves"
  );
});

test("exactly one client settles an accepted offer", () => {
  const service = readFileSync(
    new URL("../module/trade/trade-service.mjs", import.meta.url), "utf8");
  const respond = service.slice(service.indexOf("export async function respondToTrade"));
  const body = respond.slice(0, respond.indexOf("\n/* ---"));

  // Settling locally *and* broadcasting would apply the trade twice and
  // duplicate everything in it.
  assert.match(body, /if \(authority\.id === game\.user\.id\) return settleTrade\(offer\)/);
  assert.match(body, /emit\(\{ type: "settle"/);
  const settleAt = body.indexOf("return settleTrade(offer)");
  const emitAt = body.indexOf('emit({ type: "settle"');
  assert.ok(settleAt < emitAt && body.slice(settleAt, emitAt).includes("\n"),
    "the local settle returns rather than falling through to the broadcast");
});

test("settling creates before it deletes", () => {
  const service = readFileSync(
    new URL("../module/trade/trade-service.mjs", import.meta.url), "utf8");
  const move = service.slice(service.indexOf("async function moveGoods"));
  const body = move.slice(0, move.indexOf("\nasync function"));
  assert.ok(
    body.indexOf("createEmbeddedDocuments") < body.indexOf("deleteEmbeddedDocuments"),
    "deleting first would destroy the goods if the copy then failed"
  );
  // Both sides are validated before either moves.
  assert.ok(
    service.indexOf("planTrade({") < service.indexOf("moveGoods(from"),
    "the plan must be complete before anything is written"
  );
});
