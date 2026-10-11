/**
 * Only a weapon in hand can attack.
 *
 * The sheet only ever offered attack buttons for held weapons, but the attack
 * itself never checked — so Token Action HUD, which listed every weapon, and
 * any macro could swing a greatsword stowed in a pack, or one equipped with no
 * hand free for it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { equippedWeaponSlots, isHeldWeapon } from "../module/rules/weapon-slots.mjs";

const actorHolding = (...weapons) => ({ system: { equipment: { weapons } } });

test("held means in a hand, not merely owned or equipped", () => {
  const sword = { id: "s" };
  const dagger = { id: "d" };
  assert.equal(isHeldWeapon(sword, actorHolding(sword)), true);
  assert.equal(isHeldWeapon(dagger, actorHolding(sword)), false, "stowed");
  assert.equal(isHeldWeapon(sword, actorHolding()), false);
  assert.equal(isHeldWeapon(sword, {}), false, "an actor with no equipment holds nothing");
  assert.equal(isHeldWeapon(null, actorHolding(sword)), false);
});

test("an equipped weapon with no hand free is not held", () => {
  // Two two-handed weapons both marked equipped: only one can be in hand. The
  // second is equipped but displaced, which the sheet flags as "no hand free".
  const twoHander = (id) => ({ id, type: "weapon", system: { equipped: true, isTwoHanded: true, hands: "two" } });
  const [first, second] = [twoHander("g1"), twoHander("g2")];
  const slots = equippedWeaponSlots([first, second], { proficientWith: () => true });
  assert.deepEqual(slots.conflicts.map((w) => w.id), ["g2"], "precondition: the second has no hand");

  const actor = actorHolding(...slots.held);
  assert.equal(isHeldWeapon(first, actor), true);
  assert.equal(isHeldWeapon(second, actor), false);
});

test("the attack itself refuses, not just the buttons", () => {
  const item = readFileSync(new URL("../module/documents/item.mjs", import.meta.url), "utf8");
  const attack = item.slice(item.indexOf("async _rollWeaponAttack("));
  const guard = attack.indexOf("if (!isHeldWeapon(this, actor))");
  assert.ok(guard > -1, "no held check");
  assert.ok(guard < attack.indexOf("spendResources"), "refused before any AP is spent");
});
