/**
 * Refunding one use of an ability from its chat card.
 *
 * Asked for by players: undoing a mistaken use meant putting AP, RP and mana
 * back by hand and remembering to clear "used this round". A use now records
 * what it did on its card, and a refund is the exact inverse.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isRefundable,
  refundRecord,
  refundSummary,
  refundUpdates
} from "../module/rules/ability-refund.mjs";

const pools = (ap, rp, mana) => ({
  ap: { value: ap[0], max: ap[1], temp: ap[2] ?? 0 },
  rp: { value: rp[0], max: rp[1], temp: rp[2] ?? 0 },
  mana: { value: mana[0], max: mana[1], temp: mana[2] ?? 0 }
});

test("a use records what it spent and which allowances it used", () => {
  const record = refundRecord({
    actorUuid: "Actor.k", itemUuid: "Actor.k.Item.cleave", itemName: "Cleave",
    spent: { ap: { temp: 0, value: 2 }, mana: { temp: 1, value: 1 } },
    markedUsedThisRound: true
  });
  assert.deepEqual(record.pools, { ap: { temp: 0, value: 2 }, mana: { temp: 1, value: 1 } });
  assert.deepEqual(record.marks, { usedThisRound: true, secretArt: false, dualWield: false });
  assert.equal(record.refunded, false);
  assert.equal(isRefundable(record), true);
});

test("a free use that marked nothing has nothing to refund", () => {
  assert.equal(refundRecord({ spent: null }), null);
  assert.equal(refundRecord({ spent: { ap: { temp: 0, value: 0 } } }), null);
  assert.equal(isRefundable(null), false);
  // A free Rapid ability that set nothing, versus a free one that set a mark.
  assert.notEqual(refundRecord({ spent: null, markedSecretArt: true }), null);
});

test("a refund puts each point back where it came from", () => {
  const record = refundRecord({
    spent: { ap: { temp: 0, value: 2 }, rp: { temp: 1, value: 0 }, mana: { temp: 1, value: 2 } },
    markedUsedThisRound: true, markedSecretArt: true, markedDualWield: true
  });
  const { actor, item, restored } = refundUpdates(record, pools([2, 4], [1, 3, 0], [3, 8, 0]));

  assert.equal(actor["system.ap.value"], 4);
  assert.equal(actor["system.rp.temp"], 1, "temporary points come back as temporary");
  assert.equal("system.rp.value" in actor, false, "none came from the regular RP pool");
  assert.equal(actor["system.mana.value"], 5);
  assert.equal(actor["system.mana.temp"], 1);
  assert.equal(actor["system.encounter.secretArtUsed"], false);
  assert.equal(actor["system.turn.dualWieldUsed"], false);
  assert.deepEqual(item, { "system.usedThisRound": false });
  assert.deepEqual(restored, { ap: 2, rp: 1, mana: 3 });
});

test("a refund never fills a pool past its maximum", () => {
  // A new turn refilled AP after the use; the refund cannot push it over.
  const record = refundRecord({ spent: { ap: { temp: 0, value: 2 } } });
  const { actor, restored } = refundUpdates(record, pools([3, 4], [0, 3], [0, 8]));
  assert.equal(actor["system.ap.value"], 4);
  assert.deepEqual(restored, { ap: 1 }, "and the note says only what actually came back");
});

test("only the marks this use set are cleared", () => {
  const record = refundRecord({ spent: { ap: { temp: 0, value: 1 } } });
  const { actor, item } = refundUpdates(record, pools([0, 4], [0, 3], [0, 8]));
  assert.equal("system.encounter.secretArtUsed" in actor, false);
  assert.equal("system.turn.dualWieldUsed" in actor, false);
  assert.deepEqual(item, {}, "a Rapid ability never set used-this-round, so it is not cleared");
});

test("a refunded card has nothing left to give", () => {
  const record = refundRecord({ spent: { ap: { temp: 0, value: 2 } } });
  assert.equal(isRefundable({ ...record, refunded: true }), false);
});

test("the note reads as a player would say it", () => {
  assert.equal(refundSummary({ ap: 2, mana: 1 }), "2 AP, 1 Mana");
  assert.equal(refundSummary({}), "");
});

/* -------------------------------------------- */

const menu = readFileSync(new URL("../module/chat-refund.mjs", import.meta.url), "utf8");
const item = readFileSync(new URL("../module/documents/item.mjs", import.meta.url), "utf8");
const boot = readFileSync(new URL("../module/lyrian.mjs", import.meta.url), "utf8");

test("the option uses Foundry v14's context menu entry", () => {
  assert.match(menu, /Hooks\.on\("getChatMessageContextOptions", \(application, options\)/);
  // v14 renamed name/condition/callback, and onClick takes the event first.
  assert.match(menu, /label: game\.i18n\.localize\("LYRIAN\.Refund\.Option"\)/);
  assert.match(menu, /visible: \(target\) =>/);
  assert.match(menu, /onClick: \(event, target\) =>/);
  assert.doesNotMatch(menu, /\b(condition|callback):/, "the deprecated names log warnings until v16");
  assert.match(boot, /registerChatRefund\(\);/);
});

test("the card is marked before anything is given back", () => {
  const body = menu.slice(menu.indexOf("export async function refundAbilityUse"));
  assert.ok(body.indexOf("refunded: true") < body.indexOf("refundUpdates("),
    "two refunds at once must not both pay out");
  assert.match(body, /queueActorTransaction\(actor,/, "and it waits its turn behind any spending");
});

test("one use writes one record, on its first card", () => {
  assert.match(item, /const \[first\] = attacks;\s*\n\s*await this\._attachRefund\(first\?\.message, refund\);/);
  const strike = item.slice(item.indexOf("async _rollAbilityStrike("));
  assert.doesNotMatch(strike.slice(0, strike.indexOf("\n  }\n")), /_attachRefund/,
    "a strike that also recorded one would let a three-hit ability be refunded three times");
});
