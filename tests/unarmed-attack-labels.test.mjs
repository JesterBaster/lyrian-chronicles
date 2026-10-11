/**
 * The universal attack is an unarmed strike, and has to read as one.
 *
 * Reported as "two-handed melee heavies deal 4d6, not 5d6". Every weapon path
 * rolls 5d6 for a two-handed melee heavy. The universal row rolls the unarmed
 * profile — 4d6 — and sat first in the Attacks list with a hint saying "No
 * weapon equipped" whether or not one was, so it was pressed in its place.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const EN = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const template = readFileSync(new URL("../templates/actor/tab-main.hbs", import.meta.url), "utf8");
const sheet = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");

test("the universal row comes after the weapons, not before them", () => {
  const weapons = template.indexOf("{{#each weaponRows as |row|}}");
  const universal = template.indexOf("{{#if showUniversalAttacks}}");
  assert.ok(weapons > -1 && universal > -1);
  assert.ok(universal > weapons, "the weapon's own buttons are the first ones a player meets");
});

test("its hint only claims no weapon is held when none is", () => {
  assert.match(template,
    /\{\{#if anyWeaponHeld\}\}\{\{localize "LYRIAN\.Hint\.UniversalAttackArmed"\}\}\{\{else\}\}\{\{localize "LYRIAN\.Hint\.UniversalAttack"\}\}/);
  assert.match(sheet, /context\.anyWeaponHeld = /);
  assert.match(EN["LYRIAN.Hint.UniversalAttackArmed"], /not your weapon/i);
});

test("the HUD's unarmed label fills in the attack's name", () => {
  assert.equal(EN["LYRIAN.TAH.UnarmedAttack"].replace("{attack}", "Heavy Attack"), "Unarmed Heavy Attack");
  assert.doesNotMatch(EN["LYRIAN.TAH.Tooltip.Weapon"], /ctrl/i,
    "a tooltip still sending players to modifier keys would describe buttons that no longer exist");
});
