import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { equippedWeaponSlots, weaponsDisplacedBy } from "../module/rules/weapon-slots.mjs";

function weapon(id, { hands = "one", equipped = true, group = "sword", proficient = true } = {}) {
  return {
    id,
    name: id,
    type: "weapon",
    system: { hands, equipped, group, proficient, isUnarmed: group === "unarmed" }
  };
}

const proficientWith = (item) => item.system.proficient !== false;

test("a lone equipped weapon fills the main hand", () => {
  const slots = equippedWeaponSlots([weapon("sword")]);
  assert.equal(slots.mainHand.id, "sword");
  assert.equal(slots.offHand, null);
  assert.equal(slots.dualWielding, false);
  assert.deepEqual(slots.held.map((item) => item.id), ["sword"]);
});

test("stowed weapons and non-weapons never reach a hand", () => {
  const slots = equippedWeaponSlots([
    weapon("stowed", { equipped: false }),
    { id: "potion", type: "gear", system: { equipped: true } },
    { id: "plate", type: "armor", system: { equipped: true } }
  ]);
  assert.equal(slots.mainHand, null);
  assert.deepEqual(slots.held, []);
  assert.deepEqual(slots.conflicts, []);
});

test("two One-Handed weapons are dual wielded", () => {
  const slots = equippedWeaponSlots([weapon("dagger"), weapon("shortsword")], { proficientWith });
  assert.equal(slots.mainHand.id, "dagger");
  assert.equal(slots.offHand.id, "shortsword");
  assert.equal(slots.dualWielding, true);
  assert.deepEqual(slots.conflicts, []);
});

test("a Two-Handed weapon takes both hands", () => {
  const slots = equippedWeaponSlots([
    weapon("greatsword", { hands: "two" }),
    weapon("dagger")
  ], { proficientWith });
  assert.equal(slots.mainHand.id, "greatsword");
  assert.equal(slots.offHand, null);
  assert.equal(slots.dualWielding, false);
  assert.deepEqual(slots.conflicts.map((item) => item.id), ["dagger"]);
});

test("a One-Handed weapon cannot pair with a Two-Handed one either way round", () => {
  const slots = equippedWeaponSlots([
    weapon("dagger"),
    weapon("greatsword", { hands: "two" })
  ], { proficientWith });
  assert.equal(slots.mainHand.id, "dagger");
  assert.equal(slots.offHand, null);
  assert.deepEqual(slots.conflicts.map((item) => item.id), ["greatsword"]);
});

test("a shield occupies the off hand", () => {
  const slots = equippedWeaponSlots([weapon("dagger"), weapon("shortsword")], {
    shieldEquipped: true,
    proficientWith
  });
  assert.equal(slots.offHand, null);
  assert.equal(slots.dualWielding, false);
  assert.deepEqual(slots.conflicts.map((item) => item.id), ["shortsword"]);
});

test("dual wielding needs proficiency in both weapons", () => {
  const offHandUntrained = equippedWeaponSlots([
    weapon("dagger"),
    weapon("rapier", { proficient: false })
  ], { proficientWith });
  assert.equal(offHandUntrained.offHand, null);
  assert.deepEqual(offHandUntrained.conflicts.map((item) => item.id), ["rapier"]);

  const mainHandUntrained = equippedWeaponSlots([
    weapon("rapier", { proficient: false }),
    weapon("dagger")
  ], { proficientWith });
  assert.equal(mainHandUntrained.mainHand.id, "rapier");
  assert.equal(mainHandUntrained.offHand, null);
});

test("unarmed strikes cannot be dual wielded", () => {
  const slots = equippedWeaponSlots([
    weapon("fist", { group: "unarmed" }),
    weapon("dagger")
  ], { proficientWith });
  assert.equal(slots.offHand, null);
  assert.deepEqual(slots.conflicts.map((item) => item.id), ["dagger"]);
});

test("unarmed is recognised from raw data as well as prepared items", () => {
  const raw = { id: "fist", type: "weapon", system: { hands: "one", equipped: true, group: "unarmed" } };
  const slots = equippedWeaponSlots([raw, weapon("dagger")], { proficientWith });
  assert.equal(slots.offHand, null);
});

