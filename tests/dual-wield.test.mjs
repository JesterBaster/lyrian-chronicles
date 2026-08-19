import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { dualWieldFollowUp, pendingDualWieldWeaponId } from "../module/rules/dual-wield.mjs";

// A character holding a dagger in each hand.
const pair = { mainHandId: "main", offHandId: "off", dualWielding: true };

/** Swing a weapon and get back the AP verdict plus the turn state that follows. */
function swing(state, weaponId, attackType = "light") {
  const result = dualWieldFollowUp({ ...pair, ...state, weaponId, attackType });
  return { free: result.free, openerId: result.openerId, used: result.used };
}

test("the second weapon's light attack is free", () => {
  // Open with the main hand: paid, and the window opens.
  const first = swing({}, "main");
  assert.equal(first.free, false);
  assert.equal(first.openerId, "main");

  // Follow up with the off hand: free, and the window closes for the turn.
  const second = swing(first, "off");
  assert.equal(second.free, true);
  assert.equal(second.used, true);
  assert.equal(second.openerId, "");
});

test("it works opening from either hand", () => {
  const first = swing({}, "off");
  assert.equal(first.openerId, "off");
  assert.equal(swing(first, "main").free, true);
});

test("only one follow-up per turn", () => {
  let state = swing({}, "main");
  state = swing(state, "off");
  assert.equal(state.free, true);

  // A third and fourth swing are ordinary paid attacks.
  state = swing(state, "main");
  assert.equal(state.free, false);
  assert.equal(state.openerId, "", "a spent turn opens no new window");
  state = swing(state, "off");
  assert.equal(state.free, false);
});

test("swinging the same weapon twice is two paid attacks", () => {
  const first = swing({}, "main");
  const second = swing(first, "main");
  assert.equal(second.free, false);
  // It is simply the start of a new pair.
  assert.equal(second.openerId, "main");
  assert.equal(swing(second, "off").free, true);
});

test("'immediately' means a heavy swing in between closes the window", () => {
  const first = swing({}, "main");
  const interrupted = swing(first, "main", "heavy");
  assert.equal(interrupted.openerId, "");
  assert.equal(swing(interrupted, "off").free, false,
    "the off-hand attack no longer follows the light attack immediately");
});

test("heavy and precise attacks are never the free one", () => {
  const first = swing({}, "main");
  for (const attackType of ["heavy", "precise"]) {
    assert.equal(swing(first, "off", attackType).free, false);
  }
});

test("nothing is free without a weapon in each hand", () => {
  const solo = { mainHandId: "main", offHandId: "", dualWielding: false };
  const first = dualWieldFollowUp({ ...solo, weaponId: "main", attackType: "light" });
  assert.equal(first.free, false);
  assert.equal(first.openerId, "", "no window opens when not dual wielding");
  assert.equal(
    dualWieldFollowUp({ ...solo, weaponId: "main", attackType: "light", openerId: "main" }).free,
    false
  );
});

test("a stowed weapon neither opens the window nor closes it", () => {
  const first = swing({}, "main");
  // Something not in either hand: the pending window survives untouched.
  const stowed = swing(first, "packed");
  assert.equal(stowed.free, false);
  assert.equal(stowed.openerId, "main");
  assert.equal(swing(stowed, "off").free, true);
});

test("the free attack is not handed out twice by a repeated call", () => {
  const first = swing({}, "main");
  const second = swing(first, "off");
  assert.equal(second.free, true);
  // Same inputs as the follow-up, but the turn state now says it is spent.
  assert.equal(swing(second, "off").free, false);
});

/* -------------------------------------------- */
/*  What the sheet shows                         */
/* -------------------------------------------- */

test("the sheet knows which button to mark free", () => {
  assert.equal(pendingDualWieldWeaponId({ ...pair, openerId: "main" }), "off");
  assert.equal(pendingDualWieldWeaponId({ ...pair, openerId: "off" }), "main");

  // Nothing to mark before an attack, after the free one is spent, or when
  // only one hand is armed.
  assert.equal(pendingDualWieldWeaponId({ ...pair, openerId: "" }), "");
  assert.equal(pendingDualWieldWeaponId({ ...pair, openerId: "main", used: true }), "");
  assert.equal(pendingDualWieldWeaponId({
    mainHandId: "main", offHandId: "", dualWielding: false, openerId: "main"
  }), "");
});

/* -------------------------------------------- */
/*  Wiring                                       */
/* -------------------------------------------- */

test("the attack pays nothing when the follow-up is free", () => {
  const source = readFileSync(new URL("../module/documents/item.mjs", import.meta.url), "utf8");
  const attack = source.slice(source.indexOf("async _rollWeaponAttack"));
  const body = attack.slice(0, attack.indexOf("\n  /*"));

  assert.match(body, /const free = options\.free \|\| dualWield\.free/);
  assert.match(body, /if \(!free\) \{/);

  // A refused payment must leave the window exactly as it was, or a failed
  // attack would burn the free swing.
  assert.ok(
    body.indexOf("spendResources") < body.indexOf('"system.turn.dualWieldOpenerId"'),
    "the turn state must only be written once the attack is going ahead"
  );
});

test("the window is a new one each turn", () => {
  const source = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
  for (const method of ["async refreshTurn", "async startEncounter"]) {
    const body = source.slice(source.indexOf(method));
    const scope = body.slice(0, body.indexOf("\n  }"));
    assert.match(scope, /"system\.turn\.dualWieldUsed": false/, `${method} must clear the window`);
    assert.match(scope, /"system\.turn\.dualWieldOpenerId": ""/, `${method} must clear the opener`);
  }
});

test("the state is stored on the actor, not held in memory", () => {
  // A reload part way through a turn must not hand the free attack back.
  const schema = readFileSync(new URL("../module/data/actor.mjs", import.meta.url), "utf8");
  assert.match(schema, /schema\.turn = new fields\.SchemaField/);
  assert.match(schema, /dualWieldOpenerId: new fields\.StringField/);
  assert.match(schema, /dualWieldUsed: new fields\.BooleanField/);

  // A schema change needs a migration, and the manifest has to move with it.
  const versions = readFileSync(new URL("../migrations/migrate.mjs", import.meta.url), "utf8");
  assert.match(versions, /"0\.6\.28"/);
  const manifest = JSON.parse(
    readFileSync(new URL("../system.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "0.6.28");
  assert.ok(manifest.download.includes("/0.6.28/"), "the download URL must match the version");
});

test("the free swing is labelled where the player looks", () => {
  const overview = readFileSync(
    new URL("../templates/actor/tab-main.hbs", import.meta.url), "utf8");
  assert.match(overview, /row\.dualWieldFree/);
  assert.match(overview, /LYRIAN\.Cost\.ZeroAP/);

  const card = readFileSync(
    new URL("../templates/chat/attack-card.hbs", import.meta.url), "utf8");
  assert.match(card, /\{\{#if dualWield\}\}/);
});
