import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canOfferFrom,
  canRespond,
  canSettle,
  respondersFor,
  selectTradeAuthority
} from "../module/rules/trade-routing.mjs";

const gm = { id: "gm", isGM: true, active: true };
const alice = { id: "alice", isGM: false, active: true };
const bob = { id: "bob", isGM: false, active: true };
const away = { id: "away", isGM: false, active: false };

/** An actor owned by the named users. */
function actor(...owners) {
  return {
    testUserPermission: (user, level) => level === "OWNER" && owners.includes(user.id)
  };
}

test("an offer reaches the actor's owners and every GM", () => {
  const bobsCharacter = actor("bob");
  assert.deepEqual(
    respondersFor(bobsCharacter, [gm, alice, bob]).map((user) => user.id),
    ["gm", "bob"]
  );
});

test("a GM can answer for an NPC nobody owns, which is what makes shops work", () => {
  const shopkeeper = actor();
  assert.deepEqual(respondersFor(shopkeeper, [gm, alice]).map((user) => user.id), ["gm"]);
  assert.deepEqual(respondersFor(shopkeeper, [alice, bob]), [],
    "with no GM connected there is nobody to trade with an NPC");
});

test("a disconnected owner is not somebody who can answer", () => {
  assert.deepEqual(respondersFor(actor("away"), [away]), []);
});

test("you cannot accept your own offer", () => {
  const bobsCharacter = actor("bob");
  // Even a GM who owns both ends is answering their own question, which is
  // not agreement — it is just moving goods, and that is what settling is for.
  assert.equal(canRespond({ user: bob, target: bobsCharacter, initiatorUserId: "bob" }), false);
  assert.equal(canRespond({ user: bob, target: bobsCharacter, initiatorUserId: "alice" }), true);
  assert.equal(canRespond({ user: gm, target: bobsCharacter, initiatorUserId: "gm" }), false);
});

test("a stranger cannot answer for someone else's character", () => {
  assert.equal(canRespond({ user: alice, target: actor("bob"), initiatorUserId: "bob" }), false);
  assert.equal(canRespond({ user: undefined, target: actor("bob") }), false);
});

test("only a GM settles", () => {
  // Settling writes to two actors. A player who owns one must never be the
  // one moving goods off the other.
  assert.equal(canSettle(gm), true);
  assert.equal(canSettle(alice), false);
  assert.equal(canSettle(undefined), false);
});

test("you can only offer property you own", () => {
  assert.equal(canOfferFrom({ user: bob, actor: actor("bob") }), true);
  assert.equal(canOfferFrom({ user: alice, actor: actor("bob") }), false);
  // A GM may offer on any actor's behalf, which is how an NPC makes an offer.
  assert.equal(canOfferFrom({ user: gm, actor: actor() }), true);
  assert.equal(canOfferFrom({ user: bob, actor: null }), false);
});

test("every client picks the same GM to settle", () => {
  const gmA = { id: "aaa", isGM: true, active: true };
  const gmB = { id: "bbb", isGM: true, active: true };
  // Sorted by id, so two GMs never both apply the same trade.
  assert.equal(selectTradeAuthority([gmB, gmA, alice]).id, "aaa");
  assert.equal(selectTradeAuthority([gmA, gmB]).id, "aaa");
  assert.equal(selectTradeAuthority([alice, bob]), null);
  assert.equal(selectTradeAuthority([{ id: "off", isGM: true, active: false }]), null);
});

/* -------------------------------------------- */
/*  Wiring                                       */
/* -------------------------------------------- */

test("the offer is re-checked where it is settled, not only where it was made", () => {
  const service = readFileSync(
    new URL("../module/trade/trade-service.mjs", import.meta.url), "utf8");

  // The offer arrives over a socket from a client that chose its own contents,
  // so the composer's checks prove nothing on their own.
  const settle = service.slice(service.indexOf("export async function settleTrade"));
  const body = settle.slice(0, settle.indexOf("\n/** Create"));
  assert.match(body, /if \(!canSettle\(game\.user\)\) return null/);
  assert.match(body, /planTrade\(/);

  // A settle request names its GM, and that GM re-derives the authority
  // rather than believing the address it was sent to.
  const handler = service.slice(service.indexOf('if (message.type === "settle")'));
  const block = handler.slice(0, handler.indexOf("\n\n"));
  assert.match(block, /message\.authorityId !== game\.user\.id/);
  assert.match(block, /selectTradeAuthority\(game\.users\)\?\.id !== game\.user\.id/);
});

test("the trade channel does not collide with the action-lock protocol", () => {
  const service = readFileSync(
    new URL("../module/trade/trade-service.mjs", import.meta.url), "utf8");
  const locks = readFileSync(
    new URL("../module/rules/action-transactions.mjs", import.meta.url), "utf8");

  // Both listen on the same system socket, so each has to ignore the other's
  // traffic rather than trying to parse it.
  assert.match(service, /const CHANNEL = "trade"/);
  assert.match(service, /if \(message\?\.channel !== CHANNEL\) return/);
  assert.match(locks, /message\?\.protocol !== PROTOCOL/);
  assert.doesNotMatch(service, /protocol:/, "trade messages must not look like lock messages");
});

test("the trade apps are registered and reachable", () => {
  const sheet = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
  assert.match(sheet, /openTrade: LyrianActorSheet\.#onOpenTrade/);

  const inventory = readFileSync(
    new URL("../templates/actor/tab-inventory.hbs", import.meta.url), "utf8");
  assert.match(inventory, /data-action="openTrade"/);

  const boot = readFileSync(new URL("../module/lyrian.mjs", import.meta.url), "utf8");
  assert.match(boot, /initializeTrading\(\)/);
  for (const template of ["chat/trade-card", "apps/trade-offer", "apps/trade-review"]) {
    assert.ok(boot.includes(`"${template}"`), `${template} is not preloaded`);
  }
});