test("only a third weapon conflicts when two are already paired", () => {
  const slots = equippedWeaponSlots([
    weapon("dagger"),
    weapon("shortsword"),
    weapon("handaxe")
  ], { proficientWith });
  assert.deepEqual(slots.held.map((item) => item.id), ["dagger", "shortsword"]);
  assert.deepEqual(slots.conflicts.map((item) => item.id), ["handaxe"]);
});

/* -------------------------------------------- */
/*  Switching weapons                            */
/* -------------------------------------------- */

test("equipping a Two-Handed weapon stows everything else", () => {
  const greatsword = weapon("greatsword", { hands: "two", equipped: false });
  const displaced = weaponsDisplacedBy(greatsword, [
    greatsword,
    weapon("dagger"),
    weapon("shortsword")
  ], { proficientWith });
  assert.deepEqual(displaced.map((item) => item.id), ["dagger", "shortsword"]);
});

test("equipping a second One-Handed weapon stows nothing", () => {
  const shortsword = weapon("shortsword", { equipped: false });
  const displaced = weaponsDisplacedBy(shortsword, [shortsword, weapon("dagger")], {
    proficientWith
  });
  assert.deepEqual(displaced, []);
});

test("the newly equipped weapon wins the main hand", () => {
  const dagger = weapon("dagger", { equipped: false });
  const displaced = weaponsDisplacedBy(dagger, [dagger, weapon("greatsword", { hands: "two" })], {
    proficientWith
  });
  assert.deepEqual(displaced.map((item) => item.id), ["greatsword"]);
});

test("with a shield up, a second One-Handed weapon stows the first", () => {
  const shortsword = weapon("shortsword", { equipped: false });
  const displaced = weaponsDisplacedBy(shortsword, [shortsword, weapon("dagger")], {
    shieldEquipped: true,
    proficientWith
  });
  assert.deepEqual(displaced.map((item) => item.id), ["dagger"]);
});

test("stowed weapons are left alone and non-weapons displace nothing", () => {
  const dagger = weapon("dagger", { equipped: false });
  assert.deepEqual(
    weaponsDisplacedBy(dagger, [dagger, weapon("axe", { equipped: false })], { proficientWith }),
    []
  );
  const shield = { id: "shield", type: "armor", system: { equipped: false } };
  assert.deepEqual(weaponsDisplacedBy(shield, [shield, weapon("dagger")]), []);
});

/* -------------------------------------------- */
/*  Wiring                                       */
/* -------------------------------------------- */

test("the actor's equipment block exposes the hand slots", () => {
  const source = readFileSync(new URL("../module/data/actor.mjs", import.meta.url), "utf8");
  assert.match(source, /equippedWeaponSlots/);
  // Burden is paid for every weapon carried, so the slot filter must not be
  // the thing that decides what the character is loaded down with.
  assert.match(source, /out\.weapons = weaponSlots\.held/);
  for (const key of ["mainHand", "offHand", "weaponConflicts", "dualWielding"]) {
    assert.match(source, new RegExp(`out\\.${key} = `), `${key} is not published`);
  }
});

test("the overview offers attacks only for weapons in hand", () => {
  const template = readFileSync(
    new URL("../templates/actor/tab-main.hbs", import.meta.url), "utf8");

  // The attack list iterates the held/stowed view model, not the raw bucket:
  // the bucket holds every weapon owned and would arm all of them at once.
  assert.match(template, /\{\{#each weaponRows as \|row\|\}\}/);
  assert.doesNotMatch(template, /\{\{#each items\.weapons/);

  const row = template.slice(
    template.indexOf("{{#each weaponRows"),
    template.indexOf("LYRIAN.Empty.MonsterWeapons"));
  const attackButtons = row.slice(row.indexOf("{{#if row.held}}", row.indexOf("lyr-row__actions")));
  assert.match(attackButtons, /data-action="attack"/);
  assert.match(attackButtons, /data-action="multiAttack"/);
  // Switching stays reachable from the overview for stowed weapons.
  assert.match(row, /data-action="toggleEquip"/);
});

test("the sheet marks which weapons are held", () => {
  const source = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
  assert.match(source, /context\.weaponRows = /);
  assert.match(source, /weaponsDisplacedBy/);
  // Unarmed stays available while armed.
  assert.match(source, /context\.showUniversalAttacks = context\.isCharacter;/);
});
