/**
 * Monster abilities can carry an attack or healing, as player abilities can.
 *
 * Reported: "there isn't a way to attach attacks/healing to monster
 * abilities". The fields existed — a monster ability is a player ability with a
 * `kind` added, and rolls the same way — but the item sheet only showed them
 * for player abilities.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { statblockAccuracy } from "../module/rules/monster-attack.mjs";

const body = readFileSync(new URL("../templates/item/body.hbs", import.meta.url), "utf8");

/** The text of the `{{#if (eq type "<type>")}}` section. */
function section(type) {
  // The top-level one: the same condition also appears indented, nested in
  // other blocks.
  const start = body.indexOf(`\n{{#if (eq type "${type}")}}`);
  assert.ok(start > -1, `no ${type} section`);
  return body.slice(start, body.indexOf("\n{{/if}}", start));
}

test("monster abilities show the attack, healing and keyword fields", () => {
  for (const type of ["ability", "monsterAbility"]) {
    assert.match(section(type), /\{\{> abilityPayload\}\}/, `${type} does not show them`);
  }
  const start = body.indexOf('{{#*inline "abilityPayload"}}');
  const payload = body.slice(start, body.indexOf("{{/inline}}", start));
  for (const field of ["system.hasAttack", "system.attackType", "system.damageFormula",
    "system.usesWeapon", "system.hasHealing", "system.healingFormula", "toggleKeyword"]) {
    assert.ok(payload.includes(field), `${field} is missing from the shared fields`);
  }
});

test("the shared fields are defined once, so no input can be named twice", () => {
  // Two inputs with one name discard the whole submit. The two sections are
  // exclusive by type; the fields themselves must exist in one place only.
  assert.equal(body.split('name="system.hasAttack"').length - 1, 1);
  assert.equal(body.split('name="system.healingFormula"').length - 1, 1);
});

/* -------------------------------------------- */

test("a statblock monster attacks at the accuracy it prints", () => {
  // Troll prints +8 against a Focus of 4.
  const troll = { lightAttack: "+8 Accuracy, 2d4+6", heavyAttack: "+8 Accuracy, 4d6+12" };
  assert.deepEqual(statblockAccuracy(troll, 4), { standard: 8, precise: 12 },
    "Precise doubles Focus, so it adds Focus once more");

  // A statblock that prints only a heavy still gives its figure.
  assert.deepEqual(statblockAccuracy({ lightAttack: "None", heavyAttack: "+3 Accuracy, 4d6" }, 2),
    { standard: 3, precise: 5 });
  assert.equal(statblockAccuracy({}, 4), null, "nothing printed, nothing overridden");
  assert.equal(statblockAccuracy({ lightAttack: "None", heavyAttack: "" }, 4), null);
});

test("every shipped monster's accuracy matches what its statblock prints", () => {
  const index = JSON.parse(readFileSync(new URL("../content/compendium-index.json", import.meta.url), "utf8"));
  const monsters = index.packs.monsters.files.flatMap((file) => {
    const parsed = JSON.parse(readFileSync(new URL(`../content/${file}`, import.meta.url), "utf8"));
    return Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.items ?? []);
  });
  assert.equal(monsters.length, 84);

  const wrong = [];
  for (const monster of monsters) {
    const printed = String(monster.system.official.lightAttack).match(/[+-]?\d+/)?.[0];
    if (printed === undefined) continue;
    const accuracy = statblockAccuracy(monster.system.official, monster.system.stats.focus.value);
    if (accuracy?.standard !== Number(printed)) wrong.push(monster.name);
  }
  assert.deepEqual(wrong, []);
});

test("the monster model uses it, and keeps an effect's bonus on top", () => {
  const model = readFileSync(new URL("../module/data/actor.mjs", import.meta.url), "utf8");
  const official = model.slice(model.indexOf("if (this.official.enabled) {"));
  assert.match(official.slice(0, 1400), /statblockAccuracy\(this\.official, this\.stats\.focus\.total\)/);
  assert.match(official.slice(0, 1400), /printed\.standard \+ bonus/);
});
